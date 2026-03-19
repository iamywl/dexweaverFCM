# FCM QoS 평가 지표 상세 명세서

> 작성일: 2026-03-19
> 목적: FCM 알림 시스템의 서비스 품질(QoS)을 정량적으로 측정하기 위한 8개 평가 지표(M1~M8)의 정의, 계산 방법, 측정 단위, 그리고 코드 레벨 구현 방안을 상세히 기술한다.

---

## 1. 지표 체계 개요

본 문서에서 정의하는 평가 지표는 핵심 지표(Primary Metrics) 4종과 보조 지표(Secondary Metrics) 4종으로 구성된다. 핵심 지표는 FCM의 전달 신뢰성을 직접 반영하며, 보조 지표는 QoS 보장 메커니즘의 운영 효율성을 측정하는 데 사용된다.

```
┌─────────────────────────────────────────────────────┐
│                  QoS 평가 지표 체계                    │
├─────────────────────┬───────────────────────────────┤
│   핵심 지표 (Primary) │   보조 지표 (Secondary)         │
│                     │                               │
│  M1. 전송 성공률      │  M5. 복구 시간 (MTTR)          │
│  M2. 전송 지연시간     │  M6. Dead Letter 비율          │
│  M3. 메시지 손실률     │  M7. 재시도 횟수               │
│  M4. 중복 수신률      │  M8. 처리량                    │
└─────────────────────┴───────────────────────────────┘
```

각 지표에는 종합 QoS 등급 산출을 위한 가중치가 부여되며, 가중치는 푸시 알림 시스템의 특성과 사용자 경험에 대한 영향도를 기준으로 결정된다 [^1].

---

## 2. 핵심 지표 (Primary Metrics)

### 2.1 M1. 전송 성공률 (Delivery Success Rate)

#### 2.1.1 정의

전송 성공률은 전체 전송 시도 중 최종적으로 디바이스에 도달한 메시지의 비율이다. 이 지표는 FCM 시스템의 가장 근본적인 신뢰성 척도이며, 종합 QoS 등급 산출 시 40%의 가중치를 갖는다.

FCM 아키텍처의 특성상, 전송 성공률은 반드시 **두 단계**로 구분하여 측정해야 한다 [^2]:

| 구분 | 정의 | 의미 |
|------|------|------|
| **(a) 서버 수락률** | FCM Backend가 HTTP 200으로 수락한 비율 | FCM 인프라가 메시지를 접수하였음을 의미한다 |
| **(b) 디바이스 수신률** | 클라이언트 디바이스에서 실제 수신이 확인된 비율 | 최종 사용자에게 알림이 도달하였음을 의미한다 |

이 구분이 필수적인 이유는 FCM HTTP v1 API의 성공 응답(HTTP 200 + message_id)이 디바이스 도달을 보장하지 않기 때문이다 [^3]. 산업계에서 보고된 서버 수락률은 약 99%이나, 실제 디바이스 렌더링 기준 전달률은 14~48%로 큰 격차가 존재한다 [^4].

#### 2.1.2 계산 방법

```
(a) 서버 수락률(%) = (HTTP 200 응답 수 / 전체 전송 시도 수) × 100

(b) 디바이스 수신률(%) = (디바이스 ACK 수신 수 / HTTP 200 응답 수) × 100

(c) 종합 전송 성공률(%) = (디바이스 ACK 수신 수 / 전체 전송 시도 수) × 100
```

#### 2.1.3 측정 단위

- 백분율(%)
- 소수점 첫째 자리까지 표기 (예: 99.2%)

#### 2.1.4 평가 등급

| 등급 | 기준 | 판정 |
|------|------|------|
| A (우수) | ≥ 99% | 프로덕션 적합 |
| B (양호) | ≥ 95% | 조건부 적합 |
| C (보통) | ≥ 90% | 개선 필요 |
| D (미흡) | ≥ 80% | 심각한 개선 필요 |
| F (불량) | < 80% | 사용 부적합 |

#### 2.1.5 코드 레벨 측정 구현

**서버 측 (전송 및 수락률 기록):**

```typescript
// src/metrics/delivery-rate.ts
import { getMessaging } from 'firebase-admin/messaging';
import { db } from '../config/database';

interface SendResult {
  messageId: string;
  testCase: string;
  sentAt: number;        // Date.now() 기준 밀리초
  fcmAcceptedAt: number | null;
  fcmResponseCode: number;
  fcmMessageId: string | null;
  errorCode: string | null;
}

async function sendAndRecord(
  token: string,
  payload: object,
  testCase: string
): Promise<SendResult> {
  const sentAt = Date.now();
  const messageId = crypto.randomUUID();

  try {
    const response = await getMessaging().send({
      token,
      data: {
        _mid: messageId,       // 추적용 고유 ID
        _sent_at: String(sentAt),
        ...payload
      },
    });

    const result: SendResult = {
      messageId,
      testCase,
      sentAt,
      fcmAcceptedAt: Date.now(),
      fcmResponseCode: 200,
      fcmMessageId: response,  // FCM이 반환한 message ID
      errorCode: null,
    };

    await db.collection('send_logs').doc(messageId).set(result);
    return result;

  } catch (error: any) {
    const result: SendResult = {
      messageId,
      testCase,
      sentAt,
      fcmAcceptedAt: null,
      fcmResponseCode: error.code || 500,
      fcmMessageId: null,
      errorCode: error.errorInfo?.code || 'UNKNOWN',
    };

    await db.collection('send_logs').doc(messageId).set(result);
    return result;
  }
}
```

