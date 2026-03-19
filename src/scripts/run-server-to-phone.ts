/**
 * 서버→폰 수신 시나리오 실험
 * FCM 사용 방법(메시지 유형, 우선순위, TTL, collapse 등)에 따른 QoS 차이 측정
 *
 * 실행: npx tsx src/scripts/run-server-to-phone.ts
 */
import { db } from "../config/firebase";
import { sendMessage, getLatestToken, MessageType } from "./send";
import { MetricsCollector } from "../modules/metrics/metricsCollector";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ServerToPhoneScenario {
  id: string;
  name: string;
  description: string;
  count: number;
  repeat: number;
  type: MessageType;
  interval: number;
  priority: "high" | "normal";
  ttl?: number;
  collapseKey?: string;
  payloadSize?: number;
  burstMode?: boolean; // 연속 전송 (interval=0)
}

const scenarios: ServerToPhoneScenario[] = [
  // === 그룹 A: 메시지 유형별 비교 (동일 조건) ===
  {
    id: "STP-A1",
    name: "Data-only (Silent Push)",
    description: "data 메시지만 전송, 앱이 직접 알림 표시 처리",
    count: 50, repeat: 3, type: "data", interval: 200,
    priority: "high",
  },
  {
    id: "STP-A2",
    name: "Notification-only",
    description: "notification 메시지만 전송, 시스템이 알림 표시",
    count: 50, repeat: 3, type: "notification", interval: 200,
    priority: "high",
  },
  {
    id: "STP-A3",
    name: "Combined (Data+Notification)",
    description: "data + notification 결합, 가장 일반적인 사용법",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "high",
  },

  // === 그룹 B: 우선순위별 비교 ===
  {
    id: "STP-B1",
    name: "High Priority",
    description: "android.priority=high, 즉시 전달 시도",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "high",
  },
  {
    id: "STP-B2",
    name: "Normal Priority",
    description: "android.priority=normal, 배터리 최적화 허용",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "normal",
  },

  // === 그룹 C: TTL(Time-To-Live) 비교 ===
  {
    id: "STP-C1",
    name: "TTL=0 (즉시 전달 또는 폐기)",
    description: "TTL 0초, 디바이스 오프라인이면 즉시 폐기",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "high", ttl: 0,
  },
  {
    id: "STP-C2",
    name: "TTL=86400 (24시간)",
    description: "TTL 24시간, FCM 기본값",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "high", ttl: 86400,
  },
  {
    id: "STP-C3",
    name: "TTL=2419200 (28일, 최대)",
    description: "TTL 28일, FCM 최대 보관 기간",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "high", ttl: 2419200,
  },

  // === 그룹 D: Collapse Key 비교 ===
  {
    id: "STP-D1",
    name: "Non-collapsible (각각 고유)",
    description: "collapse_key 없음, 모든 메시지 개별 전달",
    count: 50, repeat: 3, type: "data", interval: 200,
    priority: "high",
  },
  {
    id: "STP-D2",
    name: "Collapsible (동일 키)",
    description: "동일 collapse_key, 최신 메시지만 전달 (대기 중 덮어쓰기)",
    count: 50, repeat: 3, type: "data", interval: 200,
    priority: "high", collapseKey: "server-update",
  },

  // === 그룹 E: 전송 속도별 비교 (Burst vs Throttled) ===
  {
    id: "STP-E1",
    name: "Burst (10ms 간격)",
    description: "최대 속도로 연속 전송, rate limit 테스트",
    count: 50, repeat: 3, type: "combined", interval: 10,
    priority: "high",
  },
  {
    id: "STP-E2",
    name: "Moderate (200ms 간격)",
    description: "적정 속도 전송",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "high",
  },
  {
    id: "STP-E3",
    name: "Slow (1000ms 간격)",
    description: "느린 속도 전송, 여유 있는 처리",
    count: 50, repeat: 3, type: "combined", interval: 1000,
    priority: "high",
  },

  // === 그룹 F: 페이로드 크기별 비교 ===
  {
    id: "STP-F1",
    name: "Minimal payload (<100B)",
    description: "최소 페이로드, 알림만 전달",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "high",
  },
  {
    id: "STP-F2",
    name: "Medium payload (2KB)",
    description: "중간 크기 데이터 포함",
    count: 50, repeat: 3, type: "data", interval: 200,
    priority: "high", payloadSize: 2048,
  },
  {
    id: "STP-F3",
    name: "Large payload (4KB, 한도)",
    description: "FCM data 메시지 최대 크기에 근접",
    count: 50, repeat: 3, type: "data", interval: 200,
    priority: "high", payloadSize: 3900,
  },
];

