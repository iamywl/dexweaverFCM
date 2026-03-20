# FCM 알림 신뢰성 확보 방안

> 작성일: 2026-03-19
> 목적: FCM의 best-effort delivery 특성으로 인한 알림 유실 문제를 분석하고, QoS Level별 신뢰성 확보 메커니즘의 구현 방법을 코드 수준에서 상세히 기술한다.

---

## 0. 배경: FCM의 구조적 한계와 본 프로젝트의 접근

### 0.1 전달 시맨틱(Delivery Semantics)이란?

메시징 시스템에서 **전달 시맨틱**이란 "메시지가 수신자에게 몇 번 도착하는지"에 대한 보장 수준을 의미한다. 업계 표준으로 세 가지 수준이 정의되어 있다:

| 시맨틱 | 의미 | 설명 | 예시 |
|--------|------|------|------|
| **at-most-once** | 최대 1번 | 메시지가 0번 또는 1번 도착한다. 유실 가능하지만 중복은 없다. | UDP 전송 |
| **at-least-once** | 최소 1번 | 메시지가 반드시 1번 이상 도착한다. 중복 가능하지만 유실은 없다. | MQTT QoS 1 |
| **exactly-once** | 정확히 1번 | 유실도 없고 중복도 없다. 구현이 가장 어렵다. | MQTT QoS 2, Kafka exactly-once |

일반적인 메시징 시스템(Kafka, RabbitMQ, MQTT 등)은 위 시맨틱 중 하나 이상을 명시적으로 보장한다. 그러나 **FCM은 이 세 가지 중 어떤 것도 공식적으로 보장하지 않는다.** 이것이 본 프로젝트의 출발점이다.

### 0.2 FCM이 전달을 보장하지 않는 이유

FCM의 메시지 전달 경로는 다음과 같다:

```
[앱 서버] → [Google FCM 서버] → [통신망] → [디바이스 OS] → [앱]
    ✅            ✅              ❌          ❌          ❌
  우리 영역     Google 영역      통신사       제조사       사용자
```

Google이 직접 통제할 수 있는 구간은 FCM 서버까지뿐이다. 그 이후의 전달 경로에서는 다양한 외부 요인에 의해 메시지가 유실될 수 있다:

- **통신망**: 디바이스가 오프라인 상태이면 물리적으로 전달할 수 없다.
- **디바이스 OS**: Android OEM 제조사의 배터리 최적화 정책(Samsung 적응형 배터리, Xiaomi 자동 시작 관리 등)이 백그라운드 앱의 네트워크 연결을 차단한다. iOS의 Doze 모드 역시 알림 수신을 지연시킨다.
- **사용자**: 알림 권한 거부, 앱 강제 종료, 앱 삭제 등의 사용자 행동은 FCM이 제어할 수 없다.

즉, Google 입장에서는 자사 서버 이후의 전달을 보장할 수 없으므로 **어떠한 전달 시맨틱도 약속하지 않는다.** FCM의 공식 입장은 "best-effort delivery"(최선의 노력)이다.

### 0.3 그럼에도 FCM을 사용하는 이유

FCM의 신뢰성이 부족함에도 대안이 사실상 없다. 모바일 환경에서 서버가 디바이스에 메시지를 보내는 방법을 비교하면:

| 방식 | 동작 원리 | 문제점 |
|------|-----------|--------|
| **직접 소켓 연결** (WebSocket 등) | 서버-디바이스 간 상시 연결 유지 | 앱이 백그라운드로 전환되면 OS가 연결을 끊는다. 배터리 소모가 심각하다. |
| **폴링** (Polling) | 디바이스가 주기적으로 서버에 새 메시지를 확인 | 실시간성이 없고, 불필요한 네트워크 요청으로 배터리와 데이터를 낭비한다. |
| **SMS** | 이동통신망을 통한 문자 전송 | 건당 비용이 발생하고, 데이터 전송량이 극히 제한적이다. |
| **플랫폼 푸시 (FCM/APNs)** | OS 레벨에서 하나의 연결을 전체 앱이 공유 | **best-effort이지만, 백그라운드에서도 동작하고 배터리 효율이 좋다.** |

FCM과 APNs 같은 플랫폼 푸시 서비스는 **운영체제 레벨에서 단일 연결을 모든 앱이 공유**하기 때문에 배터리 소모가 적고, 앱이 백그라운드 상태에서도 메시지 수신이 가능하다. 이것이 모바일 환경에서 서버-to-디바이스 통신의 사실상 유일한 현실적 방법인 이유이다.

### 0.4 본 프로젝트의 접근: FCM 위에 신뢰성 계층 구축

FCM의 한계를 인정하고, **그 위에 애플리케이션 수준의 신뢰성 메커니즘을 추가하는 것**이 본 프로젝트(DexWeaver)의 핵심 전략이다.

```
┌──────────────────────────────────────────────┐
│           애플리케이션 (알림 소비)              │
├──────────────────────────────────────────────┤
│    DexWeaver QoS 계층                         │
│    ┌────────────────────────────────────────┐│
│    │ L0: Fire & Forget (FCM 그대로)          ││
│    │ L1: ACK + 재전송 → at-least-once 확보   ││
│    │ L2: L1 + 중복 제거 → exactly-once 근접  ││
│    └────────────────────────────────────────┘│
├──────────────────────────────────────────────┤
│           FCM (best-effort delivery)          │
├──────────────────────────────────────────────┤
│           네트워크 / OS / 디바이스             │
└──────────────────────────────────────────────┘
```

이 계층 구조를 통해, 알림의 중요도에 따라 적절한 QoS 수준을 선택할 수 있다:

| QoS Level | 전달 보장 | 적합 용도 | 비용 |
|-----------|-----------|-----------|------|
| **L0** | 보장 없음 (FCM 기본) | 마케팅 알림, 뉴스 등 유실 허용 가능한 알림 | 최소 |
| **L1** | at-least-once (중복 가능) | 채팅 메시지, 일정 알림 등 반드시 도달해야 하는 알림 | 중간 |
| **L2** | exactly-once에 근접 | 결제 완료, 주문 확인 등 중복도 유실도 허용 불가한 알림 | 높음 |

이 보고서는 위 QoS 메커니즘의 상세 구현 방법을 기술한다.

---

## 1. 유실 원인 분석

위에서 설명한 것처럼 FCM은 공식적으로 어떠한 전달 시맨틱도 보장하지 않는다 [^1]. 이 절에서는 메시지가 유실되는 구체적인 원인을 계층별로 분류하고 분석한다. 유실 원인을 정확히 분류하는 것이 신뢰성 확보의 출발점이다.

### 1.1 유실 원인 계층 분류