**서버 측 (ACK 수신 엔드포인트):**

```typescript
// src/metrics/ack-receiver.ts
import express from 'express';
import { db } from '../config/database';

const router = express.Router();

interface AckPayload {
  messageId: string;
  receivedAt: number;
  appState: 'foreground' | 'background' | 'killed';
  deviceModel: string;
  platform: 'android' | 'ios';
}

router.post('/ack', async (req, res) => {
  const ack: AckPayload = req.body;

  await db.collection('ack_logs').doc(ack.messageId).set({
    ...ack,
    serverReceivedAt: Date.now(),
  });

  res.status(200).send({ status: 'ok' });
});
```

**지표 계산:**

```typescript
// src/metrics/calculate-m1.ts
async function calculateM1(testCase: string): Promise<{
  serverAcceptRate: number;
  deviceReceiveRate: number;
  overallRate: number;
  errorDistribution: Record<string, number>;
}> {
  const sendLogs = await db.collection('send_logs')
    .where('testCase', '==', testCase).get();
  const ackLogs = await db.collection('ack_logs').get();

  const totalSent = sendLogs.size;
  const accepted = sendLogs.docs.filter(d => d.data().fcmResponseCode === 200).length;

  const ackMessageIds = new Set(ackLogs.docs.map(d => d.data().messageId));
  const deviceReceived = sendLogs.docs.filter(
    d => d.data().fcmResponseCode === 200 && ackMessageIds.has(d.id)
  ).length;

  // 에러 코드별 분포 집계
  const errorDistribution: Record<string, number> = {};
  sendLogs.docs
    .filter(d => d.data().errorCode !== null)
    .forEach(d => {
      const code = d.data().errorCode;
      errorDistribution[code] = (errorDistribution[code] || 0) + 1;
    });

  return {
    serverAcceptRate: (accepted / totalSent) * 100,
    deviceReceiveRate: accepted > 0 ? (deviceReceived / accepted) * 100 : 0,
    overallRate: (deviceReceived / totalSent) * 100,
    errorDistribution,
  };
}
```

---

### 2.2 M2. 전송 지연시간 (End-to-End Latency)

#### 2.2.1 정의

전송 지연시간은 서버에서 메시지를 전송한 시점부터 디바이스가 해당 메시지를 수신한 시점까지의 시간 차이이다. 이 지표는 종합 QoS 등급 산출 시 25%의 가중치를 갖는다.

M1과 마찬가지로 두 단계로 구분하여 측정한다:

| 구분 | 정의 | 포함 구간 |
|------|------|----------|
| **(a) API 지연** | FCM HTTP v1 API 호출 후 응답 수신까지의 시간 | 서버 → FCM Backend |
| **(b) E2E 지연** | 서버 전송 시점부터 디바이스 수신까지의 시간 | 서버 → FCM → 플랫폼 전송 계층 → 디바이스 |

E2E 지연에는 FCM Backend 처리 시간, 플랫폼 전송 계층(Android ATL 또는 APNs) 지연, Doze/OEM 배터리 최적화에 의한 지연이 모두 포함된다 [^5].

#### 2.2.2 계산 방법

```
(a) API 지연(ms) = fcm_accepted_at - sent_at

(b) E2E 지연(ms) = device_received_at - sent_at
```

통계량은 다음 4가지를 산출한다:

| 통계량 | 의미 |
|--------|------|
| P50 (중앙값) | 전형적인 지연시간 |
| P95 | 95%의 메시지가 이 시간 이내에 도달함 |
| P99 | 1%의 극단적 지연 케이스를 포착함 |
| Max | 최악의 경우 지연시간 |

**시간 동기화 전제 조건**: E2E 지연 측정의 정확도는 서버와 디바이스 간 시계 동기화에 직접 의존한다. 모든 테스트 디바이스에 NTP(pool.ntp.org)를 설정하고, 측정 시작 전 시계 오차를 100ms 이내로 확인해야 한다.

#### 2.2.3 측정 단위

- 밀리초(ms)
- P50/P95/P99/Max 4가지 백분위수로 보고

#### 2.2.4 평가 등급

| 등급 | P95 기준 | 판정 |
|------|----------|------|
| A (우수) | < 1초 | 실시간 알림에 적합 |
| B (양호) | < 5초 | 일반 알림에 적합 |
| C (보통) | < 30초 | 비실시간 알림에 제한적 적합 |
| D (미흡) | < 5분 | 사용자 경험 저하 |
| F (불량) | ≥ 5분 | 사용 부적합 |

#### 2.2.5 코드 레벨 측정 구현

```typescript
// src/metrics/calculate-m2.ts
interface LatencyStats {
  apiLatency: { p50: number; p95: number; p99: number; max: number };
  e2eLatency: { p50: number; p95: number; p99: number; max: number };
  sampleCount: number;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function calculateM2(testCase: string): Promise<LatencyStats> {
  const sendLogs = await db.collection('send_logs')
    .where('testCase', '==', testCase)
    .where('fcmResponseCode', '==', 200)
    .get();

  const ackLogs = await db.collection('ack_logs').get();
  const ackMap = new Map(ackLogs.docs.map(d => [d.id, d.data()]));

  const apiLatencies: number[] = [];
  const e2eLatencies: number[] = [];

  sendLogs.docs.forEach(doc => {
    const send = doc.data();

    // API 지연: FCM 수락 시각 - 서버 전송 시각
    if (send.fcmAcceptedAt) {
      apiLatencies.push(send.fcmAcceptedAt - send.sentAt);
    }

    // E2E 지연: 디바이스 수신 시각 - 서버 전송 시각
    const ack = ackMap.get(doc.id);
    if (ack) {
      e2eLatencies.push(ack.receivedAt - send.sentAt);
    }
  });

  return {
    apiLatency: {
      p50: percentile(apiLatencies, 50),
      p95: percentile(apiLatencies, 95),
      p99: percentile(apiLatencies, 99),
      max: Math.max(...apiLatencies),
    },
    e2eLatency: {
      p50: percentile(e2eLatencies, 50),
      p95: percentile(e2eLatencies, 95),
      p99: percentile(e2eLatencies, 99),
      max: Math.max(...e2eLatencies),
    },
    sampleCount: e2eLatencies.length,
  };
}
```