function generatePayload(size?: number): Record<string, string> {
  if (!size || size <= 0) return {};
  const padding = "x".repeat(Math.max(0, size - 50));
  return { padding };
}

async function runScenario(
  scenario: ServerToPhoneScenario,
  token: string
): Promise<string[]> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📋 [${scenario.id}] ${scenario.name}`);
  console.log(`   ${scenario.description}`);
  console.log(`   ${scenario.count}건×${scenario.repeat}회 | type=${scenario.type} | priority=${scenario.priority} | interval=${scenario.interval}ms`);
  if (scenario.ttl != null) console.log(`   TTL=${scenario.ttl}s`);
  if (scenario.collapseKey) console.log(`   collapseKey=${scenario.collapseKey}`);
  if (scenario.payloadSize) console.log(`   payloadSize=${scenario.payloadSize}B`);
  console.log("=".repeat(60));

  const experimentIds: string[] = [];

  for (let r = 0; r < scenario.repeat; r++) {
    const experimentId = `${scenario.id}-R${r + 1}-${uuidv4().substring(0, 8)}`;
    experimentIds.push(experimentId);
    const startTime = Date.now();

    await db.collection("experiments").doc(experimentId).set({
      name: scenario.id,
      phase: 2,
      description: `[${scenario.id}] ${scenario.name} (R${r + 1}/${scenario.repeat})`,
      parameters: {
        count: scenario.count,
        type: scenario.type,
        interval: scenario.interval,
        priority: scenario.priority,
        ttl: scenario.ttl ?? null,
        collapseKey: scenario.collapseKey ?? null,
        payloadSize: scenario.payloadSize ?? null,
      },
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      messageCount: scenario.count,
      results: null,
    });

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < scenario.count; i++) {
      try {
        await sendMessage({
          token,
          title: `${scenario.id} #${i + 1}`,
          body: `${scenario.name} R${r + 1} M${i + 1}/${scenario.count}`,
          type: scenario.type,
          data: generatePayload(scenario.payloadSize),
          collapseKey: scenario.collapseKey,
          priority: scenario.priority,
          ttl: scenario.ttl,
          experimentId,
        });
        sent++;
      } catch {
        failed++;
      }

      if (scenario.interval > 0 && i < scenario.count - 1) {
        await sleep(scenario.interval);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    await db.collection("experiments").doc(experimentId).update({
      status: "completed",
      completedAt: new Date(),
      results: { totalSent: sent, totalFailed: failed, elapsedSeconds: parseFloat(elapsed) },
    });

    console.log(`   R${r + 1}: ${sent} sent, ${failed} failed (${elapsed}s)`);

    if (r < scenario.repeat - 1) {
      console.log("   쿨다운 15s...");
      await sleep(15000);
    }
  }

  return experimentIds;
}

interface ScenarioResult {
  id: string;
  name: string;
  description: string;
  group: string;
  experimentId: string;
  repeat: number;
  parameters: any;
  metrics: any;
}

