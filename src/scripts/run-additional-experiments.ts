/**
 * 추가 실험 실행 스크립트
 *
 * 에뮬레이터 환경에서 실행 가능한 추가 시나리오:
 *   Group G: Stale 토큰 (EXP-U01)
 *   Group H: 페이로드 경계값 (EXP-U02)
 *   Group I: Collapsible 스로틀링 (EXP-U07)
 *   Group J: 중복 전송 (EXP-U15)
 *   Group K: Doze 모드 (EXP-U09)
 *
 * 실행: npx tsx src/scripts/run-additional-experiments.ts
 */
import { db, messaging } from "../config/firebase";
import { sendMessage, getLatestToken, MessageType } from "./send";
import { MetricsCollector } from "../modules/metrics/metricsCollector";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── 타입 정의 ───

type ScenarioMode =
  | "standard"
  | "stale_token"
  | "mixed_token"
  | "payload_boundary"
  | "duplicate_send"
  | "doze";

interface AdditionalScenario {
  id: string;
  name: string;
  description: string;
  group: string;
  groupLabel: string;
  mode: ScenarioMode;
  count: number;
  repeat: number;
  type: MessageType;
  interval: number;
  priority: "high" | "normal";
  collapseKey?: string;
  payloadSize?: number;
  duplicateSendCount?: number; // 중복 전송 횟수
}

// ─── 시나리오 정의 ───

