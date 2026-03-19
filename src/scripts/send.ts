/**
 * 메시지 전송 스크립트 (L0 — 단일 전송, 재시도 없음)
 *
 * 사용법:
 *   npm run send -- --token <FCM_TOKEN> --title "제목" --body "내용"
 *   npm run send -- --token <FCM_TOKEN> --data '{"key":"value"}'
 *   npm run send -- --token <FCM_TOKEN> --type data --body "데이터 메시지"
 *   npm run send -- --auto   (Firestore에서 가장 최근 토큰 자동 선택)
 */
import { db, messaging } from "../config/firebase";
import { v4 as uuidv4 } from "uuid";

type MessageType = "notification" | "data" | "combined";

interface SendOptions {
  token: string;
  title?: string;
  body?: string;
  data?: Record<string, string>;
  type?: MessageType;
  collapseKey?: string;
  experimentId?: string;
  priority?: "high" | "normal";
  ttl?: number; // seconds
}

async function getLatestToken(): Promise<string> {
  const snapshot = await db
    .collection("tokens")
    .where("isValid", "==", true)
    .orderBy("lastActive", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new Error("No valid tokens found in Firestore");
  }
  return snapshot.docs[0].data().fcmToken;
}

async function sendMessage(options: SendOptions) {
  const messageId = uuidv4();
  const sentAt = new Date();

  const fcmMessage: any = {
    token: options.token,
    data: {
      messageId,
      sentAt: sentAt.toISOString(),
      ...(options.data || {}),
    },
  };

  const type = options.type || "combined";

  if (type === "notification" || type === "combined") {
    fcmMessage.notification = {
      title: options.title || "DexWeaver Test",
      body: options.body || `Message ${messageId.substring(0, 8)}`,
    };
  }

  if (type === "data") {
    fcmMessage.data.title = options.title || "DexWeaver Test";
    fcmMessage.data.body = options.body || `Message ${messageId.substring(0, 8)}`;
  }

  // Android 설정
  fcmMessage.android = {
    priority: options.priority || "high",
    ...(options.ttl != null ? { ttl: options.ttl * 1000 } : {}),
    ...(options.collapseKey ? { collapseKey: options.collapseKey } : {}),
  };

  if (options.collapseKey) {
    fcmMessage.apns = {
      headers: { "apns-collapse-id": options.collapseKey },
    };
  }

  // Firestore에 전송 기록 저장
  const messageDoc = {
    messageId,
    payload: fcmMessage,
    targetToken: options.token.substring(0, 20) + "...",
    qosLevel: 0,
    status: "pending",
    sentAt,
    retryCount: 0,
    experimentId: options.experimentId || null,
    createdAt: sentAt,
  };

  try {
    const fcmResponse = await messaging.send(fcmMessage);

    await db.collection("messages").doc(messageId).set({
      ...messageDoc,
      status: "sent",
      fcmResponse: { messageId: fcmResponse },
    });

    console.log(`Sent: ${messageId} → FCM: ${fcmResponse}`);
    return { messageId, fcmResponse };
  } catch (error: any) {
    await db.collection("messages").doc(messageId).set({
      ...messageDoc,
      status: "failed",
      fcmResponse: { error: error.message },
    });

    console.error(`Failed: ${messageId} → ${error.message}`);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  let token: string;
  if (args.includes("--auto")) {
    token = await getLatestToken();
    console.log(`Auto-selected token: ${token.substring(0, 20)}...`);
  } else {
    const tokenIdx = args.indexOf("--token");
    if (tokenIdx === -1 || !args[tokenIdx + 1]) {
      console.error("Usage: npm run send -- --auto OR --token <FCM_TOKEN>");
      process.exit(1);
    }
    token = args[tokenIdx + 1];
  }

  const titleIdx = args.indexOf("--title");
  const bodyIdx = args.indexOf("--body");
  const typeIdx = args.indexOf("--type");
  const dataIdx = args.indexOf("--data");

  const options: SendOptions = {
    token,
    title: titleIdx !== -1 ? args[titleIdx + 1] : undefined,
    body: bodyIdx !== -1 ? args[bodyIdx + 1] : undefined,
    type: typeIdx !== -1 ? (args[typeIdx + 1] as MessageType) : undefined,
    data: dataIdx !== -1 ? JSON.parse(args[dataIdx + 1]) : undefined,
  };

  await sendMessage(options);
  process.exit(0);
}

// Export for use in experiment scripts
export { sendMessage, getLatestToken, SendOptions, MessageType };

// Run if executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
