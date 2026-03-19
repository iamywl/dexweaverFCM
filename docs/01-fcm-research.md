# FCM(Firebase Cloud Messaging) 기술 조사 보고서

> 작성일: 2026-03-18
> 목적: FCM의 내부 동작 원리, 사용 방법, 한계를 정확히 이해하여 실험 설계 및 개발 계획의 근거로 삼는다.

---

## 1. FCM 아키텍처 개요

### 1.1 핵심 구성 요소

```
┌─────────────┐     HTTPS POST      ┌──────────────────┐
│  App Server  │ ──────────────────→ │   FCM Backend    │
│ (Firebase    │  HTTP v1 API        │ (메시지 수락,     │
│  Admin SDK)  │                     │  팬아웃, 라우팅)  │
└─────────────┘                      └────────┬─────────┘
                                              │
                                    ┌─────────┴─────────┐
                                    │                    │
                              ┌─────▼──────┐     ┌──────▼──────┐
                              │  Android    │     │   APNs      │
                              │  Transport  │     │  (Apple)    │
                              │  Layer(ATL) │     │             │
                              └─────┬──────┘     └──────┬──────┘
                                    │                    │
                              ┌─────▼──────┐     ┌──────▼──────┐
                              │  Android   │     │   iOS       │
                              │  Device    │     │   Device    │
                              │ (GMS 필수)  │     │             │
                              └────────────┘     └─────────────┘
```

### 1.2 메시지 전송 흐름 (단계별)

| 단계 | 설명 | 소요 주체 |
|------|------|----------|
| 1 | 앱 서버가 FCM HTTP v1 API에 POST 요청 | 앱 서버 |
| 2 | FCM Backend가 메시지를 수락, 메시지 ID 발급 | FCM |
| 3 | 팬아웃 처리 (토픽/그룹인 경우 개별 디바이스로 분해) | FCM |
| 4 | 플랫폼별 전송 계층으로 라우팅 (ATL 또는 APNs) | FCM |
| 5 | 디바이스가 온라인이면 즉시 전달, 오프라인이면 큐에 저장 | 플랫폼 |
| 6 | 클라이언트 SDK가 수신하여 처리 | 디바이스 |

**핵심 포인트**: 2단계에서 받는 HTTP 200 + message ID는 **FCM이 수락했다는 의미이지, 디바이스에 도달했다는 의미가 아니다.**

### 1.3 iOS에서의 특수성

- FCM은 iOS에서 직접 푸시를 보내지 않는다
- FCM → APNs로 메시지를 변환/프록시하여 전달
- 따라서 iOS 푸시 신뢰성은 **Apple 인프라에 종속**
- APNs 인증서 또는 APNs Auth Key 설정이 필수

---

## 1.5 FCM의 안전성 특장점 (Safety Advantages)

FCM을 선택하는 이유이자, FCM이 기본 제공하는 안전 메커니즘:

| 특장점 | 상세 | 근거 |
|--------|------|------|
| **전송 중 암호화** | 서버↔FCM↔디바이스 간 TLS 암호화 적용 | FCM 아키텍처 문서 [^a1] |
| **OAuth2 인증** | HTTP v1 API는 단기 만료(~1시간) OAuth2 토큰 사용, 고정 API 키보다 안전 | Legacy API의 고정 Server Key 방식 대비 보안 강화 [^a2] |
| **플랫폼 공식 지원** | Google(Android ATL) + Apple(APNs 프록시) 공식 전송 계층 사용 | 비공식 채널 대비 안정성/호환성 보장 |
| **자동 토큰 갱신** | FCM SDK가 토큰 갱신을 자동 처리, 개발자는 콜백만 구현 | Firebase Messaging SDK 문서 |
| **크로스플랫폼 단일 API** | 하나의 HTTP v1 API로 Android/iOS/Web 모두 전송 가능 | 플랫폼별 개별 구현 불필요 [^a2] |
| **토픽/그룹 기반 팬아웃** | 서버가 개별 토큰을 관리하지 않아도 토픽 구독만으로 브로드캐스트 가능 | FCM Topic Messaging 문서 [^a3] |
| **FCM Data API** | 전송 상태 7가지 카테고리로 모니터링 가능 (Delivered, Pending, TTL Expired 등) | [^a4] |
| **무료** | 전송량 무관하게 무료 (할당량 내) | Firebase 가격 정책 |
| **오프라인 저장** | 디바이스 오프라인 시 최대 28일간 메시지 큐잉 | FCM TTL 문서 [^a5] |

**주의**: FCM은 **종단 간 암호화(E2E)를 제공하지 않는다**. 전송 중 암호화만 적용되며, FCM 서버는 페이로드를 읽을 수 있다. 민감 데이터는 앱 레벨에서 별도 암호화해야 한다.

