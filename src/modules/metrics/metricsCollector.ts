/**
 * Metrics Collector — M1~M8 지표 계산
 *
 * M1: 전달률 (Delivery Rate)
 * M2: 평균 지연시간 (Average Latency)
 * M3: P95 지연시간
 * M4: P99 지연시간
 * M5: 재시도율
 * M6: DLQ 비율
 * M7: 중복 수신율
 * M8: 처리량 (Messages/sec)
 */
import { db } from "../../config/firebase";

export interface Metrics {
  m1_deliveryRate: number;
  m2_avgLatencyMs: number | null;
  m3_p95LatencyMs: number | null;
  m4_p99LatencyMs: number | null;
  m5_retryRate: number;
  m6_dlqRate: number;
  m7_duplicateRate: number;
  m8_throughput: number | null;
}

export class MetricsCollector {
  async calculate(experimentId: string): Promise<Metrics> {
    // 메시지 조회
    const msgSnapshot = await db
      .collection("messages")
      .where("experimentId", "==", experimentId)
      .get();

    const messages = msgSnapshot.docs.map((d) => d.data());
    const totalMessages = messages.length;

    if (totalMessages === 0) {
      return emptyMetrics();
    }

    // ACK 조회
    const messageIds = messages.map((m) => m.messageId);
    const acks: any[] = [];
    // Firestore IN 쿼리는 최대 30개이므로 배치 처리
    for (let i = 0; i < messageIds.length; i += 30) {
      const batch = messageIds.slice(i, i + 30);
      const ackSnapshot = await db
        .collection("acks")
        .where("messageId", "in", batch)
        .get();
      acks.push(...ackSnapshot.docs.map((d) => d.data()));
    }

    // M1: 전달률 (ACK가 존재하는 메시지 = 실제 전달됨)
    const ackedMessageIds = new Set(acks.map((a) => a.messageId));
    const delivered = messages.filter(
      (m) => m.status === "delivered" || ackedMessageIds.has(m.messageId)
    ).length;
    const m1 = (delivered / totalMessages) * 100;

    // 지연시간 계산
    const latencies: number[] = [];
    for (const ack of acks) {
      const msg = messages.find((m) => m.messageId === ack.messageId);
      if (msg) {
        const sentAt = msg.sentAt?.toDate?.() || new Date(msg.sentAt);
        const receivedAt =
          ack.receivedAt?.toDate?.() || new Date(ack.receivedAt);
        const latency = receivedAt.getTime() - sentAt.getTime();
        if (latency >= 0) latencies.push(latency);
      }
    }
    latencies.sort((a, b) => a - b);

    // M2~M4
    const m2 =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : null;
    const m3 = latencies.length > 0 ? percentile(latencies, 95) : null;
    const m4 = latencies.length > 0 ? percentile(latencies, 99) : null;

    // M5: 재시도율
    const retried = messages.filter((m) => (m.retryCount || 0) > 0).length;
    const m5 = (retried / totalMessages) * 100;

    // M6: DLQ 비율
    const dlq = messages.filter((m) => m.status === "dlq").length;
    const m6 = (dlq / totalMessages) * 100;

    // M7: 중복 수신율 (동일 messageId에 대한 ACK가 2개 이상)
    const ackCounts = new Map<string, number>();
    for (const ack of acks) {
      ackCounts.set(ack.messageId, (ackCounts.get(ack.messageId) || 0) + 1);
    }
    const duplicates = Array.from(ackCounts.values()).filter((c) => c > 1).length;
    const m7 = acks.length > 0 ? (duplicates / ackCounts.size) * 100 : 0;

    // M8: 처리량 (실험 시작~종료 기간 동안 전송된 메시지/초)
    const expDoc = await db
      .collection("experiments")
      .doc(experimentId)
      .get();
    let m8: number | null = null;
    if (expDoc.exists) {
      const exp = expDoc.data()!;
      if (exp.startedAt && exp.completedAt) {
        const start = exp.startedAt.toDate?.() || new Date(exp.startedAt);
        const end = exp.completedAt.toDate?.() || new Date(exp.completedAt);
        const durationSec = (end.getTime() - start.getTime()) / 1000;
        if (durationSec > 0) {
          m8 = totalMessages / durationSec;
        }
      }
    }

    return {
      m1_deliveryRate: m1,
      m2_avgLatencyMs: m2,
      m3_p95LatencyMs: m3,
      m4_p99LatencyMs: m4,
      m5_retryRate: m5,
      m6_dlqRate: m6,
      m7_duplicateRate: m7,
      m8_throughput: m8,
    };
  }

  formatReport(experimentId: string, metrics: Metrics): string {
    const lines = [
      `# Experiment: ${experimentId}`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| M1 Delivery Rate | ${metrics.m1_deliveryRate.toFixed(2)}% |`,
      `| M2 Avg Latency | ${metrics.m2_avgLatencyMs?.toFixed(0) ?? "N/A"} ms |`,
      `| M3 P95 Latency | ${metrics.m3_p95LatencyMs?.toFixed(0) ?? "N/A"} ms |`,
      `| M4 P99 Latency | ${metrics.m4_p99LatencyMs?.toFixed(0) ?? "N/A"} ms |`,
      `| M5 Retry Rate | ${metrics.m5_retryRate.toFixed(2)}% |`,
      `| M6 DLQ Rate | ${metrics.m6_dlqRate.toFixed(2)}% |`,
      `| M7 Duplicate Rate | ${metrics.m7_duplicateRate.toFixed(2)}% |`,
      `| M8 Throughput | ${metrics.m8_throughput?.toFixed(1) ?? "N/A"} msg/s |`,
    ];
    return lines.join("\n");
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function emptyMetrics(): Metrics {
  return {
    m1_deliveryRate: 0,
    m2_avgLatencyMs: null,
    m3_p95LatencyMs: null,
    m4_p99LatencyMs: null,
    m5_retryRate: 0,
    m6_dlqRate: 0,
    m7_duplicateRate: 0,
    m8_throughput: null,
  };
}