**이상치 분석 함수:**

```typescript
// src/metrics/latency-outlier-analysis.ts
interface OutlierReport {
  totalOutliers: number;
  causes: Record<string, number>;
}

async function analyzeLatencyOutliers(
  testCase: string,
  thresholdMs: number  // P99 값을 기준으로 설정
): Promise<OutlierReport> {
  const sendLogs = await db.collection('send_logs')
    .where('testCase', '==', testCase).get();
  const ackMap = await getAckMap();

  const causes: Record<string, number> = {
    'doze_mode': 0,
    'oem_battery_optimization': 0,
    'network_delay': 0,
    'unknown': 0,
  };

  sendLogs.docs.forEach(doc => {
    const send = doc.data();
    const ack = ackMap.get(doc.id);
    if (!ack) return;

    const latency = ack.receivedAt - send.sentAt;
    if (latency <= thresholdMs) return;

    // 앱 상태와 디바이스 모델을 기반으로 원인 분류
    if (send.appState === 'background' && latency > 60000) {
      causes['doze_mode']++;
    } else if (['samsung', 'xiaomi', 'oppo'].includes(send.oem?.toLowerCase())) {
      causes['oem_battery_optimization']++;
    } else {
      causes['unknown']++;
    }
  });

  return {
    totalOutliers: Object.values(causes).reduce((a, b) => a + b, 0),
    causes,
  };
}
```

---

### 2.3 M3. 메시지 손실률 (Message Loss Rate)

#### 2.3.1 정의

메시지 손실률은 FCM Backend가 수락(HTTP 200)하였으나 디바이스에 최종적으로 도달하지 못한 메시지의 비율이다. 이 지표는 종합 QoS 등급 산출 시 20%의 가중치를 갖는다.

M1의 서버 수락률(a)과 디바이스 수신률(b)의 차이를 직접 정량화하는 지표이다. FCM이 공식적으로 어떠한 전달 시맨틱도 보장하지 않는 "best-effort delivery" 방식이라는 근본적 한계를 반영한다 [^3].

#### 2.3.2 계산 방법

```
메시지 손실률(%) = (FCM 수락 수 - 디바이스 수신 수) / FCM 수락 수 × 100
```

손실 원인은 FCM Data API의 7가지 상태 카테고리를 활용하여 분류한다 [^6]:

| 손실 원인 | FCM Data API 상태 | 설명 |
|----------|-------------------|------|
| TTL 만료 | TTL Expired | 지정된 생존 시간 내 전달 불가 |
| 비활성 디바이스 | Inactive Device | 28일 이상 오프라인 |
| 대기 한도 초과 | Too Many Pending | Non-collapsible 100건 한도 초과 |
| 메시지 대체 | Collapsed | 동일 collapse key의 신규 메시지에 의해 대체 |
| 강제 종료 앱 | Force-Stopped App | Android에서 Data 메시지 드롭 |
| 미분류 | - | OEM 배터리 최적화, iOS 스로틀링 등 |

#### 2.3.3 측정 단위

- 백분율(%)
- 소수점 첫째 자리까지 표기

#### 2.3.4 평가 등급

| 등급 | 기준 | 판정 |
|------|------|------|
| A (우수) | < 0.5% | 높은 신뢰성 |
| B (양호) | < 2% | 수용 가능 |
| C (보통) | < 5% | 보완 필요 |
| D (미흡) | < 10% | 심각한 보완 필요 |
| F (불량) | ≥ 10% | 대안 채널 검토 필요 |

#### 2.3.5 코드 레벨 측정 구현

```typescript
// src/metrics/calculate-m3.ts
interface LossAnalysis {
  lossRate: number;
  totalAccepted: number;
  totalReceived: number;
  totalLost: number;
  lostMessageIds: string[];
  lossCauses: Record<string, number>;
}

async function calculateM3(
  testCase: string,
  ackWaitHours: number = 24  // ACK 대기 시간 (기본 24시간)
): Promise<LossAnalysis> {
  const cutoffTime = Date.now() - (ackWaitHours * 3600 * 1000);

  // A 집합: FCM이 수락한 메시지 ID
  const sendLogs = await db.collection('send_logs')
    .where('testCase', '==', testCase)
    .where('fcmResponseCode', '==', 200)
    .where('sentAt', '<', cutoffTime)
    .get();

  const acceptedIds = new Set(sendLogs.docs.map(d => d.id));

  // B 집합: 디바이스가 ACK한 메시지 ID
  const ackLogs = await db.collection('ack_logs').get();
  const receivedIds = new Set(ackLogs.docs.map(d => d.id));

  // 손실 집합: A - B
  const lostIds = [...acceptedIds].filter(id => !receivedIds.has(id));

  // 손실 원인 분류 (FCM Data API 조회 시뮬레이션)
  const lossCauses: Record<string, number> = {
    'TTL_EXPIRED': 0,
    'INACTIVE_DEVICE': 0,
    'TOO_MANY_PENDING': 0,
    'COLLAPSED': 0,
    'FORCE_STOPPED': 0,
    'UNCLASSIFIED': 0,
  };

  for (const lostId of lostIds) {
    const sendDoc = sendLogs.docs.find(d => d.id === lostId);
    if (!sendDoc) continue;
    const data = sendDoc.data();

    // 손실 원인 휴리스틱 분류
    if (data.appState === 'killed' && data.messageType === 'data') {
      lossCauses['FORCE_STOPPED']++;
    } else if (data.collapseKey) {
      lossCauses['COLLAPSED']++;
    } else {
      lossCauses['UNCLASSIFIED']++;
    }
  }

  return {
    lossRate: acceptedIds.size > 0
      ? (lostIds.length / acceptedIds.size) * 100
      : 0,
    totalAccepted: acceptedIds.size,
    totalReceived: [...acceptedIds].filter(id => receivedIds.has(id)).length,
    totalLost: lostIds.length,
    lostMessageIds: lostIds,
    lossCauses,
  };
}
```

