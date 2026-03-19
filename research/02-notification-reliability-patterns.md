# 알림 신뢰성 및 사용자 인지 보장 패턴 연구

## 목차
1. [Application-Level Delivery Confirmation (ACK)](#1-application-level-delivery-confirmation-ack)
2. [Reminder / Re-notification 전략](#2-reminder--re-notification-전략)
3. [Client-Side 알림 영속성](#3-client-side-알림-영속성)
4. [알림 피로도 방지](#4-알림-피로도-방지)
5. [산업별 Best Practices](#5-산업별-best-practices)

---

## 1. Application-Level Delivery Confirmation (ACK)

### 1.1 FCM의 한계와 App-Level ACK 필요성

FCM은 메시지 수락(accepted for delivery)만 보장하며, 실제 디바이스 도달 확인은 제공하지 않는다. FCM 서버로부터 `message_id`를 받는 것은 메시지가 "배달 대기열에 들어갔다"는 의미일 뿐, 디바이스에 도달했다는 의미가 아니다.

**FCM 제공 Delivery Funnel (Firebase Console 기준):**

| 단계 | 설명 | 플랫폼 |
|------|------|--------|
| Sends | 메시지가 delivery queue에 들어감 | 전체 |
| Received | 앱(FCM SDK 18.0.1+)에 메시지 도달 | Android만 |
| Impressions | 백그라운드에서 알림이 화면에 표시됨 | Android만 |
| Opens | 사용자가 알림을 탭하여 열음 | 전체 |

> iOS에서는 Received/Impressions 추적이 FCM 자체로는 불가능하므로, 반드시 App-Level ACK가 필요하다.

### 1.2 App-Level ACK 구현 패턴

```
[서버] --FCM Data Message--> [클라이언트 앱]
                                    |
                              onMessageReceived()
                                    |
                              알림 표시 + 로컬 저장
                                    |
                              ACK 전송 -------> [서버]
                                                  |
                                            ACK 수신 기록
                                            (미수신 시 재전송)
```

**핵심 구현 요소:**

1. **Data Message 사용**: Notification Message가 아닌 Data Message을 사용해야 앱이 foreground/background 모두에서 `onMessageReceived()` 콜백을 받을 수 있다
2. **3단계 상태 추적**:
   - `delivered`: 클라이언트가 메시지를 수신함
   - `displayed`: 알림이 사용자에게 표시됨
   - `acted_on`: 사용자가 알림을 탭하거나 관련 액션을 수행함
3. **ACK 메시지 구조 예시**:
   ```json
   {
     "message_id": "msg_12345",
     "status": "delivered",
     "timestamp": "2026-03-19T10:30:00Z",
     "device_id": "device_abc"
   }
   ```
4. **서버 측 타임아웃**: ACK가 일정 시간(예: 5분) 내에 오지 않으면 미도달로 간주하고 재전송 또는 fallback 채널 트리거

### 1.3 Firebase Analytics 연동

FCM은 Google Analytics와 통합하여 알림 추적이 가능하다:

- **자동 추적**: Firebase Notifications Console로 보낸 알림의 Opens는 자동 추적
- **Analytics Labels**: 커스텀 필터링용 메타데이터 (최대 50자, 일일 100개 고유 라벨)
- **BigQuery Export**: 개별 메시지 로그 (수락/배달 이벤트) - SDK 최소 버전: Android 20.1.0+, iOS 8.6.0+
- **데이터 지연**: Analytics 데이터는 최대 24시간 지연, FCM Data API는 5일 지연

**한계**: BigQuery Export와 Reports 탭은 Google Analytics 통합이 필수이며, Aggregated Delivery Data만 Analytics 없이 사용 가능하다.

### 1.4 권장 아키텍처: 자체 ACK 시스템

Firebase Analytics의 24시간+ 지연은 실시간 QoS 모니터링에 부적합하므로, 자체 ACK 시스템 구축을 권장한다:

```
Firestore Collection: notification_acks
├── message_id (string)
├── user_id (string)
├── sent_at (timestamp)
├── delivered_at (timestamp | null)
├── displayed_at (timestamp | null)
├── acted_at (timestamp | null)
├── ack_latency_ms (number | null)
└── retry_count (number)
```

---

## 2. Reminder / Re-notification 전략

### 2.1 Cron 기반 주기적 리마인더 시스템

미확인 알림에 대해 주기적으로 재전송하는 시스템:

```
┌─────────────────────────────────────────────┐
│           Cron Scheduler (Cloud Functions)    │
│                                               │
│  매 5분: 미수신 ACK 메시지 조회               │
│  매 30분: 미열람 알림 재전송                  │
│  매 2시간: 중요 알림 에스컬레이션 체크        │
└─────────────────────────────────────────────┘
```

**구현 전략:**
- Cloud Scheduler + Cloud Functions 조합으로 주기적 체크
- Firestore에서 `delivered_at IS NULL AND sent_at < NOW() - 5min` 조건으로 미수신 메시지 조회
- 재전송 횟수에 제한을 두어 무한 루프 방지 (최대 3회 권장)

### 2.2 에스컬레이션 래더 (Escalation Ladder)

알림이 확인되지 않을 때 점진적으로 채널을 확대하는 전략:

```
Level 1: Push Notification (즉시)
    ↓ 5분 미확인
Level 2: In-App 알림 + Push 재전송
    ↓ 30분 미확인
Level 3: Email 발송
    ↓ 2시간 미확인
Level 4: SMS 발송 (최종 수단)
```

**핵심 설계 원칙:**
- 각 채널은 독립된 큐(queue)로 격리하여 한 채널의 장애가 다른 채널에 영향을 주지 않도록 한다
- 채널별 실패 처리가 다르다: Push는 성공/실패가 즉시 결정되지만, SMS는 carrier 이슈로 재시도가 필요할 수 있다
- 사용자의 선호 채널과 시간대를 고려한 에스컬레이션

### 2.3 Notification Digest / Summary

개별 알림 대신 묶어서 전달하는 방식:

**두 가지 배칭 전략:**

| 전략 | 설명 | 적합한 경우 |
|------|------|------------|
| **시간 기반** | 고정 간격으로 요약 전송 (예: 오전 9시, 오후 6시) | 뉴스, 마케팅 |
| **이벤트 기반** | 임계값 도달 시 전송 (예: 5개 알림 누적 시) | 소셜, 협업 도구 |

**효과**: Digest 알림을 사용하는 앱은 개별 알림 대비 35% 높은 engagement rate를 보이며, opt-out rate는 28% 감소한다 (Braze 연구 결과).

### 2.4 사용자 활동 패턴 기반 Smart Timing

- 사용자별 앱 사용 시간대를 분석하여 가장 활성화된 시간에 알림 전송
- ML 기반 최적 전송 시간 예측
- 사용자가 앱을 열 때 미확인 알림을 즉시 표시하는 "이벤트 기반 배칭" 활용

---

## 3. Client-Side 알림 영속성

### 3.1 In-App Notification Inbox

Push 알림은 사용자가 dismiss하면 사라지지만, In-App Inbox는 모든 알림의 이력을 보관한다.

**아키텍처 구성:**

```
┌─────────────────────────────────────┐
│          In-App Inbox UI            │
│                                     │
│  ┌─────────┐  ┌──────────────────┐  │
│  │ Bell    │  │ Full-page Inbox  │  │
│  │ Icon +  │  │ - 필터/탭       │  │
│  │ Badge   │  │ - Read/Unread   │  │
│  │ Counter │  │ - Archive/삭제  │  │
│  └─────────┘  └──────────────────┘  │
└─────────────────────────────────────┘
         ↕ WebSocket (실시간)
┌─────────────────────────────────────┐
│         Backend / Firestore         │
│  - 알림 저장 및 상태 관리           │
│  - 읽음/안읽음 상태 동기화          │
│  - 만료 및 아카이브 정책            │
└─────────────────────────────────────┘
```

**UI 패턴 3가지:**
1. **Full-page Inbox**: 작업 중심 알림에 적합 (할 일, 승인 요청 등)
2. **Floating/Side-panel Feed**: 실시간 업데이트 표시
3. **Toast Notification**: 일시적 알림 (자동 사라짐)

### 3.2 서버-클라이언트 상태 동기화

**핵심 원칙**: 서버가 unread count의 권위(authoritative) 소스가 되어야 한다. 클라이언트 로컬에서만 관리하면 멀티 디바이스 간 불일치가 발생한다.

**동기화 흐름:**
1. 앱 실행 시: 서버에서 최신 알림 목록 + unread count 가져오기
2. 실시간: WebSocket으로 새 알림 수신 → 로컬 DB 저장 + UI 업데이트
3. 사용자 액션 시: 읽음 처리 → 서버에 상태 업데이트 → 다른 디바이스에 동기화
4. 오프라인 시: 로컬 DB에 상태 변경 저장 → 온라인 복귀 시 서버에 배치 동기화

### 3.3 Unread Badge 관리

**문제점**: Badge 숫자와 실제 앱 내 미읽음 수가 불일치하는 경우가 빈번하다 (예: Badge에 2개, 앱 내에 5개).

**해결 전략:**
- 서버에서 사용자별 unread count를 관리하고, Push Payload에 badge 숫자를 포함하여 전송
- 앱이 열릴 때 서버에서 정확한 count를 받아 badge 갱신
- Service Worker에서 `navigator.setAppBadge()` API 활용 (PWA)
- 로컬에 badge counter를 캐싱하여 delivery 실패 시 다음 기회에 재전송

### 3.4 Offline-First 알림 저장

**Android:**
- **Room DB**: 구조화된 알림 데이터 저장에 적합 (SQLite 기반)
- **SharedPreferences**: 단순한 설정값 (마지막 읽은 시간 등) 저장

**데이터 모델 예시:**
```kotlin
@Entity(tableName = "notifications")
data class NotificationEntity(
    @PrimaryKey val id: String,
    val title: String,
    val body: String,
    val type: String,
    val receivedAt: Long,
    val readAt: Long? = null,
    val actedAt: Long? = null,
    val synced: Boolean = false  // 서버 동기화 여부
)
```

**오프라인 → 온라인 동기화:**
- 읽음 처리한 알림 ID를 로컬에 저장
- 온라인 복귀 시 서버에 배치 업데이트
- 서버 ACK 수신 후 로컬 synced 플래그 갱신

---

## 4. 알림 피로도 방지

### 4.1 Rate Limiting & Throttling

**사용자별 빈도 제한:**
- 일일 Push 알림 상한: 3~10건 (대부분의 앱에서 10건 초과는 불필요)
- Quiet Hours 설정: 사용자 로컬 시간 기준 22:00~07:00 자동 보류
- 채널별 개별 제한: 프로모션 SMS는 일 2건, 트랜잭션 알림은 제한 없음

**구현 예시:**
```json
{
  "user_preferences": {
    "daily_limits": {
      "promotional_limit": 2,
      "transactional_limit": -1
    },
    "quiet_hours": {
      "enabled": true,
      "start": "22:00",
      "end": "07:00",
      "timezone": "Asia/Seoul"
    }
  }
}
```

### 4.2 Priority 기반 필터링

Rate limit에 도달했을 때 우선순위가 높은 알림만 즉시 전달하고, 낮은 우선순위는 큐에 보관하거나 폐기한다.

**우선순위 분류:**

| Priority | 예시 | 처리 |
|----------|------|------|
| Critical | 보안 경고, 결제 실패 | 항상 즉시 전달, Quiet Hours 무시 |
| High | 중요 업데이트, 배송 상태 | Rate limit 내 즉시 전달 |
| Medium | 새 콘텐츠, 리마인더 | 배칭 가능, Quiet Hours 준수 |
| Low | 프로모션, 뉴스 | Digest로 묶어서 전달 |

### 4.3 사용자 선호도 관리

**연구 결과**: 포괄적인 알림 설정을 제공하는 앱은 제한적인 설정만 있는 앱 대비 opt-out rate가 43% 낮고, engagement가 31% 높다.

**제공해야 할 설정:**
- 알림 유형별 on/off (마케팅, 업데이트, 보안 등)
- 채널별 선호도 (Push, Email, SMS)
- 빈도 조절 (즉시, 일일 요약, 주간 요약)
- Quiet Hours 커스텀 설정
- 카테고리별 소리/진동 설정

### 4.4 Do Not Disturb (DND) 인식

- OS 레벨 DND 상태 감지 후 서버에 보고
- DND 중 발생한 알림은 큐에 보관 → DND 해제 시 배치 전달
- 긴급 알림(Critical)은 DND override 가능 (사용자 사전 동의 필요)

### 4.5 알림 통합 (Consolidation)

여러 알림을 하나로 묶는 전략:
- 비필수 알림을 지연시켜 일정 기간 내 추가 알림과 합침
- 예: "김철수님 외 4명이 메시지를 보냈습니다" (개별 5건 → 1건)
- 관련성이 높은 알림은 개별 전달을 유지하되, 반복적인 알림은 통합

---

## 5. 산업별 Best Practices

### 5.1 메시징 앱 (WhatsApp, Slack)

**WhatsApp의 메시지 전달 보장:**
- Persistent WebSocket 연결로 실시간 메시지 전달
- 수신 확인 (더블 체크): 디바이스가 ACK를 서버에 보냄
- 오프라인 사용자: 메시지를 offline queue/DB에 저장 → 재접속 시 모든 대기 메시지 전달
- At-least-once delivery + Idempotent storage로 중복 방지

**Slack의 Smart Notification 시스템:**
- **컨텍스트 인식 기본값**: 95% 이상의 사용자가 알림 설정을 커스텀하지 않으므로, 기본값이 핵심
- **디바이스 우선순위**: 데스크톱 활성 시 모바일 알림 억제 (중복 방지)
- **자동 전환**: 모바일 앱 설치 시 이메일 알림 자동 비활성화
- **근무시간 보호**: 주말/야간 DND 자동 적용
- **설계 철학**: "언제 알림을 보낼까?"가 아닌 "언제 사용자가 주의를 끌기 원할까?"로 접근
- **Anti-pattern 경고**: "더 많은 사용은 항상 더 나은 사용이 아니다" - 과도한 알림은 OS 레벨 알림 차단으로 이어지며, 이는 복구 불가능

### 5.2 의료/헬스케어 알림 시스템 (최고 신뢰성 요구)

**핵심 요구사항:**
- Sub-second latency: 패혈증 감지, Code Blue, 위험 검사 결과 등은 초 단위 전달 필수
- Multi-channel 동시 전달: In-app + SMS + Push + Voice
- 역할 기반 라우팅: 개인이 아닌 당직 역할(on-call role)에 알림 전달

**에스컬레이션 체인:**
```
1차: 담당 의료진 Push + In-app (즉시)
    ↓ 미확인 (30초)
2차: 같은 부서 당직의 Push + SMS
    ↓ 미확인 (2분)
3차: 상급 의료진 + 간호 스테이션 알림
    ↓ 미확인 (5분)
4차: 전체 부서 broadcast + 디지털 사이니지
```

**Alert Fatigue 문제:**
- 임상 알람의 80~99%가 조치 불필요(non-actionable)한 것으로 연구됨
- 이로 인해 진짜 중요한 알림도 무시되어 환자 안전 사고 발생
- **해결**: 알림의 정밀도를 높여 actionable alert 비율 증가

**다중 채널 중복 전달:**
- 텍스트/이메일만으로는 불충분
- 디지털 사이니지, 데스크톱 알림, 화재경보 시스템 연동 등 다중 채널 활용
- 채널 간 장애 격리 필수: 이메일 장애가 Push에 영향을 주면 안 됨

### 5.3 금융/뱅킹 트랜잭션 알림

**규제 요구사항:**
- 거래 확인 통지는 거래일 종료 전(다음 영업일 개장 전)까지 고객에게 전달되어야 함
- 전자 전송 실패 시 우편/팩스 등 대체 수단으로 반드시 전달해야 하는 의무
- SWIFT 기준: 주간 결제 트래픽의 80%를 2영업일 이내 확인 (수혜자 입금, 거부, 보류 등)

**구현 패턴:**
- 트랜잭션 알림은 프로모션 알림과 완전히 분리된 파이프라인
- 전달 실패 시 자동 fallback (Push → SMS → Email → 우편)
- 모든 전달 시도와 결과를 감사 로그에 기록 (규정 준수)
- Dead Letter Queue(DLQ)로 전달 불가 메시지 관리 → 수동 처리

### 5.4 공통 아키텍처 패턴 요약

**확장 가능한 알림 시스템의 핵심 구성:**

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   API 서버   │────>│  메시지 큐   │────>│ Channel      │
│ (알림 생성)  │     │ (Kafka/      │     │ Processors   │
│              │     │  Pub/Sub)    │     │ (Push/SMS/   │
└──────────────┘     └──────────────┘     │  Email)      │
       │                                   └──────┬───────┘
       │                                          │
       ▼                                          ▼
┌──────────────┐                          ┌──────────────┐
│ User         │                          │ Delivery     │
│ Preference   │                          │ Status DB    │
│ Service      │                          │ + ACK Log    │
└──────────────┘                          └──────────────┘
```

**설계 원칙:**
1. **At-least-once delivery**: 메시지 큐를 통한 최소 1회 전달 보장
2. **Idempotent processing**: 중복 메시지 감지 및 폐기
3. **채널 격리**: 각 채널(Push/SMS/Email)은 독립 큐로 처리하여 cascading failure 방지
4. **Exponential backoff**: 실패 시 1s → 5s → 30s 간격으로 재시도 (최대 3회)
5. **Dead Letter Queue**: 최대 재시도 초과 메시지는 DLQ로 이동하여 수동 검토
6. **Multi-tier storage**: RDB (트랜잭션 로그) + NoSQL (사용자 선호도, rate limit) + Blob (첨부파일)

---

## DexWeaver FCM QoS 프로젝트 적용 제안

위 연구 결과를 DexWeaver 프로젝트에 적용할 수 있는 우선순위별 구현 항목:

### Phase 1: 기본 신뢰성 확보
- [ ] FCM Data Message 기반 App-Level ACK 구현
- [ ] Firestore에 알림 상태 추적 컬렉션 생성 (sent/delivered/displayed/acted)
- [ ] 미수신 알림 재전송 Cloud Function 구현

### Phase 2: 사용자 경험 향상
- [ ] In-App Notification Inbox 구현 (Room DB + Firestore 동기화)
- [ ] Unread Badge 관리 (서버 기반 count)
- [ ] 사용자별 알림 선호도 설정 UI

### Phase 3: 고급 QoS 기능
- [ ] Priority 기반 알림 필터링
- [ ] Quiet Hours / DND 인식
- [ ] Notification Digest / 배칭
- [ ] 에스컬레이션 래더 (Push → Email fallback)

### Phase 4: 분석 및 최적화
- [ ] 알림 전달률/열람률 대시보드
- [ ] BigQuery Export 연동
- [ ] Smart Timing 알고리즘 (사용자 활동 패턴 분석)

---

## 참고 자료

### FCM 및 Delivery Tracking
- [Understanding message delivery - Firebase](https://firebase.google.com/docs/cloud-messaging/understand-delivery)
- [FCM Aggregated Delivery Data - Medium](https://medium.com/firebase-developers/what-is-fcm-aggregated-delivery-data-d6d68396b83b)
- [Understanding FCM Message Delivery on Android - Firebase Blog](https://firebase.blog/posts/2024/07/understand-fcm-delivery-rates/)
- [Ensure your FCM notifications reach users on Android - Firebase Blog](https://firebase.blog/posts/2025/04/fcm-on-android)
- [Life of a message from FCM to the device - Firebase Blog](https://firebase.googleblog.com/2019/02/life-of-a-message.html)

### 알림 시스템 설계
- [Design a Scalable Notification Service - AlgoMaster](https://blog.algomaster.io/p/design-a-scalable-notification-service)
- [Notification System Design - MagicBell](https://www.magicbell.com/blog/notification-system-design)
- [Top 6 Design Patterns for Notification Systems - SuprSend](https://www.suprsend.com/post/top-6-design-patterns-for-building-effective-notification-systems-for-developers)
- [How to Design a Notification System - System Design Handbook](https://www.systemdesignhandbook.com/guides/design-a-notification-system/)

### In-App Inbox 및 영속성
- [In-App Inbox Guide - DEV Community](https://dev.to/suprsend/in-app-inbox-guide-what-is-it-and-how-to-implement-in-code-44ff)
- [Infobip Mobile Push Inbox](https://www.infobip.com/docs/mobile-push/inbox)
- [Building a Batched Notification Engine - Knock](https://knock.app/blog/building-a-batched-notification-engine)

### 알림 피로도 방지
- [How to Help Users Avoid Notification Fatigue - MagicBell](https://www.magicbell.com/blog/help-your-users-avoid-notification-fatigue)
- [How to Reduce Notification Fatigue: 7 Strategies - Courier](https://www.courier.com/blog/how-to-reduce-notification-fatigue-7-proven-product-strategies-for-saas)
- [Push Notification Best Practices 2026 - Appbot](https://appbot.co/blog/app-push-notifications-2026-best-practices/)
- [Alert Fatigue: Impact and Solutions - MagicBell](https://www.magicbell.com/blog/alert-fatigue)

### 산업별 사례
- [How Slack Builds Smart Notification Systems - Courier](https://www.courier.com/blog/how-slack-builds-smart-notification-systems-users-want)
- [Designing WhatsApp - AlgoMaster](https://algomaster.io/learn/system-design-interviews/design-whatsapp)
- [Best Healthcare Software for Real-Time Alerts - MagicBell](https://www.magicbell.com/blog/best-real-time-healthcare-software-platforms)
- [Evaluating Effectiveness of Clinical Alerts - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3243147/)
- [Digest Notifications Best Practices - Novu](https://novu.co/blog/digest-notifications-best-practices-example/)
