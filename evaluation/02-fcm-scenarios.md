# FCM 알림 송수신 시나리오 조사

> 작성일: 2026-03-19
> 목적: FCM을 통한 알림 전송의 다양한 시나리오를 체계적으로 분류하고, 각 시나리오의 기술적 특성, 장단점, 적합 용도를 객관적으로 분석한다.

---

## 1. 전송 대상 기반 시나리오 분류

FCM HTTP v1 API는 전송 대상에 따라 네 가지 시나리오를 지원한다. 각 시나리오는 메시지 구조, 팬아웃 처리 방식, 할당량 소비 패턴이 상이하다.

### 1.1 단일 디바이스 전송 (Unicast)

#### 정의 및 구조

단일 디바이스 전송은 하나의 FCM 등록 토큰을 대상으로 메시지를 전송하는 가장 기본적인 방식이다. FCM HTTP v1 API의 `token` 필드를 사용한다 [^1].

```typescript
// 단일 디바이스 전송 예시
import { getMessaging } from 'firebase-admin/messaging';

const message = {
  token: 'device_fcm_registration_token',
  data: {
    title: '주문 확인',
    orderId: 'ORD-2026-001',
    status: 'confirmed',
  },
  android: {
    priority: 'high' as const,
    ttl: 86400000,  // 24시간 (밀리초)
  },
  apns: {
    headers: {
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400),
    },
  },
};

const response = await getMessaging().send(message);
// response: 'projects/{project_id}/messages/{message_id}'
```

#### 특성

| 항목 | 내용 |
|------|------|
| API 호출 | 메시지 1건당 HTTP POST 1회 |
| 팬아웃 | 없음 (1:1 전달) |
| 응답 | 개별 메시지 ID 즉시 반환 |
| 에러 처리 | 토큰별 에러 코드 확인 가능 |
| 할당량 소비 | 1건/호출 |

#### 장단점

| 장점 | 단점 |
|------|------|
| 개별 에러 추적 가능 | 대량 전송 시 HTTP 호출 수가 선형 증가한다 |
| 토큰별 전달 상태 확인 | 10,000건 이상 전송 시 Rate Limit 위험이 존재한다 |
| 가장 단순한 구현 | 서버 측 부하가 수신자 수에 비례한다 |
| 개인화 메시지 전송 적합 | — |

#### 적합 용도

- 개인 맞춤형 알림 (주문 상태, 결제 완료 등)
- 1:1 채팅 메시지 알림
- 사용자 특정 이벤트 알림

---

### 1.2 다중 디바이스 전송 (Multicast)

#### 정의 및 구조

다중 디바이스 전송은 복수의 FCM 등록 토큰에 동일한 메시지를 한 번에 전송하는 방식이다. Firebase Admin SDK의 `sendEachForMulticast()` 메서드를 사용하며, 요청당 최대 500개의 토큰을 지정할 수 있다 [^2].

```typescript
// 다중 디바이스 전송 예시
import { getMessaging } from 'firebase-admin/messaging';

const tokens: string[] = [
  'token_device_1',
  'token_device_2',
  'token_device_3',
  // 최대 500개
];

const message = {
  data: {
    type: 'broadcast_alert',
    content: '시스템 점검 안내',
  },
  tokens,  // MulticastMessage의 tokens 필드
};

const response = await getMessaging().sendEachForMulticast(message);

// 응답 분석
console.log(`성공: ${response.successCount}`);
console.log(`실패: ${response.failureCount}`);

response.responses.forEach((resp, idx) => {
  if (!resp.success) {
    console.log(`토큰 ${idx} 실패: ${resp.error?.code}`);
    // UNREGISTERED, INVALID_ARGUMENT 등 에러 코드 확인
  }
});
```

#### 특성

| 항목 | 내용 |
|------|------|
| API 호출 | 500건 단위로 배치 처리 |
| 팬아웃 | FCM 서버 측에서 개별 전달로 분해 |
| 응답 | 토큰별 성공/실패 결과 배열 반환 |
| 에러 처리 | 개별 토큰 에러 확인 가능 |
| 할당량 소비 | 토큰 수만큼 소비 |

#### 장단점

| 장점 | 단점 |
|------|------|
| 개별 토큰 에러 추적 가능 | 요청당 최대 500개 토큰 제한이 존재한다 |
| 부분 실패 처리 용이 | 토큰 목록을 서버에서 관리해야 한다 |
| 네트워크 호출 감소 (vs 개별 전송) | 대규모 전송 시 배치 분할 로직이 필요하다 |