---

### 2.4 M4. 중복 수신률 (Duplicate Rate)

#### 2.4.1 정의

중복 수신률은 디바이스에서 동일한 메시지가 2회 이상 수신된 비율이다. 이 지표는 종합 QoS 등급 산출 시 10%의 가중치를 갖는다.

FCM은 공식적으로 중복 제거(deduplication)를 보장하지 않는다. MQTT QoS 비교에서 FCM은 QoS 0(중복 제거 없음) 수준으로 평가되며, 네트워크 재연결이나 FCM 내부 재시도 과정에서 중복 전달이 발생할 수 있다 [^7].

#### 2.4.2 계산 방법

```
중복 수신률(%) = (총 수신 횟수 - 고유 메시지 수) / 고유 메시지 수 × 100
```

예시:
- 고유 메시지 100건 전송
- 디바이스에서 총 103회 수신 (3건이 2회씩 수신됨)
- 중복 수신률 = (103 - 100) / 100 × 100 = 3%

#### 2.4.3 측정 단위

- 백분율(%)
- 소수점 첫째 자리까지 표기

#### 2.4.4 평가 등급

| 등급 | 기준 | 판정 |
|------|------|------|
| A (우수) | 0% | 중복 없음 |
| B (양호) | < 1% | 수용 가능 |
| C (보통) | < 5% | 클라이언트 측 중복 제거 권장 |
| F (불량) | ≥ 5% | 중복 제거 필수 |

#### 2.4.5 코드 레벨 측정 구현

**클라이언트 측 (Android - Kotlin):**

```kotlin
// Android 테스트 앱 — 수신 로그 기록 및 중복 감지
class TestFirebaseMessagingService : FirebaseMessagingService() {

    private val receivedIds = mutableSetOf<String>()

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val messageId = remoteMessage.data["_mid"] ?: return
        val receivedAt = System.currentTimeMillis()
        val isDuplicate = !receivedIds.add(messageId)

        // ACK 서버로 전송 (중복 여부 포함)
        sendAck(AckPayload(
            messageId = messageId,
            receivedAt = receivedAt,
            isDuplicate = isDuplicate,
            duplicateCount = if (isDuplicate) countOccurrences(messageId) else 1,
            appState = getAppState(),
            deviceModel = Build.MODEL,
            platform = "android"
        ))
    }
}
```

**서버 측 (지표 계산):**

```typescript
// src/metrics/calculate-m4.ts
interface DuplicateAnalysis {
  duplicateRate: number;
  uniqueMessages: number;
  totalReceived: number;
  duplicatedMessages: Array<{ messageId: string; count: number }>;
  duplicateContexts: Record<string, number>;
}

async function calculateM4(testCase: string): Promise<DuplicateAnalysis> {
  const ackLogs = await db.collection('ack_logs')
    .where('testCase', '==', testCase)
    .get();

  // 메시지 ID별 수신 횟수 집계
  const receiveCount = new Map<string, number>();
  const receiveContexts = new Map<string, string[]>();

  ackLogs.docs.forEach(doc => {
    const data = doc.data();
    const mid = data.messageId;
    receiveCount.set(mid, (receiveCount.get(mid) || 0) + 1);
  });

  const uniqueMessages = receiveCount.size;
  const totalReceived = [...receiveCount.values()].reduce((a, b) => a + b, 0);

  const duplicatedMessages = [...receiveCount.entries()]
    .filter(([_, count]) => count > 1)
    .map(([messageId, count]) => ({ messageId, count }));

  return {
    duplicateRate: uniqueMessages > 0
      ? ((totalReceived - uniqueMessages) / uniqueMessages) * 100
      : 0,
    uniqueMessages,
    totalReceived,
    duplicatedMessages,
    duplicateContexts: {},  // 추후 컨텍스트 분석 확장
  };
}
```

---

## 3. 보조 지표 (Secondary Metrics)

### 3.1 M5. 복구 시간 (Mean Time To Recovery, MTTR)

#### 3.1.1 정의

복구 시간은 시스템이 불안정 상태에 진입한 시점부터 정상적인 전달이 재개되는 시점까지의 경과 시간이다. 이 지표는 종합 QoS 등급 산출 시 5%의 가중치를 갖는다.

복구 시점의 판정 기준은 **연속 3회 성공 전송**으로 정의한다. 이는 일시적인 성공(sporadic success)과 진정한 복구를 구분하기 위함이다.

