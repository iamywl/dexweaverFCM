/**
 * ACK 리스너 스크립트
 * Firestore의 acks/ 컬렉션을 실시간으로 감시하고,
 * messages/ 컬렉션과 매칭하여 지연시간을 계산한다.
 *
 * 사용법: npm run ack-listener
 */
import { db } from "../config/firebase";

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function startListener() {
  console.log("ACK Listener started. Watching acks/ collection...\n");

  const unsubscribe = db
    .collection("acks")
    .orderBy("ackSentAt", "desc")
    .limit(50)
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== "added") return;

        const ack = change.doc.data();
        const messageId = ack.messageId;

        // 대응하는 메시지 조회
        const msgDoc = await db.collection("messages").doc(messageId).get();

        if (msgDoc.exists) {
          const msg = msgDoc.data()!;
          const sentAt = msg.sentAt?.toDate?.() || new Date(msg.sentAt);
          const receivedAt =
            ack.receivedAt?.toDate?.() || new Date(ack.receivedAt);
          const latency = receivedAt.getTime() - sentAt.getTime();

          // 메시지 상태를 delivered로 업데이트
          await db.collection("messages").doc(messageId).update({
            status: "delivered",
          });

          console.log(
            `ACK | ${messageId.substring(0, 8)} | ` +
              `${ack.appState.padEnd(12)} | ` +
              `latency: ${formatLatency(latency)} | ` +
              `network: ${ack.networkType || "unknown"}`
          );
        } else {
          console.log(
            `ACK | ${messageId.substring(0, 8)} | (message not found)`
          );
        }
      });
    });

  // Ctrl+C로 종료
  process.on("SIGINT", () => {
    console.log("\nStopping ACK listener...");
    unsubscribe();
    process.exit(0);
  });
}

startListener().catch(console.error);