#### 적합 용도

- 특정 사용자 그룹 대상 공지 (세그먼트 전송)
- 서버 측에서 토큰 목록을 직접 관리하는 경우
- 전송 결과를 토큰 단위로 추적해야 하는 경우

---

### 1.3 토픽 전송 (Topic Messaging)

#### 정의 및 구조

토픽 전송은 특정 토픽을 구독한 모든 디바이스에 메시지를 전송하는 pub/sub 방식이다. 서버는 토큰 목록을 관리할 필요 없이 토픽 이름만 지정하면 되며, FCM Backend가 팬아웃을 처리한다 [^3].

```typescript
// 토픽 구독 (서버 측)
await getMessaging().subscribeToTopic(
  ['token_1', 'token_2', 'token_3'],  // 최대 1,000개/요청
  'news_sports'
);

// 토픽 전송
const message = {
  topic: 'news_sports',
  data: {
    headline: '속보: 월드컵 결승',
    category: 'sports',
  },
  android: { priority: 'high' as const },
  apns: { headers: { 'apns-priority': '10' } },
};

const response = await getMessaging().send(message);
```

#### 팬아웃 특성

| 항목 | 수치 |
|------|------|
| 동시 팬아웃 | 프로젝트당 최대 1,000개 (조정 불가) [^4] |
| 팬아웃 속도 | 10,000 QPS |
| 100만 구독자 토픽 | 최소 약 100초 소요 |
| 토픽당 구독자 수 | 무제한 |
| 앱 인스턴스당 토픽 수 | 최대 2,000개 |

#### 장단점

| 장점 | 단점 |
|------|------|
| 서버에서 토큰 목록을 관리하지 않아도 된다 | 개별 토큰 에러를 확인할 수 없다 |
| API 호출 1회로 무제한 디바이스 전송 가능 | 팬아웃 완료 시간이 구독자 수에 비례한다 |
| 클라이언트 측 구독/해제가 유연하다 | 동시 팬아웃 1,000개 제한이 존재한다 |
| 구독자 수 무제한 | 구독/해제 속도가 3,000 QPS로 제한된다 |

#### 적합 용도

- 뉴스 카테고리별 브로드캐스트
- 전체 사용자 공지
- 관심사 기반 콘텐츠 알림
- 지역 기반 알림

---

### 1.4 조건부 전송 (Condition Messaging)

#### 정의 및 구조

조건부 전송은 토픽의 논리적 조합(AND, OR, NOT)을 조건식으로 지정하여, 해당 조건을 만족하는 디바이스에만 메시지를 전송하는 방식이다. 최대 5개의 토픽을 조합할 수 있다 [^3].

```typescript
// 조건부 전송 예시
const message = {
  condition: "'news_sports' in topics && 'news_korea' in topics",
  data: {
    headline: '한국 스포츠 뉴스 속보',
    category: 'sports_kr',
  },
};

const response = await getMessaging().send(message);

// 지원되는 논리 연산자
// && : AND — 모든 토픽에 구독한 디바이스
// || : OR  — 하나 이상의 토픽에 구독한 디바이스
// !  : NOT — 해당 토픽에 미구독한 디바이스

// 복합 조건 예시: 스포츠 구독 AND (한국 OR 일본) AND NOT 축구
const complexCondition =
  "'sports' in topics && ('korea' in topics || 'japan' in topics) && !('soccer' in topics)";
```

#### 특성

| 항목 | 내용 |
|------|------|
| 조건식 최대 토픽 수 | 5개 |
| 논리 연산자 | AND(&&), OR(||), NOT(!) |
| 팬아웃 | 조건 평가 후 대상 디바이스에 팬아웃 |
| 응답 | 메시지 ID만 반환 (대상 수 비공개) |

#### 장단점

| 장점 | 단점 |
|------|------|
| 세밀한 타겟팅 가능 | 최대 5개 토픽으로 조합이 제한된다 |
| 서버 측 필터링 불필요 | 조건 평가로 팬아웃이 토픽 전송보다 느리다 |
| 토큰 관리 불필요 | 전송 대상 수를 사전에 알 수 없다 |
| | 복잡한 조건일수록 디버깅이 어렵다 |

#### 적합 용도

- 다중 관심사 교집합 타겟팅
- 지역 + 카테고리 기반 알림
- A/B 테스트 그룹 분리 전송

---

### 1.5 전송 시나리오 비교 요약