#### 3.1.2 계산 방법

```
MTTR = T_recovery - T_fault

  T_fault    = 최초 실패 응답 수신 시각
  T_recovery = 연속 3회 성공 전송 중 첫 번째 전송 시각
```

#### 3.1.3 측정 단위

- 초(s) 또는 분(min)
- 10초 미만은 초 단위, 이상은 분 단위로 표기

#### 3.1.4 평가 등급

| 등급 | 기준 | 판정 |
|------|------|------|
| A (우수) | < 10초 | 일시적 에러, 자동 복구 |
| B (양호) | < 1분 | 빠른 복구 |
| C (보통) | < 5분 | 수동 개입 불필요 |
| D (미흡) | < 30분 | 수동 개입 필요 가능 |
| F (불량) | ≥ 30분 | 심각한 장애 |

#### 3.1.5 적용 케이스

모든 불안정 케이스에 적용 가능하나, 특히 다음 케이스에서 핵심적이다:

- UNSTABLE-03: Rate Limit 초과 후 복구
- UNSTABLE-04: OAuth2 인증 만료 후 갱신
- UNSTABLE-07: FCM 서버 일시 장애 후 복구
- UNSTABLE-14: 네트워크 단절 후 복구

#### 3.1.6 코드 레벨 측정 구현

```typescript
// src/metrics/calculate-m5.ts
interface RecoveryAnalysis {
  mttr: number | null;       // 밀리초, 복구 불가 시 null
  faultTime: number;
  recoveryTime: number | null;
  recoveryPattern: 'immediate' | 'gradual' | 'prolonged' | 'unrecovered';
  consecutiveSuccessRequired: number;
}

async function calculateM5(
  testCase: string,
  consecutiveSuccessThreshold: number = 3,
  maxWaitMs: number = 30 * 60 * 1000  // 30분
): Promise<RecoveryAnalysis> {
  const sendLogs = await db.collection('send_logs')
    .where('testCase', '==', testCase)
    .orderBy('sentAt', 'asc')
    .get();

  let faultTime: number | null = null;
  let recoveryTime: number | null = null;
  let consecutiveSuccess = 0;
  let inFaultState = false;

  for (const doc of sendLogs.docs) {
    const data = doc.data();
    const isSuccess = data.fcmResponseCode === 200;

    if (!inFaultState && !isSuccess) {
      // 장애 진입
      faultTime = data.sentAt;
      inFaultState = true;
      consecutiveSuccess = 0;
    } else if (inFaultState && isSuccess) {
      consecutiveSuccess++;
      if (consecutiveSuccess >= consecutiveSuccessThreshold) {
        // 복구 판정: 연속 N회 성공의 첫 번째 시각
        recoveryTime = data.sentAt - (consecutiveSuccessThreshold - 1) * 1000;
        break;
      }
    } else if (inFaultState && !isSuccess) {
      consecutiveSuccess = 0;
    }
  }

  const mttr = (faultTime && recoveryTime)
    ? recoveryTime - faultTime
    : null;

  let recoveryPattern: RecoveryAnalysis['recoveryPattern'];
  if (mttr === null) recoveryPattern = 'unrecovered';
  else if (mttr < 10000) recoveryPattern = 'immediate';
  else if (mttr < 300000) recoveryPattern = 'gradual';
  else recoveryPattern = 'prolonged';

  return {
    mttr,
    faultTime: faultTime || 0,
    recoveryTime,
    recoveryPattern,
    consecutiveSuccessRequired: consecutiveSuccessThreshold,
  };
}
```

---

### 3.2 M6. Dead Letter 비율 (DLQ Rate)

#### 3.2.1 정의

Dead Letter 비율은 재시도 정책에 정의된 최대 재시도 횟수를 모두 소진한 후에도 전달에 실패하여 Dead Letter Queue(DLQ)에 적재된 메시지의 비율이다. 이 지표는 QoS Level 1 이상에서만 의미를 가진다.

#### 3.2.2 계산 방법

```
DLQ 비율(%) = (DLQ 적재 메시지 수 / 전체 전송 시도 수) × 100
```

재시도 정책은 다음과 같이 정의된다:
- 최대 재시도 횟수: 5회
- 재시도 간격: exponential backoff (1s, 2s, 4s, 8s, 16s)
- 총 최대 대기 시간: 31초

#### 3.2.3 측정 단위 및 평가 등급

| 등급 | 기준 | 판정 |
|------|------|------|
| A (우수) | < 0.1% | 재시도 정책이 매우 효과적 |
| B (양호) | < 1% | 재시도 정책이 효과적 |
| C (보통) | < 5% | 재시도 정책 조정 필요 |
| F (불량) | ≥ 5% | 근본적 문제 존재 |

#### 3.2.4 코드 레벨 측정 구현