```
┌─────────────────────────────────────────────────────────────────┐
│                    메시지 유실 원인 계층 모델                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: 서버 → FCM 구간                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ • 토큰 만료/무효 (UNREGISTERED, 404)                      │   │
│  │ • 페이로드 형식 오류 (INVALID_ARGUMENT, 400)               │   │
│  │ • 인증 만료 (THIRD_PARTY_AUTH_ERROR, 401)                 │   │
│  │ • Rate Limit 초과 (QUOTA_EXCEEDED, 429)                   │   │
│  │ • FCM 서버 장애 (INTERNAL, 500/503)                       │   │
│  │ • 네트워크 연결 실패 (서버 → FCM)                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Layer 2: FCM 내부 구간                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ • TTL 만료 (디바이스 오프라인 지속)                          │   │
│  │ • Non-collapsible 100건 한도 초과 (전체 삭제)               │   │
│  │ • Collapsible 메시지 대체 (의도적 손실)                     │   │
│  │ • 팬아웃 과부하 시 내부 큐 오버플로우                        │   │
│  │ • 미추적 손실 (FCM Data API에서 분류 불가)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Layer 3: FCM → 디바이스 구간                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ • Android Force-stopped (Data 메시지 드롭)                 │   │
│  │ • OEM 배터리 최적화 (Samsung/Xiaomi/Oppo)                  │   │
│  │ • Android Doze 모드 (NORMAL 우선순위 지연)                  │   │
│  │ • iOS Silent Push 스로틀링 (시간당 2~3건)                   │   │
│  │ • iOS 앱 스와이프 종료 + Silent Push                       │   │
│  │ • 디바이스 오프라인 / 네트워크 불안정                        │   │
│  │ • APNs 장애 (iOS)                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 유실 원인별 상세 분석

#### 1.2.1 토큰 만료 및 무효화

FCM 등록 토큰(Registration Token)이란, FCM이 특정 디바이스의 특정 앱을 식별하기 위해 발급하는 고유 문자열이다. 서버가 메시지를 보낼 때 "어떤 디바이스에 보낼 것인지"를 이 토큰으로 지정한다.

이 토큰은 **영구적이지 않다.** 앱이 재설치되거나, 사용자가 앱 데이터를 삭제하거나, 디바이스를 교체하면 기존 토큰은 무효화되고 새 토큰이 발급된다. 따라서 서버는 항상 최신 유효 토큰을 보유하고 있어야 하며, 무효화된 토큰으로의 전송은 유실로 이어진다.

다음 상황에서 토큰이 무효화된다 [^2]:

| 원인 | FCM 응답 | HTTP 코드 | 발생 빈도 |
|------|----------|----------|----------|
| 앱 재설치 | `UNREGISTERED` | 404 | 빈번 |
| 앱 데이터 삭제 | `UNREGISTERED` | 404 | 중간 |
| 새 디바이스에 복원 | `UNREGISTERED` | 404 | 낮음 |
| 270일 비활성 | `UNREGISTERED` | 404 | 높음 (관리 미흡 시) |
| 다른 프로젝트의 토큰 | `SENDER_ID_MISMATCH` | 403 | 설정 오류 |

**영향 규모**: 토큰 관리를 하지 않을 경우 전체 메시지의 약 15%가 비활성 디바이스로 드롭된다 [^2].

**감지 및 대응 코드:**

```typescript
// src/token/token-validator.ts
import { getMessaging, MessagingErrorCode } from 'firebase-admin/messaging';

const INVALID_TOKEN_ERRORS: string[] = [
  'messaging/registration-token-not-registered',  // UNREGISTERED
  'messaging/invalid-registration-token',          // INVALID_ARGUMENT
  'messaging/mismatched-credential',               // SENDER_ID_MISMATCH
];

async function sendWithTokenValidation(
  token: string,
  message: object
): Promise<{ success: boolean; shouldRemoveToken: boolean }> {
  try {
    await getMessaging().send({ token, ...message });
    return { success: true, shouldRemoveToken: false };
  } catch (error: any) {
    const errorCode = error.errorInfo?.code || '';

    if (INVALID_TOKEN_ERRORS.includes(errorCode)) {
      // 즉시 토큰 삭제 — 재시도 무의미
      await removeTokenFromDB(token);
      return { success: false, shouldRemoveToken: true };
    }

    return { success: false, shouldRemoveToken: false };
  }
}
```

**본 프로젝트에서의 토큰 관리 흐름:**

본 프로젝트에서는 다음과 같은 흐름으로 토큰을 관리한다:

1. **토큰 발급**: 디바이스 앱이 시작되면 `FirebaseMessaging.instance.getToken()`으로 FCM 토큰을 발급받는다.
2. **토큰 저장**: 발급된 토큰과 디바이스 메타정보(플랫폼, 모델명, OS 버전 등)를 Firestore `tokens` 컬렉션에 저장한다.
3. **토큰 갱신 감지**: `onTokenRefresh` 리스너가 토큰 변경을 실시간 감지하여, 새 토큰으로 Firestore를 자동 업데이트한다.
4. **토큰 유효성 검증**: 서버에서 메시지 전송 시 `UNREGISTERED` 응답을 받으면 해당 토큰을 `isValid: false`로 마킹하고, 이후 전송 대상에서 제외한다.

```
[디바이스 앱 시작]
    │
    ├── getToken() → FCM 토큰 발급
    │
    ├── Firestore "tokens" 컬렉션에 저장
    │     { fcmToken, platform, deviceModel, osVersion, isValid: true }
    │
    └── onTokenRefresh 리스너 등록
          │
          └── 토큰 변경 시 → Firestore 자동 업데이트
```

#### 1.2.2 Rate Limit 초과

FCM은 프로젝트 수준 및 디바이스 수준에서 전송 속도를 제한한다 [^3]:

| 범위 | 제한 | 초과 시 응답 |
|------|------|-------------|
| 프로젝트당 | 600,000건/분 (10,000건/초) | HTTP 429 + `QUOTA_EXCEEDED` |
| Android 단일 디바이스 | 240건/분, 5,000건/시간 | HTTP 429 |
| iOS 단일 디바이스 | APNs 제한 (비공개) | 조용한 드롭 |

Rate Limit 초과 시 메시지는 즉시 거부되며, `Retry-After` 헤더 또는 exponential backoff를 사용하여 재시도해야 한다.

#### 1.2.3 네트워크 장애

서버에서 FCM Backend까지의 네트워크 구간에서 발생하는 장애이다. HTTP 연결 자체가 실패하므로 FCM 응답을 받을 수 없다.

| 유형 | 증상 | 대응 |
|------|------|------|
| DNS 장애 | `ENOTFOUND` 에러 | DNS 캐싱, 다중 DNS 서버 |
| 연결 타임아웃 | `ETIMEOUT` 에러 | 타임아웃 설정, 재시도 |
| TLS 핸드셰이크 실패 | `EPROTO` 에러 | 인증서 확인, 프로토콜 버전 |
| 간헐적 패킷 손실 | 타임아웃 또는 부분 응답 | 재시도, 서킷 브레이커 |

#### 1.2.4 Non-Collapsible 100건 한도 초과

디바이스가 오프라인인 동안 Non-collapsible 메시지가 100건을 초과하면, FCM은 저장된 **모든 메시지를 삭제**한다 [^4]. 이는 단순히 초과분만 삭제하는 것이 아니라 전체를 삭제하므로 치명적이다.

```
시나리오: 디바이스 오프라인 중 101건 전송

  전송 1~100건: FCM 큐에 저장 (정상)
  전송 101건째: 전체 100건 + 101건째 모두 삭제
  디바이스 온라인 복귀: 수신 메시지 0건
  onDeletedMessages() 콜백: 호출됨 (Android)