| 시나리오 | API 호출 수 | 토큰 관리 | 에러 추적 | 최대 대상 | 적합 규모 |
|----------|-----------|----------|----------|----------|----------|
| Unicast | N회 (대상 수) | 필요 | 개별 가능 | 1 | 소규모, 개인화 |
| Multicast | N/500회 | 필요 | 개별 가능 | 500/배치 | 중규모 세그먼트 |
| Topic | 1회 | 불필요 | 불가 | 무제한 | 대규모 브로드캐스트 |
| Condition | 1회 | 불필요 | 불가 | 무제한 | 대규모 타겟팅 |

---

## 2. 메시지 유형별 특성

FCM은 세 가지 메시지 유형을 지원하며, 각 유형은 페이로드 구조와 처리 방식이 근본적으로 다르다 [^5].

### 2.1 Notification 메시지

#### 정의

Notification 메시지는 `notification` 키를 포함하는 메시지이다. 시스템(OS)이 알림 표시를 자동으로 처리하며, 앱 코드의 개입 없이 시스템 트레이에 알림이 표시된다.

#### 페이로드 구조

```typescript
const notificationMessage = {
  token: 'device_token',
  notification: {
    title: '새로운 메시지',
    body: '김철수님이 메시지를 보냈습니다.',
    image: 'https://example.com/image.png',  // 선택적
  },
  android: {
    notification: {
      channelId: 'chat_channel',
      icon: 'ic_notification',
      color: '#4285F4',
      sound: 'default',
      clickAction: 'OPEN_CHAT',
      tag: 'chat_notification',           // collapse key 역할
    },
  },
  apns: {
    payload: {
      aps: {
        alert: {
          title: '새로운 메시지',
          body: '김철수님이 메시지를 보냈습니다.',
        },
        badge: 1,
        sound: 'default',
        'mutable-content': 1,             // Notification Service Extension용
      },
    },
  },
};
```

#### 핵심 특성

| 특성 | 설명 |
|------|------|
| 자동 표시 | 앱이 Background/Killed 상태일 때 시스템이 자동으로 알림을 표시한다 |
| Collapsible | Notification 메시지는 항상 collapsible이다 [^6] |
| 크기 제한 | 4,096 bytes (4KB) |
| 플랫폼별 커스터마이징 | `android.notification`, `apns.payload` 블록으로 세분화 가능 |

#### 제약 사항

- Background/Killed 상태에서 앱이 메시지 내용을 가공할 수 없다
- 항상 collapsible이므로 동일 태그의 이전 미전달 메시지가 대체된다
- 사용자가 알림을 탭하지 않으면 앱이 데이터에 접근할 수 없다

---

### 2.2 Data 메시지

#### 정의

Data 메시지는 `data` 키만 포함하는 메시지이다. 앱의 메시지 핸들러가 직접 모든 처리를 담당하며, 시스템은 자동으로 알림을 표시하지 않는다.

#### 페이로드 구조

```typescript
const dataMessage = {
  token: 'device_token',
  data: {
    type: 'chat_message',
    senderId: 'user_123',
    senderName: '김철수',
    content: '안녕하세요',
    timestamp: '1710820800000',
    chatRoomId: 'room_456',
    // 모든 값은 문자열이어야 한다
  },
  android: {
    priority: 'high' as const,         // Doze 바이패스
    ttl: 86400000,
  },
  apns: {
    headers: {
      'apns-priority': '5',            // Silent push
    },
    payload: {
      aps: {
        'content-available': 1,         // Background 수신 활성화
      },
    },
  },
};
```

#### 핵심 특성

| 특성 | 설명 |
|------|------|
| 앱 직접 처리 | 모든 상태에서 앱의 메시지 핸들러가 호출된다 (예외 있음) |
| Non-collapsible | 기본적으로 개별 전달이며, 이전 메시지를 대체하지 않는다 |
| 값 형식 | 모든 키-값 쌍은 문자열(String)이어야 한다 |
| 크기 제한 | 4,096 bytes (4KB) |

#### 플랫폼별 결정적 제약 사항

Data 메시지의 가장 중요한 특성은 플랫폼 및 앱 상태에 따른 수신 가능 여부이다 [^7]:

