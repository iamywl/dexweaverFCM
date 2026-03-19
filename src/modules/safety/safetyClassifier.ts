/**
 * Safety Classifier — 페이로드 검증 및 rate limit 검사
 */

const MAX_PAYLOAD_BYTES = 4096; // FCM data 메시지 최대 크기
const MAX_NOTIFICATION_PAYLOAD_BYTES = 2048; // iOS notification 최대 크기

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  payloadSize: number;
}

export class SafetyClassifier {
  validate(fcmMessage: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 토큰 존재 확인
    if (!fcmMessage.token) {
      errors.push("Missing target token");
    }

    // 페이로드 크기 확인
    const dataStr = JSON.stringify(fcmMessage.data || {});
    const dataSize = Buffer.byteLength(dataStr, "utf-8");

    if (dataSize > MAX_PAYLOAD_BYTES) {
      errors.push(
        `Data payload too large: ${dataSize} bytes (max ${MAX_PAYLOAD_BYTES})`
      );
    } else if (dataSize > MAX_PAYLOAD_BYTES * 0.9) {
      warnings.push(
        `Data payload near limit: ${dataSize}/${MAX_PAYLOAD_BYTES} bytes`
      );
    }

    // Notification 페이로드 크기 확인
    if (fcmMessage.notification) {
      const notifStr = JSON.stringify(fcmMessage.notification);
      const notifSize = Buffer.byteLength(notifStr, "utf-8");
      if (notifSize > MAX_NOTIFICATION_PAYLOAD_BYTES) {
        warnings.push(
          `Notification payload large: ${notifSize} bytes`
        );
      }
    }

    // data 키 검증 (예약어 사용 금지)
    const reservedKeys = ["from", "google.", "gcm", "collapse_key"];
    if (fcmMessage.data) {
      for (const key of Object.keys(fcmMessage.data)) {
        if (reservedKeys.some((rk) => key.startsWith(rk))) {
          errors.push(`Reserved key in data: "${key}"`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      payloadSize: dataSize,
    };
  }
}
