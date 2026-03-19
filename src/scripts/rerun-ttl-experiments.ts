/**
 * TTL 실험 재실행 (send.ts의 TTL 포맷 수정 후)
 *
 * 실행: npx tsx src/scripts/rerun-ttl-experiments.ts
 */
import { db } from "../config/firebase";
import { sendMessage, getLatestToken, MessageType } from "./send";
import { MetricsCollector } from "../modules/metrics/metricsCollector";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Scenario {
  id: string;
  name: string;
  description: string;
  count: number;
  repeat: number;
  type: MessageType;
  interval: number;
  priority: "high" | "normal";
  ttl?: number;
}

const scenarios: Scenario[] = [
  {
    id: "STP-C1-v2",
    name: "TTL=0 (즉시 전달 또는 폐기)",
    description: "TTL 0초 (밀리초 변환 수정 후 재실험)",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "high", ttl: 0,
  },
  {
    id: "STP-C2-v2",
    name: "TTL=86400 (24시간)",
    description: "TTL 24시간 (밀리초 변환 수정 후 재실험)",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "high", ttl: 86400,
  },
  {
    id: "STP-C3-v2",
    name: "TTL=2419200 (28일, 최대)",
    description: "TTL 28일 최대 보관 (밀리초 변환 수정 후 재실험)",
    count: 50, repeat: 3, type: "combined", interval: 200,
    priority: "high", ttl: 2419200,
  },
];

interface ScenarioResult {
  id: string;
  name: string;
  description: string;
  experimentId: string;
  repeat: number;
  parameters: any;
  metrics: any;
}

async function runScenario(scenario: Scenario, token: string): Promise<string[]> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📋 [${scenario.id}] ${scenario.name}`);
  console.log(`   ${scenario.description}`);
  console.log(`   TTL=${scenario.ttl}s → Admin SDK: ttl=${scenario.ttl! * 1000}ms`);
  console.log("=".repeat(60));

  const experimentIds: string[] = [];

  for (let r = 0; r < scenario.repeat; r++) {
    const experimentId = `${scenario.id}-R${r + 1}-${uuidv4().substring(0, 8)}`;
    experimentIds.push(experimentId);
    const startTime = Date.now();

    await db.collection("experiments").doc(experimentId).set({
      name: scenario.id,
      phase: "ttl-rerun",
      description: `[${scenario.id}] ${scenario.name} (R${r + 1}/${scenario.repeat})`,
      parameters: {
        count: scenario.count,
        type: scenario.type,
        interval: scenario.interval,
        priority: scenario.priority,
        ttl: scenario.ttl,
        ttlMs: scenario.ttl! * 1000,
        fix: "ttl format changed from string to milliseconds number",
      },
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      messageCount: scenario.count,
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
          priority: scenario.priority,
          ttl: scenario.ttl,
          experimentId,
        });
        sent++;
      } catch (err: any) {
        failed++;
        console.error(`   ❌ ${err.message}`);
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

async function main() {
  const token = await getLatestToken();
  console.log(`Token: ${token.substring(0, 20)}...`);
  console.log(`\n🔧 수정사항: ttl 포맷 변경 (문자열 "Ns" → 밀리초 숫자 N*1000)`);
  console.log(`총 ${scenarios.length}개 TTL 시나리오 재실행\n`);

  const collector = new MetricsCollector();
  const allResults: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    const experimentIds = await runScenario(scenario, token);

    console.log("\n⏳ ACK 수신 대기 20초...");
    await sleep(20000);

    for (let i = 0; i < experimentIds.length; i++) {
      const metrics = await collector.calculate(experimentIds[i]);
      allResults.push({
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        experimentId: experimentIds[i],
        repeat: i + 1,
        parameters: {
          type: scenario.type,
          priority: scenario.priority,
          interval: scenario.interval,
          ttl: scenario.ttl,
          count: scenario.count,
        },
        metrics,
      });

      console.log(`   R${i + 1} 전달률: ${metrics.m1_deliveryRate.toFixed(1)}% | 평균지연: ${metrics.m2_avgLatencyMs?.toFixed(0) ?? "N/A"}ms`);
    }

    console.log("💤 다음 시나리오 전 10초 대기...");
    await sleep(10000);
  }

  // 결과 저장
  const resultsDir = path.resolve(__dirname, "../../results");
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  fs.writeFileSync(
    path.join(resultsDir, "ttl-rerun-results.json"),
    JSON.stringify(allResults, null, 2),
  );

  // 요약 출력
  console.log("\n" + "=".repeat(60));
  console.log("📊 TTL 재실험 결과 요약");
  console.log("=".repeat(60));
  console.log("| 시나리오 | TTL | 전달률 | 평균지연 | P95 | P99 |");
  console.log("|---------|-----|:-----:|:------:|:---:|:---:|");

  const grouped = new Map<string, ScenarioResult[]>();
  for (const r of allResults) {
    if (!grouped.has(r.id)) grouped.set(r.id, []);
    grouped.get(r.id)!.push(r);
  }

  for (const [id, runs] of grouped) {
    const f = runs[0];
    const m1 = avg(runs.map((r) => r.metrics.m1_deliveryRate));
    const m2 = avg(runs.map((r) => r.metrics.m2_avgLatencyMs).filter(nonNull));
    const m3 = avg(runs.map((r) => r.metrics.m3_p95LatencyMs).filter(nonNull));
    const m4 = avg(runs.map((r) => r.metrics.m4_p99LatencyMs).filter(nonNull));
    console.log(
      `| ${f.name} | ${f.parameters.ttl}s | ${m1.toFixed(1)}% | ${m2.toFixed(0)}ms | ${m3.toFixed(0)}ms | ${m4.toFixed(0)}ms |`
    );
  }

  console.log("\n💾 결과 저장: results/ttl-rerun-results.json");
  console.log("✅ TTL 재실험 완료!");
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function nonNull(v: any): boolean { return v != null; }

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