| 플랫폼 | 앱 상태 | 수신 여부 | 비고 |
|--------|---------|----------|------|
| **Android** | Foreground | 수신 가능 | `onMessageReceived()` 호출 |
| **Android** | Background | 수신 가능 | `onMessageReceived()` 호출 |
| **Android** | Force-stopped | **수신 불가** | 메시지가 완전히 드롭된다 |
| **iOS** | Foreground | 수신 가능 | 콜백 호출 |
| **iOS** | Background | **제한적** | `content-available:1` 필요, 시간당 2~3건 스로틀링 [^8] |
| **iOS** | Suspended/Terminated | **심각한 스로틀링** | 전달되지 않을 가능성이 높다 |

이 제약은 FCM의 QoS에 직접적 영향을 미치며, 실험 설계에서 반드시 통제해야 하는 변수이다.

---

### 2.3 Combined 메시지 (Notification + Data)

#### 정의

Combined 메시지는 `notification`과 `data` 키를 모두 포함하는 메시지이다. 두 유형의 장점을 결합하려는 의도이나, 앱 상태에 따라 data 접근성에 중요한 차이가 발생한다.

#### 페이로드 구조

```typescript
const combinedMessage = {
  token: 'device_token',
  notification: {
    title: '주문 배송 출발',
    body: '주문하신 상품이 배송을 시작했습니다.',
  },
  data: {
    orderId: 'ORD-2026-001',
    trackingNumber: 'CJ1234567890',
    estimatedDelivery: '2026-03-20',
    deepLink: '/orders/ORD-2026-001/tracking',
  },
  android: {
    priority: 'high' as const,
  },
  apns: {
    headers: { 'apns-priority': '10' },
    payload: {
      aps: {
        alert: {
          title: '주문 배송 출발',
          body: '주문하신 상품이 배송을 시작했습니다.',
        },
        badge: 1,
        sound: 'default',
      },
    },
  },
};
```

#### 앱 상태별 동작 차이 (결정적 특성)

| 플랫폼 | 앱 상태 | notification 처리 | data 접근 |
|--------|---------|------------------|----------|
| **Android** | Foreground | `onMessageReceived()`에서 접근 | `onMessageReceived()`에서 접근 |
| **Android** | Background | 시스템 트레이 자동 표시 | **사용자가 알림 탭 시에만** Intent extras로 접근 |
| **Android** | Killed | 시스템 트레이 자동 표시 | **사용자가 알림 탭 시에만** Intent extras로 접근 |
| **iOS** | Foreground | 콜백에서 접근 | 콜백에서 접근 |
| **iOS** | Background | 시스템이 알림 표시 | **사용자가 알림 탭 시에만** 접근 |
| **iOS** | Terminated | 시스템이 알림 표시 | **사용자가 알림 탭 시에만** 접근 |

**핵심 주의사항**: Background/Killed 상태에서 사용자가 알림을 탭하지 않으면 data 부분에 접근할 수 없다. 이는 data 처리가 비즈니스 로직에 필수적인 경우 심각한 문제가 된다.

---

### 2.4 메시지 유형 비교 요약

| 항목 | Notification | Data | Combined |
|------|-------------|------|----------|
| 자동 알림 표시 | Background/Killed 시 자동 | 불가 | Background/Killed 시 자동 |
| 앱 코드 처리 | Foreground에서만 | 항상 (예외 있음) | Foreground에서만 완전 접근 |
| Collapsible | 항상 | 선택적 | 항상 (notification 포함) |
| Force-stopped(Android) | 시스템 트레이 표시 | **드롭** | notification만 표시 |
| iOS Background | 시스템 표시 | 스로틀링 | 시스템 표시 |
| 적합 용도 | 단순 표시형 알림 | 앱 로직 트리거 | 표시 + 부가 데이터 |

---

## 3. 앱 상태별 동작 차이 상세 분석

앱 상태는 FCM 메시지 수신 동작에 가장 큰 영향을 미치는 변수이다. 각 상태별 동작을 플랫폼별로 상세히 분석한다.

### 3.1 Android 앱 상태별 동작

#### 3.1.1 Foreground (활성 상태)

앱이 사용자에게 보이는 상태(Activity가 resumed 상태)이다.

```kotlin
// Android — Foreground 수신 처리
class MyFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        // Foreground에서는 모든 메시지 유형이 이 콜백으로 전달된다

        // Notification 메시지
        remoteMessage.notification?.let { notification ->
            // 시스템이 자동 표시하지 않음 — 앱이 직접 처리해야 한다
            showCustomNotification(notification.title, notification.body)
        }

        // Data 메시지
        if (remoteMessage.data.isNotEmpty()) {
            processData(remoteMessage.data)
        }
    }
}
```

