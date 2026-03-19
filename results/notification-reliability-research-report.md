# 알림 신뢰성 보장 기법 조사 보고서

> 작성일: 2026-03-19
> 목적: FCM 기반 Push Notification의 전달 신뢰성 한계를 분석하고, 이를 보완하기 위한 기법·논문·대안 아키텍처를 조사하여 DexWeaver 프로젝트의 QoS 개선 방향을 제시한다.

---

## 1. 문제 정의

### 1.1 서버 → 디바이스 전달 신뢰성 문제

FCM은 서버 수락률(HTTP 200) ~99%를 달성하지만, **실제 디바이스 렌더링 기준 산업 평균은 14~48%** 에 불과하다 (MoEngage, 2021). 본 프로젝트의 추가 실험(additional-report.md)에서도 다음 결과가 확인되었다:

| 불안정 요인 | 실험 결과 | 심각도 |
|------------|----------|:------:|
| Collapsible 스로틀링 | 전달률 1.7~33.3% | 극대 |
| 페이로드 한도 초과 (5000B) | 전달률 0% (즉시 거부) | 극대 |
| 중복 전송 | 중복률 100% (서버 dedup 없음) | 높음 |
| Stale 토큰 혼재 | 유효 메시지에 영향 없음 | 낮음 |

**핵심 문제**: FCM의 `messaging.send()` 성공 응답은 "FCM 서버가 수락했다"는 의미이지, "디바이스에 도달했다"는 의미가 아니다. 실제 디바이스 도달 여부를 추적하려면 **Application-Level ACK**이 필수적이다.

### 1.2 사용자 알림 미확인 문제

디바이스에 알림이 도달하더라도 사용자가 이를 확인하지 않는 문제가 존재한다:

- 젊은 성인 기준 일일 평균 60~80건의 알림 수신 → **알림 피로도(Notification Fatigue)** 발생
- 과도한 알림 빈도는 앱 알림 비활성화 또는 앱 삭제로 이어짐 (Consumer Acceptance of App Push Notifications, 2020)
- 사용자가 알림을 swipe 해제하면 데이터에 접근 불가 (특히 Background/Killed 상태의 Combined 메시지)

---

## 2. 학술 논문 조사 결과

### 2.1 전달 신뢰성 관련 (6건)

| # | 논문 | 발표 | 핵심 기여 |
|---|------|------|----------|
| P1 | Reliable Push Notification for Mobile Users in Interactive Smart Mobile Applications | IoT 학회 | BLE 환경에서 이동 중 사용자에게 DCAE(Dynamic Content Adaptation Engine)를 적용하여 콘텐츠 전달 성공률 개선 |
| P3 | An Approach for Modeling and Analyzing Mobile Push Notification Services | IEEE SCC 2014 | Formal specification/verification을 통한 push notification 시스템의 신뢰성·보안 취약점 분석 |
| P4 | Using Adaptive Heartbeat Rate on Long-Lived TCP Connections | IEEE/ACM ToN 2017 | Push 서비스의 persistent TCP 연결 heartbeat 간격을 동적 조정하여 배터리 소모와 연결 신뢰성 trade-off 최적화 |
| P16 | A Comparative Evaluation of AMQP and MQTT over Unstable Networks | ResearchGate 2015 | 불안정 네트워크에서 AMQP vs MQTT 프로토콜 신뢰성 비교. 일부 프로토콜만 전체 메시지 전달 성공 |
| P17 | Secure Push Notification Service Based on MQTT Protocol | 2017 | MQTT QoS 레벨을 활용한 저대역폭/고지연 환경에서의 보안 push notification 서비스 |
| P18 | Design and Implementation of Push Notification System Based on MQTT Protocol | ResearchGate 2014 | MQTT 기반 자체 push notification 시스템의 아키텍처 설계 및 구현 |

### 2.2 사용자 인게이지먼트 및 알림 피로도 관련 (6건)

