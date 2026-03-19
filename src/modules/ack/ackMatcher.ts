/**
 * ACK Matcher — message ↔ ack 매칭 및 미수신 감지
 */
import { db } from "../../config/firebase";

interface MatchResult {
  messageId: string;
  status: "delivered" | "undelivered";
  latencyMs?: number;
  appState?: string;
}

export class AckMatcher {
  /**
   * 특정 실험의 전체 메시지에 대해 ACK 매칭 수행
   */
  async matchExperiment(experimentId: string): Promise<MatchResult[]> {
    const messagesSnapshot = await db
      .collection("messages")
      .where("experimentId", "==", experimentId)
      .get();

    const results: MatchResult[] = [];

    for (const msgDoc of messagesSnapshot.docs) {
      const msg = msgDoc.data();
      const messageId = msg.messageId;

      const ackSnapshot = await db
        .collection("acks")
        .where("messageId", "==", messageId)
        .limit(1)
        .get();

      if (!ackSnapshot.empty) {
        const ack = ackSnapshot.docs[0].data();
        const sentAt = msg.sentAt?.toDate?.() || new Date(msg.sentAt);
        const receivedAt =
          ack.receivedAt?.toDate?.() || new Date(ack.receivedAt);
        const latencyMs = receivedAt.getTime() - sentAt.getTime();

        results.push({
          messageId,
          status: "delivered",
          latencyMs,
          appState: ack.appState,
        });
      } else {
        results.push({
          messageId,
          status: "undelivered",
        });
      }
    }

    return results;
  }

  /**
   * 매칭 결과로부터 기본 지표 계산
   */
  calculateMetrics(results: MatchResult[]) {
    const total = results.length;
    const delivered = results.filter((r) => r.status === "delivered");
    const latencies = delivered
      .map((r) => r.latencyMs!)
      .filter((l) => l >= 0)
      .sort((a, b) => a - b);

    return {
      total,
      deliveredCount: delivered.length,
      deliveryRate: total > 0 ? (delivered.length / total) * 100 : 0,
      avgLatencyMs:
        latencies.length > 0
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : null,
      p50LatencyMs: latencies.length > 0 ? percentile(latencies, 50) : null,
      p95LatencyMs: latencies.length > 0 ? percentile(latencies, 95) : null,
      p99LatencyMs: latencies.length > 0 ? percentile(latencies, 99) : null,
    };
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