| 메시지 유형 | 동작 | 비고 |
|-----------|------|------|
| Notification | `onMessageReceived()` 호출 | 자동 표시 없음, 앱이 직접 표시해야 한다 |
| Data | `onMessageReceived()` 호출 | 모든 데이터 접근 가능 |
| Combined | `onMessageReceived()` 호출 | notification + data 모두 접근 가능 |

#### 3.1.2 Background (백그라운드 상태)

앱 프로세스는 존재하나 사용자에게 보이지 않는 상태이다.

| 메시지 유형 | 동작 | 비고 |
|-----------|------|------|
| Notification | 시스템 트레이 자동 표시 | 탭 시 런처 Activity로 전달 |
| Data | `onMessageReceived()` 호출 | **앱 코드가 직접 처리** |
| Combined | 알림은 시스템 표시, data는 Intent extras | **탭해야 data 접근 가능** |

#### 3.1.3 Killed/Force-stopped (종료 상태)

사용자가 최근 앱 목록에서 스와이프하거나 설정에서 강제 종료한 상태이다. 이 상태는 Android에서 가장 문제가 되는 상태이다 [^7].

| 메시지 유형 | 동작 | 비고 |
|-----------|------|------|
| Notification | 시스템 트레이 자동 표시 | 탭 시 앱 실행 |
| Data | **수신 불가 (드롭)** | FCM이 전달해도 앱이 처리할 수 없다 |
| Combined | notification만 표시 | data는 탭 시 Intent extras |

**Data 메시지 드롭의 기술적 원인**: Android의 Force-stopped 상태에서는 `FLAG_EXCLUDE_STOPPED_PACKAGES` 플래그에 의해 브로드캐스트 수신이 차단된다. FCM SDK의 `FirebaseMessagingService`도 브로드캐스트 기반이므로 Data 메시지를 수신할 수 없다. Notification 메시지는 시스템 레벨에서 처리되므로 이 제한의 영향을 받지 않는다.

#### 3.1.4 OEM 배터리 최적화에 의한 의사(pseudo) Killed 상태

Samsung OneUI, Xiaomi MIUI, Oppo ColorOS 등의 OEM 스킨은 자체적인 배터리 최적화 정책으로 앱 프로세스를 종료하며, 이는 사실상 Force-stopped와 동일한 효과를 가져온다 [^9].

| OEM | 기능명 | 영향 |
|-----|--------|------|
| Samsung | 적응형 배터리 / 앱 절전 | Background 앱 자동 종료, Data 메시지 드롭 |
| Xiaomi | 배터리 세이버 / 자동 시작 관리 | 자동 시작 차단 시 모든 FCM 수신 불가 |
| Oppo/Vivo | 스마트 파워 세이버 | 2주 내 전달률 급감 보고 [^9] |

이 상태에서의 전달률은 UNSTABLE-08 실험에서 측정한다.

---

### 3.2 iOS 앱 상태별 동작

#### 3.2.1 Foreground (활성 상태)

```swift
// iOS — Foreground 수신 처리
extension AppDelegate: MessagingDelegate, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler:
            @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo
        // Foreground에서는 알림이 자동 표시되지 않는다
        // completionHandler로 표시 방법을 지정해야 한다
        completionHandler([.banner, .sound, .badge])
    }
}
```

| 메시지 유형 | 동작 | 비고 |
|-----------|------|------|
| Notification | 콜백 수신 (자동 표시 안됨) | `completionHandler`로 표시 제어 |
| Data | 콜백 수신 | 모든 데이터 접근 가능 |
| Combined | 콜백에서 모두 접근 | notification + data 접근 가능 |

#### 3.2.2 Background (백그라운드 상태)

| 메시지 유형 | 동작 | 비고 |
|-----------|------|------|
| Notification | 시스템이 알림 표시 | 탭 시 앱 실행 |
| Data (Silent) | `content-available:1` 필요 | **시간당 약 2~3건 스로틀링** [^8] |
| Combined | 알림 표시, data는 탭 시 접근 | 탭하지 않으면 data 처리 불가 |

**iOS Silent Push 스로틀링의 기술적 배경**: Apple은 시스템 자원 보호를 위해 `content-available` 기반 Background 업데이트 빈도를 제한한다. 정확한 임계값은 공개되지 않았으나, 개발자 커뮤니티의 관측 결과 시간당 2~3건으로 보고되고 있다. 배터리 잔량, 디바이스 온도, 앱 사용 패턴 등에 따라 더 엄격하게 스로틀링될 수 있다.