```typescript
// src/metrics/calculate-m6.ts
async function calculateM6(testCase: string): Promise<{
  dlqRate: number;
  totalAttempted: number;
  dlqCount: number;
  dlqMessages: Array<{ messageId: string; attempts: number; lastError: string }>;
}> {
  const sendLogs = await db.collection('send_logs')
    .where('testCase', '==', testCase)
    .get();

  // 메시지별 최대 시도 횟수 집계
  const messageAttempts = new Map<string, { attempts: number; lastError: string }>();

  sendLogs.docs.forEach(doc => {
    const data = doc.data();
    const existing = messageAttempts.get(data.messageId);
    if (!existing || data.attemptNumber > existing.attempts) {
      messageAttempts.set(data.messageId, {
        attempts: data.attemptNumber,
        lastError: data.errorCode || 'none',
      });
    }
  });

  const MAX_RETRIES = 5;
  const dlqMessages = [...messageAttempts.entries()]
    .filter(([_, info]) => info.attempts >= MAX_RETRIES && info.lastError !== 'none')
    .map(([messageId, info]) => ({
      messageId,
      attempts: info.attempts,
      lastError: info.lastError,
    }));

  return {
    dlqRate: messageAttempts.size > 0
      ? (dlqMessages.length / messageAttempts.size) * 100
      : 0,
    totalAttempted: messageAttempts.size,
    dlqCount: dlqMessages.length,
    dlqMessages,
  };
}
```

---

### 3.3 M7. 재시도 횟수 (Retry Count)

#### 3.3.1 정의

재시도 횟수는 QoS 메커니즘에 의해 재전송이 발생한 메시지의 평균 재시도 횟수이다. 이 지표는 QoS 보장 메커니즘의 효율성을 평가하는 데 사용된다. 재시도가 많을수록 서버 리소스 소비가 증가하고 FCM Rate Limit에 도달할 위험이 높아진다.

#### 3.3.2 계산 방법

```
평균 재시도 횟수 = 총 재시도 횟수 / 재시도가 발생한 메시지 수

재시도 성공률(%) = 재시도 후 성공 수 / 재시도 발생 메시지 수 × 100
```

참고: 개발자 사례에서 재시도 성공률 97%가 보고된 바 있다 [^8].

#### 3.3.3 측정 단위

- 평균 재시도 횟수: 소수점 둘째 자리까지 표기 (예: 1.73회)
- 재시도 성공률: 백분율(%)

#### 3.3.4 코드 레벨 측정 구현

```typescript
// src/metrics/calculate-m7.ts
interface RetryAnalysis {
  avgRetryCount: number;
  medianRetryCount: number;
  maxRetryCount: number;
  retrySuccessRate: number;
  distribution: Record<number, number>;  // 시도 횟수별 메시지 수
}

async function calculateM7(testCase: string): Promise<RetryAnalysis> {
  const sendLogs = await db.collection('send_logs')
    .where('testCase', '==', testCase)
    .get();

  // 메시지별 시도 횟수 집계
  const messageMaxAttempt = new Map<string, number>();
  const messageSuccess = new Map<string, boolean>();

  sendLogs.docs.forEach(doc => {
    const data = doc.data();
    const current = messageMaxAttempt.get(data.messageId) || 0;
    if (data.attemptNumber > current) {
      messageMaxAttempt.set(data.messageId, data.attemptNumber);
    }
    if (data.fcmResponseCode === 200) {
      messageSuccess.set(data.messageId, true);
    }
  });

  // 재시도가 발생한 메시지만 필터링 (시도 횟수 > 1)
  const retriedMessages = [...messageMaxAttempt.entries()]
    .filter(([_, attempts]) => attempts > 1);

  const retryCounts = retriedMessages.map(([_, attempts]) => attempts - 1);

  // 분포 히스토그램
  const distribution: Record<number, number> = {};
  retriedMessages.forEach(([_, attempts]) => {
    distribution[attempts] = (distribution[attempts] || 0) + 1;
  });

  // 재시도 후 성공한 메시지 수
  const retrySuccessCount = retriedMessages
    .filter(([id, _]) => messageSuccess.get(id) === true).length;

  return {
    avgRetryCount: retryCounts.length > 0
      ? retryCounts.reduce((a, b) => a + b, 0) / retryCounts.length
      : 0,
    medianRetryCount: retryCounts.length > 0
      ? percentile(retryCounts, 50)
      : 0,
    maxRetryCount: retryCounts.length > 0
      ? Math.max(...retryCounts)
      : 0,
    retrySuccessRate: retriedMessages.length > 0
      ? (retrySuccessCount / retriedMessages.length) * 100
      : 0,
    distribution,
  };
}
```

---

### 3.4 M8. 처리량 (Throughput)

#### 3.4.1 정의

처리량은 단위 시간당 성공적으로 전달된 메시지의 수이다. 이 지표는 시스템의 최대 처리 능력을 측정하며, FCM의 프로젝트당 할당량(600,000건/분 = 10,000건/초)과의 관계를 파악하는 데 사용된다 [^9].

#### 3.4.2 계산 방법

```
순간 처리량(msg/sec) = 1초간 성공 전달 수

유효 최대 처리량 = M1(전송 성공률) ≥ 95%를 유지하는 최대 전송 속도
```

측정 방법은 점진적 부하 증가(ramp-up) 테스트를 사용한다:

| 단계 | 전송 속도 | 지속 시간 |
|------|----------|----------|
| 1 | 100 msg/sec | 30초 |
| 2 | 500 msg/sec | 30초 |
| 3 | 1,000 msg/sec | 30초 |
| 4 | 5,000 msg/sec | 30초 |
| 5 | 10,000 msg/sec | 30초 |

#### 3.4.3 측정 단위

- msg/sec (초당 메시지 수)
- 초당, 분당, 시간당 세 가지 단위로 보고

#### 3.4.4 코드 레벨 측정 구현