```

#### 1.2.5 OEM 배터리 최적화

Android OEM 제조사의 자체 배터리 최적화 정책은 FCM 전달에 가장 심각한 영향을 미치는 요인 중 하나이다 [^5]:

| OEM | 정책 | FCM 영향 | 우회 방법 |
|-----|------|---------|----------|
| Samsung | 적응형 배터리 | Background 앱 종료, FCM 지연 | 배터리 최적화 미적용 목록 등록 |
| Xiaomi | 자동 시작 관리 | 자동 시작 차단 시 FCM 수신 불가 | 자동 시작 허용 설정 |
| Oppo/Vivo | 스마트 파워 세이버 | 2주 내 전달률 급감 | 배터리 최적화 예외 등록 |
| Huawei | 앱 시작 관리 | 백그라운드 실행 차단 | 수동 허용 설정 |

**핵심**: OEM 배터리 최적화는 서버 측 QoS 메커니즘(재시도 등)으로 해결할 수 없다. 디바이스 측 설정 변경이 필수적이다.

#### 1.2.6 iOS Silent Push 스로틀링

Apple은 `content-available` 기반 Background 업데이트의 빈도를 시스템 레벨에서 제한한다 [^6]:

| 조건 | 제한 | 비고 |
|------|------|------|
| 정상 상태 | 시간당 약 2~3건 | 비공식 관측치 |
| 저전력 모드 | 더 엄격한 스로틀링 | 구체적 수치 비공개 |
| 앱 스와이프 종료 | 콜백 미호출 | Silent push 전달 불가 |

---

### 1.3 유실 원인별 서버 측 QoS 개선 가능성

| 유실 원인 | 계층 | 서버 측 QoS 개선 가능 | 이유 |
|----------|------|-------------------|------|
| 토큰 무효 | L1 | **불가** | 토큰 자체가 유효하지 않으므로 재시도 무의미 |
| Rate Limit | L1 | **가능** | 지연 후 재시도로 다음 윈도우에서 전송 가능 |
| 인증 만료 | L1 | **가능** | 토큰 갱신 후 재시도로 복구 가능 |
| 서버 장애 (5xx) | L1 | **가능** | 일시적 장애이므로 재시도 효과적 |
| 네트워크 장애 | L1 | **가능** | 일시적 장애이므로 재시도 효과적 |
| TTL 만료 | L2 | **제한적** | TTL 연장으로 부분 개선 가능 |
| 100건 한도 | L2 | **제한적** | 전송 빈도 제어로 예방 가능 |
| OEM 배터리 최적화 | L3 | **불가** | 디바이스 측 설정 변경 필요 |
| Doze 모드 | L3 | **부분적** | HIGH 우선순위로 일부 바이패스 가능 |
| iOS 스로틀링 | L3 | **불가** | Apple 정책으로 서버 측 우회 불가 |

---

## 2. QoS Level별 구현 방법

### 2.1 QoS Level 체계 정의

FCM의 best-effort 특성을 보완하기 위해, MQTT QoS 모델을 참조하여 세 단계의 QoS Level을 정의한다 [^7]:

```
┌─────────────────────────────────────────────────────────────────┐
│                    QoS Level 비교                                │
├──────────┬──────────────────┬──────────────────────────────────┤
│ Level    │ 전달 시맨틱       │ 구현                              │
├──────────┼──────────────────┼──────────────────────────────────┤
│ L0       │ Best Effort      │ FCM 1회 전송, 결과 무시            │
│ (Fire &  │ (≈ MQTT QoS 0)   │                                  │
│  Forget) │                  │                                  │
├──────────┼──────────────────┼──────────────────────────────────┤
│ L1       │ At Least Once    │ ACK 미수신 시 재시도               │
│ (Retry)  │ (≈ MQTT QoS 1)   │ (최대 5회, exponential backoff)   │
│          │                  │ 중복 가능                         │
├──────────┼──────────────────┼──────────────────────────────────┤
│ L2       │ Exactly Once     │ L1 + 클라이언트 측 중복 제거        │
│ (Dedup)  │ (≈ MQTT QoS 2)   │ message_id 기반 idempotent 처리   │
└──────────┴──────────────────┴──────────────────────────────────┘
```

### 2.2 QoS Level 0 — Best Effort (Fire & Forget)

#### 개요

가장 단순한 방식으로, FCM API를 1회 호출하고 결과에 관계없이 완료로 처리한다. FCM 자체의 best-effort delivery에 의존하며, 추가적인 서버 측 보장 메커니즘이 없다.

#### 구현

```typescript
// src/qos/level0.ts
import { getMessaging } from 'firebase-admin/messaging';

interface QoSL0Result {
  messageId: string;
  fcmMessageId: string | null;
  success: boolean;
  error: string | null;
}

async function sendL0(
  token: string,
  payload: Record<string, string>,
  options: { priority?: 'high' | 'normal'; ttl?: number } = {}
): Promise<QoSL0Result> {
  const messageId = crypto.randomUUID();

  try {
    const fcmResponse = await getMessaging().send({
      token,
      data: {
        _mid: messageId,
        _qos: '0',
        _sent_at: String(Date.now()),
        ...payload,
      },
      android: {
        priority: options.priority || 'high',
        ttl: options.ttl || 86400000,
      },
      apns: {
        headers: {
          'apns-priority': options.priority === 'high' ? '10' : '5',
        },
      },
    });

    return {
      messageId,
      fcmMessageId: fcmResponse,
      success: true,
      error: null,
    };
  } catch (error: any) {
    return {
      messageId,
      fcmMessageId: null,
      success: false,
      error: error.errorInfo?.code || error.message,
    };
  }
}
```

#### 적합 용도

- 마케팅 프로모션 알림
- 뉴스 브로드캐스트
- 실시간 점수 업데이트 (최신 값만 의미 있는 경우)
- 전달률 저하가 비즈니스에 치명적이지 않은 알림

#### 장단점

| 장점 | 단점 |
|------|------|
| 구현이 단순하다 | 유실 감지 및 복구가 불가하다 |
| 서버 리소스 소비가 최소이다 | FCM 서버 수락만 확인 가능하다 |
| Rate Limit 소비가 최소이다 | 디바이스 도달 여부를 알 수 없다 |

---

### 2.3 QoS Level 1 — At Least Once (ACK 기반 재시도)

#### 개요

서버가 각 메시지에 대해 디바이스로부터 ACK(수신 확인)를 기다린다. 지정된 시간 내에 ACK가 수신되지 않으면 메시지를 재전송한다. 최대 재시도 횟수 소진 후에도 ACK가 없으면 Dead Letter Queue에 적재한다.

```
┌────────────┐                    ┌───────────┐                ┌──────────┐
│  App Server │                    │    FCM    │                │  Device  │
└──────┬─────┘                    └─────┬─────┘                └────┬─────┘
       │                                │                           │
       │  1. POST message (_mid=abc)    │                           │
       │ ──────────────────────────────>│                           │
       │                                │                           │
       │  2. HTTP 200 (fcm_msg_id)      │                           │
       │ <──────────────────────────────│                           │
       │                                │  3. 전달                   │
       │                                │ ────────────────────────> │
       │                                │                           │
       │  4. ACK (_mid=abc, received_at)                            │
       │ <──────────────────────────────────────────────────────────│
       │                                │                           │
       │  ✓ 전달 확인 완료               │                           │
       │                                │                           │
       │  [ACK 미수신 시]                │                           │
       │                                │                           │
       │  5. 재전송 (attempt=2)          │                           │
       │ ──────────────────────────────>│                           │
       │                                │                           │
```

#### 구현

**재시도 엔진:**

```typescript
// src/qos/level1.ts
import { getMessaging } from 'firebase-admin/messaging';
import { db } from '../config/database';

interface RetryConfig {
  maxRetries: number;           // 최대 재시도 횟수
  baseDelayMs: number;          // 기본 지연 (밀리초)
  maxDelayMs: number;           // 최대 지연 (밀리초)
  ackTimeoutMs: number;         // ACK 대기 시간 (밀리초)
  jitterFactor: number;         // 지터 비율 (0~1)
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,            // 1초
  maxDelayMs: 60000,            // 1분
  ackTimeoutMs: 30000,          // 30초 (첫 ACK 대기)
  jitterFactor: 0.2,            // ±20% 지터
};

// 재시도 불필요한 에러 (영구적 실패)
const NON_RETRYABLE_ERRORS = new Set([
  'messaging/registration-token-not-registered',  // 404
  'messaging/invalid-registration-token',          // 400
  'messaging/mismatched-credential',               // 403
  'messaging/invalid-argument',                    // 400
]);

function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig
): number {
  // Exponential backoff with jitter
  const exponentialDelay = Math.min(
    config.baseDelayMs * Math.pow(2, attempt - 1),
    config.maxDelayMs
  );
  const jitter = exponentialDelay * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exponentialDelay + jitter));
}