#### 3.2.3 Suspended/Terminated (일시 정지/종료 상태)

| 메시지 유형 | 동작 | 비고 |
|-----------|------|------|
| Notification | 시스템이 알림 표시 | 탭 시 앱 실행 |
| Data (Silent) | **심각한 스로틀링** | 전달되지 않을 가능성이 높다 |
| Combined | 알림 표시 | data는 탭 시 접근 |

**주요 차이점 (vs Android)**: iOS에서는 사용자가 앱을 스와이프 종료해도 Notification 메시지는 정상 수신된다. 이는 APNs가 OS 레벨에서 처리하기 때문이다. 그러나 Silent Push(Data only)는 앱이 스와이프 종료된 경우 `application(_:didReceiveRemoteNotification:)` 콜백이 호출되지 않는다.

---

### 3.3 앱 상태별 수신 가능성 종합 매트릭스

```
         ┌───────────────────────────────────────────────────────┐
         │        메시지 수신 가능 여부 매트릭스                     │
         ├──────────┬────────┬────────┬────────┬────────┬────────┤
         │          │ Notif  │ Data   │ Comb-N │ Comb-D │ Silent │
         │          │        │        │ (표시)  │ (데이터)│ (iOS)  │
  Android├──────────┼────────┼────────┼────────┼────────┼────────┤
         │ FG       │  ✓     │  ✓     │  ✓     │  ✓     │  N/A   │
         │ BG       │  ✓(자동)│  ✓     │  ✓(자동)│  △(탭)  │  N/A   │
         │ Killed   │  ✓(자동)│  ✗     │  ✓(자동)│  △(탭)  │  N/A   │
  iOS    ├──────────┼────────┼────────┼────────┼────────┼────────┤
         │ FG       │  ✓     │  ✓     │  ✓     │  ✓     │  ✓     │
         │ BG       │  ✓(자동)│  N/A   │  ✓(자동)│  △(탭)  │  △(제한)│
         │ Terminated│ ✓(자동)│  N/A   │  ✓(자동)│  △(탭)  │  ✗(*)  │
         └──────────┴────────┴────────┴────────┴────────┴────────┘

  ✓ : 수신 가능   ✗ : 수신 불가   △ : 조건부 수신
  (*) : 심각한 스로틀링으로 사실상 불가
```

---

## 4. 전송 시나리오별 신뢰성 특성

### 4.1 전송 시나리오 × 메시지 유형 신뢰성 매트릭스

| 전송 시나리오 | Notification | Data | Combined |
|-------------|-------------|------|----------|
| **Unicast** | 높음 (시스템 처리) | 중간 (앱 상태 의존) | 높음 (표시) / 중간 (data) |
| **Multicast** | 높음 | 중간 | 높음 / 중간 |
| **Topic** | 높음 | 중간 | 높음 / 중간 |
| **Condition** | 높음 | 중간 | 높음 / 중간 |

### 4.2 시나리오별 QoS 영향 요인

| 시나리오 | 주요 위험 요인 | 영향 지표 |
|----------|-------------|----------|
| Unicast | 토큰 무효화 | M1 (전송 성공률) |
| Multicast | 부분 실패, Rate Limit | M1, M5 (복구 시간) |
| Topic (대규모) | 팬아웃 지연, Rate Limit | M2 (지연시간), M8 (처리량) |
| Condition | 조건 평가 지연 | M2 (지연시간) |

### 4.3 실무 시나리오 선택 가이드

```
                    전송 대상 수
                    │
        ┌───────────┤───────────┐
        │           │           │
     1~10명      10~1만명     1만명 이상
        │           │           │
   Unicast      Multicast     Topic
   (개인 알림)    (세그먼트)    (브로드캐스트)
        │           │           │
        ▼           ▼           ▼
   토큰 직접    500건 배치    서버 토큰
   관리 필요    분할 필요     관리 불필요
```

| 사용 사례 | 권장 시나리오 | 권장 메시지 유형 | 이유 |
|----------|-------------|----------------|------|
| 1:1 채팅 알림 | Unicast | Data | 앱이 직접 알림 커스터마이징 필요 |
| 주문 상태 변경 | Unicast | Combined | 표시 보장 + 추적 데이터 |
| 마케팅 캠페인 | Topic | Notification | 대량 전송, 단순 표시 |
| 긴급 공지 | Topic (HIGH) | Notification | 최대 도달률 필요 |
| 데이터 동기화 | Unicast | Data (collapse) | 최신 상태만 필요 |
| 카테고리별 뉴스 | Condition | Combined | 다중 관심사 타겟팅 |