[^a1]: https://firebase.google.com/docs/cloud-messaging/fcm-architecture
[^a2]: https://firebase.google.com/docs/cloud-messaging/send/v1-api
[^a3]: https://firebase.google.com/docs/cloud-messaging/topic-messaging
[^a4]: https://firebase.google.com/docs/cloud-messaging/understand-delivery
[^a5]: https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan

---

## 2. API 버전

### 2.1 HTTP v1 API (현재 권장)

- **엔드포인트**: `POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send`
- **인증**: OAuth2 단기 액세스 토큰 (서비스 계정 기반, ~1시간 만료)
- **페이로드**: 플랫폼별 블록 (`android`, `apns`, `webpush`) 지원
- **장점**: 플랫폼별 세밀한 커스터마이징 가능

### 2.2 Legacy API (폐기됨)

- 2023년 6월 20일 deprecated
- 2024년 7월 22일부터 shutdown 시작
- 고정 Server Key 인증 방식 → 보안 취약
- **신규 프로젝트에서는 절대 사용하지 않는다**

---

## 3. 메시지 유형

### 3.1 세 가지 유형

| 유형 | 키 | 특징 |
|------|-----|------|
| **Notification** | `notification` | 미리 정의된 키(title, body, image 등), 시스템이 자동 표시 |
| **Data** | `data` | 커스텀 키-값 쌍만, 앱이 직접 처리 |
| **Combined** | `notification` + `data` | 두 유형 결합 |

### 3.2 플랫폼/앱 상태별 동작 차이 (매우 중요)

#### Android

| 앱 상태 | Notification 메시지 | Data 메시지 | Combined 메시지 |
|---------|-------------------|------------|----------------|
| **Foreground** | `onMessageReceived()` 호출 | `onMessageReceived()` 호출 | `onMessageReceived()`에서 둘 다 접근 가능 |
| **Background** | 시스템 트레이 자동 표시 | `onMessageReceived()` 호출 | 알림은 시스템 트레이, data는 인텐트 extras (탭 시에만 접근) |
| **Killed/Force-stopped** | 시스템 트레이 자동 표시 | **수신 불가 (드롭됨)** | 알림은 시스템 트레이, data는 인텐트 extras (탭 시) |

#### iOS

| 앱 상태 | Notification 메시지 | Data 메시지 | Combined 메시지 |
|---------|-------------------|------------|----------------|
| **Foreground** | 콜백 수신 (자동 표시 안됨) | 콜백 수신 | 콜백에서 둘 다 접근 가능 |
| **Background** | 시스템이 알림 표시 | `content-available:true` 필요, iOS 스로틀링 적용 | 알림 표시, data는 탭 시 접근 |
| **Suspended/Terminated** | 시스템이 알림 표시 | 심각한 스로틀링, 전달 안될 수 있음 | 알림 표시, data는 탭 시 |

**결정적 차이점**:
- Android Force-stopped 상태에서 Data 메시지는 **완전히 드롭**됨
- iOS Silent Notification(data only)은 시간당 **약 2~3회로 스로틀링**됨
- Combined 메시지의 data 부분은 사용자가 알림을 **탭해야만** 접근 가능

---

## 4. FCM 토큰 생명주기

### 4.1 토큰 생성

- 앱 최초 실행 시 FCM SDK가 등록 토큰 자동 생성
- 토큰 = 특정 디바이스의 특정 앱 인스턴스를 고유 식별

### 4.2 토큰 갱신이 발생하는 경우

| 이벤트 | 설명 |
|--------|------|
| 새 디바이스에 앱 복원 | 백업 복원 시 |
| 앱 재설치 | 삭제 후 재설치 |
| 앱 데이터 삭제 | 설정에서 캐시/데이터 삭제 |
| FCM 자체 만료 | 비활성 270일 이후 |
| iOS APNs 토큰 변경 | APNs 토큰이 바뀌면 FCM 토큰도 갱신 |

### 4.3 토큰 무효화 감지

| FCM 응답 | HTTP 코드 | 의미 | 조치 |
|----------|----------|------|------|
| `UNREGISTERED` | 404 | 토큰 더 이상 유효하지 않음 | **즉시 서버에서 삭제** |
| `INVALID_ARGUMENT` | 400 | 토큰 형식 자체가 잘못됨 | **즉시 서버에서 삭제** |
| `SENDER_ID_MISMATCH` | 403 | 다른 Firebase 프로젝트의 토큰 | **즉시 서버에서 삭제** |

### 4.4 토큰 관리 핵심 수치