interface QoSL1Result {
  messageId: string;
  delivered: boolean;
  totalAttempts: number;
  finalError: string | null;
  ackReceivedAt: number | null;
  sentToDLQ: boolean;
}

async function sendL1(
  token: string,
  payload: Record<string, string>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<QoSL1Result> {
  const messageId = crypto.randomUUID();
  let attempt = 0;
  let lastError: string | null = null;

  while (attempt < config.maxRetries) {
    attempt++;

    try {
      // FCM 전송
      const fcmResponse = await getMessaging().send({
        token,
        data: {
          _mid: messageId,
          _qos: '1',
          _attempt: String(attempt),
          _sent_at: String(Date.now()),
          ...payload,
        },
        android: { priority: 'high' as const },
        apns: { headers: { 'apns-priority': '10' } },
      });

      // 전송 로그 기록
      await db.collection('send_logs').add({
        messageId,
        attemptNumber: attempt,
        fcmResponseCode: 200,
        fcmMessageId: fcmResponse,
        sentAt: Date.now(),
      });

      // ACK 대기
      const ackTimeout = attempt === 1
        ? config.ackTimeoutMs
        : config.ackTimeoutMs * 2;  // 재시도 시 대기 시간 연장

      const ack = await waitForAck(messageId, ackTimeout);

      if (ack) {
        return {
          messageId,
          delivered: true,
          totalAttempts: attempt,
          finalError: null,
          ackReceivedAt: ack.receivedAt,
          sentToDLQ: false,
        };
      }

      // ACK 미수신 — 재시도 준비
      lastError = 'ACK_TIMEOUT';

    } catch (error: any) {
      const errorCode = error.errorInfo?.code || error.message;
      lastError = errorCode;

      // 전송 로그 기록
      await db.collection('send_logs').add({
        messageId,
        attemptNumber: attempt,
        fcmResponseCode: error.httpResponse?.status || 500,
        errorCode,
        sentAt: Date.now(),
      });

      // 재시도 불필요 에러 확인
      if (NON_RETRYABLE_ERRORS.has(errorCode)) {
        // 토큰 무효 등 영구적 실패
        await removeTokenFromDB(token);
        return {
          messageId,
          delivered: false,
          totalAttempts: attempt,
          finalError: errorCode,
          ackReceivedAt: null,
          sentToDLQ: true,
        };
      }
    }

    // 다음 재시도 전 대기 (마지막 시도가 아닌 경우)
    if (attempt < config.maxRetries) {
      const delay = calculateBackoffDelay(attempt, config);
      await sleep(delay);
    }
  }

  // 모든 재시도 소진 — DLQ 적재
  await db.collection('dead_letter_queue').add({
    messageId,
    token,
    payload,
    totalAttempts: attempt,
    lastError,
    createdAt: Date.now(),
  });

  return {
    messageId,
    delivered: false,
    totalAttempts: attempt,
    finalError: lastError,
    ackReceivedAt: null,
    sentToDLQ: true,
  };
}
```

**ACK 대기 함수:**

```typescript
// src/qos/ack-waiter.ts
interface AckRecord {
  messageId: string;
  receivedAt: number;
  appState: string;
  deviceModel: string;
}

async function waitForAck(
  messageId: string,
  timeoutMs: number
): Promise<AckRecord | null> {
  return new Promise((resolve) => {
    const checkInterval = 1000;  // 1초 간격 폴링
    let elapsed = 0;

    const timer = setInterval(async () => {
      elapsed += checkInterval;

      const ackDoc = await db.collection('ack_logs').doc(messageId).get();
      if (ackDoc.exists) {
        clearInterval(timer);
        resolve(ackDoc.data() as AckRecord);
        return;
      }

      if (elapsed >= timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, checkInterval);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**클라이언트 측 ACK 전송 (Android):**

```kotlin
// Android — ACK 전송 구현
class QoSFirebaseMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val messageId = remoteMessage.data["_mid"] ?: return
        val qosLevel = remoteMessage.data["_qos"] ?: "0"
        val receivedAt = System.currentTimeMillis()

        // QoS L1/L2: 즉시 ACK 전송
        if (qosLevel == "1" || qosLevel == "2") {
            sendAckToServer(
                messageId = messageId,
                receivedAt = receivedAt,
                appState = getAppState(),
                deviceModel = Build.MODEL
            )
        }

        // 메시지 처리
        processMessage(remoteMessage)
    }

    private fun sendAckToServer(
        messageId: String,
        receivedAt: Long,
        appState: String,
        deviceModel: String
    ) {
        // WorkManager를 사용하여 ACK 전송 보장
        val ackData = workDataOf(
            "messageId" to messageId,
            "receivedAt" to receivedAt,
            "appState" to appState,
            "deviceModel" to deviceModel,
            "platform" to "android"
        )

        val ackWork = OneTimeWorkRequestBuilder<AckWorker>()
            .setInputData(ackData)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                WorkRequest.MIN_BACKOFF_MILLIS,
                TimeUnit.MILLISECONDS
            )
            .build()

        WorkManager.getInstance(applicationContext)
            .enqueueUniqueWork(
                "ack_$messageId",
                ExistingWorkPolicy.KEEP,  // 중복 방지
                ackWork
            )
    }
}
```

**클라이언트 측 ACK 전송 (iOS):**

```swift
// iOS — ACK 전송 구현
class NotificationService: UNNotificationServiceExtension {
    // Notification Service Extension을 사용하여
    // Background/Terminated 상태에서도 ACK 전송 가능

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler:
            @escaping (UNNotificationContent) -> Void
    ) {
        guard let userInfo = request.content.userInfo as? [String: Any],
              let messageId = userInfo["_mid"] as? String,
              let qosLevel = userInfo["_qos"] as? String,
              qosLevel == "1" || qosLevel == "2"
        else {
            contentHandler(request.content)
            return
        }

        let receivedAt = Int64(Date().timeIntervalSince1970 * 1000)

        sendAck(messageId: messageId, receivedAt: receivedAt) { success in
            contentHandler(request.content)
        }
    }

    private func sendAck(
        messageId: String,
        receivedAt: Int64,
        completion: @escaping (Bool) -> Void
    ) {
        let url = URL(string: "https://your-server.com/api/ack")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "messageId": messageId,
            "receivedAt": receivedAt,
            "appState": "background",
            "deviceModel": UIDevice.current.model,
            "platform": "ios"
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { _, response, error in
            let success = (response as? HTTPURLResponse)?.statusCode == 200
            completion(success)
        }.resume()
    }
}
```

#### 장단점

| 장점 | 단점 |
|------|------|
| 일시적 장애에 대한 복원력이 높다 | 중복 전달이 발생할 수 있다 |
| 전달 확인이 가능하다 | ACK 인프라 구축이 필요하다 |
| DLQ를 통한 최종 실패 추적이 가능하다 | Rate Limit 소비가 증가한다 |
| 재시도 성공률 약 97% [^8] | ACK 전송 자체가 실패할 수 있다 |

---

### 2.4 QoS Level 2 — Exactly Once (중복 제거 포함)

#### 개요

QoS Level 1에 클라이언트 측 중복 제거(deduplication) 메커니즘을 추가한 방식이다. 서버의 재시도로 인해 동일 메시지가 여러 번 전달되더라도, 클라이언트가 고유 message_id를 기반으로 중복을 감지하고 1회만 처리한다.

```
┌────────────┐              ┌──────────┐              ┌──────────────────┐
│  App Server │              │   FCM    │              │      Device      │
└──────┬─────┘              └────┬─────┘              │  ┌────────────┐  │
       │                         │                     │  │ Dedup Store│  │
       │                         │                     │  │ {seen_ids} │  │
       │  1. Send (_mid=abc)     │                     │  └────────────┘  │
       │ ───────────────────────>│                     └───────┬──────────┘
       │                         │  2. 전달                     │
       │                         │ ──────────────────────────> │
       │                         │                     _mid=abc│
       │                         │                     seen?   │ No
       │                         │                     → 처리  │
       │                         │                     → 저장  │
       │  3. ACK (_mid=abc)                                    │
       │ <─────────────────────────────────────────────────────│
       │                         │                             │
       │  [ACK 미수신 → 재전송]   │                             │
       │                         │                             │
       │  4. Send (_mid=abc, #2) │                             │
       │ ───────────────────────>│                             │
       │                         │  5. 전달 (중복)              │
       │                         │ ──────────────────────────> │
       │                         │                     _mid=abc│
       │                         │                     seen?   │ Yes!
       │                         │                     → 스킵  │
       │  6. ACK (_mid=abc)      │                     → ACK만 │
       │ <─────────────────────────────────────────────────────│
       │                         │                             │
       │  ✓ Exactly Once 달성    │                             │
```

#### 구현 — 서버 측

서버 측 구현은 QoS Level 1과 동일하다. 차이는 클라이언트 측 중복 제거에 있다.

```typescript
// src/qos/level2.ts — 서버 측은 L1과 동일
async function sendL2(
  token: string,
  payload: Record<string, string>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<QoSL1Result> {
  const messageId = crypto.randomUUID();

  // L1과 동일한 재시도 로직 사용
  // 단, _qos 필드를 '2'로 설정하여 클라이언트에 중복 제거 신호를 전달
  return sendL1Internal(token, {
    ...payload,
    _qos: '2',
  }, messageId, config);
}
```

#### 구현 — 클라이언트 측 중복 제거 (Android)

```kotlin
// Android — 중복 제거 저장소
class MessageDeduplicator(context: Context) {

    // SharedPreferences 기반 간단한 중복 제거 저장소
    // 프로덕션에서는 Room DB 사용 권장
    private val prefs = context.getSharedPreferences(
        "fcm_dedup", Context.MODE_PRIVATE
    )

    companion object {
        private const val MAX_STORED_IDS = 10000
        private const val EXPIRY_HOURS = 48L
    }

    /**
     * 메시지 ID가 이미 처리되었는지 확인한다.
     * @return true이면 신규 메시지, false이면 중복
     */
    @Synchronized
    fun checkAndMark(messageId: String): Boolean {
        val key = "msg_$messageId"

        if (prefs.contains(key)) {
            // 이미 처리된 메시지 — 중복
            return false
        }

        // 신규 메시지 — 등록
        prefs.edit()
            .putLong(key, System.currentTimeMillis())
            .apply()

        // 오래된 항목 정리 (비동기)
        cleanupExpiredEntries()

        return true
    }

    private fun cleanupExpiredEntries() {
        val now = System.currentTimeMillis()
        val expiryMs = EXPIRY_HOURS * 3600 * 1000
        val editor = prefs.edit()
        var removedCount = 0

        prefs.all.forEach { (key, value) ->
            if (key.startsWith("msg_") && value is Long) {
                if (now - value > expiryMs) {
                    editor.remove(key)
                    removedCount++
                }
            }
        }

        if (removedCount > 0) {
            editor.apply()
        }
    }
}

// QoS Level 2 서비스
class QoSL2FirebaseMessagingService : FirebaseMessagingService() {

    private lateinit var deduplicator: MessageDeduplicator

    override fun onCreate() {
        super.onCreate()
        deduplicator = MessageDeduplicator(applicationContext)
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val messageId = remoteMessage.data["_mid"] ?: return
        val qosLevel = remoteMessage.data["_qos"] ?: "0"

        when (qosLevel) {
            "2" -> handleL2Message(messageId, remoteMessage)
            "1" -> handleL1Message(messageId, remoteMessage)
            else -> processMessage(remoteMessage)
        }
    }

    private fun handleL2Message(messageId: String, remoteMessage: RemoteMessage) {
        // 1. 중복 확인
        val isNew = deduplicator.checkAndMark(messageId)

        // 2. ACK 전송 (중복이더라도 ACK는 전송)
        sendAckToServer(
            messageId = messageId,
            receivedAt = System.currentTimeMillis(),
            isDuplicate = !isNew,
            appState = getAppState(),
            deviceModel = Build.MODEL
        )

        // 3. 신규 메시지만 처리
        if (isNew) {
            processMessage(remoteMessage)
        } else {
            Log.d("QoS", "중복 메시지 스킵: $messageId")
        }
    }
}
```

#### 구현 — 클라이언트 측 중복 제거 (iOS)

```swift
// iOS — 중복 제거 저장소
class MessageDeduplicator {
    static let shared = MessageDeduplicator()

    private let userDefaults = UserDefaults(suiteName: "group.com.example.fcm.dedup")!
    private let maxStoredIds = 10000
    private let expiryHours: TimeInterval = 48 * 3600

    /// 메시지 ID가 이미 처리되었는지 확인한다.
    /// - Returns: true이면 신규 메시지, false이면 중복
    func checkAndMark(_ messageId: String) -> Bool {
        let key = "msg_\(messageId)"

        if userDefaults.object(forKey: key) != nil {
            return false  // 중복
        }

        userDefaults.set(Date().timeIntervalSince1970, forKey: key)

        // 비동기 정리
        DispatchQueue.global(qos: .background).async { [weak self] in
            self?.cleanupExpired()
        }

        return true  // 신규
    }

    private func cleanupExpired() {
        let now = Date().timeIntervalSince1970
        let keys = userDefaults.dictionaryRepresentation().keys
            .filter { $0.hasPrefix("msg_") }

        for key in keys {
            if let timestamp = userDefaults.double(forKey: key) as Double?,
               now - timestamp > expiryHours {
                userDefaults.removeObject(forKey: key)
            }
        }
    }
}

// Notification Service Extension에서의 중복 제거
class DeduplicatingNotificationService: UNNotificationServiceExtension {
    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler:
            @escaping (UNNotificationContent) -> Void
    ) {
        guard let userInfo = request.content.userInfo as? [String: Any],
              let messageId = userInfo["_mid"] as? String,
              let qosLevel = userInfo["_qos"] as? String,
              qosLevel == "2"
        else {
            contentHandler(request.content)
            return
        }

        let isNew = MessageDeduplicator.shared.checkAndMark(messageId)

        // ACK 전송 (중복 여부 무관)
        sendAck(messageId: messageId, isDuplicate: !isNew)

        if isNew {
            // 신규 메시지 — 알림 표시
            contentHandler(request.content)
        } else {
            // 중복 메시지 — 알림 억제
            let emptyContent = UNMutableNotificationContent()
            contentHandler(emptyContent)
        }
    }
}
```

#### 장단점

| 장점 | 단점 |
|------|------|
| 사실상 Exactly Once 시맨틱 달성 | 클라이언트 측 저장소 관리가 필요하다 |
| L1의 모든 장점 포함 | 메모리/스토리지 소비가 증가한다 |
| 중복 알림으로 인한 사용자 혼란 방지 | ID 저장소 크기 관리가 필요하다 (만료 정책) |
| | App Group 설정 필요 (iOS) |

---

## 3. ACK 기반 재전송 구현 상세

### 3.1 재시도 정책 설계

#### Exponential Backoff with Jitter

재시도 간격은 exponential backoff에 jitter를 추가하여 "thundering herd" 문제를 방지한다 [^9]:

```
재시도 간격 = min(base × 2^(attempt-1), max_delay) ± jitter

기본 설정:
  base = 1초
  max_delay = 60초
  jitter = ±20%

시도 1: 1초 ± 0.2초   = 0.8~1.2초
시도 2: 2초 ± 0.4초   = 1.6~2.4초
시도 3: 4초 ± 0.8초   = 3.2~4.8초
시도 4: 8초 ± 1.6초   = 6.4~9.6초
시도 5: 16초 ± 3.2초  = 12.8~19.2초
총 최대 대기: ~36.2초
```

#### 재시도 가능 여부 판정

```typescript
// src/qos/retry-policy.ts
interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
  delayMs: number;
}

function shouldRetry(
  error: any,
  attempt: number,
  config: RetryConfig
): RetryDecision {
  // 1. 최대 재시도 횟수 초과
  if (attempt >= config.maxRetries) {
    return {
      shouldRetry: false,
      reason: 'MAX_RETRIES_EXCEEDED',
      delayMs: 0,
    };
  }

  const errorCode = error.errorInfo?.code || '';
  const httpStatus = error.httpResponse?.status || 0;

  // 2. 영구적 실패 (재시도 무의미)
  if (NON_RETRYABLE_ERRORS.has(errorCode)) {
    return {
      shouldRetry: false,
      reason: `PERMANENT_FAILURE: ${errorCode}`,
      delayMs: 0,
    };
  }

  // 3. Rate Limit (429) — Retry-After 헤더 존재 시 해당 시간 대기
  if (httpStatus === 429) {
    const retryAfter = error.httpResponse?.headers?.['retry-after'];
    const delayMs = retryAfter
      ? parseInt(retryAfter) * 1000
      : calculateBackoffDelay(attempt, config);

    return {
      shouldRetry: true,
      reason: 'RATE_LIMITED',
      delayMs,
    };
  }

  // 4. 서버 에러 (5xx) — 재시도 가능
  if (httpStatus >= 500) {
    return {
      shouldRetry: true,
      reason: 'SERVER_ERROR',
      delayMs: calculateBackoffDelay(attempt, config),
    };
  }

  // 5. 네트워크 에러 — 재시도 가능
  if (['ECONNREFUSED', 'ETIMEOUT', 'ENOTFOUND'].includes(error.code)) {
    return {
      shouldRetry: true,
      reason: 'NETWORK_ERROR',
      delayMs: calculateBackoffDelay(attempt, config),
    };
  }

  // 6. ACK 타임아웃 — 재시도 가능
  if (errorCode === 'ACK_TIMEOUT') {
    return {
      shouldRetry: true,
      reason: 'ACK_TIMEOUT',
      delayMs: calculateBackoffDelay(attempt, config),
    };
  }

  // 7. 알 수 없는 에러 — 안전하게 재시도
  return {
    shouldRetry: true,
    reason: 'UNKNOWN_ERROR',
    delayMs: calculateBackoffDelay(attempt, config),
  };
}
```

### 3.2 서킷 브레이커 패턴

연속적인 실패가 감지될 때 일시적으로 전송을 중단하여 FCM 서버와 자체 서버의 부하를 줄이는 패턴이다.

```typescript
// src/qos/circuit-breaker.ts
enum CircuitState {
  CLOSED = 'CLOSED',       // 정상 운영
  OPEN = 'OPEN',           // 전송 차단
  HALF_OPEN = 'HALF_OPEN', // 시험적 전송
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private successCount: number = 0;

  constructor(
    private failureThreshold: number = 10,    // 연속 실패 임계값
    private recoveryTimeMs: number = 30000,   // 30초 후 반개방
    private halfOpenSuccessThreshold: number = 3  // 반개방에서 연속 3회 성공 시 닫기
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeMs) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        throw new Error('CIRCUIT_OPEN: 전송 일시 차단 중');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
```

### 3.3 Dead Letter Queue (DLQ) 관리

모든 재시도가 소진된 메시지는 DLQ에 적재되어 수동 검토 또는 대안 채널을 통한 전송을 기다린다.

```typescript
// src/qos/dead-letter-queue.ts
interface DLQEntry {
  messageId: string;
  token: string;
  payload: Record<string, string>;
  totalAttempts: number;
  lastError: string;
  lastAttemptAt: number;
  createdAt: number;
  status: 'pending' | 'retried' | 'abandoned';
}

class DeadLetterQueue {
  async enqueue(entry: Omit<DLQEntry, 'status' | 'createdAt'>): Promise<void> {
    await db.collection('dead_letter_queue').doc(entry.messageId).set({
      ...entry,
      status: 'pending',
      createdAt: Date.now(),
    });
  }

  /**
   * DLQ에서 재시도 가능한 메시지를 조회한다.
   * 재시도 가능 조건:
   * - 상태가 'pending'
   * - 마지막 시도로부터 1시간 이상 경과
   * - 에러 코드가 일시적 에러 (5xx, RATE_LIMITED 등)
   */
  async getRetryable(limit: number = 100): Promise<DLQEntry[]> {
    const oneHourAgo = Date.now() - 3600000;

    const docs = await db.collection('dead_letter_queue')
      .where('status', '==', 'pending')
      .where('lastAttemptAt', '<', oneHourAgo)
      .limit(limit)
      .get();

    return docs.docs
      .map(d => d.data() as DLQEntry)
      .filter(entry =>
        !NON_RETRYABLE_ERRORS.has(entry.lastError)
      );
  }

  /**
   * DLQ 모니터링 지표를 반환한다.
   */
  async getStats(): Promise<{
    total: number;
    pending: number;
    retried: number;
    abandoned: number;
    errorDistribution: Record<string, number>;
  }> {
    const all = await db.collection('dead_letter_queue').get();
    const stats = {
      total: all.size,
      pending: 0,
      retried: 0,
      abandoned: 0,
      errorDistribution: {} as Record<string, number>,
    };

    all.docs.forEach(doc => {
      const data = doc.data() as DLQEntry;
      stats[data.status]++;
      const err = data.lastError;
      stats.errorDistribution[err] = (stats.errorDistribution[err] || 0) + 1;
    });

    return stats;
  }
}
```

---

## 4. 중복 제거 구현 상세

### 4.1 서버 측 중복 전송 방지

서버 측에서는 동일 비즈니스 이벤트에 대해 중복 FCM 전송을 방지하는 멱등성(idempotency) 메커니즘을 구현한다.

```typescript
// src/qos/idempotency.ts
class IdempotentSender {
  /**
   * 비즈니스 이벤트 ID 기반 멱등성 전송.
   * 동일 eventId로 중복 호출되어도 FCM은 1회만 전송한다.
   */
  async sendIdempotent(
    eventId: string,            // 비즈니스 이벤트 고유 ID
    token: string,
    payload: Record<string, string>,
    qosLevel: 0 | 1 | 2
  ): Promise<{ alreadySent: boolean; result: any }> {
    // 1. 이미 전송된 이벤트인지 확인
    const existing = await db.collection('sent_events').doc(eventId).get();

    if (existing.exists) {
      return {
        alreadySent: true,
        result: existing.data(),
      };
    }

    // 2. 전송 시도 (원자적으로 기록)
    const messageId = crypto.randomUUID();

    // Firestore 트랜잭션으로 중복 방지
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(db.collection('sent_events').doc(eventId));
      if (doc.exists) {
        return { alreadySent: true, result: doc.data() };
      }

      // 전송 기록 먼저 저장 (전송 전)
      tx.set(db.collection('sent_events').doc(eventId), {
        messageId,
        token,
        qosLevel,
        createdAt: Date.now(),
        status: 'sending',
      });

      return { alreadySent: false, result: null };
    });

    if (result.alreadySent) {
      return result;
    }

    // 3. QoS Level에 따라 전송
    let sendResult;
    switch (qosLevel) {
      case 0:
        sendResult = await sendL0(token, { ...payload, _event_id: eventId });
        break;
      case 1:
        sendResult = await sendL1(token, { ...payload, _event_id: eventId });
        break;
      case 2:
        sendResult = await sendL2(token, { ...payload, _event_id: eventId });
        break;
    }

    // 4. 전송 결과 업데이트
    await db.collection('sent_events').doc(eventId).update({
      status: sendResult.success ? 'sent' : 'failed',
      fcmResult: sendResult,
    });

    return { alreadySent: false, result: sendResult };
  }
}
```

### 4.2 클라이언트 측 중복 제거 고도화

프로덕션 환경에서는 SharedPreferences/UserDefaults 대신 로컬 데이터베이스를 사용하여 더 강건한 중복 제거를 구현해야 한다.

**Android (Room DB 기반):**

```kotlin
// Android — Room DB 기반 중복 제거

@Entity(tableName = "received_messages")
data class ReceivedMessage(
    @PrimaryKey val messageId: String,
    val receivedAt: Long,
    val processedAt: Long? = null,
    val expiresAt: Long  // 만료 시각
)

@Dao
interface ReceivedMessageDao {
    @Query("SELECT COUNT(*) FROM received_messages WHERE messageId = :messageId")
    suspend fun exists(messageId: String): Int

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(message: ReceivedMessage): Long
    // IGNORE: 이미 존재하면 -1 반환 (원자적 중복 확인 + 삽입)

    @Query("DELETE FROM received_messages WHERE expiresAt < :now")
    suspend fun deleteExpired(now: Long)
}

class RoomMessageDeduplicator(
    private val dao: ReceivedMessageDao
) {
    companion object {
        private const val EXPIRY_HOURS = 48L
    }

    /**
     * 원자적 중복 확인 및 등록.
     * Room의 OnConflictStrategy.IGNORE를 활용하여 race condition을 방지한다.
     * @return true이면 신규, false이면 중복
     */
    suspend fun checkAndMark(messageId: String): Boolean {
        val now = System.currentTimeMillis()
        val expiresAt = now + EXPIRY_HOURS * 3600 * 1000

        val result = dao.insert(ReceivedMessage(
            messageId = messageId,
            receivedAt = now,
            expiresAt = expiresAt
        ))

        // result == -1이면 이미 존재 (중복)
        val isNew = result != -1L

        // 만료 항목 정리 (매 100번째 호출마다)
        if (isNew && messageId.hashCode() % 100 == 0) {
            dao.deleteExpired(now)
        }

        return isNew
    }
}
```

---

## 5. QoS Level별 효과 예측

실험 설계(04-experiment-design.md)의 Phase 4에서 검증할 QoS Level별 예상 효과는 다음과 같다:

### 5.1 불안정 케이스별 QoS 개선 예측

| 불안정 케이스 | L0 (Raw FCM) | L1 (재시도) | L2 (재시도+중복제거) | 개선 가능 근거 |
|-------------|-------------|------------|-------------------|-------------|
| UNSTABLE-01 (토큰 무효) | 실패 | 실패 | 실패 | 토큰 자체가 무효하므로 재시도 무의미 |
| UNSTABLE-03 (Rate Limit) | 초과분 0% | 90%+ | 90%+ (중복 0%) | 다음 윈도우에서 재전송 가능 |
| UNSTABLE-04 (인증 만료) | 실패 | 복구 가능 | 복구 가능 | 토큰 갱신 후 재전송 가능 |
| UNSTABLE-07 (서버 5xx) | 실패 | 복구 가능 | 복구 가능 | 일시적 장애 복구 후 재전송 |
| UNSTABLE-08 (OEM 최적화) | 53% | 53% | 53% | 디바이스 측 문제로 서버 재시도 무효 |
| UNSTABLE-09 (Doze) | 지연 | 지연 | 지연 (중복 0%) | HIGH 우선순위로 부분 개선만 가능 |
| UNSTABLE-11 (iOS Silent) | 2~3건/h | 2~3건/h | 2~3건/h | Apple 정책으로 우회 불가 |
| UNSTABLE-14 (네트워크) | 실패 | 복구 가능 | 복구 가능 | 네트워크 복구 후 재전송 |

### 5.2 핵심 결론

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  QoS 메커니즘은 Layer 1(서버→FCM) 원인에 효과적이다:              │
│    ✓ Rate Limit, 인증 만료, 서버 장애, 네트워크 장애              │
│                                                                 │
│  QoS 메커니즘은 Layer 3(FCM→디바이스) 원인에 무효하다:            │
│    ✗ OEM 배터리 최적화, iOS 스로틀링, Android Force-stopped       │
│                                                                 │
│  Layer 3 문제는 다음으로 대응해야 한다:                            │
│    • 사용자에게 배터리 최적화 예외 등록 안내                        │
│    • Notification 메시지 유형 사용 (Data 대신)                    │
│    • 대안 채널 도입 (HMS, WebSocket, SMS 폴백)                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 실무 적용 가이드

### 6.1 QoS Level 선택 가이드

```
                    메시지 중요도
                        │
            ┌───────────┤───────────┐
            │           │           │
        낮음 (Low)    중간 (Med)   높음 (High)
            │           │           │
         QoS L0      QoS L1      QoS L2
            │           │           │
            ▼           ▼           ▼
       마케팅 알림    일반 알림    결제/보안
       뉴스 속보     채팅 알림    인증 코드
       점수 업데이트   주문 상태    긴급 공지
```

| 사용 사례 | 권장 QoS Level | 이유 |
|----------|---------------|------|
| 마케팅 프로모션 | L0 | 유실이 비즈니스에 치명적이지 않다 |
| 뉴스/콘텐츠 업데이트 | L0 | 최신 내용만 의미가 있다 |
| 채팅 메시지 알림 | L1 | 전달 확인이 필요하나 중복은 허용 가능하다 |
| 주문 상태 변경 | L1 | 전달이 중요하고 상태 변경이 멱등적이다 |
| 결제 완료 알림 | L2 | 중복 알림이 사용자 혼란을 유발한다 |
| OTP/인증 코드 | L2 | 정확히 1회 전달이 필수적이다 |
| 긴급 재난 알림 | L1 + 대안채널 | 최대 도달률이 필요하다 |

### 6.2 토큰 관리 모범 사례

```typescript
// src/token/token-manager.ts

class TokenManager {
  /**
   * 주기적 토큰 정리 (일간 실행)
   * 30일 이상 비활성 토큰을 삭제한다.
   */
  async cleanupStaleTokens(): Promise<{
    totalChecked: number;
    removed: number;
  }> {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 3600 * 1000);

    const staleTokens = await db.collection('fcm_tokens')
      .where('lastActiveAt', '<', thirtyDaysAgo)
      .get();

    let removed = 0;
    const batch = db.batch();

    staleTokens.docs.forEach(doc => {
      batch.delete(doc.ref);
      removed++;
    });

    await batch.commit();

    return { totalChecked: staleTokens.size, removed };
  }

  /**
   * 토큰 갱신 처리
   * 클라이언트에서 onNewToken 콜백 시 호출한다.
   */
  async updateToken(
    userId: string,
    oldToken: string | null,
    newToken: string,
    platform: 'android' | 'ios'
  ): Promise<void> {
    const batch = db.batch();

    // 이전 토큰 삭제
    if (oldToken) {
      const oldRef = db.collection('fcm_tokens').doc(oldToken);
      batch.delete(oldRef);
    }

    // 새 토큰 등록
    batch.set(db.collection('fcm_tokens').doc(newToken), {
      userId,
      token: newToken,
      platform,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    await batch.commit();
  }

  /**
   * 전송 실패 시 무효 토큰 처리
   */
  async handleSendError(
    token: string,
    errorCode: string
  ): Promise<void> {
    if (NON_RETRYABLE_ERRORS.has(errorCode)) {
      await db.collection('fcm_tokens').doc(token).delete();
      console.log(`무효 토큰 삭제: ${token} (${errorCode})`);
    }
  }
}
```

### 6.3 Non-Collapsible 100건 한도 대응

오프라인 디바이스에 대한 Non-collapsible 메시지 누적을 방지하기 위한 전략이다:

```typescript
// src/qos/pending-message-tracker.ts

class PendingMessageTracker {
  private readonly MAX_PENDING = 90;  // 안전 마진을 두어 90건으로 제한

  /**
   * 디바이스별 미전달 메시지 수를 추적한다.
   * 90건 초과 시 전송을 보류하고 경고를 발생시킨다.
   */
  async canSend(token: string): Promise<{
    allowed: boolean;
    pendingCount: number;
  }> {
    const pending = await db.collection('send_logs')
      .where('token', '==', token)
      .where('fcmResponseCode', '==', 200)
      .where('ackReceived', '==', false)
      .get();

    const pendingCount = pending.size;

    if (pendingCount >= this.MAX_PENDING) {
      console.warn(
        `경고: 토큰 ${token.substring(0, 10)}...의 미전달 메시지가 ` +
        `${pendingCount}건입니다. 100건 한도 초과 위험으로 전송을 보류합니다.`
      );
      return { allowed: false, pendingCount };
    }

    return { allowed: true, pendingCount };
  }
}
```

### 6.4 OEM 배터리 최적화 대응 가이드

서버 측 QoS로 해결 불가한 OEM 문제에 대한 클라이언트 측 대응 방안이다:

```kotlin
// Android — 배터리 최적화 예외 요청
class BatteryOptimizationHelper(private val activity: Activity) {

    fun requestBatteryOptimizationExemption() {
        val packageName = activity.packageName
        val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager

        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            // 사용자에게 배터리 최적화 예외 요청
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:$packageName")
            )
            activity.startActivity(intent)
        }
    }

    /**
     * OEM별 배터리 최적화 설정 안내
     * 각 OEM의 설정 경로가 다르므로 분기 처리한다.
     */
    fun openOEMBatterySettings() {
        val manufacturer = Build.MANUFACTURER.lowercase()

        val intent = when {
            manufacturer.contains("samsung") -> {
                Intent().apply {
                    component = ComponentName(
                        "com.samsung.android.lool",
                        "com.samsung.android.sm.battery.ui.BatteryActivity"
                    )
                }
            }
            manufacturer.contains("xiaomi") -> {
                Intent().apply {
                    component = ComponentName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.autostart.AutoStartManagementActivity"
                    )
                }
            }
            else -> {
                Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)
            }
        }

        try {
            activity.startActivity(intent)
        } catch (e: Exception) {
            // OEM 설정을 찾을 수 없는 경우 기본 설정으로 폴백
            activity.startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }
}
```

### 6.5 모니터링 및 알람 설정

프로덕션 환경에서의 QoS 모니터링을 위한 핵심 메트릭과 알람 기준이다:

| 메트릭 | 경고 임계값 | 심각 임계값 | 모니터링 주기 |
|--------|-----------|-----------|-------------|
| 서버 수락률 | < 98% | < 95% | 1분 |
| 디바이스 수신률 | < 90% | < 80% | 5분 |
| API 지연 P95 | > 2초 | > 10초 | 1분 |
| DLQ 적재율 | > 1% | > 5% | 5분 |
| 429 에러 비율 | > 5% | > 20% | 1분 |
| 서킷 브레이커 OPEN | 발생 | 5분 이상 지속 | 실시간 |

```typescript
// src/monitoring/alerts.ts
interface AlertConfig {
  metric: string;
  warningThreshold: number;
  criticalThreshold: number;
  evaluationPeriodMs: number;
}

const ALERT_CONFIGS: AlertConfig[] = [
  {
    metric: 'server_accept_rate',
    warningThreshold: 98,
    criticalThreshold: 95,
    evaluationPeriodMs: 60000,
  },
  {
    metric: 'device_receive_rate',
    warningThreshold: 90,
    criticalThreshold: 80,
    evaluationPeriodMs: 300000,
  },
  {
    metric: 'api_latency_p95',
    warningThreshold: 2000,
    criticalThreshold: 10000,
    evaluationPeriodMs: 60000,
  },
  {
    metric: 'dlq_rate',
    warningThreshold: 1,
    criticalThreshold: 5,
    evaluationPeriodMs: 300000,
  },
];
```

---

## 7. QoS Level별 리소스 비용 비교

| 항목 | L0 | L1 | L2 |
|------|-----|-----|-----|
| FCM API 호출 수 | 1× | 1~5× (평균 1.03×) [^8] | 1~5× (평균 1.03×) |
| 서버 CPU | 기준 | 1.5~2× | 1.5~2× |
| 네트워크 대역폭 | 기준 | 1.5~2× | 2~3× (ACK 포함) |
| 클라이언트 스토리지 | 0 | 0 | 수 MB (중복 ID 저장) |
| 서버 스토리지 | 최소 | 중간 (전송 로그, DLQ) | 중간 + 이벤트 ID |
| 구현 복잡도 | 낮음 | 중간 | 높음 |
| 운영 복잡도 | 낮음 | 중간 (DLQ 모니터링) | 높음 (중복 제거 관리) |

---

## 참고 문헌

[^1]: Firebase, "About FCM messages," https://firebase.google.com/docs/cloud-messaging/concept-options — FCM의 best-effort delivery 특성, 전달 보장 부재

[^2]: Firebase, "Manage FCM registration tokens," https://firebase.google.com/docs/cloud-messaging/manage-tokens — 토큰 생명주기, 갱신 이벤트, 비활성 토큰의 약 15% 드롭

[^3]: Firebase, "Throttling and Quotas," https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas — 프로젝트/디바이스별 Rate Limit 상세

[^4]: Firebase, "Collapsible message types," https://firebase.google.com/docs/cloud-messaging/customize-messages/collapsible-message-types — Non-collapsible 100건 한도, 전체 삭제 동작

[^5]: DontKillMyApp.com, https://dontkillmyapp.com/ — OEM별 배터리 최적화 정책, 앱 종료 동작 비교

[^6]: Apple Developer Forums, "Silent Push Throttling," https://developer.apple.com/forums/thread/47901 — iOS Silent push 스로틀링 관측

[^7]: HiveMQ, "MQTT QoS Essentials," https://www.hivemq.com/blog/mqtt-essentials-part-6-mqtt-quality-of-service-levels/ — MQTT QoS 0/1/2 정의, FCM과의 비교

[^8]: S. Rhie, "Beyond Token Validation: Measuring Real Device Delivery Rates with Firebase FCM," DEV Community, 2024 — 재시도 성공률 97%, 평균 재시도 횟수

[^9]: AWS, "Exponential Backoff And Jitter," https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ — Exponential backoff + jitter 패턴

[^10]: Firebase, "FCM architectural overview," https://firebase.google.com/docs/cloud-messaging/fcm-architecture — FCM 전송 흐름, 플랫폼별 전송 계층

[^11]: Firebase, "Understanding message delivery," https://firebase.google.com/docs/cloud-messaging/understand-delivery — FCM Data API 7가지 상태 카테고리

[^12]: Firebase, "Receive messages in an Android app," https://firebase.google.com/docs/cloud-messaging/android/receive-messages — Android 앱 상태별 메시지 처리, Force-stopped 드롭

[^13]: G. Albertengo, F.G. Debele, W. Hassan, D. Stramandino, "On the Performance of Web Services, Google Cloud Messaging and Firebase Cloud Messaging," *Digital Communications and Networks*, Vol. 6, Issue 1, pp. 31-37, 2019. DOI: 10.1016/j.dcan.2019.02.002 — FCM 전달 성능 벤치마크