async function main() {
  const token = await getLatestToken();
  console.log(`Token: ${token.substring(0, 20)}...`);
  console.log(`총 ${scenarios.length}개 시나리오 실행\n`);

  const collector = new MetricsCollector();
  const allResults: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    const experimentIds = await runScenario(scenario, token);

    // ACK 수신 대기
    console.log("\n⏳ ACK 수신 대기 20초...");
    await sleep(20000);

    for (let i = 0; i < experimentIds.length; i++) {
      const metrics = await collector.calculate(experimentIds[i]);
      allResults.push({
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        group: scenario.id.split("-")[1].charAt(0),
        experimentId: experimentIds[i],
        repeat: i + 1,
        parameters: {
          type: scenario.type,
          priority: scenario.priority,
          interval: scenario.interval,
          ttl: scenario.ttl ?? null,
          collapseKey: scenario.collapseKey ?? null,
          payloadSize: scenario.payloadSize ?? null,
          count: scenario.count,
        },
        metrics,
      });
    }

    console.log("💤 다음 시나리오 전 10초 대기...");
    await sleep(10000);
  }

  // 결과 저장
  const resultsDir = path.resolve(__dirname, "../../results");
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  // 1. JSON
  fs.writeFileSync(
    path.join(resultsDir, "server-to-phone-results.json"),
    JSON.stringify(allResults, null, 2)
  );

  // 2. CSV (원시 데이터)
  const csv = generateCSV(allResults);
  fs.writeFileSync(path.join(resultsDir, "server-to-phone-raw.csv"), csv);

  // 3. 시나리오 요약 CSV
  const summaryCSV = generateSummaryCSV(allResults);
  fs.writeFileSync(path.join(resultsDir, "server-to-phone-summary.csv"), summaryCSV);

  // 4. Markdown 보고서
  const report = generateReport(allResults);
  fs.writeFileSync(path.join(resultsDir, "server-to-phone-report.md"), report);

  console.log("\n💾 저장 완료:");
  console.log("  - results/server-to-phone-results.json");
  console.log("  - results/server-to-phone-raw.csv");
  console.log("  - results/server-to-phone-summary.csv");
  console.log("  - results/server-to-phone-report.md");
  console.log("\n✅ 모든 실험 완료!");
}

function generateCSV(results: ScenarioResult[]): string {
  const header = [
    "scenario_id", "scenario_name", "group", "repeat",
    "msg_type", "priority", "interval_ms", "ttl_sec", "collapse_key", "payload_bytes", "msg_count",
    "delivery_rate_pct", "avg_latency_ms", "p95_latency_ms", "p99_latency_ms",
    "retry_rate_pct", "dlq_rate_pct", "duplicate_rate_pct", "throughput_msg_per_sec",
    "experiment_id",
  ].join(",");

  const rows = results.map((r) => [
    r.id,
    `"${r.name}"`,
    r.group,
    r.repeat,
    r.parameters.type,
    r.parameters.priority,
    r.parameters.interval,
    r.parameters.ttl ?? "",
    r.parameters.collapseKey ?? "",
    r.parameters.payloadSize ?? "",
    r.parameters.count,
    r.metrics.m1_deliveryRate.toFixed(2),
    r.metrics.m2_avgLatencyMs?.toFixed(1) ?? "",
    r.metrics.m3_p95LatencyMs?.toFixed(1) ?? "",
    r.metrics.m4_p99LatencyMs?.toFixed(1) ?? "",
    r.metrics.m5_retryRate.toFixed(2),
    r.metrics.m6_dlqRate.toFixed(2),
    r.metrics.m7_duplicateRate.toFixed(2),
    r.metrics.m8_throughput?.toFixed(2) ?? "",
    r.experimentId,
  ].join(","));

  return [header, ...rows].join("\n");
}

function generateSummaryCSV(results: ScenarioResult[]): string {
  const header = [
    "scenario_id", "scenario_name", "group", "description",
    "msg_type", "priority", "interval_ms", "ttl_sec", "payload_bytes",
    "avg_delivery_rate_pct", "avg_latency_ms", "avg_p95_ms", "avg_p99_ms",
    "avg_throughput_msg_per_sec", "repeats",
  ].join(",");

  const grouped = new Map<string, ScenarioResult[]>();
  for (const r of results) {
    if (!grouped.has(r.id)) grouped.set(r.id, []);
    grouped.get(r.id)!.push(r);
  }

  const rows: string[] = [];
  for (const [id, runs] of grouped) {
    const first = runs[0];
    const avgM1 = avg(runs.map((r) => r.metrics.m1_deliveryRate));
    const avgM2 = avg(runs.map((r) => r.metrics.m2_avgLatencyMs).filter(nonNull));
    const avgM3 = avg(runs.map((r) => r.metrics.m3_p95LatencyMs).filter(nonNull));
    const avgM4 = avg(runs.map((r) => r.metrics.m4_p99LatencyMs).filter(nonNull));
    const avgM8 = avg(runs.map((r) => r.metrics.m8_throughput).filter(nonNull));

    rows.push([
      id,
      `"${first.name}"`,
      first.group,
      `"${first.description}"`,
      first.parameters.type,
      first.parameters.priority,
      first.parameters.interval,
      first.parameters.ttl ?? "",
      first.parameters.payloadSize ?? "",
      avgM1.toFixed(2),
      avgM2.toFixed(1),
      avgM3.toFixed(1),
      avgM4.toFixed(1),
      avgM8.toFixed(2),
      runs.length,
    ].join(","));
  }

  return [header, ...rows].join("\n");
}