```typescript
// src/metrics/calculate-m8.ts
interface ThroughputAnalysis {
  rampUpResults: Array<{
    targetRate: number;       // 목표 전송 속도 (msg/sec)
    actualRate: number;       // 실측 전송 속도 (msg/sec)
    successRate: number;      // 해당 단계 전송 성공률 (%)
    avgLatencyMs: number;     // 해당 단계 평균 API 지연
    throttledCount: number;   // 429 응답 수
  }>;
  effectiveMaxThroughput: number;  // 성공률 95% 유지 가능 최대 속도
}

async function calculateM8(testCase: string): Promise<ThroughputAnalysis> {
  const sendLogs = await db.collection('send_logs')
    .where('testCase', '==', testCase)
    .orderBy('sentAt', 'asc')
    .get();

  // 1초 단위 윈도우로 그룹화
  const windows = new Map<number, { total: number; success: number; latencies: number[]; throttled: number }>();

  sendLogs.docs.forEach(doc => {
    const data = doc.data();
    const windowKey = Math.floor(data.sentAt / 1000);

    if (!windows.has(windowKey)) {
      windows.set(windowKey, { total: 0, success: 0, latencies: [], throttled: 0 });
    }

    const window = windows.get(windowKey)!;
    window.total++;
    if (data.fcmResponseCode === 200) {
      window.success++;
      if (data.fcmAcceptedAt) {
        window.latencies.push(data.fcmAcceptedAt - data.sentAt);
      }
    }
    if (data.fcmResponseCode === 429) {
      window.throttled++;
    }
  });

  // ramp-up 단계별 분석
  const rampUpResults: ThroughputAnalysis['rampUpResults'] = [];
  const sortedWindows = [...windows.entries()].sort(([a], [b]) => a - b);

  // 30초 단위로 단계 분할
  const stageSize = 30;
  for (let i = 0; i < sortedWindows.length; i += stageSize) {
    const stage = sortedWindows.slice(i, i + stageSize);
    const totalInStage = stage.reduce((sum, [_, w]) => sum + w.total, 0);
    const successInStage = stage.reduce((sum, [_, w]) => sum + w.success, 0);
    const throttledInStage = stage.reduce((sum, [_, w]) => sum + w.throttled, 0);
    const allLatencies = stage.flatMap(([_, w]) => w.latencies);

    rampUpResults.push({
      targetRate: Math.round(totalInStage / stage.length),
      actualRate: Math.round(successInStage / stage.length),
      successRate: totalInStage > 0 ? (successInStage / totalInStage) * 100 : 0,
      avgLatencyMs: allLatencies.length > 0
        ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
        : 0,
      throttledCount: throttledInStage,
    });
  }

  // 성공률 95% 이상인 최대 처리량 단계 찾기
  const effectiveStages = rampUpResults.filter(r => r.successRate >= 95);
  const effectiveMaxThroughput = effectiveStages.length > 0
    ? Math.max(...effectiveStages.map(r => r.actualRate))
    : 0;

  return {
    rampUpResults,
    effectiveMaxThroughput,
  };
}
```

---

## 4. 종합 QoS 등급 산출

### 4.1 가중 평균 계산

5개 핵심 지표의 가중 평균으로 종합 QoS 점수를 산출한다:

| 지표 | 가중치 | 근거 |
|------|--------|------|
| M1. 전송 성공률 | 40% | 푸시 알림의 가장 근본적인 품질 지표이다 |
| M2. 전송 지연시간 | 25% | 실시간성이 중요한 푸시 알림의 특성을 반영한다 |
| M3. 메시지 손실률 | 20% | FCM의 best-effort 특성에서 핵심적 관심사이다 |
| M4. 중복 수신률 | 10% | 사용자 경험에 영향을 미친다 |
| M5. 복구 시간 | 5% | 장애 대응 능력을 반영한다 |

```
종합 QoS 점수 = (M1_score × 0.40) + (M2_score × 0.25) + (M3_score × 0.20)
              + (M4_score × 0.10) + (M5_score × 0.05)

점수 매핑: A=5, B=4, C=3, D=2, F=1
```

### 4.2 종합 등급 판정

| 점수 | 등급 | 의미 |
|------|------|------|
| ≥ 4.5 | Grade A | 프로덕션 적합 |
| ≥ 3.5 | Grade B | 조건부 적합 |
| ≥ 2.5 | Grade C | 개선 필요 |
| ≥ 1.5 | Grade D | 심각한 개선 필요 |
| < 1.5 | Grade F | 사용 부적합 |

### 4.3 종합 점수 계산 코드

