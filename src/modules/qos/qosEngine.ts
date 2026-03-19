/**
 * QoS Engine — L0 / L1 / L2 분기 처리
 *
 * L0: 1회 전송, 재시도 없음
 * L1: ACK 미수신 시 재시도 (최대 5회, exponential backoff)
 * L2: L1 + 클라이언트 중복 제거
 */
import { db, messaging } from "../../config/firebase";
import { RetryManager } from "./retryManager";
import { DeadLetterQueue } from "./deadLetterQueue";

export type QoSLevel = 0 | 1 | 2;

interface QoSMessage {
  messageId: string;
  token: string;
  fcmMessage: any;
  experimentId?: string;
}

const ACK_TIMEOUT_MS = 30_000; // 30초 내 ACK 없으면 재시도

export class QoSEngine {
  private retryManager: RetryManager;
  private dlq: DeadLetterQueue;

  constructor() {
    this.retryManager = new RetryManager();
    this.dlq = new DeadLetterQueue();
  }

  async send(msg: QoSMessage, level: QoSLevel): Promise<string> {
    switch (level) {
      case 0:
        return this.sendL0(msg);
      case 1:
        return this.sendL1(msg);
      case 2:
        return this.sendL2(msg);
      default:
        throw new Error(`Unknown QoS level: ${level}`);
    }
  }

  /** L0: Fire-and-forget */
  private async sendL0(msg: QoSMessage): Promise<string> {
    return messaging.send(msg.fcmMessage);
  }

  /** L1: Send + ACK tracking + retry */
  private async sendL1(msg: QoSMessage): Promise<string> {
    const response = await messaging.send(msg.fcmMessage);

    // ACK 타임아웃 후 재시도 스케줄링
    this.retryManager.scheduleAckCheck(msg, ACK_TIMEOUT_MS);

    return response;
  }

  /** L2: L1 + 중복 제거 헤더 추가 */
  private async sendL2(msg: QoSMessage): Promise<string> {
    // 중복 제거를 위한 messageId를 data에 포함 (클라이언트가 처리)
    if (msg.fcmMessage.data) {
      msg.fcmMessage.data.dedupId = msg.messageId;
      msg.fcmMessage.data.qosLevel = "2";
    }

    return this.sendL1(msg);
  }

  /** ACK 미수신 시 재시도 처리 (RetryManager에서 호출) */
  async handleRetry(messageId: string): Promise<void> {
    const msgDoc = await db.collection("messages").doc(messageId).get();
    if (!msgDoc.exists) return;

    const msg = msgDoc.data()!;

    // 이미 delivered면 스킵
    if (msg.status === "delivered") return;

    // ACK 확인
    const ackSnapshot = await db
      .collection("acks")
      .where("messageId", "==", messageId)
      .limit(1)
      .get();

    if (!ackSnapshot.empty) {
      await db.collection("messages").doc(messageId).update({
        status: "delivered",
      });
      return;
    }

    const retryCount = (msg.retryCount || 0) + 1;

    if (retryCount > 5) {
      // DLQ로 이동
      await this.dlq.add(messageId, msg);
      await db.collection("messages").doc(messageId).update({
        status: "dlq",
        retryCount,
      });
      console.log(`DLQ: ${messageId} (max retries exceeded)`);
      return;
    }

    // 재전송
    try {
      const response = await messaging.send(msg.payload);
      await db.collection("messages").doc(messageId).update({
        retryCount,
        fcmResponse: { messageId: response },
        status: "sent",
      });
      console.log(`Retry ${retryCount}: ${messageId}`);

      // 다시 ACK 체크 스케줄링
      this.retryManager.scheduleAckCheck(
        { messageId, token: msg.targetToken, fcmMessage: msg.payload },
        ACK_TIMEOUT_MS * Math.pow(2, retryCount - 1) // exponential backoff
      );
    } catch (error: any) {
      await db.collection("messages").doc(messageId).update({
        retryCount,
        status: "failed",
        fcmResponse: { error: error.message },
      });
    }
  }

  stop() {
    this.retryManager.stop();
  }
}
