/**
 * Retry Manager — 로컬 인메모리 타이머 기반 재시도 큐
 * Cloud Tasks 대신 setTimeout으로 구현 (Spark 무료 플랜 호환)
 */

interface PendingRetry {
  messageId: string;
  token: string;
  fcmMessage: any;
  timer: NodeJS.Timeout;
}

export class RetryManager {
  private pending = new Map<string, PendingRetry>();

  scheduleAckCheck(
    msg: { messageId: string; token: string; fcmMessage: any },
    delayMs: number
  ): void {
    // 기존 타이머가 있으면 취소
    this.cancel(msg.messageId);

    const timer = setTimeout(async () => {
      this.pending.delete(msg.messageId);
      // QoSEngine.handleRetry를 호출하기 위해 이벤트 발생
      if (this.onRetryCallback) {
        await this.onRetryCallback(msg.messageId);
      }
    }, delayMs);

    this.pending.set(msg.messageId, {
      ...msg,
      timer,
    });
  }

  cancel(messageId: string): void {
    const entry = this.pending.get(messageId);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(messageId);
    }
  }

  stop(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  // 콜백 설정
  private onRetryCallback?: (messageId: string) => Promise<void>;

  onRetry(callback: (messageId: string) => Promise<void>): void {
    this.onRetryCallback = callback;
  }
}