---

## 5. 플랫폼별 전송 특성

### 5.1 Android 전용 옵션

```typescript
const androidSpecific = {
  android: {
    priority: 'high',              // 'high' | 'normal'
    ttl: 86400000,                 // 밀리초 단위
    collapseKey: 'status_update',  // 최대 4개 동시 저장
    restrictedPackageName: 'com.example.app',
    directBootOk: false,           // Direct Boot 모드 허용 여부
    notification: {
      channelId: 'important_channel',
      tag: 'unique_tag',           // 알림 그룹핑
      defaultSound: true,
      defaultVibrateTimings: true,
      visibility: 'PUBLIC',        // PUBLIC | PRIVATE | SECRET
    },
  },
};
```

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `priority` | `normal` | `high` 설정 시 Doze 모드를 바이패스한다 |
| `ttl` | 28일 | 0 설정 시 즉시 전달 불가하면 폐기한다 |
| `collapseKey` | 없음 | 설정 시 동일 키의 미전달 메시지를 대체한다 |
| `restrictedPackageName` | 없음 | 특정 패키지에만 전달을 제한한다 |
| `directBootOk` | `false` | 디바이스 부팅 중(잠금 해제 전) 전달 허용 여부 |

### 5.2 iOS(APNs) 전용 옵션

```typescript
const iosSpecific = {
  apns: {
    headers: {
      'apns-priority': '10',       // '10' (즉시) | '5' (절전) | '1' (Silent)
      'apns-expiration': '0',      // 0이면 즉시 전달 불가 시 폐기
      'apns-collapse-id': 'status', // collapse 식별자
      'apns-push-type': 'alert',   // 'alert' | 'background' | 'voip'
      'apns-topic': 'com.example.app',
    },
    payload: {
      aps: {
        alert: { title: '제목', body: '본문' },
        badge: 1,
        sound: 'default',
        'thread-id': 'chat_room_1', // 알림 그룹핑
        'interruption-level': 'time-sensitive', // iOS 15+
        'relevance-score': 1.0,     // 알림 요약 우선순위
        'content-available': 1,     // Silent push 활성화
        'mutable-content': 1,       // Notification Service Extension
      },
    },
    fcmOptions: {
      image: 'https://example.com/image.png',
    },
  },
};
```

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `apns-priority` | `10` | `5`로 설정 시 배터리 최적화 고려 전달 |
| `interruption-level` | `active` | `time-sensitive` 설정 시 집중 모드를 바이패스한다 |
| `content-available` | 미설정 | 설정 시 Silent push로 Background 수신 활성화 |
| `mutable-content` | 미설정 | 설정 시 Notification Service Extension에서 가공 가능 |
| `thread-id` | 없음 | 동일 thread-id 알림을 그룹으로 묶는다 |

---

## 6. 고급 전송 시나리오

### 6.1 Collapsible vs Non-Collapsible 전략

#### Collapsible 메시지

동일한 collapse key를 가진 미전달 메시지 중 최신 것만 유지하는 방식이다. 디바이스가 오프라인일 때 동일 키의 메시지가 여러 번 전송되면, FCM은 가장 최근 메시지만 저장한다.

```typescript
// Collapsible 메시지 예시 — 실시간 점수 업데이트
const scoreUpdate = {
  token: 'device_token',
  data: {
    matchId: 'match_2026_final',
    score: '2-1',
    minute: '78',
  },
  android: {
    collapseKey: 'score_match_2026_final',  // 동일 키 → 최신만 유지
    ttl: 0,  // 즉시 전달 불가 시 폐기 (최신 점수만 의미)
  },
};
```

#### Non-Collapsible 메시지

모든 메시지를 개별적으로 전달하는 방식이다. 디바이스당 최대 100건까지 저장되며, 100건을 초과하면 **전체가 삭제**된다 [^6].

```typescript
// Non-Collapsible 메시지 예시 — 채팅 메시지
const chatMessage = {
  token: 'device_token',
  data: {
    type: 'chat',
    messageId: 'msg_789',
    content: '안녕하세요',
    senderId: 'user_123',
  },
  // collapseKey 미설정 → Non-collapsible
};
```