```typescript
// src/metrics/calculate-overall-qos.ts
type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

const GRADE_SCORE: Record<Grade, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };

const WEIGHTS = {
  m1: 0.40,
  m2: 0.25,
  m3: 0.20,
  m4: 0.10,
  m5: 0.05,
};

function gradeM1(rate: number): Grade {
  if (rate >= 99) return 'A';
  if (rate >= 95) return 'B';
  if (rate >= 90) return 'C';
  if (rate >= 80) return 'D';
  return 'F';
}

function gradeM2(p95Ms: number): Grade {
  if (p95Ms < 1000) return 'A';
  if (p95Ms < 5000) return 'B';
  if (p95Ms < 30000) return 'C';
  if (p95Ms < 300000) return 'D';
  return 'F';
}

function gradeM3(lossRate: number): Grade {
  if (lossRate < 0.5) return 'A';
  if (lossRate < 2) return 'B';
  if (lossRate < 5) return 'C';
  if (lossRate < 10) return 'D';
  return 'F';
}

function gradeM4(dupRate: number): Grade {
  if (dupRate === 0) return 'A';
  if (dupRate < 1) return 'B';
  if (dupRate < 5) return 'C';
  return 'F';
}

function gradeM5(mttrMs: number | null): Grade {
  if (mttrMs === null) return 'F';
  if (mttrMs < 10000) return 'A';
  if (mttrMs < 60000) return 'B';
  if (mttrMs < 300000) return 'C';
  if (mttrMs < 1800000) return 'D';
  return 'F';
}

interface OverallQoS {
  grades: { m1: Grade; m2: Grade; m3: Grade; m4: Grade; m5: Grade };
  scores: { m1: number; m2: number; m3: number; m4: number; m5: number };
  weightedScore: number;
  overallGrade: Grade;
}

function calculateOverallQoS(
  m1Rate: number,
  m2P95Ms: number,
  m3LossRate: number,
  m4DupRate: number,
  m5MttrMs: number | null
): OverallQoS {
  const grades = {
    m1: gradeM1(m1Rate),
    m2: gradeM2(m2P95Ms),
    m3: gradeM3(m3LossRate),
    m4: gradeM4(m4DupRate),
    m5: gradeM5(m5MttrMs),
  };

  const scores = {
    m1: GRADE_SCORE[grades.m1],
    m2: GRADE_SCORE[grades.m2],
    m3: GRADE_SCORE[grades.m3],
    m4: GRADE_SCORE[grades.m4],
    m5: GRADE_SCORE[grades.m5],
  };

  const weightedScore =
    scores.m1 * WEIGHTS.m1 +
    scores.m2 * WEIGHTS.m2 +
    scores.m3 * WEIGHTS.m3 +
    scores.m4 * WEIGHTS.m4 +
    scores.m5 * WEIGHTS.m5;

  let overallGrade: Grade;
  if (weightedScore >= 4.5) overallGrade = 'A';
  else if (weightedScore >= 3.5) overallGrade = 'B';
  else if (weightedScore >= 2.5) overallGrade = 'C';
  else if (weightedScore >= 1.5) overallGrade = 'D';
  else overallGrade = 'F';

  return { grades, scores, weightedScore, overallGrade };
}
```

---

## 5. 측정 데이터 스키마

모든 지표 계산의 기반이 되는 원시 데이터 스키마는 다음과 같이 정의된다:

```json
{
  "message_id": "UUID v4 — 추적용 고유 식별자",
  "test_case": "STABLE-01 | UNSTABLE-08 등",
  "platform": "android | ios",
  "device_model": "Pixel 7 | iPhone 14 등",
  "oem": "Google | Samsung | Xiaomi 등",
  "sent_at": "서버 전송 시각 (Unix timestamp, ms)",
  "fcm_accepted_at": "FCM 수락 시각 (Unix timestamp, ms) | null",
  "fcm_response_code": "200 | 400 | 404 | 429 | 500 | 503",
  "fcm_message_id": "FCM 반환 메시지 ID | null",
  "device_received_at": "디바이스 수신 시각 (Unix timestamp, ms) | null",
  "device_ack_at": "ACK 서버 수신 시각 (Unix timestamp, ms) | null",
  "attempt_number": "시도 횟수 (1~N)",
  "qos_level": "0 | 1 | 2",
  "message_type": "notification | data | combined",
  "priority": "high | normal",
  "app_state": "foreground | background | killed",
  "payload_size_bytes": 1024,
  "collapse_key": "string | null",
  "error_code": "UNREGISTERED | QUOTA_EXCEEDED | null 등"
}
```

---

## 참고 문헌

[^1]: W.G. Cochran, "Sampling Techniques," 3rd ed., Wiley, 1977 — 표본 크기 결정 및 비율 추정 공식

[^2]: Firebase, "FCM architectural overview," https://firebase.google.com/docs/cloud-messaging/fcm-architecture — FCM 전송 흐름에서 서버 수락과 디바이스 도달의 구분

[^3]: Firebase, "About FCM messages," https://firebase.google.com/docs/cloud-messaging/concept-options — FCM의 best-effort delivery 특성, 전달 보장 부재

[^4]: CleverTap, "Why Push Notifications Go Undelivered," https://clevertap.com/blog/why-push-notifications-go-undelivered-and-what-to-do-about-it/ — 산업 평균 전달률 14~48%

[^5]: Android Developers, "Optimize for Doze and App Standby," https://developer.android.com/training/monitoring-device-state/doze-standby — Doze 모드가 메시지 지연에 미치는 영향

[^6]: Firebase, "Understanding message delivery," https://firebase.google.com/docs/cloud-messaging/understand-delivery — FCM Data API 7가지 상태 카테고리

[^7]: HiveMQ, "MQTT QoS Essentials," https://www.hivemq.com/blog/mqtt-essentials-part-6-mqtt-quality-of-service-levels/ — MQTT QoS 레벨과 FCM 비교, 중복 제거 미보장

[^8]: S. Rhie, "Beyond Token Validation: Measuring Real Device Delivery Rates with Firebase FCM," DEV Community, 2024 — 재시도 성공률 97%

[^9]: Firebase, "Throttling and Quotas," https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas — 프로젝트당 600,000건/분 할당량

[^10]: J. Cohen, "Statistical Power Analysis for the Behavioral Sciences," 2nd ed., 1988 — 효과 크기(Cohen's h) 기준

[^11]: G. Albertengo, F.G. Debele, W. Hassan, D. Stramandino, "On the Performance of Web Services, Google Cloud Messaging and Firebase Cloud Messaging," *Digital Communications and Networks*, Vol. 6, Issue 1, pp. 31-37, 2019. DOI: 10.1016/j.dcan.2019.02.002 — FCM 성능 벤치마크