| # | 논문 | 발표 | 핵심 발견 |
|---|------|------|----------|
| P5 | Effects of Push Notifications on Learner Engagement | IEEE 2016 | Push notification이 앱 사용 빈도와 인게이지먼트를 유의미하게 증가시킴 |
| P6 | Mobile Apps in Retail: Effect of Push Notification Frequency | 2021 | 과도한 알림은 효과 감소. 중요 알림이 불필요한 알림에 묻히는 현상 발생 |
| P7 | Consumer Acceptance of App Push Notifications: Systematic Review | 2020 | 과도한 빈도 → 알림 비활성화 또는 앱 삭제로 이어짐 |
| P8 | An In-Situ Study of Mobile Phone Notifications | ResearchGate 2016 | **인터럽트 가능한 순간에 알림 전달 시 사용자 응답 시간 49.7% 감소** |
| P9 | Exploring User's Experience of Push Notifications | 2022 | 부적절한 타이밍·빈도·콘텐츠 → 침입적이고 성가신 경험 |
| P10 | Empowering Individual Preferences in Mobile Notifications | IEEE Access 2025 | 사용자 주도 3가지 수신 모드(Immediate/While in Use/On Demand) 설정 시 알림 피로도 감소 |

### 2.3 QoS 측정 및 평가 관련 (3건)

| # | 논문 | 발표 | 핵심 기여 |
|---|------|------|----------|
| P11 | An Exploration of Evaluation Metrics for Mobile Push Notifications | **ACM SIGIR 2016** | Push notification 평가는 **관련성(relevant), 적시성(timely), 참신성(novel)** 3축이 핵심. TREC 2015 Microblog 평가 지표 분석 |
| P12 | Alert Notification as a Service | IEEE 2014 | 알림의 서비스화(as-a-Service) 모델과 서비스 품질 관리 프레임워크 |
| P15 | A Survey of Distributed Message Broker Queues | arXiv 2017 | RabbitMQ, Kafka, ActiveMQ 등 분산 메시지 브로커의 QoS 수준별 전달 보장 비교 |

### 2.4 강화학습 기반 알림 최적화 관련 (4건)

| # | 논문 | 발표 | 핵심 기여 |
|---|------|------|----------|
| P19 | Nurture: Notifying Users at the Right Time Using RL | **ACM UbiComp 2018** | 사용자 컨텍스트에 적합한 알림 전달 시점을 강화학습으로 자동 식별 |
| P20 | Offline RL for Mobile Notifications | **ACM CIKM 2022** | MDP 정형화를 통한 오프라인 RL 기반 sequential notification 최적화 |
| P21 | Multi-objective Optimization of Notifications Using Offline RL | arXiv 2022 | 알림 선택과 적절한 순간 식별을 위한 2개 RL 모델 동시 활용 |
| P22 | ML Approach to Manage Adaptive Push Notifications | ACM MobiQuitous 2020 | 지도학습 기반 적응형 알림 시스템이 CTR을 유의미하게 향상 |

### 2.5 보안 관련 (2건)

| # | 논문 | 발표 | 핵심 기여 |
|---|------|------|----------|
| P23 | When Push Comes to Shove | **ACM ACSAC 2023** | 운영 중인 Web Push 구현의 보안 취약점 대규모 실증 분석 |
| P24 | DaPanda: Detecting Aggressive Push Notifications in Android | **ACM/IEEE ASE 2019** | 공격적 push notification의 대규모 탐지·특성화 |

---

## 3. 알림 신뢰성 보장 기법

### 3.1 Application-Level ACK 시스템

FCM은 디바이스 도달 확인을 제공하지 않으므로, **앱 레벨에서 3단계 상태 추적**이 필수적이다:

```
[서버] --FCM Data Message--> [디바이스/앱]
                                  │
                           onMessageReceived()
                                  │
                           알림 표시 + 로컬 저장
                                  │
                            ACK 전송 -------> [서버]
                                                │
                                          ACK 수신 기록
                                          (미수신 시 재전송)
```

**3단계 상태 추적**:

| 상태 | 의미 | 트리거 시점 |
|------|------|-----------|
| `delivered` | 클라이언트가 메시지를 수신 | `onMessageReceived()` 콜백 |
| `displayed` | 알림이 사용자에게 표시 | 알림 표시 완료 시 |
| `acted_on` | 사용자가 알림을 탭하거나 액션 수행 | 사용자 인터랙션 시 |