- **30일 이상 비활성 토큰**: stale로 간주, 정리 권장
- **270일 비활성**: FCM이 자동 만료 처리
- **토큰 미관리 시**: 전체 메시지의 **약 15%가 비활성 디바이스로 드롭**됨

---

## 5. FCM의 전달 보장 수준

### 5.1 공식 보장

> **FCM은 공식적으로 어떤 전달 시맨틱(at-most-once, at-least-once, exactly-once)도 보장하지 않는다.**

- FCM은 **best-effort delivery** (최선 노력 전달)
- 메시지는 여러 이유로 **조용히 드롭**될 수 있음
- 드물게 **중복 전달**도 발생 가능
- 앱 서버에 노출되는 **수신 확인(ACK) 프로토콜이 없음**
- send 호출의 성공 응답은 "FCM이 수락함"이지 "디바이스가 수신함"이 아님

### 5.2 MQTT QoS와의 비교

| 특성 | FCM | MQTT QoS 0 | MQTT QoS 1 | MQTT QoS 2 |
|------|-----|-----------|-----------|-----------|
| 전달 보장 | Best-effort | At most once | At least once | Exactly once |
| 수신 확인 | 없음 (서버 수락만) | 없음 | PUBACK | 4단계 핸드셰이크 |
| 중복 제거 | **없음** | N/A | 없음 | 보장 |
| 순서 보장 | **없음** | Best-effort | 조건부 | 보장 |
| 재시도 | 오프라인 시 TTL까지 저장 | 없음 | 자동 | 자동 |

**결론: FCM ≈ MQTT QoS 0 + 오프라인 저장(TTL)**

---

## 6. FCM 제한 사항 및 할당량

### 6.1 메시지 크기

| 항목 | 제한 |
|------|------|
| Notification 페이로드 | **4,096 bytes (4KB)** |
| Data 페이로드 | **4,096 bytes (4KB)** |
| Firebase 콘솔 | 1,000자 |

- 종단 간 암호화 **미지원** — 전송 중 암호화만 (FCM 서버가 페이로드 읽기 가능)

### 6.2 전송 속도 제한

| 범위 | 제한 |
|------|------|
| **프로젝트 당** | 600,000 메시지/분 (기본), 최대 +25% 증설 가능 |
| **Android 단일 디바이스** | 240 메시지/분, 5,000 메시지/시간 |
| **iOS 단일 디바이스** | APNs 제한 적용 (구체적 수치 비공개) |

### 6.3 Collapsible 메시지 스로틀링

| 항목 | 수치 |
|------|------|
| 버스트 한도 | 디바이스당 앱당 **20건** |
| 리필 속도 | **3분에 1건** |
| TTL=0 메시지 | 스로틀링 **바이패스** |

### 6.4 토픽 제한

| 항목 | 제한 |
|------|------|
| 앱 인스턴스당 토픽 구독 | 최대 **2,000개** |
| 토픽당 구독자 | **무제한** |
| 배치 구독 요청 | 요청당 최대 **1,000개** 앱 인스턴스 |
| 구독/해제 속도 | 프로젝트당 **3,000 QPS** |

### 6.5 팬아웃 제한

| 항목 | 제한 |
|------|------|
| 동시 팬아웃 | 프로젝트당 **1,000개** (조정 불가) |
| 팬아웃 속도 | **10,000 QPS** |
| 100만 구독자 토픽 전송 | 최소 **약 100초** 소요 |

---

## 7. 메시지 수명 (TTL) 및 Collapse

### 7.1 TTL (Time to Live)

| 항목 | 값 |
|------|-----|
| 기본값 | **28일 (2,419,200초)** |
| 최대값 | 28일 |
| 최소값 | 0초 |
| TTL=0 | 즉시 전달 불가 시 폐기, collapsible 스로틀링 바이패스 |

### 7.2 Collapsible vs Non-Collapsible

| 특성 | Collapsible | Non-Collapsible |
|------|------------|----------------|
| 동작 | 같은 collapse key의 이전 미전달 메시지를 **대체** | 모든 메시지 **개별 전달** |
| 디바이스 저장 한도 | collapse key별 **4개** | 디바이스당 **100개** |
| 100개 초과 시 | N/A | **모든 저장 메시지 폐기** + `onDeletedMessages()` 콜백 |
| 용도 | 점수 업데이트, 동기화 신호 | 채팅 메시지, 중요 알림 |
| Notification 메시지 | **항상 collapsible** | — |

**주의**: Non-collapsible 메시지가 100개를 초과하면 **전체가 삭제**된다. 이는 치명적 데이터 손실로 이어질 수 있다.

---

## 8. 우선순위 시스템

### 8.1 Android