const scenarios: AdditionalScenario[] = [
  // === Group G: Stale 토큰 (EXP-U01) ===
  {
    id: "STP-G1",
    name: "Valid Token (대조군)",
    description: "유효 토큰에 정상 전송, 기준선 비교용",
    group: "G", groupLabel: "Stale 토큰 비율별 전달률",
    mode: "standard",
    count: 30, repeat: 2, type: "data", interval: 200, priority: "high",
  },
  {
    id: "STP-G2",
    name: "Invalid Token (100% 무효)",
    description: "완전히 무효한 토큰으로 전송, FCM 에러 유형 및 응답 속도 측정",
    group: "G", groupLabel: "Stale 토큰 비율별 전달률",
    mode: "stale_token",
    count: 30, repeat: 2, type: "data", interval: 200, priority: "high",
  },
  {
    id: "STP-G3",
    name: "Mixed Token (50% 유효/50% 무효)",
    description: "유효+무효 토큰 교대 전송, 무효 토큰이 유효 전달에 영향 주는지 확인",
    group: "G", groupLabel: "Stale 토큰 비율별 전달률",
    mode: "mixed_token",
    count: 30, repeat: 2, type: "data", interval: 200, priority: "high",
  },

  // === Group H: 페이로드 경계값 (EXP-U02) ===
  {
    id: "STP-H1",
    name: "Payload 4000B (한도 이내)",
    description: "4000B 페이로드, FCM data 메시지 한도(4096B) 이내",
    group: "H", groupLabel: "페이로드 경계값 테스트",
    mode: "payload_boundary",
    count: 30, repeat: 2, type: "data", interval: 200, priority: "high",
    payloadSize: 4000,
  },
  {
    id: "STP-H2",
    name: "Payload 4096B (정확한 한도)",
    description: "4096B 페이로드, FCM data 메시지 정확한 최대 크기",
    group: "H", groupLabel: "페이로드 경계값 테스트",
    mode: "payload_boundary",
    count: 30, repeat: 2, type: "data", interval: 200, priority: "high",
    payloadSize: 4096,
  },
  {
    id: "STP-H3",
    name: "Payload 5000B (한도 초과)",
    description: "5000B 페이로드, FCM 한도 초과 시 에러 동작 확인",
    group: "H", groupLabel: "페이로드 경계값 테스트",
    mode: "payload_boundary",
    count: 30, repeat: 2, type: "data", interval: 200, priority: "high",
    payloadSize: 5000,
  },

  // === Group I: Collapsible 스로틀링 (EXP-U07) ===
  {
    id: "STP-I1",
    name: "Collapsible Burst (100ms)",
    description: "동일 collapse_key, 100ms 간격 — 최대 속도 오버라이트",
    group: "I", groupLabel: "Collapsible 전송 빈도별 전달률",
    mode: "standard",
    count: 30, repeat: 2, type: "data", interval: 100, priority: "high",
    collapseKey: "throttle-test",
  },
  {
    id: "STP-I2",
    name: "Collapsible 1s 간격",
    description: "동일 collapse_key, 1초 간격 — 중간 속도",
    group: "I", groupLabel: "Collapsible 전송 빈도별 전달률",
    mode: "standard",
    count: 30, repeat: 2, type: "data", interval: 1000, priority: "high",
    collapseKey: "throttle-test",
  },
  {
    id: "STP-I3",
    name: "Collapsible 3s 간격",
    description: "동일 collapse_key, 3초 간격 — 느린 속도",
    group: "I", groupLabel: "Collapsible 전송 빈도별 전달률",
    mode: "standard",
    count: 20, repeat: 2, type: "data", interval: 3000, priority: "high",
    collapseKey: "throttle-test",
  },
  {
    id: "STP-I4",
    name: "Collapsible 10s 간격",
    description: "동일 collapse_key, 10초 간격 — 충분한 전달 시간 확보",
    group: "I", groupLabel: "Collapsible 전송 빈도별 전달률",
    mode: "standard",
    count: 15, repeat: 2, type: "data", interval: 10000, priority: "high",
    collapseKey: "throttle-test",
  },

  // === Group J: 중복 전송 (EXP-U15) ===
  {
    id: "STP-J1",
    name: "단일 전송 (대조군)",
    description: "각 메시지 1회 전송, 중복 없음",
    group: "J", groupLabel: "중복 전송 시 클라이언트 중복 수신 테스트",
    mode: "standard",
    count: 10, repeat: 2, type: "combined", interval: 500, priority: "high",
  },
  {
    id: "STP-J2",
    name: "3회 중복 전송",
    description: "각 메시지를 동일 messageId로 3회 전송, 클라이언트 dedup 확인",
    group: "J", groupLabel: "중복 전송 시 클라이언트 중복 수신 테스트",
    mode: "duplicate_send",
    count: 10, repeat: 2, type: "combined", interval: 500, priority: "high",
    duplicateSendCount: 3,
  },
  {
    id: "STP-J3",
    name: "5회 중복 전송",
    description: "각 메시지를 동일 messageId로 5회 전송, 중복 수신율 측정",
    group: "J", groupLabel: "중복 전송 시 클라이언트 중복 수신 테스트",
    mode: "duplicate_send",
    count: 10, repeat: 2, type: "combined", interval: 500, priority: "high",
    duplicateSendCount: 5,
  },

  // === Group K: Doze 모드 (EXP-U09) ===
  {
    id: "STP-K1",
    name: "Doze + HIGH Priority",
    description: "Doze 강제 진입 후 HIGH 우선순위 전송, Doze 바이패스 확인",
    group: "K", groupLabel: "Doze 모드에서의 우선순위별 전달",
    mode: "doze",
    count: 30, repeat: 2, type: "combined", interval: 200, priority: "high",
  },
  {
    id: "STP-K2",
    name: "Doze + NORMAL Priority",
    description: "Doze 강제 진입 후 NORMAL 우선순위 전송, 배치 처리 지연 측정",
    group: "K", groupLabel: "Doze 모드에서의 우선순위별 전달",
    mode: "doze",
    count: 30, repeat: 2, type: "combined", interval: 200, priority: "normal",
  },
];

// ─── 유틸리티 ───

function generatePayload(size?: number): Record<string, string> {
  if (!size || size <= 0) return {};
  const padding = "x".repeat(Math.max(0, size - 50));
  return { padding };
}

function generateInvalidToken(): string {
  return "INVALID_FCM_TOKEN_" + uuidv4().replace(/-/g, "");
}