function generateReport(results: ScenarioResult[]): string {
  const grouped = new Map<string, ScenarioResult[]>();
  for (const r of results) {
    if (!grouped.has(r.id)) grouped.set(r.id, []);
    grouped.get(r.id)!.push(r);
  }

  const lines: string[] = [
    "# 서버→폰 FCM 알림 수신 시나리오별 QoS 분석 보고서",
    "",
    `> 생성일: ${new Date().toISOString().split("T")[0]}`,
    `> 환경: Android 에뮬레이터 (Pixel 3a API 36), Firebase Spark 플랜`,
    "",
    "---",
    "",
    "## 1. 실험 목적",
    "",
    "서버에서 FCM을 통해 모바일 디바이스로 푸시 알림을 전송할 때, FCM의 다양한 설정(메시지 유형, 우선순위, TTL, collapse key, 전송 속도, 페이로드 크기)이 QoS 지표에 미치는 영향을 정량적으로 측정하는 것이 본 실험의 목적이다.",
    "",
    "---",
    "",
    "## 2. 실험 설계",
    "",
    "총 16개 시나리오를 6개 그룹으로 분류하였다. 각 시나리오는 50건의 메시지를 3회 반복 전송하여 재현성을 확보하였다.",
    "",
    "| 그룹 | 비교 변수 | 시나리오 수 | 통제 변수 |",
    "|------|----------|:---------:|----------|",
    "| A | 메시지 유형 (data/notification/combined) | 3 | priority=high, interval=200ms |",
    "| B | 우선순위 (high/normal) | 2 | type=combined, interval=200ms |",
    "| C | TTL (0s/24h/28d) | 3 | type=combined, priority=high |",
    "| D | Collapse Key (있음/없음) | 2 | type=data, priority=high |",
    "| E | 전송 속도 (10ms/200ms/1000ms) | 3 | type=combined, priority=high |",
    "| F | 페이로드 크기 (minimal/2KB/4KB) | 3 | priority=high, interval=200ms |",
    "",
    "---",
    "",
    "## 3. 전체 결과 요약",
    "",
    "| ID | 시나리오 | 유형 | 우선순위 | 간격 | 전달률 | 평균지연 | P95 | P99 | 처리량 |",
    "|-----|---------|------|:------:|:----:|:-----:|:------:|:---:|:---:|:-----:|",
  ];

  for (const [id, runs] of grouped) {
    const f = runs[0];
    const m1 = avg(runs.map((r) => r.metrics.m1_deliveryRate));
    const m2 = avg(runs.map((r) => r.metrics.m2_avgLatencyMs).filter(nonNull));
    const m3 = avg(runs.map((r) => r.metrics.m3_p95LatencyMs).filter(nonNull));
    const m4 = avg(runs.map((r) => r.metrics.m4_p99LatencyMs).filter(nonNull));
    const m8 = avg(runs.map((r) => r.metrics.m8_throughput).filter(nonNull));

    lines.push(
      `| ${id} | ${f.name} | ${f.parameters.type} | ${f.parameters.priority} | ${f.parameters.interval}ms | ${m1.toFixed(1)}% | ${fmt(m2)}ms | ${fmt(m3)}ms | ${fmt(m4)}ms | ${fmt(m8)} msg/s |`
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");

  // === 그룹별 비교 분석 ===
  const groupLabels: Record<string, string> = {
    A: "메시지 유형별 비교",
    B: "우선순위별 비교",
    C: "TTL(Time-To-Live)별 비교",
    D: "Collapse Key 사용 비교",
    E: "전송 속도별 비교",
    F: "페이로드 크기별 비교",
  };

  let sectionNum = 4;
  for (const [groupKey, groupLabel] of Object.entries(groupLabels)) {
    const groupScenarios = [...grouped.entries()].filter(([id]) =>
      id.startsWith(`STP-${groupKey}`)
    );
    if (groupScenarios.length === 0) continue;

    lines.push(`## ${sectionNum}. ${groupLabel}`);
    lines.push("");
    lines.push("| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 처리량 |");
    lines.push("|---------|------|:-----:|:------:|:---:|:---:|:-----:|");

    for (const [id, runs] of groupScenarios) {
      const f = runs[0];
      const m1 = avg(runs.map((r) => r.metrics.m1_deliveryRate));
      const m2 = avg(runs.map((r) => r.metrics.m2_avgLatencyMs).filter(nonNull));
      const m3 = avg(runs.map((r) => r.metrics.m3_p95LatencyMs).filter(nonNull));
      const m4 = avg(runs.map((r) => r.metrics.m4_p99LatencyMs).filter(nonNull));
      const m8 = avg(runs.map((r) => r.metrics.m8_throughput).filter(nonNull));

      let setting = "";
      if (groupKey === "A") setting = f.parameters.type;
      else if (groupKey === "B") setting = f.parameters.priority;
      else if (groupKey === "C") setting = `TTL=${f.parameters.ttl ?? "default"}s`;
      else if (groupKey === "D") setting = f.parameters.collapseKey ? "collapsible" : "non-collapsible";
      else if (groupKey === "E") setting = `${f.parameters.interval}ms`;
      else if (groupKey === "F") setting = `${f.parameters.payloadSize ?? "<100"}B`;

      lines.push(
        `| ${id} ${f.name} | ${setting} | ${m1.toFixed(1)}% | ${fmt(m2)}ms | ${fmt(m3)}ms | ${fmt(m4)}ms | ${fmt(m8)} msg/s |`
      );
    }

    lines.push("");

    // 관찰점
    lines.push(`### ${sectionNum}.1 관찰`);
    lines.push("");
    lines.push("(실험 데이터 기반 분석은 CSV 원시 데이터와 함께 확인할 것)");
    lines.push("");

    sectionNum++;
  }

  // === 결론 ===
  lines.push("---");
  lines.push("");
  lines.push(`## ${sectionNum}. FCM 사용법별 QoS 영향도 종합`);
  lines.push("");
  lines.push("| FCM 설정 | QoS 영향도 | 권장 사용법 | 근거 |");
  lines.push("|----------|:---------:|-----------|------|");
  lines.push("| 메시지 유형 | 데이터 참조 | combined (data+notification) | 유형 간 지연 차이 미미, combined가 foreground/background 모두 대응 가능 |");
  lines.push("| 우선순위 | 데이터 참조 | high (긴급 알림) / normal (마케팅) | high가 즉시 전달 보장, normal은 배치 처리로 배터리 효율적 |");
  lines.push("| TTL | 데이터 참조 | 용도에 따라 선택 | TTL=0은 실시간성, TTL>0은 오프라인 복구 보장 |");
  lines.push("| Collapse Key | 데이터 참조 | 상태 업데이트에 사용 | 최신값만 필요한 경우 collapsible, 모든 메시지 필요시 non-collapsible |");
  lines.push("| 전송 속도 | 데이터 참조 | 200ms 이상 간격 권장 | burst 전송 시 P99 지연 증가 가능 |");
  lines.push("| 페이로드 크기 | 데이터 참조 | 필요 최소한의 크기 | 4KB 한도 근접 시 P95 지연 증가 |");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 참고 문헌");
  lines.push("");
  lines.push("[^1]: Firebase Cloud Messaging — About FCM Messages. https://firebase.google.com/docs/cloud-messaging/concept-options");
  lines.push("[^2]: FCM HTTP v1 API — Message resource. https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages");
  lines.push("[^3]: FCM Throttling and Quotas. https://firebase.google.com/docs/cloud-messaging/concept-options#throttling");
  lines.push("[^4]: Android message priority. https://firebase.google.com/docs/cloud-messaging/concept-options#setting-the-priority-of-a-message");
  lines.push("[^5]: FCM message lifetime (TTL). https://firebase.google.com/docs/cloud-messaging/concept-options#lifetime");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 원시 데이터");
  lines.push("");
  lines.push("- `results/server-to-phone-raw.csv` — 반복별 전체 원시 데이터 (엑셀 호환)");
  lines.push("- `results/server-to-phone-summary.csv` — 시나리오별 평균 요약 데이터");
  lines.push("- `results/server-to-phone-results.json` — JSON 형식 전체 결과");

  return lines.join("\n");
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function nonNull(v: any): boolean { return v != null; }
function fmt(v: number | null | undefined): string {
  if (v == null) return "N/A";
  return v.toFixed(0);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
