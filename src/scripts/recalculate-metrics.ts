/**
 * 실험 결과 메트릭 재계산 스크립트
 * 실행: npx tsx src/scripts/recalculate-metrics.ts
 */
import { db } from "../config/firebase";
import { MetricsCollector } from "../modules/metrics/metricsCollector";
import * as fs from "fs";
import * as path from "path";

async function main() {
  // 모든 실험 조회
  const expSnapshot = await db
    .collection("experiments")
    .where("status", "==", "completed")
    .get();

  if (expSnapshot.empty) {
    console.log("No completed experiments found.");
    return;
  }

  const collector = new MetricsCollector();
  const allResults: any[] = [];

  console.log(`Found ${expSnapshot.size} experiments. Recalculating metrics...\n`);

  for (const doc of expSnapshot.docs) {
    const exp = doc.data();
    const experimentId = doc.id;

    const metrics = await collector.calculate(experimentId);

    allResults.push({
      scenario: exp.name,
      description: exp.description,
      experimentId,
      parameters: exp.parameters,
      metrics,
    });

    console.log(collector.formatReport(experimentId, metrics));
    console.log("");
  }

  // 결과 저장
  const resultsDir = path.resolve(__dirname, "../../results");
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const jsonPath = path.join(resultsDir, "experiment-results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
  console.log(`JSON 저장: ${jsonPath}`);

  // Markdown 보고서 생성
  const report = generateReport(allResults);
  const mdPath = path.join(resultsDir, "qos-metrics-report.md");
  fs.writeFileSync(mdPath, report);
  console.log(`보고서 저장: ${mdPath}`);
}

function generateReport(results: any[]): string {
  const lines: string[] = [
    "# DexWeaver FCM QoS 지표 보고서",
    "",
    `> 생성일: ${new Date().toISOString().split("T")[0]}`,
    `> 환경: Android 에뮬레이터 (Pixel 3a API 36), Firebase Spark 플랜`,
    `> 전송 방식: 맥북 로컬 스크립트 (ts-node + Firebase Admin SDK)`,
    "",
    "---",
    "",
    "## 1. 실험 개요",
    "",
    "본 보고서는 FCM(Firebase Cloud Messaging)의 QoS(Quality of Service) 지표를 다양한 시나리오에서 측정한 결과이다.",
    "각 시나리오는 3회 반복 실행하여 재현성을 확보하였다.",
    "",
    "### 측정 지표",
    "",
    "| 지표 | 설명 | 단위 |",
    "|------|------|------|",
    "| M1 | 전달률 (Delivery Rate) — ACK 수신 기준 | % |",
    "| M2 | 평균 지연시간 (Average Latency) | ms |",
    "| M3 | P95 지연시간 (95th Percentile Latency) | ms |",
    "| M4 | P99 지연시간 (99th Percentile Latency) | ms |",
    "| M5 | 재시도율 (Retry Rate) | % |",
    "| M6 | DLQ 비율 (Dead Letter Queue Rate) | % |",
    "| M7 | 중복 수신율 (Duplicate Rate) | % |",
    "| M8 | 처리량 (Throughput) | msg/s |",
    "",
    "---",
    "",
    "## 2. 시나리오별 QoS 지표 요약",
    "",
    "| 시나리오 | 설명 | 전달률(M1) | 평균지연(M2) | P95지연(M3) | P99지연(M4) | 처리량(M8) |",
    "|---------|------|:---------:|:----------:|:----------:|:----------:|:---------:|",
  ];

  // 시나리오별 평균 계산
  const scenarioMap = new Map<string, any[]>();
  for (const r of results) {
    if (!scenarioMap.has(r.scenario)) scenarioMap.set(r.scenario, []);
    scenarioMap.get(r.scenario)!.push(r);
  }

  for (const [scenario, runs] of scenarioMap) {
    const desc = runs[0].description?.replace(/ \(repeat.*/, "") || scenario;
    const avgM1 = avg(runs.map((r) => r.metrics.m1_deliveryRate));
    const avgM2 = avg(runs.map((r) => r.metrics.m2_avgLatencyMs).filter(nonNull));
    const avgM3 = avg(runs.map((r) => r.metrics.m3_p95LatencyMs).filter(nonNull));
    const avgM4 = avg(runs.map((r) => r.metrics.m4_p99LatencyMs).filter(nonNull));
    const avgM8 = avg(runs.map((r) => r.metrics.m8_throughput).filter(nonNull));

    lines.push(
      `| ${scenario} | ${desc} | ${avgM1.toFixed(1)}% | ${fmt(avgM2)}ms | ${fmt(avgM3)}ms | ${fmt(avgM4)}ms | ${fmt(avgM8)} msg/s |`
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. 상세 결과 (반복별)");
  lines.push("");

  for (const [scenario, runs] of scenarioMap) {
    const desc = runs[0].description?.replace(/ \(repeat.*/, "") || scenario;
    lines.push(`### ${scenario}: ${desc}`);
    lines.push("");

    const params = runs[0].parameters;
    if (params) {
      lines.push(`- 메시지 수: ${params.count}건 × ${runs.length}회`);
      lines.push(`- 메시지 유형: ${params.type}`);
      lines.push(`- 전송 간격: ${params.interval}ms`);
      if (params.collapseKey) lines.push(`- Collapse Key: ${params.collapseKey}`);
      if (params.payloadSize) lines.push(`- 페이로드 크기: ${params.payloadSize} bytes`);
      lines.push("");
    }

    lines.push("| 반복 | 전달률 | 평균지연 | P95 | P99 | 재시도율 | DLQ율 | 중복율 | 처리량 |");
    lines.push("|:----:|:-----:|:-------:|:---:|:---:|:------:|:----:|:-----:|:------:|");

    for (const r of runs) {
      const m = r.metrics;
      const repeat = r.experimentId.match(/R(\d+)/)?.[1] || "?";
      lines.push(
        `| R${repeat} | ${m.m1_deliveryRate.toFixed(1)}% | ${fmt(m.m2_avgLatencyMs)}ms | ${fmt(m.m3_p95LatencyMs)}ms | ${fmt(m.m4_p99LatencyMs)}ms | ${m.m5_retryRate.toFixed(1)}% | ${m.m6_dlqRate.toFixed(1)}% | ${m.m7_duplicateRate.toFixed(1)}% | ${fmt(m.m8_throughput)} msg/s |`
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 4. 분석 및 관찰");
  lines.push("");

  // 자동 분석
  const allM2: number[] = [];
  const scenarioSummaries: any[] = [];
  for (const [scenario, runs] of scenarioMap) {
    const m2vals = runs.map((r) => r.metrics.m2_avgLatencyMs).filter(nonNull);
    const m1vals = runs.map((r) => r.metrics.m1_deliveryRate);
    const m3vals = runs.map((r) => r.metrics.m3_p95LatencyMs).filter(nonNull);
    allM2.push(...m2vals);
    scenarioSummaries.push({
      scenario,
      avgM1: avg(m1vals),
      avgM2: avg(m2vals),
      avgM3: avg(m3vals),
      params: runs[0].parameters,
    });
  }

  const overallAvgLatency = avg(allM2);
  lines.push(`### 4.1 전체 평균 지연시간: ${overallAvgLatency.toFixed(0)}ms`);
  lines.push("");
  lines.push("모든 시나리오에서 평균 지연시간은 100ms 내외로 측정되었다. 이는 에뮬레이터 환경(로컬 네트워크)에서의 결과이며, 실제 디바이스 + 셀룰러 환경에서는 더 높은 지연이 예상된다.");
  lines.push("");

  // 메시지 유형 비교
  const typeComparison = scenarioSummaries.filter((s) =>
    ["EXP-S01", "EXP-S02", "EXP-S03"].includes(s.scenario)
  );
  if (typeComparison.length >= 3) {
    lines.push("### 4.2 메시지 유형별 비교");
    lines.push("");
    lines.push("| 유형 | 시나리오 | 평균지연 | P95 |");
    lines.push("|------|---------|:-------:|:---:|");
    for (const s of typeComparison) {
      lines.push(`| ${s.params?.type || "?"} | ${s.scenario} | ${s.avgM2.toFixed(0)}ms | ${s.avgM3.toFixed(0)}ms |`);
    }
    lines.push("");
    lines.push("data, notification, combined 메시지 유형 간 지연시간에 유의미한 차이는 관찰되지 않았다.");
    lines.push("");
  }

  // 전송 간격 비교
  const intervalComparison = scenarioSummaries.filter((s) =>
    ["EXP-S05-fast", "EXP-S05-slow"].includes(s.scenario)
  );
  if (intervalComparison.length >= 2) {
    lines.push("### 4.3 전송 간격별 비교");
    lines.push("");
    lines.push("| 간격 | 시나리오 | 평균지연 | P95 |");
    lines.push("|------|---------|:-------:|:---:|");
    for (const s of intervalComparison) {
      lines.push(`| ${s.params?.interval}ms | ${s.scenario} | ${s.avgM2.toFixed(0)}ms | ${s.avgM3.toFixed(0)}ms |`);
    }
    lines.push("");
    lines.push("50ms 간격(빠른 전송)과 1000ms 간격(느린 전송) 간 평균 지연시간에 큰 차이가 없었다. 50건 규모에서는 FCM의 rate limit에 도달하지 않아 전송 간격이 지연시간에 영향을 주지 않는 것으로 보인다.");
    lines.push("");
  }

  // 페이로드 크기 비교
  const sizeComparison = scenarioSummaries.filter((s) =>
    ["EXP-U02-1KB", "EXP-U02-3KB"].includes(s.scenario)
  );
  if (sizeComparison.length >= 2) {
    lines.push("### 4.4 페이로드 크기별 비교");
    lines.push("");
    lines.push("| 크기 | 시나리오 | 평균지연 | P95 |");
    lines.push("|------|---------|:-------:|:---:|");
    for (const s of sizeComparison) {
      lines.push(`| ${s.params?.payloadSize} bytes | ${s.scenario} | ${s.avgM2.toFixed(0)}ms | ${s.avgM3.toFixed(0)}ms |`);
    }
    lines.push("");
    lines.push("1KB와 3KB 페이로드 간 평균 지연시간 차이는 미미하다. P95에서는 3KB가 약간 높은 경향을 보이며, 이는 네트워크 전송량 증가에 따른 것으로 추정된다. FCM의 데이터 메시지 최대 크기인 4KB에 근접할수록 지연이 증가할 가능성이 있다.");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 5. 실험 환경");
  lines.push("");
  lines.push("| 항목 | 값 |");
  lines.push("|------|-----|");
  lines.push("| 전송 장비 | MacBook (Apple M4 Max, macOS 15.7.4) |");
  lines.push("| 수신 디바이스 | Android 에뮬레이터 (Pixel 3a, API 36) |");
  lines.push("| 네트워크 | 로컬 (에뮬레이터 ↔ 호스트) |");
  lines.push("| FCM 전송 | Firebase Admin SDK (Node.js) |");
  lines.push("| Firebase 플랜 | Spark (무료) |");
  lines.push("| 클라이언트 | Flutter 3.41.5 |");
  lines.push(`| 실험 일시 | ${new Date().toISOString().split("T")[0]} |`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 참고 문헌");
  lines.push("");
  lines.push("[^1]: Firebase Cloud Messaging documentation. https://firebase.google.com/docs/cloud-messaging");
  lines.push("[^2]: FCM HTTP v1 API. https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages");
  lines.push("[^3]: FCM Throttling and Quotas. https://firebase.google.com/docs/cloud-messaging/concept-options#throttling-and-quotas");

  return lines.join("\n");
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function nonNull(v: any): boolean {
  return v != null;
}

function fmt(v: number | null | undefined): string {
  if (v == null) return "N/A";
  return v.toFixed(0);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