| 특성 | Collapsible | Non-Collapsible |
|------|------------|----------------|
| 오프라인 시 저장 | collapse key별 4건 | 디바이스당 100건 |
| 100건 초과 시 | 해당 없음 | **전체 삭제** + `onDeletedMessages()` |
| 적합 용도 | 상태 동기화, 점수 업데이트 | 채팅, 트랜잭션 알림 |
| 스로틀링 | 버스트 20건, 리필 3분/1건 | 없음 |

### 6.2 우선순위 전략

```
                  메시지 긴급도
                      │
          ┌───────────┤───────────┐
          │           │           │
       즉시 필요    적시 전달    지연 허용
          │           │           │
       HIGH        NORMAL      NORMAL
   (Doze 바이패스)  (기본)    (TTL 활용)
          │           │           │
          ▼           ▼           ▼
   결제, 보안     일반 알림     마케팅
   인증 코드      뉴스 속보     프로모션
```

**HIGH 우선순위 사용 시 주의사항**: Android에서 HIGH 우선순위 메시지는 반드시 사용자에게 보이는 알림을 생성해야 한다. 7일간 지속적으로 보이는 알림을 생성하지 않으면 FCM이 자동으로 NORMAL로 강등한다 [^10].

---

## 7. 시나리오별 실험 설계 연계

본 문서에서 분석한 각 시나리오는 실험 설계(04-experiment-design.md)의 다음 실험과 직접 연계된다:

| 시나리오 | 관련 실험 | 측정 초점 |
|----------|----------|----------|
| 단일 디바이스 × 3 메시지 유형 × 3 앱 상태 | EXP-S05 | 앱 상태별 수신 가능 여부 확인 |
| 토픽 전송 (소규모) | EXP-S03 | 팬아웃 지연 기준선 |
| Collapsible (적정 빈도) | EXP-S04 | 스로틀링 미발생 조건 확인 |
| Collapsible (과빈도) | EXP-U07 | 스로틀링 임계점 측정 |
| Non-Collapsible 100건 한도 | EXP-U05 | 전체 삭제 동작 확인 |
| Android Force-stopped + Data | EXP-U08 | OEM별 드롭률 측정 |
| iOS Silent Push 스로틀링 | EXP-U11 | 스로틀링 임계점 측정 |

---

## 참고 문헌

[^1]: Firebase, "Send messages to specific devices," https://firebase.google.com/docs/cloud-messaging/send-message — 단일 디바이스 전송 API

[^2]: Firebase, "Send messages to multiple devices," https://firebase.google.com/docs/cloud-messaging/send-message#send-messages-to-multiple-devices — Multicast 전송, 500개 토큰 제한

[^3]: Firebase, "Send messages to topics," https://firebase.google.com/docs/cloud-messaging/topic-messaging — 토픽 전송, 조건부 전송, 토픽 구독 관리

[^4]: Firebase, "Best practices for sending FCM messages at scale," https://firebase.google.com/docs/cloud-messaging/scale-fcm — 팬아웃 제한 (1,000개 동시, 10,000 QPS)

[^5]: Firebase, "Set message type," https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type — Notification/Data/Combined 메시지 유형 정의

[^6]: Firebase, "Collapsible message types," https://firebase.google.com/docs/cloud-messaging/customize-messages/collapsible-message-types — Collapsible vs Non-collapsible, 100건 한도

[^7]: Firebase, "Receive messages in an Android app," https://firebase.google.com/docs/cloud-messaging/android/receive-messages — Android 앱 상태별 메시지 처리 동작, Force-stopped 드롭

[^8]: Apple Developer Forums, "Silent Push Throttling," https://developer.apple.com/forums/thread/47901 — iOS Silent push 시간당 2~3건 스로틀링

[^9]: DontKillMyApp.com, https://dontkillmyapp.com/ — OEM별 배터리 최적화 정책 및 앱 종료 동작 비교

[^10]: Firebase, "Set and manage Android message priority," https://firebase.google.com/docs/cloud-messaging/android-message-priority — HIGH/NORMAL 우선순위, 7일 자동 강등

[^11]: Firebase, "FCM HTTP v1 API reference," https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages — HTTP v1 API 전체 페이로드 스키마

[^12]: Firebase, "Setting message lifespan (TTL)," https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan — TTL 설정, TTL=0 동작

[^13]: G. Albertengo, F.G. Debele, W. Hassan, D. Stramandino, "On the Performance of Web Services, Google Cloud Messaging and Firebase Cloud Messaging," *Digital Communications and Networks*, Vol. 6, Issue 1, pp. 31-37, 2019. DOI: 10.1016/j.dcan.2019.02.002 — FCM 전송 지연 벤치마크
