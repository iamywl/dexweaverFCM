/**
 * Phase 1 Baseline 실험 일괄 실행 + QoS 지표 수집
 *
 * 에뮬레이터 환경이므로 메시지 수를 축소하여 실행
 * 실행: npx tsx src/scripts/run-all-experiments.ts
 */
import { db } from "../config/firebase";
import { sendMessage, getLatestToken, MessageType } from "./send";
import { MetricsCollector } from "../modules/metrics/metricsCollector";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ScenarioConfig {
  name: string;
  description: string;
  count: number;
  repeat: number;
  type: MessageType;
  interval: number;
  collapseKey?: string;
  payloadSize?: number;
}

// 에뮬레이터 환경 — 각 시나리오 50건 × 3회 반복
const scenarios: ScenarioConfig[] = [
  {
    name: "EXP-S01",
    description: "Baseline: 단일 디바이스 정상 전송 (data 메시지, foreground)",
    count: 50,
    repeat: 3,
    type: "data",
    interval: 200,
  },
  {
    name: "EXP-S02",
    description: "Notification 메시지 전송",
    count: 50,
    repeat: 3,
    type: "notification",
    interval: 200,
  },
  {
    name: "EXP-S03",
    description: "Combined (data+notification) 메시지 전송",
    count: 50,
    repeat: 3,
    type: "combined",
    interval: 200,
  },
  {
    name: "EXP-S04",
    description: "Collapsible 메시지 (collapse_key 사용)",
    count: 30,
    repeat: 3,
    type: "data",
    interval: 500,
    collapseKey: "collapsible-test",
  },
  {
    name: "EXP-S05-fast",
    description: "빠른 전송 간격 (50ms)",
    count: 50,
    repeat: 3,
    type: "combined",
    interval: 50,
  },
  {
    name: "EXP-S05-slow",
    description: "느린 전송 간격 (1000ms)",
    count: 30,
    repeat: 3,
    type: "combined",
    interval: 1000,
  },
  {
    name: "EXP-U02-1KB",
    description: "페이로드 크기 1KB",
    count: 30,
    repeat: 3,
    type: "data",
    interval: 200,
    payloadSize: 1024,
  },
  {
    name: "EXP-U02-3KB",
    description: "페이로드 크기 3KB",
    count: 30,
    repeat: 3,
    type: "data",
    interval: 200,
    payloadSize: 3072,
  },
];

function generatePayload(size?: number): Record<string, string> {
  if (!size || size <= 0) return {};
  const padding = "x".repeat(Math.max(0, size - 50));
  return { padding };
}

async function runScenario(
  scenario: ScenarioConfig,
  token: string
): Promise<{ experimentIds: string[] }> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📋 ${scenario.name}: ${scenario.description}`);
  console.log(`   ${scenario.count}건 × ${scenario.repeat}회, ${scenario.type}, ${scenario.interval}ms 간격`);
  console.log("=".repeat(60));

  const experimentIds: string[] = [];

  for (let r = 0; r < scenario.repeat; r++) {
    const experimentId = `${scenario.name}-R${r + 1}-${uuidv4().substring(0, 8)}`;
    experimentIds.push(experimentId);
    const startTime = Date.now();

    await db.collection("experiments").doc(experimentId).set({
      name: scenario.name,
      phase: 1,
      description: `${scenario.description} (repeat ${r + 1}/${scenario.repeat})`,
      parameters: {
        count: scenario.count,
        type: scenario.type,
        interval: scenario.interval,
        collapseKey: scenario.collapseKey || null,
        payloadSize: scenario.payloadSize || null,
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
          title: `${scenario.name} #${i + 1}`,
          body: `R${r + 1} M${i + 1}/${scenario.count}`,
          type: scenario.type,
          data: generatePayload(scenario.payloadSize),
          collapseKey: scenario.collapseKey,
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

    // 반복 간 ACK 수신 대기
    if (r < scenario.repeat - 1) {
      console.log("   ACK 수신 대기 15s...");
      await sleep(15000);
    }
  }

  return { experimentIds };
}

async function collectMetrics(experimentIds: string[]): Promise<any[]> {
  // ACK 수신 대기
  console.log("\n⏳ ACK 수신 대기 20초...");
  await sleep(20000);

  const collector = new MetricsCollector();
  const results = [];

  for (const expId of experimentIds) {
    const metrics = await collector.calculate(expId);
    results.push({ experimentId: expId, ...metrics });
    console.log(collector.formatReport(expId, metrics));
    console.log("");
  }

  return results;
}