function isAdbAvailable(): boolean {
  try {
    execSync("adb devices", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function setDozeMode(enable: boolean): boolean {
  try {
    if (enable) {
      execSync("adb shell dumpsys deviceidle enable", { stdio: "pipe", timeout: 5000 });
      execSync("adb shell dumpsys deviceidle force-idle", { stdio: "pipe", timeout: 5000 });
      console.log("   ✅ Doze 모드 활성화");
    } else {
      execSync("adb shell dumpsys deviceidle unforce", { stdio: "pipe", timeout: 5000 });
      execSync("adb shell dumpsys deviceidle disable", { stdio: "pipe", timeout: 5000 });
      console.log("   ✅ Doze 모드 비활성화");
    }
    return true;
  } catch (err: any) {
    console.warn(`   ⚠️ Doze 모드 설정 실패: ${err.message}`);
    return false;
  }
}

// ─── 시나리오 실행 ───

interface ScenarioResult {
  id: string;
  name: string;
  description: string;
  group: string;
  groupLabel: string;
  experimentId: string;
  repeat: number;
  parameters: any;
  metrics: any;
  errors: string[];
}

async function runStandardScenario(
  scenario: AdditionalScenario,
  token: string,
  experimentId: string,
  repeatNum: number,
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < scenario.count; i++) {
    try {
      await sendMessage({
        token,
        title: `${scenario.id} #${i + 1}`,
        body: `${scenario.name} R${repeatNum} M${i + 1}/${scenario.count}`,
        type: scenario.type,
        data: generatePayload(scenario.payloadSize),
        collapseKey: scenario.collapseKey,
        priority: scenario.priority,
        experimentId,
      });
      sent++;
    } catch (err: any) {
      failed++;
      if (!errors.includes(err.message)) errors.push(err.message);
    }

    if (scenario.interval > 0 && i < scenario.count - 1) {
      await sleep(scenario.interval);
    }
  }
  return { sent, failed, errors };
}

async function runStaleTokenScenario(
  scenario: AdditionalScenario,
  _validToken: string,
  experimentId: string,
  repeatNum: number,
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const invalidToken = generateInvalidToken();

  for (let i = 0; i < scenario.count; i++) {
    try {
      await sendMessage({
        token: invalidToken,
        title: `${scenario.id} #${i + 1}`,
        body: `${scenario.name} R${repeatNum} M${i + 1}/${scenario.count}`,
        type: scenario.type,
        priority: scenario.priority,
        experimentId,
      });
      sent++;
    } catch (err: any) {
      failed++;
      const errKey = err.code || err.message;
      if (!errors.includes(errKey)) errors.push(errKey);
    }

    if (scenario.interval > 0 && i < scenario.count - 1) {
      await sleep(scenario.interval);
    }
  }
  return { sent, failed, errors };
}

async function runMixedTokenScenario(
  scenario: AdditionalScenario,
  validToken: string,
  experimentId: string,
  repeatNum: number,
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const invalidToken = generateInvalidToken();

  for (let i = 0; i < scenario.count; i++) {
    const useValid = i % 2 === 0; // 짝수=유효, 홀수=무효
    try {
      await sendMessage({
        token: useValid ? validToken : invalidToken,
        title: `${scenario.id} #${i + 1}`,
        body: `${scenario.name} R${repeatNum} M${i + 1}/${scenario.count} [${useValid ? "valid" : "invalid"}]`,
        type: scenario.type,
        priority: scenario.priority,
        experimentId,
      });
      sent++;
    } catch (err: any) {
      failed++;
      const errKey = err.code || err.message;
      if (!errors.includes(errKey)) errors.push(errKey);
    }

    if (scenario.interval > 0 && i < scenario.count - 1) {
      await sleep(scenario.interval);
    }
  }
  return { sent, failed, errors };
}

async function runDuplicateSendScenario(
  scenario: AdditionalScenario,
  token: string,
  experimentId: string,
  repeatNum: number,
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const dupCount = scenario.duplicateSendCount || 1;

  for (let i = 0; i < scenario.count; i++) {
    try {
      // 첫 번째 전송: 정상 sendMessage (Firestore 기록)
      const result = await sendMessage({
        token,
        title: `${scenario.id} #${i + 1}`,
        body: `${scenario.name} R${repeatNum} M${i + 1}/${scenario.count}`,
        type: scenario.type,
        priority: scenario.priority,
        experimentId,
      });
      sent++;

      // 추가 전송: 동일 messageId로 FCM 직접 전송 (Firestore 미기록)
      for (let d = 1; d < dupCount; d++) {
        try {
          const fcmMessage: any = {
            token,
            data: {
              messageId: result.messageId,
              sentAt: new Date().toISOString(),
              title: `${scenario.id} #${i + 1} (dup ${d + 1}/${dupCount})`,
              body: `Duplicate send test`,
            },
            notification: {
              title: `${scenario.id} Dup #${d + 1}`,
              body: `Duplicate of message ${i + 1}`,
            },
            android: { priority: scenario.priority },
          };
          await messaging.send(fcmMessage);
          console.log(`   Dup ${d + 1}/${dupCount} for msg ${i + 1}: sent`);
        } catch (err: any) {
          console.warn(`   Dup ${d + 1}/${dupCount} for msg ${i + 1}: ${err.message}`);
        }
      }
    } catch (err: any) {
      failed++;
      if (!errors.includes(err.message)) errors.push(err.message);
    }

    if (scenario.interval > 0 && i < scenario.count - 1) {
      await sleep(scenario.interval);
    }
  }
  return { sent, failed, errors };
}

async function runDozeScenario(
  scenario: AdditionalScenario,
  token: string,
  experimentId: string,
  repeatNum: number,
): Promise<{ sent: number; failed: number; errors: string[] }> {
  // Doze 모드 진입
  const dozeOk = setDozeMode(true);
  if (!dozeOk) {
    return { sent: 0, failed: scenario.count, errors: ["Doze 모드 설정 실패 (adb 미연결)"] };
  }

  // 잠시 대기 (Doze 안정화)
  await sleep(3000);

  // 표준 전송
  const result = await runStandardScenario(scenario, token, experimentId, repeatNum);

  // Doze 모드 해제
  setDozeMode(false);
  await sleep(2000);

  return result;
}

// ─── 메인 실행 ───

async function runScenario(
  scenario: AdditionalScenario,
  token: string,
): Promise<{ experimentIds: string[]; errors: string[][] }> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📋 [${scenario.id}] ${scenario.name}`);
  console.log(`   ${scenario.description}`);
  console.log(`   mode=${scenario.mode} | ${scenario.count}건×${scenario.repeat}회 | type=${scenario.type} | priority=${scenario.priority} | interval=${scenario.interval}ms`);
  if (scenario.collapseKey) console.log(`   collapseKey=${scenario.collapseKey}`);
  if (scenario.payloadSize) console.log(`   payloadSize=${scenario.payloadSize}B`);
  if (scenario.duplicateSendCount) console.log(`   duplicateSendCount=${scenario.duplicateSendCount}×`);
  console.log("=".repeat(60));

  const experimentIds: string[] = [];
  const allErrors: string[][] = [];

  for (let r = 0; r < scenario.repeat; r++) {
    const experimentId = `${scenario.id}-R${r + 1}-${uuidv4().substring(0, 8)}`;
    experimentIds.push(experimentId);
    const startTime = Date.now();

    await db.collection("experiments").doc(experimentId).set({
      name: scenario.id,
      phase: "additional",
      description: `[${scenario.id}] ${scenario.name} (R${r + 1}/${scenario.repeat})`,
      parameters: {
        mode: scenario.mode,
        count: scenario.count,
        type: scenario.type,
        interval: scenario.interval,
        priority: scenario.priority,
        collapseKey: scenario.collapseKey ?? null,
        payloadSize: scenario.payloadSize ?? null,
        duplicateSendCount: scenario.duplicateSendCount ?? null,
      },
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      messageCount: scenario.count,
      results: null,
    });

    let result: { sent: number; failed: number; errors: string[] };

    switch (scenario.mode) {
      case "stale_token":
        result = await runStaleTokenScenario(scenario, token, experimentId, r + 1);
        break;
      case "mixed_token":
        result = await runMixedTokenScenario(scenario, token, experimentId, r + 1);
        break;
      case "duplicate_send":
        result = await runDuplicateSendScenario(scenario, token, experimentId, r + 1);
        break;
      case "doze":
        result = await runDozeScenario(scenario, token, experimentId, r + 1);
        break;
      case "payload_boundary":
      case "standard":
      default:
        result = await runStandardScenario(scenario, token, experimentId, r + 1);
        break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    allErrors.push(result.errors);

    await db.collection("experiments").doc(experimentId).update({
      status: "completed",
      completedAt: new Date(),
      results: {
        totalSent: result.sent,
        totalFailed: result.failed,
        elapsedSeconds: parseFloat(elapsed),
        errors: result.errors,
      },
    });

    console.log(`   R${r + 1}: ${result.sent} sent, ${result.failed} failed (${elapsed}s)`);
    if (result.errors.length > 0) {
      console.log(`   ⚠️ Errors: ${result.errors.join(", ")}`);
    }

    if (r < scenario.repeat - 1) {
      console.log("   쿨다운 10s...");
      await sleep(10000);
    }
  }

  return { experimentIds, errors: allErrors };
}

async function main() {
  const token = await getLatestToken();
  console.log(`Token: ${token.substring(0, 20)}...`);

  // Doze 시나리오를 위한 adb 확인
  const adbOk = isAdbAvailable();
  console.log(`ADB: ${adbOk ? "사용 가능" : "사용 불가 (Doze 테스트 스킵)"}`);

  const activeScenarios = scenarios.filter((s) => {
    if (s.mode === "doze" && !adbOk) {
      console.log(`⏭️ [${s.id}] ${s.name} — adb 미연결로 스킵`);
      return false;
    }
    return true;
  });

  console.log(`\n총 ${activeScenarios.length}개 시나리오 실행\n`);

  const collector = new MetricsCollector();
  const allResults: ScenarioResult[] = [];

  for (const scenario of activeScenarios) {
    const { experimentIds, errors } = await runScenario(scenario, token);

    // ACK 수신 대기
    const ackWait = scenario.mode === "doze" ? 30000 : 20000;
    console.log(`\n⏳ ACK 수신 대기 ${ackWait / 1000}초...`);
    await sleep(ackWait);

    for (let i = 0; i < experimentIds.length; i++) {
      const metrics = await collector.calculate(experimentIds[i]);
      allResults.push({
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        group: scenario.group,
        groupLabel: scenario.groupLabel,
        experimentId: experimentIds[i],
        repeat: i + 1,
        parameters: {
          mode: scenario.mode,
          type: scenario.type,
          priority: scenario.priority,
          interval: scenario.interval,
          collapseKey: scenario.collapseKey ?? null,
          payloadSize: scenario.payloadSize ?? null,
          duplicateSendCount: scenario.duplicateSendCount ?? null,
          count: scenario.count,
        },
        metrics,
        errors: errors[i] || [],
      });
    }

    console.log("💤 다음 시나리오 전 10초 대기...");
    await sleep(10000);
  }

  // ─── 결과 저장 ───
  const resultsDir = path.resolve(__dirname, "../../results");
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  // JSON
  fs.writeFileSync(
    path.join(resultsDir, "additional-results.json"),
    JSON.stringify(allResults, null, 2),
  );

  // Raw CSV
  fs.writeFileSync(
    path.join(resultsDir, "additional-raw.csv"),
    generateCSV(allResults),
  );

  // Summary CSV
  fs.writeFileSync(
    path.join(resultsDir, "additional-summary.csv"),
    generateSummaryCSV(allResults),
  );

  // Markdown Report
  fs.writeFileSync(
    path.join(resultsDir, "additional-report.md"),
    generateReport(allResults),
  );

  console.log("\n💾 저장 완료:");
  console.log("  - results/additional-results.json");
  console.log("  - results/additional-raw.csv");
  console.log("  - results/additional-summary.csv");
  console.log("  - results/additional-report.md");
  console.log("\n✅ 추가 실험 모두 완료!");
}

// ─── CSV 생성 ───

function generateCSV(results: ScenarioResult[]): string {
  const header = [
    "scenario_id", "scenario_name", "group", "repeat", "mode",
    "msg_type", "priority", "interval_ms", "collapse_key", "payload_bytes",
    "duplicate_count", "msg_count",
    "delivery_rate_pct", "avg_latency_ms", "p95_latency_ms", "p99_latency_ms",
    "retry_rate_pct", "dlq_rate_pct", "duplicate_rate_pct", "throughput_msg_per_sec",
    "errors", "experiment_id",
  ].join(",");

  const rows = results.map((r) => [
    r.id,
    `"${r.name}"`,
    r.group,
    r.repeat,
    r.parameters.mode,
    r.parameters.type,
    r.parameters.priority,
    r.parameters.interval,
    r.parameters.collapseKey ?? "",
    r.parameters.payloadSize ?? "",
    r.parameters.duplicateSendCount ?? "",
    r.parameters.count,
    r.metrics.m1_deliveryRate.toFixed(2),
    r.metrics.m2_avgLatencyMs?.toFixed(1) ?? "",
    r.metrics.m3_p95LatencyMs?.toFixed(1) ?? "",
    r.metrics.m4_p99LatencyMs?.toFixed(1) ?? "",
    r.metrics.m5_retryRate.toFixed(2),
    r.metrics.m6_dlqRate.toFixed(2),
    r.metrics.m7_duplicateRate.toFixed(2),
    r.metrics.m8_throughput?.toFixed(2) ?? "",
    `"${r.errors.join("; ")}"`,
    r.experimentId,
  ].join(","));

  return [header, ...rows].join("\n");
}

function generateSummaryCSV(results: ScenarioResult[]): string {
  const header = [
    "scenario_id", "scenario_name", "group", "group_label", "description", "mode",
    "msg_type", "priority", "interval_ms", "payload_bytes", "duplicate_count",
    "avg_delivery_rate_pct", "avg_latency_ms", "avg_p95_ms", "avg_p99_ms",
    "avg_duplicate_rate_pct", "avg_throughput_msg_per_sec", "repeats", "errors",
  ].join(",");

  const grouped = groupBy(results);
  const rows: string[] = [];

  for (const [, runs] of grouped) {
    const f = runs[0];
    const allErrors = [...new Set(runs.flatMap((r) => r.errors))];
    rows.push([
      f.id,
      `"${f.name}"`,
      f.group,
      `"${f.groupLabel}"`,
      `"${f.description}"`,
      f.parameters.mode,
      f.parameters.type,
      f.parameters.priority,
      f.parameters.interval,
      f.parameters.payloadSize ?? "",
      f.parameters.duplicateSendCount ?? "",
      avg(runs.map((r) => r.metrics.m1_deliveryRate)).toFixed(2),
      avg(runs.map((r) => r.metrics.m2_avgLatencyMs).filter(nonNull)).toFixed(1),
      avg(runs.map((r) => r.metrics.m3_p95LatencyMs).filter(nonNull)).toFixed(1),
      avg(runs.map((r) => r.metrics.m4_p99LatencyMs).filter(nonNull)).toFixed(1),
      avg(runs.map((r) => r.metrics.m7_duplicateRate)).toFixed(2),
      avg(runs.map((r) => r.metrics.m8_throughput).filter(nonNull)).toFixed(2),
      runs.length,
      `"${allErrors.join("; ")}"`,
    ].join(","));
  }

  return [header, ...rows].join("\n");
}

// ─── Markdown 보고서 생성 ───

function generateReport(results: ScenarioResult[]): string {
  const grouped = groupBy(results);
  const groups = [...new Set(results.map((r) => r.group))];

  const lines: string[] = [
    "# 추가 실험 QoS 분석 보고서",
    "",
    `> 생성일: ${new Date().toISOString().split("T")[0]}`,
    "> 환경: Android 에뮬레이터 (Pixel 3a API 36), Firebase Spark 플랜",
    "",
    "---",
    "",
    "## 1. 실험 목적",
    "",
    "기존 서버→폰 실험(그룹 A~F)에서 다루지 못한 추가 불안정 요인을 에뮬레이터 환경에서 검증한다.",
    "Stale 토큰, 페이로드 경계값, Collapsible 스로틀링, 중복 전송, Doze 모드 등",
    "실제 운영에서 발생 가능한 시나리오에 대한 QoS 영향을 정량적으로 측정한다.",
    "",
    "---",
    "",
    "## 2. 실험 설계",
    "",
  ];

  // 그룹 요약 테이블
  const groupLabels: Record<string, string> = {};
  for (const r of results) groupLabels[r.group] = r.groupLabel;

  lines.push("| 그룹 | 비교 변수 | 시나리오 수 | 대상 실험 |");
  lines.push("|------|----------|:---------:|----------|");
  for (const g of groups) {
    const count = [...grouped.entries()].filter(([id]) => id.startsWith(`STP-${g}`)).length;
    const expMap: Record<string, string> = {
      G: "EXP-U01 (Stale 토큰)",
      H: "EXP-U02 (페이로드 경계값)",
      I: "EXP-U07 (Collapsible 스로틀링)",
      J: "EXP-U15 (중복 전송)",
      K: "EXP-U09 (Doze 모드)",
    };
    lines.push(`| ${g} | ${groupLabels[g]} | ${count} | ${expMap[g] || ""} |`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");

  // 전체 결과 요약
  lines.push("## 3. 전체 결과 요약");
  lines.push("");
  lines.push("| ID | 시나리오 | 모드 | 전달률 | 평균지연 | P95 | P99 | 중복률 | 처리량 | 에러 |");
  lines.push("|-----|---------|------|:-----:|:------:|:---:|:---:|:-----:|:-----:|------|");

  for (const [, runs] of grouped) {
    const f = runs[0];
    const m1 = avg(runs.map((r) => r.metrics.m1_deliveryRate));
    const m2 = avg(runs.map((r) => r.metrics.m2_avgLatencyMs).filter(nonNull));
    const m3 = avg(runs.map((r) => r.metrics.m3_p95LatencyMs).filter(nonNull));
    const m4 = avg(runs.map((r) => r.metrics.m4_p99LatencyMs).filter(nonNull));
    const m7 = avg(runs.map((r) => r.metrics.m7_duplicateRate));
    const m8 = avg(runs.map((r) => r.metrics.m8_throughput).filter(nonNull));
    const allErrors = [...new Set(runs.flatMap((r) => r.errors))];

    lines.push(
      `| ${f.id} | ${f.name} | ${f.parameters.mode} | ${m1.toFixed(1)}% | ${fmt(m2)}ms | ${fmt(m3)}ms | ${fmt(m4)}ms | ${m7.toFixed(1)}% | ${fmt(m8)} msg/s | ${allErrors.length > 0 ? allErrors.join(", ") : "-"} |`
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");

  // 그룹별 상세 분석
  let sectionNum = 4;

  for (const g of groups) {
    const groupScenarios = [...grouped.entries()].filter(([id]) =>
      id.startsWith(`STP-${g}`)
    );
    if (groupScenarios.length === 0) continue;

    lines.push(`## ${sectionNum}. ${groupLabels[g]} (그룹 ${g})`);
    lines.push("");

    // 그룹별 테이블
    lines.push("| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 중복률 | 에러 |");
    lines.push("|---------|------|:-----:|:------:|:---:|:---:|:-----:|------|");

    for (const [, runs] of groupScenarios) {
      const f = runs[0];
      const m1 = avg(runs.map((r) => r.metrics.m1_deliveryRate));
      const m2 = avg(runs.map((r) => r.metrics.m2_avgLatencyMs).filter(nonNull));
      const m3 = avg(runs.map((r) => r.metrics.m3_p95LatencyMs).filter(nonNull));
      const m4 = avg(runs.map((r) => r.metrics.m4_p99LatencyMs).filter(nonNull));
      const m7 = avg(runs.map((r) => r.metrics.m7_duplicateRate));
      const allErrors = [...new Set(runs.flatMap((r) => r.errors))];

      let setting = "";
      if (g === "G") setting = f.parameters.mode;
      else if (g === "H") setting = `${f.parameters.payloadSize}B`;
      else if (g === "I") setting = `collapse, ${f.parameters.interval}ms`;
      else if (g === "J") setting = `×${f.parameters.duplicateSendCount || 1}`;
      else if (g === "K") setting = `Doze, ${f.parameters.priority}`;

      lines.push(
        `| ${f.id} ${f.name} | ${setting} | ${m1.toFixed(1)}% | ${fmt(m2)}ms | ${fmt(m3)}ms | ${fmt(m4)}ms | ${m7.toFixed(1)}% | ${allErrors.length > 0 ? allErrors.slice(0, 2).join(", ") : "-"} |`
      );
    }

    lines.push("");
    lines.push(`### ${sectionNum}.1 관찰`);
    lines.push("");

    // 그룹별 관찰 템플릿
    if (g === "G") {
      lines.push("Stale 토큰 실험 결과를 기반으로 분석:");
      lines.push("- **STP-G1 (유효 토큰)**: 기준선 전달률 및 지연시간");
      lines.push("- **STP-G2 (무효 토큰)**: FCM 에러 유형, 응답 시간 측정");
      lines.push("- **STP-G3 (혼합)**: 무효 토큰 전송 실패가 유효 토큰 전달에 미치는 영향 확인");
      lines.push("");
      lines.push("> 핵심 질문: 무효 토큰이 유효 토큰의 전달률/지연시간에 영향을 주는가?");
    } else if (g === "H") {
      lines.push("페이로드 경계값 실험 결과를 기반으로 분석:");
      lines.push("- **STP-H1 (4000B)**: 한도 이내 정상 동작 확인");
      lines.push("- **STP-H2 (4096B)**: 정확한 한도에서의 동작");
      lines.push("- **STP-H3 (5000B)**: 한도 초과 시 FCM 에러 응답 유형 확인");
      lines.push("");
      lines.push("> 핵심 질문: 4096B 경계에서 정확히 어떤 동작을 하는가?");
    } else if (g === "I") {
      lines.push("기존 STP-D2 (200ms, collapse_key, 전달률 13.3%)와 비교:");
      lines.push("- **전송 간격이 길어질수록** 이전 메시지가 전달된 후 다음 메시지가 도착하므로 오버라이트 감소");
      lines.push("- **전송 간격이 짧을수록** FCM 대기열에서 최신 메시지로 덮어쓰기 증가");
      lines.push("");
      lines.push("> 핵심 질문: Collapsible 메시지의 전달률이 전송 빈도에 비례하여 변하는가?");
    } else if (g === "J") {
      lines.push("중복 전송 실험 결과를 기반으로 분석:");
      lines.push("- **STP-J1 (1회)**: 중복 없는 기준선");
      lines.push("- **STP-J2/J3 (3회/5회)**: 동일 messageId 반복 전송 시 클라이언트 수신 횟수");
      lines.push("- M7(중복률) 지표로 클라이언트 dedup 서비스의 실효성 평가");
      lines.push("");
      lines.push("> 핵심 질문: FCM은 서버 측에서 중복 제거를 수행하는가? 클라이언트 dedup은 작동하는가?");
    } else if (g === "K") {
      lines.push("Doze 모드 실험 결과를 기반으로 분석:");
      lines.push("- **STP-K1 (HIGH)**: HIGH priority가 Doze 모드를 바이패스하는지 확인");
      lines.push("- **STP-K2 (NORMAL)**: NORMAL priority가 배치 처리되어 지연되는 정도 측정");
      lines.push("");
      lines.push("> 핵심 질문: HIGH priority는 Doze를 바이패스하는가? NORMAL의 지연 분포는?");
    }

    lines.push("");
    sectionNum++;
  }

  // 종합 분석
  lines.push("---");
  lines.push("");
  lines.push(`## ${sectionNum}. 종합 분석`);
  lines.push("");
  lines.push("| 실험 | QoS 영향도 | 핵심 발견 | 운영 권장사항 |");
  lines.push("|------|:---------:|----------|-------------|");
  lines.push("| Stale 토큰 | 데이터 참조 | 무효 토큰의 유효 전달 영향 여부 | 주기적 토큰 정리, 404 UNREGISTERED 에러 시 즉시 토큰 삭제 |");
  lines.push("| 페이로드 경계값 | 데이터 참조 | 4096B 경계 동작 | SafetyClassifier로 사전 검증, 4KB 이내 유지 |");
  lines.push("| Collapsible 스로틀링 | 데이터 참조 | 전송 빈도별 오버라이트율 | 상태 업데이트 메시지는 적정 빈도로 전송 |");
  lines.push("| 중복 전송 | 데이터 참조 | FCM/클라이언트 중복 처리 | QoS L2 (dedup) 적용 시 실효성 확인 |");
  lines.push("| Doze 모드 | 데이터 참조 | HIGH vs NORMAL 우선순위 차이 | 긴급 알림은 반드시 HIGH, 비긴급은 NORMAL |");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 참고 문헌");
  lines.push("");
  lines.push("[^1]: Firebase Cloud Messaging — About FCM Messages. https://firebase.google.com/docs/cloud-messaging/concept-options");
  lines.push("[^2]: FCM Throttling and Quotas. https://firebase.google.com/docs/cloud-messaging/concept-options#throttling");
  lines.push("[^3]: Android Developers — Optimize for Doze and App Standby. https://developer.android.com/training/monitoring-device-state/doze-standby");
  lines.push("[^4]: DontKillMyApp.com — OEM 배터리 최적화 현황. https://dontkillmyapp.com/");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 원시 데이터");
  lines.push("");
  lines.push("- `results/additional-results.json` — JSON 형식 전체 결과");
  lines.push("- `results/additional-raw.csv` — 반복별 전체 원시 데이터 (엑셀 호환)");
  lines.push("- `results/additional-summary.csv` — 시나리오별 평균 요약 데이터");

  return lines.join("\n");
}

// ─── 유틸 함수 ───

function groupBy(results: ScenarioResult[]): Map<string, ScenarioResult[]> {
  const map = new Map<string, ScenarioResult[]>();
  for (const r of results) {
    if (!map.has(r.id)) map.set(r.id, []);
    map.get(r.id)!.push(r);
  }
  return map;
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

// ─── 실행 ───

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
