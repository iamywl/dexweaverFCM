/**
 * Dead Letter Queue — 최대 재시도 초과 시 Firestore dlq/ 컬렉션에 저장
 */
import { db } from "../../config/firebase";

export class DeadLetterQueue {
  async add(messageId: string, messageData: any): Promise<void> {
    await db
      .collection("dlq")
      .doc(messageId)
      .set({
        messageId,
        originalMessage: messageData,
        reason: "max_retries_exceeded",
        createdAt: new Date(),
      });
  }

  async list(limit = 50) {
    const snapshot = await db
      .collection("dlq")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => doc.data());
  }

  async retry(messageId: string): Promise<any> {
    const doc = await db.collection("dlq").doc(messageId).get();
    if (!doc.exists) throw new Error(`DLQ entry not found: ${messageId}`);

    const data = doc.data()!;
    await db.collection("dlq").doc(messageId).delete();
    return data.originalMessage;
  }
}