async function main() {
  const token = await getLatestToken();
  console.log(`Token: ${token.substring(0, 20)}...`);
  console.log(`총 ${scenarios.length}개 시나리오 실행 예정\n`);

  const allResults: any[] = [];

  for (const scenario of scenarios) {
    const { experimentIds } = await runScenario(scenario, token);

    // 시나리오 완료 후 ACK 대기 + 메트릭 수집
    console.log("\n⏳ ACK 수신 대기 20초...");
    await sleep(20000);

    const collector = new MetricsCollector();
    for (const expId of experimentIds) {
      const metrics = await collector.calculate(expId);
      allResults.push({
        scenario: scenario.name,
        description: scenario.description,
        experimentId: expId,
        parameters: {
          count: scenario.count,
          type: scenario.type,
          interval: scenario.interval,
          collapseKey: scenario.collapseKey || null,
          payloadSize: scenario.payloadSize || null,
        },
        metrics,
      });
      console.log(collector.formatReport(expId, metrics));
    }

    // 시나리오 간 쿨다운
    console.log("\n💤 다음 시나리오 전 쿨다운 10초...");
    await sleep(10000);
  }

  // 결과 저장
  const resultsDir = path.resolve(__dirname, "../../results");
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  // JSON 결과
  const jsonPath = path.join(resultsDir, "experiment-results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
  console.log(`\n💾 JSON 결과 저장: ${jsonPath}`);

  // Markdown 보고서
  const report = generateReport(allResults);
  const mdPath = path.join(resultsDir, "qos-metrics-report.md");
  fs.writeFileSync(mdPath, report);
  console.log(`📊 QoS 보고서 저장: ${mdPath}`);

  console.log("\n✅ 모든 실험 완료!");
}

function generateReport(results: any[]): string {
  const lines: string[] = [
    "# DexWeaver FCM QoS 지표 보고서",
    "",
    `> 생성일: ${new Date().toISOString().split("T")[0]}`,
    `> 환경: Android 에뮬레이터 (Pixel 3a API 36), Firebase Spark 플랜`,
    "",
    "---",
    "",
    "## 시나리오별 QoS 지표 요약",
    "",
    "| 시나리오 | 설명 | 전달률(M1) | 평균지연(M2) | P95지연(M3) | P99지연(M4) | 재시도율(M5) | 처리량(M8) |",
    "|---------|------|-----------|------------|------------|------------|------------|-----------|",
  ];

  // 시나리오별 평균 계산
  const scenarioMap = new Map<string, any[]>();
  for (const r of results) {
    if (!scenarioMap.has(r.scenario)) scenarioMap.set(r.scenario, []);
    scenarioMap.get(r.scenario)!.push(r);
  }

  for (const [scenario, runs] of scenarioMap) {
    const desc = runs[0].description;
    const avgM1 = avg(runs.map((r) => r.metrics.m1_deliveryRate));
    const avgM2 = avg(runs.map((r) => r.metrics.m2_avgLatencyMs).filter(Boolean));
    const avgM3 = avg(runs.map((r) => r.metrics.m3_p95LatencyMs).filter(Boolean));
    const avgM4 = avg(runs.map((r) => r.metrics.m4_p99LatencyMs).filter(Boolean));
    const avgM5 = avg(runs.map((r) => r.metrics.m5_retryRate));
    const avgM8 = avg(runs.map((r) => r.metrics.m8_throughput).filter(Boolean));

    lines.push(
      `| ${scenario} | ${desc} | ${avgM1.toFixed(1)}% | ${avgM2?.toFixed(0) ?? "N/A"}ms | ${avgM3?.toFixed(0) ?? "N/A"}ms | ${avgM4?.toFixed(0) ?? "N/A"}ms | ${avgM5.toFixed(1)}% | ${avgM8?.toFixed(1) ?? "N/A"} msg/s |`
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 상세 결과 (반복별)");
  lines.push("");

  for (const [scenario, runs] of scenarioMap) {
    lines.push(`### ${scenario}: ${runs[0].description}`);
    lines.push("");
    lines.push("| Repeat | 전달률 | 평균지연 | P95 | P99 | 재시도율 | DLQ율 | 중복율 | 처리량 |");
    lines.push("|--------|-------|---------|-----|-----|---------|------|-------|--------|");

    for (const r of runs) {
      const m = r.metrics;
      const repeat = r.experimentId.match(/R(\d+)/)?.[1] || "?";
      lines.push(
        `| R${repeat} | ${m.m1_deliveryRate.toFixed(1)}% | ${m.m2_avgLatencyMs?.toFixed(0) ?? "N/A"}ms | ${m.m3_p95LatencyMs?.toFixed(0) ?? "N/A"}ms | ${m.m4_p99LatencyMs?.toFixed(0) ?? "N/A"}ms | ${m.m5_retryRate.toFixed(1)}% | ${m.m6_dlqRate.toFixed(1)}% | ${m.m7_duplicateRate.toFixed(1)}% | ${m.m8_throughput?.toFixed(1) ?? "N/A"} msg/s |`
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 분석 및 관찰");
  lines.push("");
  lines.push("(실험 데이터 기반으로 자동 생성된 보고서. 상세 분석은 별도 작성 필요)");

  return lines.join("\n");
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