**서버 측 ACK 추적 스키마**:
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

**참고**: Firebase Analytics는 24시간+ 지연이 있어 실시간 QoS 모니터링에 부적합. 자체 ACK 시스템 구축이 권장됨.

### 3.2 에스컬레이션 래더 (Escalation Ladder)

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

**알림 유형별 에스컬레이션 타이밍**:

| 알림 유형 | 1차 (Push) | 2차 (리마인더) | 3차 (Digest) | 4차 (Email/SMS) |
|-----------|-----------|-------------|------------|----------------|
| 보안 알림 | 즉시 | 2~5분 | - | 5분 (SMS 동시) |
| 결제/주문 | 즉시 | 30분 | 2시간 | 24시간 |
| 소셜 활동 | 즉시 | - | 1시간(배치) | 일간 요약 |
| 마케팅 | 즉시 | - | - | 주간 Digest |

### 3.3 Notification Digest (배칭)

개별 알림 대신 모아서 요약 전달. **Digest 사용 시 engagement 35% 증가, opt-out 28% 감소** (Braze 연구).

| 유형 | 주기 | 적합한 알림 |
|------|------|-----------|
| 즉시(Immediate) | 실시간 | 보안 알림, 결제 알림 |
| Near-real-time | 5~15분 | 채팅 메시지, 주문 업데이트 |
| 시간별(Hourly) | 1시간 | SNS 활동, 좋아요/댓글 |
| 일간(Daily) | 1일 | 뉴스 요약, 추천 콘텐츠 |
| 주간(Weekly) | 1주 | 활동 보고서, 주간 하이라이트 |

### 3.4 In-App Notification Inbox

Push 알림은 사용자가 dismiss하면 사라지지만, In-App Inbox는 모든 알림 이력을 영속적으로 보관한다.

- **서버가 unread count의 권위(authoritative) 소스**가 되어야 함 (멀티 디바이스 불일치 방지)
- 앱 실행 시 서버에서 최신 알림 목록 + unread count 동기화
- Room DB 기반 offline-first 저장 → 온라인 복귀 시 서버에 배치 동기화

### 3.5 알림 피로도 방지

- **일일 3~10건 rate limiting** (대부분의 앱에서 10건 초과는 불필요)
- **Quiet Hours**: 22:00~07:00 자동 보류
- **Priority 기반 4단계 필터링**: Critical > High > Medium > Low
- **포괄적 설정 제공 시 opt-out 43% 감소, engagement 31% 증가**

---

## 4. FCM 대안: Message Queue 기반 아키텍처

### 4.1 Message Queue 기술 비교

| 기술 | 전송 보장 | 영속성 | 처리량 | 모바일 알림 적합도 | 운영 복잡도 |
|------|----------|--------|--------|:----------------:|:---------:|
| **RabbitMQ** | At-least-once | O | 중 | ★★★★ | 중 |
| **Kafka** | Exactly-once 가능 | O | 매우 높음 | ★★★ | 상 |
| **Redis Streams** | At-least-once | O (제한적) | 높음 | ★★★ | 하 |
| **SQS/SNS** | At-least-once ~ Exactly-once | O | 높음 | ★★★★★ | 하 |
| **NATS JetStream** | At-least-once ~ Exactly-once | O | 매우 높음 | ★★★ | 중 |
| **Apache Pulsar** | At-least-once | O | 매우 높음 | ★★★★ | 상 |

### 4.2 RabbitMQ + FCM 하이브리드

```
[App Server] → [RabbitMQ Broker] → [Notification Worker] → [FCM/APNs] → [Device]
                    │
              ┌─────┴─────┐
              │           │
        [Push Queue] [Email Queue] ...
              │
        [Dead Letter Queue] ← 전송 실패 메시지
```

**RabbitMQ의 FCM 보완 기능**:

