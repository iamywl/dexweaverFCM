/**
 * 실험 실행 스크립트
 *
 * 사용법:
 *   npm run experiment -- --name EXP-S01 --count 2500 --repeat 3
 *   npm run experiment -- --name EXP-S01 --count 100 --repeat 1 --type data
 *   npm run experiment -- --name EXP-S01 --count 100 --interval 500
 */
import { db } from "../config/firebase";
import { sendMessage, getLatestToken, MessageType } from "./send";
import { v4 as uuidv4 } from "uuid";

interface ExperimentConfig {
  name: string;
  count: number;
  repeat: number;
  type: MessageType;
  interval: number; // ms between sends
  collapseKey?: string;
  payloadSize?: number; // bytes
}

function parseArgs(): ExperimentConfig {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
  };

  return {
    name: get("--name", "EXP-TEST"),
    count: parseInt(get("--count", "10")),
    repeat: parseInt(get("--repeat", "1")),
    type: get("--type", "combined") as MessageType,
    interval: parseInt(get("--interval", "100")),
    collapseKey: args.includes("--collapse") ? get("--collapse", "default") : undefined,
    payloadSize: args.includes("--payload-size")
      ? parseInt(get("--payload-size", "0"))
      : undefined,
  };
}

function generatePayload(size?: number): Record<string, string> {
  if (!size || size <= 0) return {};
  // 각 key-value 쌍의 오버헤드를 고려하여 패딩
  const padding = "x".repeat(Math.max(0, size - 50));
  return { padding };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runExperiment(config: ExperimentConfig) {
  const token = await getLatestToken();
  console.log(`\nExperiment: ${config.name}`);
  console.log(`Token: ${token.substring(0, 20)}...`);
  console.log(`Count: ${config.count} × ${config.repeat} repeats`);
  console.log(`Type: ${config.type}, Interval: ${config.interval}ms\n`);

  for (let r = 0; r < config.repeat; r++) {
    const experimentId = `${config.name}-R${r + 1}-${uuidv4().substring(0, 8)}`;
    const startTime = Date.now();

    // 실험 레코드 생성
    await db.collection("experiments").doc(experimentId).set({
      name: config.name,
      phase: parseInt(config.name.replace(/\D/g, "").charAt(0) || "0"),
      description: `${config.name} repeat ${r + 1}/${config.repeat}`,
      parameters: {
        count: config.count,
        type: config.type,
        interval: config.interval,
        collapseKey: config.collapseKey || null,
        payloadSize: config.payloadSize || null,
      },
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      messageCount: config.count,
      results: null,
    });

    console.log(`--- Repeat ${r + 1}/${config.repeat} (${experimentId}) ---`);

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < config.count; i++) {
      try {
        await sendMessage({
          token,
          title: `${config.name} #${i + 1}`,
          body: `Repeat ${r + 1}, Message ${i + 1}/${config.count}`,
          type: config.type,
          data: generatePayload(config.payloadSize),
          collapseKey: config.collapseKey,
          experimentId,
        });
        sent++;
      } catch {
        failed++;
      }

      if (config.interval > 0 && i < config.count - 1) {
        await sleep(config.interval);
      }

      // 진행률 표시 (10% 단위)
      if ((i + 1) % Math.max(1, Math.floor(config.count / 10)) === 0) {
        const pct = (((i + 1) / config.count) * 100).toFixed(0);
        console.log(`  Progress: ${pct}% (${sent} sent, ${failed} failed)`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // 실험 완료 업데이트
    await db.collection("experiments").doc(experimentId).update({
      status: "completed",
      completedAt: new Date(),
      results: {
        totalSent: sent,
        totalFailed: failed,
        elapsedSeconds: parseFloat(elapsed),
      },
    });

    console.log(
      `  Done: ${sent} sent, ${failed} failed in ${elapsed}s\n`
    );

    // 반복 간 쿨다운
    if (r < config.repeat - 1) {
      console.log("  Cooldown 10s...");
      await sleep(10000);
    }
  }

  console.log("Experiment complete.");
}

const config = parseArgs();
runExperiment(config)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