| 우선순위 | 동작 | 주의사항 |
|---------|------|---------|
| **HIGH** | Doze 모드 바이패스, 즉시 전달 시도, 디바이스 깨움 | 반드시 사용자에게 **보이는 알림**을 생성해야 함 |
| **NORMAL** (기본) | 화면 켜진 상태에서 즉시, Doze 중이면 유지보수 윈도우까지 지연 | — |

**자동 강등**: HIGH 우선순위 메시지가 7일간 지속적으로 보이는 알림을 생성하지 않으면, FCM이 **자동으로 NORMAL로 강등**시킨다.

### 8.2 iOS (APNs 매핑)

| FCM 우선순위 | APNs 우선순위 | 동작 |
|-------------|-------------|------|
| HIGH | Priority 10 | 즉시 전달, 디바이스 깨움 |
| NORMAL | Priority 5 | 배터리 최적화 고려하여 적절한 시점에 전달 |
| — | Priority 1 | Background/Silent, 심하게 스로틀링 |

---

## 9. FCM Data API — 전송 상태 카테고리

FCM이 제공하는 메시지 상태 7가지:

| 상태 | 설명 |
|------|------|
| **Delivered** | 디바이스에 전달됨 |
| **Pending** | 디바이스 오프라인, 전달 대기 중 |
| **Collapsed** | 같은 collapse key의 새 메시지에 의해 대체됨 |
| **Too Many Pending** | Non-collapsible 100개 한도 초과로 폐기됨 |
| **Force-Stopped App** | 앱이 강제 종료 상태 (Data 메시지 드롭) |
| **Inactive Device** | 비활성 디바이스로 드롭 (28일+ 오프라인) |
| **TTL Expired** | TTL 만료로 폐기됨 |

**주의**: 이 7가지 상태를 합해도 100%가 되지 않을 수 있다. 추적되지 않는 메시지 상태가 존재한다.

---

## 10. 참고 문헌

[^1]: Firebase, "FCM architectural overview," https://firebase.google.com/docs/cloud-messaging/fcm-architecture — 아키텍처, 전송 흐름, 플랫폼 전송 계층

[^2]: Firebase, "FCM HTTP v1 API," https://firebase.google.com/docs/cloud-messaging/send/v1-api — HTTP v1 엔드포인트, OAuth2 인증, 플랫폼별 페이로드

[^3]: Firebase, "Set message type," https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type — Notification/Data/Combined 메시지 유형

[^4]: Firebase, "Receive messages in an Android app," https://firebase.google.com/docs/cloud-messaging/android/receive-messages — Android 앱 상태별 메시지 처리 동작

[^5]: Firebase, "Manage FCM registration tokens," https://firebase.google.com/docs/cloud-messaging/manage-tokens — 토큰 생명주기, stale 토큰 정리, ~15% 드롭 데이터

[^6]: Firebase, "Throttling and Quotas," https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas — 프로젝트/디바이스별 Rate limit, Collapsible 스로틀링 수치

[^7]: Firebase, "Set and manage Android message priority," https://firebase.google.com/docs/cloud-messaging/android-message-priority — HIGH/NORMAL 우선순위, 7일 자동 강등

[^8]: Firebase, "Setting message lifespan (TTL)," https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan — TTL 기본값 28일, TTL=0 동작

[^9]: Firebase, "Collapsible message types," https://firebase.google.com/docs/cloud-messaging/customize-messages/collapsible-message-types — Collapsible vs Non-collapsible, 100건 한도

[^10]: Firebase, "Understanding FCM delivery rates," https://firebase.blog/posts/2024/07/understand-fcm-delivery-rates/ — FCM Data API 상태 카테고리, 전달률 분석

[^11]: Android Developers, "Optimize for Doze and App Standby," https://developer.android.com/training/monitoring-device-state/doze-standby — Doze 모드 동작, App Standby Buckets

[^12]: Firebase, "Best practices for sending FCM messages at scale," https://firebase.google.com/docs/cloud-messaging/scale-fcm — 대규모 전송 최적화, 팬아웃 제한

**학술 논문:**

[^13]: G. Albertengo, F.G. Debele, W. Hassan, D. Stramandino, "On the Performance of Web Services, Google Cloud Messaging and Firebase Cloud Messaging," *Digital Communications and Networks*, Vol. 6, Issue 1, pp. 31-37, 2019. DOI: 10.1016/j.dcan.2019.02.002 — GCM/FCM vs REST/SOAP 성능 비교

[^14]: A. Sahami Shirazi, N. Henze, T. Dingler, M. Pielot, D. Weber, A. Schmidt, "Large-Scale Assessment of Mobile Notifications," *CHI '14*, ACM, 2014. DOI: 10.1145/2556288.2557189 — 4만+ 사용자, 2억+ 알림 대규모 분석