| 항목 | FCM 단독 | RabbitMQ + FCM |
|------|---------|----------------|
| 전송 보장 | Best-effort | At-least-once (Manual ACK + Publisher Confirms) |
| 실패 처리 | 제한적 자동 재시도 | DLQ + 커스텀 재시도 + Exponential Backoff |
| 메시지 순서 | 보장하지 않음 | FIFO 보장 가능 |
| 우선순위 | High/Normal 2단계 | 무제한 Priority Queue 구성 |
| 모니터링 | Firebase Console (제한적) | 상세 Queue/Consumer 상태 확인 |

### 4.3 하이브리드 아키텍처 패턴

#### Outbox 패턴 (Transactional Outbox)

DB 트랜잭션과 알림 발행의 **원자성** 보장:

```
┌─────────────────────────────────────────┐
│           Single Transaction            │
│                                         │
│  [Business Data Update] + [Outbox 저장] │
│                                         │
└─────────────────────────────────────────┘
              │
     [Message Relay] (Polling/CDC)
              │
     [Message Broker → FCM/APNs]
```

- 비즈니스 로직과 알림 발송의 원자성 보장 (예: 주문 생성 ↔ 주문 알림)
- 서비스 장애 시에도 메시지 유실 방지
- 감사 로그(Audit Trail) 자동 생성

#### Store-and-Forward 패턴

```
1. 알림 요청 → DB에 저장 (status: PENDING)
2. Worker가 PENDING 알림 조회
3. FCM/APNs로 전송 시도
4. 성공 → status: SENT / 실패 → retry_count 증가 또는 DLQ 이동
```

### 4.4 클라이언트 로컬 Queue + Cron 리마인더

앱 내부에 미확인 알림을 로컬 Queue(SQLite/Room)에 저장하고, **주기적으로 리마인더를 표시**하는 전략:

```
[FCM 수신] → [Local Notification Queue (Room DB)]
                         │
               [Periodic Sync (WorkManager / BGTaskScheduler)]
                         │
               [미확인 알림 리마인더 표시]
```

**플랫폼별 주기적 동기화**:

| 플랫폼 | 기술 | 최소 주기 | 특성 |
|--------|------|----------|------|
| Android | WorkManager (`PeriodicWorkRequest`) | 15분 | 기기 재부팅 후에도 유지. Doze 모드 존중 |
| iOS | BGTaskScheduler (`BGAppRefreshTask`) | OS 결정 | 사용자 앱 사용 패턴에 따라 실행 빈도 변동 |

**리마인더 로직**:
1. 알림 수신 → 로컬 Queue에 저장 (status: UNREAD)
2. WorkManager가 주기적으로 UNREAD 알림 조회
3. 미확인 알림이 있으면 Digest 형태로 리마인더 표시
4. 최대 리마인더 횟수(3회) 초과 시 더 이상 리마인드하지 않음

---

## 5. 산업 사례 분석

### 5.1 WhatsApp — 최고 수준 전달 보장

- Persistent WebSocket 연결로 실시간 메시지 전달
- 수신 확인(더블 체크): 디바이스가 ACK를 서버에 전송
- 오프라인 사용자: offline queue/DB에 저장 → 재접속 시 전달
- **At-least-once delivery + Idempotent storage**로 중복 방지

### 5.2 Slack — Smart Notification

- **컨텍스트 인식 기본값**: 95%+ 사용자가 알림 설정을 커스텀하지 않으므로 기본값이 핵심
- **디바이스 우선순위**: 데스크톱 활성 시 모바일 알림 억제 (중복 방지)
- **설계 철학**: "언제 알림을 보낼까?"가 아닌 **"언제 사용자가 주의를 끌기 원할까?"**

### 5.3 의료 시스템 — 최고 신뢰성 요구

- Sub-second latency: 패혈증 감지, Code Blue 등 초 단위 전달 필수
- **30초 → 2분 → 5분** 에스컬레이션 체인
- Alert Fatigue 문제: 임상 알람의 80~99%가 조치 불필요 → 알림 정밀도 향상 필수

### 5.4 금융 — 규제 준수 필수

- 거래 확인 통지는 거래일 종료 전까지 고객에게 전달 의무
- 전자 전송 실패 시 우편/팩스 등 대체 수단 의무
- **Push → SMS → Email → 우편** 4단계 자동 fallback + 감사 로그

---

## 6. FCM의 QoS 3계층 모델과 보완 전략

본 프로젝트의 기존 실험(그룹 A~J)과 본 조사 결과를 종합하면, FCM 알림의 신뢰성은 **3계층 모델**로 이해할 수 있다:

```
┌─────────────────────────────────────────────────────┐
│ Layer 1: 서버 → FCM 서버 (Server-side)              │
│   - 페이로드 한도, Stale 토큰, Rate Limit            │
│   - 제어 가능: 전송 전 검증으로 100% 예방 가능         │
├─────────────────────────────────────────────────────┤
│ Layer 2: FCM 서버 → 디바이스 (Platform-side)         │
│   - Collapsible 스로틀링, 메시지 유형, 우선순위        │
│   - 부분 제어: 설정 최적화로 개선 가능하나 완전 통제 불가 │
├─────────────────────────────────────────────────────┤
│ Layer 3: 디바이스 내부 (Device-side)                  │
│   - Doze 모드, OEM 배터리 최적화, App Standby         │
│   - 제어 불가: OEM·OS 정책에 의존                     │
├─────────────────────────────────────────────────────┤
│ Layer 4: 사용자 인지 (User-side) [신규 식별]          │
│   - 알림 피로도, 알림 미확인, 알림 dismiss             │
│   - 간접 제어: Digest, 에스컬레이션, In-App Inbox     │
└─────────────────────────────────────────────────────┘
```

**계층별 보완 전략**:

| 계층 | 문제 | 보완 전략 | 구현 복잡도 |
|------|------|----------|:---------:|
| Layer 1 | 페이로드 초과, Stale 토큰 | 전송 전 검증 (payload check, token validation) | 하 |
| Layer 2 | Collapsible 스로틀링, 중복 | 서버 재시도 큐 + 클라이언트 dedup | 중 |
| Layer 3 | Doze, OEM 배터리 최적화 | HIGH priority + 대체 채널 (MQTT, WebSocket) | 상 |
| **Layer 4** | **알림 미확인, 피로도** | **App-Level ACK + 에스컬레이션 + Digest + In-App Inbox** | **중** |

---

## 7. DexWeaver 프로젝트 권장 적용 방안

### 7.1 우선순위별 구현 로드맵

#### Phase 1: 기본 신뢰성 확보 (Layer 1~2 보완)
- FCM Data Message 기반 App-Level ACK 구현
- Firestore에 알림 상태 추적 컬렉션 생성 (sent/delivered/displayed/acted)
- 미수신 알림 재전송 Cloud Function 구현 (Exponential Backoff + Jittering)
- 클라이언트 측 messageId 기반 멱등성 처리 (DedupService 보완)

#### Phase 2: 사용자 인지 보장 (Layer 4 보완)
- 클라이언트 로컬 Queue (Room DB) + WorkManager 기반 주기적 리마인더
- In-App Notification Inbox 구현 (서버 기반 unread count 동기화)
- Notification Digest (시간/이벤트 기반 배칭)
- 사용자별 알림 선호도 설정

#### Phase 3: 인프라 신뢰성 강화 (Layer 2~3 보완)
- Message Queue(SQS/SNS 또는 RabbitMQ) → FCM 앞단에 신뢰성 계층 배치
- Outbox 패턴으로 DB 트랜잭션과 알림 발행의 원자성 보장
- DLQ(Dead Letter Queue)를 통한 실패 알림 추적·재처리

#### Phase 4: 고급 기능 (Layer 4 최적화)
- 에스컬레이션 래더 (Push → In-App → Email → SMS)
- Priority 기반 알림 필터링 + Quiet Hours/DND 인식
- 알림 전달률/열람률 대시보드
- Smart Timing (사용자 활동 패턴 기반 최적 전달 시점)

### 7.2 기술 스택 권장

| 구성 요소 | 권장 기술 | 이유 |
|----------|----------|------|
| 서버 → MQ | SQS/SNS (AWS) 또는 RabbitMQ | Serverless 아키텍처와 최적 조합, 운영 부담 최소 |
| MQ → FCM | Cloud Functions Worker | Firebase 생태계와 자연스러운 통합 |
| 클라이언트 로컬 Queue | Room DB (Android) | 구조화된 알림 데이터 저장, offline-first |
| 주기적 리마인더 | WorkManager (Android) / BGTaskScheduler (iOS) | OS 배터리 최적화 존중, 재부팅 후에도 유지 |
| 상태 동기화 | Firestore 실시간 리스너 | 멀티 디바이스 동기화, 서버 권위 unread count |

---

## 8. 조사 자료 디렉토리 구조

본 조사 과정에서 생성된 상세 자료는 `research/` 디렉토리에 별도 관리한다:

```
research/
├── 01-academic-research-survey.md        # 학술 논문 24건 조사 (9개 주제 영역)
├── 02-notification-reliability-patterns.md  # 알림 신뢰성 보장 패턴 및 산업 사례
└── 03-fcm-alternatives-message-queue.md    # Message Queue 대안 및 하이브리드 아키텍처
```

| 파일 | 내용 | 분량 |
|------|------|:----:|
| 01-academic-research-survey.md | 전달 신뢰성, 사용자 인게이지먼트, QoS 측정, E2E ACK, Store-and-Forward, RL 기반 최적화, 보안 논문 조사 | 24건 논문/기술 자료 |
| 02-notification-reliability-patterns.md | App-Level ACK, 에스컬레이션 래더, Digest 배칭, In-App Inbox, 알림 피로도 방지, WhatsApp/Slack/의료/금융 사례 | 5개 영역 |
| 03-fcm-alternatives-message-queue.md | RabbitMQ, Kafka, Redis, SQS/SNS, NATS, Pulsar 비교, Outbox/CQRS 패턴, 클라이언트 로컬 Queue + Cron 패턴 | 7개 기술 + 4개 패턴 |

---

## 참고 문헌

### 학술 논문
- [An Exploration of Evaluation Metrics for Mobile Push Notifications (ACM SIGIR 2016)](https://dl.acm.org/doi/10.1145/2911451.2914694)
- [Nurture: Notifying Users at the Right Time Using RL (ACM UbiComp 2018)](https://dl.acm.org/doi/10.1145/3267305.3274107)
- [Offline Reinforcement Learning for Mobile Notifications (ACM CIKM 2022)](https://dl.acm.org/doi/10.1145/3511808.3557083)
- [When Push Comes to Shove (ACM ACSAC 2023)](https://dl.acm.org/doi/10.1145/3627106.3627186)
- [Empowering Individual Preferences in Mobile Notifications (IEEE Access 2025)](https://ieeexplore.ieee.org/iel8/6287639/10820123/10916668.pdf)
- [Effects of Push Notifications on Learner Engagement (IEEE 2016)](https://ieeexplore.ieee.org/document/7756930/)
- [Using Adaptive Heartbeat Rate on Long-Lived TCP Connections (IEEE/ACM ToN 2017)](https://dl.acm.org/doi/abs/10.1109/TNET.2017.2774275)
- [A Comparative Evaluation of AMQP and MQTT over Unstable Networks (ResearchGate 2015)](https://www.researchgate.net/publication/282914203)
- [On the Performance of Web Services, GCM and FCM (Digital Comm. Networks 2019)](https://www.sciencedirect.com/science/article/pii/S235286481830035X)

### 산업 보고서 및 기술 자료
- [Understanding FCM Message Delivery on Android (Firebase Blog 2024)](https://firebase.blog/posts/2024/07/understand-fcm-delivery-rates/)
- [The Push Notification Delivery Rate Report 2021 (MoEngage)](https://www.moengage.com/blog/the-push-notifications-delivery-rate-report-is-here/)
- [DontKillMyApp.com — OEM 배터리 최적화 영향](https://dontkillmyapp.com/)
- [MQTT QoS Levels (HiveMQ)](https://www.hivemq.com/blog/mqtt-essentials-part-6-mqtt-quality-of-service-levels/)
- [Amazon SNS Message Delivery Retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)
