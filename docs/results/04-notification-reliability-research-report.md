# 알림 신뢰성 보장 기법 조사 보고서

> 작성일: 2026-03-19
> 목적: FCM 기반 Push Notification의 전달 신뢰성 한계를 분석하고, 이를 보완하기 위한 기법·논문·대안 아키텍처를 조사하여 DexWeaver 프로젝트의 QoS 개선 방향을 제시한다.

---

## 1. 핵심 문제 요약

FCM 기반 Push Notification에는 크게 2가지 핵심 문제가 존재한다.

### 문제 1: 서버 → 디바이스 전달 신뢰성 부족

FCM의 `messaging.send()` 성공 응답은 "FCM 서버가 수락했다"는 의미일 뿐, "디바이스에 도달했다"는 의미가 아니다. 서버 수락률은 ~99%이지만, 실제 디바이스 렌더링 기준 산업 평균은 14~48%에 불과하다 [R2].

| 불안정 요인 | 실험 결과 | 심각도 | 제어 가능성 |
|------------|----------|:------:|:---------:|
| Collapsible 스로틀링 | 전달률 1.7~33.3% | 극대 | 부분 제어 |
| 페이로드 한도 초과 (5000B) | 전달률 0% (즉시 거부) | 극대 | 완전 제어 |
| Doze/OEM 배터리 최적화 | 전달 지연·누락 | 높음 | 제어 불가 |
| 중복 전송 | 중복률 100% (서버 dedup 없음) | 높음 | 완전 제어 |
| Stale 토큰 혼재 | 유효 메시지에 영향 없음 | 낮음 | 완전 제어 |

### 문제 2: 사용자 알림 미확인 (알림 피로도)

디바이스에 도달하더라도 사용자가 확인하지 않는 문제:

- 일일 평균 60~80건 알림 수신 → 알림 피로도(Notification Fatigue) [P7]
- 과도한 빈도 → 앱 알림 비활성화 또는 앱 삭제
- 알림 swipe 해제 시 데이터 접근 불가

### 문제의 4계층 모델

```
┌─────────────────────────────────────────────────────┐
│ Layer 1: 서버 → FCM 서버    │ 완전 제어 가능          │
│   페이로드 한도, Stale 토큰, Rate Limit               │
├─────────────────────────────────────────────────────┤
│ Layer 2: FCM → 디바이스     │ 부분 제어 가능          │
│   Collapsible 스로틀링, 메시지 유형, 우선순위          │
├─────────────────────────────────────────────────────┤
│ Layer 3: 디바이스 내부       │ 제어 불가              │
│   Doze 모드, OEM 배터리 최적화, App Standby           │
├─────────────────────────────────────────────────────┤
│ Layer 4: 사용자 인지         │ 간접 제어              │
│   알림 피로도, 알림 미확인, 알림 dismiss               │
└─────────────────────────────────────────────────────┘
```

---

## 2. 후보 시나리오 총정리

위 문제들을 해결하기 위한 6가지 후보 시나리오를 도출했다.

| # | 후보 시나리오 | 해결하는 문제 | 구현 복잡도 | 핵심 효과 |
|:-:|-------------|:-----------:|:---------:|----------|
| A | Application-Level ACK | 문제 1 | 중 | 실제 디바이스 도달 여부 추적 + 미수신 재전송 |
| B | Message Queue 하이브리드 아키텍처 | 문제 1 | 상 | At-least-once~Exactly-once 전달 보장 + DLQ 실패 추적 |
| C | 에스컬레이션 래더 | 문제 1+2 | 중 | 미확인 시 Push → In-App → Email → SMS 점진적 채널 확대 |
| D | Notification Digest (배칭) | 문제 2 | 중 | engagement 35%↑, opt-out 28%↓ |
| E | In-App Notification Inbox | 문제 2 | 중 | 알림 이력 영속 보관 + 멀티 디바이스 동기화 |
| F | 알림 피로도 방지 (Rate Limit + Quiet Hours) | 문제 2 | 하 | opt-out 43%↓, engagement 31%↑ |

---

## 3. 각 시나리오별 상세 분석

### 시나리오 A: Application-Level ACK 시스템

목적: FCM이 제공하지 않는 디바이스 도달 확인을 앱 레벨에서 구현 [R1]

동작 흐름:
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

3단계 상태 추적:

| 상태 | 의미 | 트리거 시점 |
|------|------|-----------|
| `delivered` | 클라이언트가 메시지를 수신 | `onMessageReceived()` 콜백 |
| `displayed` | 알림이 사용자에게 표시 | 알림 표시 완료 시 |
| `acted_on` | 사용자가 알림을 탭/액션 수행 | 사용자 인터랙션 시 |

구현 시 고려 요소:

| 항목 | 고려사항 |
|------|---------|
| 서버 스키마 | Firestore `notification_acks` 컬렉션 (message_id, sent_at, delivered_at, displayed_at, acted_at, retry_count) |
| 재전송 정책 | Exponential Backoff + Jittering으로 FCM 스로틀링 회피 |
| 멱등성 | 클라이언트 messageId 기반 중복 수신 방지 (DedupService) |
| 실시간성 | Firebase Analytics는 24시간+ 지연 → 자체 ACK 시스템 필수 [R3] |
| 네트워크 | 오프라인 상태에서 ACK 전송 실패 시 로컬 큐잉 후 재전송 |

---

### 시나리오 B: Message Queue 하이브리드 아키텍처

목적: FCM의 Best-effort 전달 모델 한계를 MQ 앞단 배치로 보완 [R14] [R15]

공통 아키텍처:
```
[App Server] → [Message Queue] → [Notification Worker] → [FCM/APNs] → [Device]
                    │                                          │
              ┌─────┴─────┐                              [ACK / 실패]
              │           │                                    │
        [Push Queue] [Email Queue] ...                  [재시도 or DLQ]
              │
        [Dead Letter Queue] ← 전송 실패 메시지
```

MQ가 FCM에 추가하는 기능:

| 항목 | FCM 단독 | MQ + FCM 하이브리드 |
|------|---------|---------------------|
| 전송 보장 | Best-effort | At-least-once ~ Exactly-once |
| 실패 처리 | 제한적 자동 재시도 | DLQ + 커스텀 재시도 + Exponential Backoff |
| 메시지 순서 | 보장 안 함 | FIFO 보장 가능 |
| 우선순위 | High/Normal 2단계 | 다단계 Priority Queue |
| 채널 분기 | Push만 | Push + Email + SMS + In-App 멀티채널 |

#### MQ 기술별 벤치마크 비교

| 기술 | 처리량 | 지연시간 | 전달 보장 | 영속성 | 학습 곡선 | 운영 복잡도 |
|------|:------:|:-------:|----------|:------:|:--------:|:---------:|
| RabbitMQ | ~2,667 RPS | 0.13ms (초저지연) | At-least-once | O | 중 | 중 |
| Apache Kafka | 수십만~수백만 msg/s | 81ms (로그 기반) | Exactly-once 가능 | O (매우 강력) | 높음 | 상 |
| Redis Streams | ~100만 msg/s | 초저지연 (인메모리) | At-least-once | △ (제한적) | 낮음 | 하 |
| AWS SQS/SNS | 자동 확장 | 중간 | At-least-once~Exactly-once(FIFO) | O | 낮음 | 하 (관리형) |
| NATS JetStream | ~160K msg/s | 낮음 | At-most-once~Exactly-once | O | 낮음 | 중 |
| Apache Pulsar | ~2.6M msg/s | p99 NATS 대비 40배↓ | At-least-once | O (매우 강력) | 높음 | 상 |

> 출처: Confluent Kafka vs Pulsar vs RabbitMQ 벤치마크, StreamNative Pulsar vs NATS 비교, Medium 벤치마크 (2024)

#### 규모별 MQ 선택 기준

| 프로젝트 규모 | 권장 MQ | 선택 근거 |
|:------------:|---------|----------|
| 소규모 (0~10만 사용자) | Google Cloud Tasks + Cloud Functions | Firebase 네이티브 통합, 무료 티어 충분, 운영 오버헤드 제로. 분당 10,000건 푸시까지 검증됨 |
| 중규모 (10만~100만) | Cloud Pub/Sub 또는 Redis Streams | GCP 생태계 유지(Pub/Sub), 또는 빠른 프로토타이핑(Redis). BullMQ(Node.js) 등 성숙한 라이브러리 |
| 대규모 (100만+) | Kafka 또는 Apache Pulsar | 수백만 msg/s 처리량, Consumer Group 수평 확장, 이벤트 소싱 |
| 복잡한 라우팅 필요 | RabbitMQ | 다채널 알림, 우선순위 큐, TTL 기반 에스컬레이션 |
| AWS 생태계 | SQS/SNS | 완전 관리형, Lambda 트리거, FIFO 보장 |

#### DexWeaver 프로젝트 권장: Google Cloud Tasks + Cloud Functions

Firebase/FCM 기반 중소규모 프로젝트에서 가장 실용적인 선택:

```
이벤트 발생 → Cloud Functions (트리거) → Google Cloud Tasks (큐잉)
    → Cloud Functions (워커) → FCM API → 디바이스
```

| 평가 항목 | Cloud Tasks | Redis | RabbitMQ | Kafka |
|-----------|:-----------:|:-----:|:--------:|:-----:|
| 학습 곡선 | 매우 낮음 | 낮음 | 중간 | 높음 |
| Firebase 통합 | 네이티브 | 별도 연동 | 별도 연동 | 별도 연동 |
| 비용 (소규모) | 무료 티어 | 자체 호스팅/유료 | 자체 호스팅/유료 | 높음 |
| 운영 오버헤드 | 제로 | 낮음~중간 | 중간 | 높음 |
| 자동 재시도/백오프 | 내장 | 수동 구현 | 수동 구현 | 수동 구현 |
| 확장성 한계 | 10만 사용자급 | 100만+ | 100만+ | 수백만+ |

규모 성장 시 전환 경로: Cloud Tasks → Cloud Pub/Sub → Kafka/Pulsar

구현 시 고려 요소:

| 항목 | 고려사항 |
|------|---------|
| 원자성 | Outbox 패턴으로 DB 트랜잭션과 알림 발행의 원자성 보장 [R12] |
| 실패 처리 | DLQ(Dead Letter Queue)로 실패 알림 추적·재처리 |
| 인프라 비용 | 관리형(SQS/SNS, Cloud Tasks)은 운영 부담↓, 자체 운영(Kafka)은 반대 |
| 확장성 | Kafka는 Consumer Group 수평 확장, SQS/Cloud Tasks는 자동 확장 |
| 감사 로그 | 금융/의료 도메인은 Kafka 이벤트 소싱으로 불변 로그 필수 |

주요 아키텍처 패턴:

- Outbox 패턴: 비즈니스 DB 쓰기와 메시지 발행을 단일 트랜잭션으로 처리 → 유실 방지
- Store-and-Forward: 알림을 DB에 PENDING 저장 → Worker가 순차 전송 → 실패 시 재시도/DLQ

---

### 시나리오 C: 에스컬레이션 래더 (Escalation Ladder)

목적: 알림 미확인 시 점진적으로 채널을 확대하여 전달 보장

동작 흐름:
```
Level 1: Push Notification (즉시)
    ↓ 5분 미확인
Level 2: In-App 알림 + Push 재전송
    ↓ 30분 미확인
Level 3: Email 발송
    ↓ 2시간 미확인
Level 4: SMS 발송 (최종 수단)
```

구현 시 고려 요소:

| 항목 | 고려사항 |
|------|---------|
| 선행 조건 | 시나리오 A(ACK 시스템)가 필수 — ACK 없이는 "미확인" 판단 불가 |
| 유형별 타이밍 | 보안 알림(2~5분) vs 마케팅(에스컬레이션 없음) 등 차등 적용 |
| 비용 | SMS/Email 채널 추가 시 외부 서비스 비용 발생 |
| 사용자 경험 | 과도한 에스컬레이션은 오히려 피로도 증가 → 최대 횟수 제한 필요 |
| 산업 사례 | 금융: Push→SMS→Email→우편 4단계 [5.4], 의료: 30초→2분→5분 [R9] |

알림 유형별 에스컬레이션 전략:

| 알림 유형 | 1차 (Push) | 2차 (리마인더) | 3차 (Digest) | 4차 (Email/SMS) |
|-----------|-----------|-------------|------------|----------------|
| 보안 알림 | 즉시 | 2~5분 | - | 5분 (SMS 동시) |
| 결제/주문 | 즉시 | 30분 | 2시간 | 24시간 |
| 소셜 활동 | 즉시 | - | 1시간(배치) | 일간 요약 |
| 마케팅 | 즉시 | - | - | 주간 Digest |

---

### 시나리오 D: Notification Digest (배칭)

목적: 개별 알림 대신 모아서 요약 전달 → engagement 35%↑, opt-out 28%↓ [R6]

배칭 유형:

| 유형 | 주기 | 적합한 알림 |
|------|------|-----------|
| 즉시(Immediate) | 실시간 | 보안 알림, 결제 알림 |
| Near-real-time | 5~15분 | 채팅 메시지, 주문 업데이트 |
| 시간별(Hourly) | 1시간 | SNS 활동, 좋아요/댓글 |
| 일간(Daily) | 1일 | 뉴스 요약, 추천 콘텐츠 |
| 주간(Weekly) | 1주 | 활동 보고서, 주간 하이라이트 |

구현 시 고려 요소:

| 항목 | 고려사항 |
|------|---------|
| 분류 기준 | 알림 유형별로 즉시/배칭 여부를 사전 정의해야 함 |
| 타이밍 | 사용자 활동 패턴에 맞춘 최적 전달 시점 (예: 출근 시간 일간 Digest) |
| 요약 품질 | 배칭된 알림의 요약 텍스트 생성 로직 필요 |
| 클라이언트 구현 | 로컬 Queue(Room DB) + WorkManager로 주기적 리마인더 표시 |
| 플랫폼 제약 | Android WorkManager 최소 주기 15분, iOS BGTaskScheduler는 OS 결정 |

---

### 시나리오 E: In-App Notification Inbox

목적: Push 알림은 dismiss하면 사라지지만, Inbox는 모든 알림 이력을 영속 보관

구현 시 고려 요소:

| 항목 | 고려사항 |
|------|---------|
| 권위 소스 | 서버가 unread count의 권위(authoritative) 소스 — 멀티 디바이스 불일치 방지 |
| 동기화 | 앱 실행 시 서버에서 최신 알림 목록 + unread count 동기화 |
| 오프라인 | Room DB 기반 offline-first 저장 → 온라인 복귀 시 서버에 배치 동기화 |
| 데이터 보존 | 알림 보존 기간 정책 (30일/90일 등) + 오래된 데이터 정리 |
| UI/UX | 읽음/안읽음 상태, 카테고리별 필터링, 검색 기능 |

---

### 시나리오 F: 알림 피로도 방지 (Rate Limit + Quiet Hours)

목적: 과도한 알림으로 인한 사용자 이탈 방지 → opt-out 43%↓, engagement 31%↑ [R7]

주요 정책:

- 일일 3~10건 Rate Limiting (대부분의 앱에서 10건 초과 불필요)
- Quiet Hours: 22:00~07:00 자동 보류
- Priority 기반 4단계 필터링: Critical > High > Medium > Low

구현 시 고려 요소:

| 항목 | 고려사항 |
|------|---------|
| 기본값 설계 | 95%+ 사용자가 설정 미변경 → 기본값이 핵심 [R8] (Slack 사례) |
| 사용자 제어 | 3가지 수신 모드(Immediate/While in Use/On Demand) 제공 시 피로도↓ [P10] |
| 디바이스 인식 | 데스크톱 활성 시 모바일 알림 억제 (Slack 방식) |
| Critical 예외 | 보안/결제 알림은 Rate Limit·Quiet Hours 무시 |

---

## 4. 시나리오 간 의존성과 권장 구현 순서

```
Phase 1 (기본)        Phase 2 (사용자 인지)       Phase 3 (인프라)       Phase 4 (고급)
┌──────────┐         ┌──────────┐              ┌──────────┐          ┌──────────┐
│ A. ACK   │────────→│ C. 에스컬 │              │ B. MQ    │          │ Smart    │
│ 시스템    │         │ 레이션    │              │ 하이브리드│          │ Timing   │
└──────────┘         └──────────┘              └──────────┘          │ (RL기반) │
                     ┌──────────┐                                    └──────────┘
                     │ D. Digest│
                     │ E. Inbox │
                     │ F. 피로도 │
                     │   방지    │
                     └──────────┘
```

| Phase | 시나리오 | 선행 조건 | 기대 효과 |
|:-----:|---------|----------|----------|
| 1 | A. ACK 시스템 | 없음 | 실제 전달률 측정 가능, 미수신 재전송 기반 마련 |
| 2 | D. Digest + E. Inbox + F. 피로도 방지 | 없음 (독립 구현 가능) | 사용자 경험 개선, 이탈률 감소 |
| 2 | C. 에스컬레이션 | A (ACK 시스템) 필수 | 미확인 알림의 멀티채널 전달 보장 |
| 3 | B. MQ 하이브리드 | 트래픽 규모 확인 후 | 서버-FCM 구간 전달 보장 강화 |
| 4 | Smart Timing (RL 기반) | A+충분한 사용자 데이터 | 최적 전달 시점 자동 식별 [P19][P20] |

---

## 5. 애플리케이션 vs 백엔드 조치 구분

각 시나리오에서 구현해야 할 조치를 **애플리케이션(클라이언트)** 영역과 **백엔드(서버)** 영역으로 구분한다.

### 5.1 영역별 조치 총괄표

| 시나리오 | 애플리케이션 (클라이언트) | 백엔드 (서버) |
|---------|----------------------|-------------|
| **A. ACK 시스템** | `onMessageReceived()`에서 ACK 전송, 오프라인 시 로컬 큐잉 후 재전송, messageId 기반 중복 수신 방지(DedupService), 3단계 상태(delivered/displayed/acted_on) 리포팅 | `notification_acks` 컬렉션 관리, ACK 미수신 감지 + 재전송 스케줄링, Exponential Backoff + Jittering 재전송 정책 |
| **B. MQ 하이브리드** | 변경 없음 (투명) | MQ(Cloud Tasks/Pub/Sub/Kafka) 도입, Notification Worker 구현, DLQ 실패 추적·재처리, Outbox 패턴으로 DB-MQ 원자성 보장 |
| **C. 에스컬레이션** | ACK 전송 (시나리오 A 동일) | 에스컬레이션 타이머 관리, 미확인 시 채널 전환 로직(Push→In-App→Email→SMS), 알림 유형별 에스컬레이션 정책 설정 |
| **D. Digest (배칭)** | 로컬 Queue(Room DB)로 알림 배칭 저장, WorkManager/BGTaskScheduler로 주기적 Digest 표시 | 알림 유형별 즉시/배칭 분류, 배칭 주기 관리, 요약 텍스트 생성 로직 |
| **E. In-App Inbox** | Room DB 기반 offline-first 저장, 읽음/안읽음 UI 관리, 카테고리 필터링·검색, 앱 실행 시 서버 동기화 | Firestore 알림 이력 영속 저장, unread count 권위 소스 관리, 멀티 디바이스 동기화, 보존 기간 정책(30/90일) |
| **F. 피로도 방지** | 3가지 수신 모드 UI(Immediate/While in Use/On Demand), Quiet Hours 로컬 설정 | 일일 Rate Limiting(3~10건), Priority 기반 4단계 필터링, 디바이스 활성 상태 감지(데스크톱 활성 시 모바일 억제), Critical 알림 예외 처리 |

### 5.2 애플리케이션 영역 상세

애플리케이션에서 담당하는 조치는 **디바이스 도달 이후**의 처리에 집중된다.

| 분류 | 구체적 조치 | 관련 시나리오 | 기술 스택 |
|------|-----------|:----------:|----------|
| **수신 확인** | `onMessageReceived()` 콜백에서 ACK HTTP 전송 | A, C | FCM SDK + HTTP Client |
| **오프라인 대응** | 네트워크 미연결 시 ACK/알림을 로컬 큐에 저장, 복귀 시 배치 전송 | A, E | Room DB + ConnectivityManager |
| **중복 방지** | messageId 기반 DedupService로 동일 메시지 중복 표시 차단 | A | Room DB (수신 이력 테이블) |
| **로컬 배칭** | 알림을 즉시 표시하지 않고 로컬 Queue에 모은 뒤 주기적으로 Digest 형태 표시 | D | Room DB + WorkManager (Android) / BGTaskScheduler (iOS) |
| **Inbox UI** | 알림 이력 목록, 읽음/안읽음 토글, 카테고리 필터, 검색 | E | Room DB + RecyclerView / LazyColumn |
| **사용자 설정** | 수신 모드 선택(Immediate/While in Use/On Demand), Quiet Hours, 카테고리별 on/off | F | SharedPreferences / DataStore |
| **상태 동기화** | 앱 실행 시 서버의 최신 알림 목록 + unread count fetch | E | Firestore 실시간 리스너 |

### 5.3 백엔드 영역 상세

백엔드에서 담당하는 조치는 **전송 신뢰성 보장**과 **정책 관리**에 집중된다.

| 분류 | 구체적 조치 | 관련 시나리오 | 기술 스택 |
|------|-----------|:----------:|----------|
| **ACK 추적** | `notification_acks` 컬렉션에 sent/delivered/displayed/acted 타임스탬프 기록 | A | Firestore |
| **재전송 스케줄링** | ACK 미수신 메시지 감지 → Exponential Backoff + Jittering으로 재전송 | A, C | Cloud Functions + Cloud Tasks |
| **메시지 큐잉** | MQ 앞단 배치로 At-least-once 전달 보장, 실패 시 DLQ 적재 | B | Cloud Tasks → Cloud Pub/Sub → Kafka (규모별) |
| **원자성 보장** | Outbox 패턴으로 비즈니스 DB 쓰기와 알림 발행을 단일 트랜잭션 처리 | B | Firestore Transaction + Cloud Tasks |
| **에스컬레이션 엔진** | 알림별 타이머 관리, 미확인 시 다음 채널로 자동 전환 | C | Cloud Functions (Scheduled) |
| **멀티채널 라우팅** | Push/Email/SMS 채널별 전송 Worker 분리 | C | Cloud Functions + SendGrid/Twilio |
| **Rate Limiting** | 사용자별 일일 전송 건수 제한, Priority 기반 필터링 | F | Firestore (카운터) + Cloud Functions |
| **Digest 생성** | 배칭 대상 알림 집계 + 요약 텍스트 생성 후 단일 Push 발송 | D | Cloud Functions (Scheduled) |
| **Inbox 데이터 관리** | 알림 이력 저장, unread count 관리, 보존 기간 만료 데이터 정리 | E | Firestore + Cloud Functions (TTL 정리) |
| **디바이스 상태 감지** | 활성 디바이스 판별, 데스크톱 활성 시 모바일 알림 억제 | F | Firestore (디바이스 heartbeat) |

### 5.4 영역별 구현 우선순위

```
                    애플리케이션                              백엔드
                    ──────────                              ──────
Phase 1 (기본)      ACK 전송 + 중복 방지                     ACK 추적 + 재전송 스케줄링
                         │                                      │
Phase 2 (UX)        Inbox UI + 로컬 배칭                     Rate Limiting + Digest 생성
                    + 사용자 설정 UI                          + Inbox 데이터 관리
                         │                                      │
Phase 3 (인프라)    변경 없음 (투명)                          MQ 도입 + DLQ + Outbox 패턴
                         │                                      │
Phase 4 (고급)      변경 없음 (투명)                          에스컬레이션 엔진 + 멀티채널
                                                              + Smart Timing (RL)
```

> **핵심 인사이트**: Phase 1~2에서는 애플리케이션과 백엔드가 동시에 변경되어야 하지만, Phase 3~4의 인프라/고급 기능은 **백엔드만 변경**하면 되며 클라이언트는 투명(transparent)하게 유지된다. 이는 초기에 클라이언트 인터페이스를 올바르게 설계하면 이후 백엔드 확장이 클라이언트 변경 없이 가능함을 의미한다.

---

## 6. 산업 사례 벤치마크: 실제 기업의 알림 기술 스택

### 5.1 대형 테크 기업

#### Uber — RAMEN (Realtime Asynchronous MEssaging Network)

| 구성 요소 | 기술 |
|----------|------|
| MQ | Kafka / SNS (도메인 이벤트 소비) |
| 캐시 | Redis (핫 캐시, thundering-herd 방지) |
| 저장소 | Cassandra (다중 리전 내구성 저장소) |
| 전송 프로토콜 | SSE → gRPC 마이그레이션 (전이중 스트림, 바이너리 프레이밍) |
| 규모 | 피크 시 250,000 msg/s, 150만+ 동시 연결, 서버 사이드 99.99% 신뢰성 |
| 전달 보장 | 시퀀스 번호 + ACK으로 exactly-once 전달 (불안정 모바일 네트워크 대응) |

#### Netflix — RENO (Rapid Event Notification System)

| 구성 요소 | 기술 |
|----------|------|
| MQ | Kafka (이벤트 소싱) + AWS SQS (우선순위별 큐 분리) |
| 저장소 | Cassandra (이벤트 이력 저장) |
| 게이트웨이 | Zuul Push (TV 디바이스용) |
| 전달 모델 | Push-and-Pull 하이브리드 |
| 특징 | 우선순위별 이벤트를 분류해 별도 SQS 큐와 컴퓨팅 클러스터로 라우팅 |

#### LinkedIn — Air Traffic Controller (ATC)

| 구성 요소 | 기술 |
|----------|------|
| MQ | Kafka (내부 이벤트 파이프라인, 일일 수조 건 이벤트) |
| 저장소 | RocksDB (알림 큐잉/집계용) |
| 채널 | 이메일, SMS, 데스크톱, 인앱, 푸시 |
| 최적화 | ML 모델로 클릭률/알림 비활성화율 실시간 예측, 최적 전달 시간/채널 자동 선택 |

#### Airbnb

| 구성 요소 | 기술 |
|----------|------|
| 클라우드 | GCP |
| 푸시 | Firebase Cloud Messaging (FCM) |
| 이메일 | SendGrid |
| SMS | Twilio |

### 5.2 메시징 앱

#### WhatsApp — 50명 엔지니어로 20억 사용자

| 구성 요소 | 기술 |
|----------|------|
| 언어 | Erlang (BEAM VM) — 경량 프로세스, 프로세스당 독립 메모리/메일박스 |
| OS | FreeBSD |
| 서버 | Ejabberd (XMPP) |
| DB | Mnesia (Erlang 기반) |
| 규모 | 단일 서버 200만 동시 연결, 일일 1,000억+ 메시지 |
| 전달 보장 | Persistent WebSocket + 디바이스 ACK(더블 체크) + offline queue + 멱등성 |

#### Discord — Elixir + Rust 하이브리드

| 구성 요소 | 기술 |
|----------|------|
| 핵심 언어 | Elixir (BEAM VM) + Rust |
| API | Python (모놀리스) |
| 규모 | 1,100만 동시 사용자, 400~500대 Elixir 머신 클러스터 |
| 최적화 | Rust NIF로 SortedSet 구현해 Elixir 성능 병목 해소 |

### 5.3 이커머스

| 기업 | 클라우드 | MQ/이벤트 | 알림 특징 |
|------|---------|----------|----------|
| Amazon | AWS | SQS/SNS (자체 서비스) | 마이크로서비스 + 이벤트 드리븐 |
| Coupang | AWS | 마이크로서비스 (독립 스케일링) | 분당 50,000+ 주문 처리, 위치 기반 배송 푸시, AI/ML 실시간 물류 |

### 5.4 Notification-as-a-Service 플랫폼

| 플랫폼 | 유형 | GitHub Stars | 채널 | 특징 |
|--------|------|:-----------:|------|------|
| Novu | 오픈소스 (MIT) | 38,000+ | Inbox, Push, Email, SMS, Chat | 자체 호스팅 가능 (VPC, K8s, 서버리스) |
| Courier | 관리형 SaaS | - | 50+ 서비스 통합 | 드래그 앤 드롭 빌더, 제품+마케팅 통합 |
| Knock | 관리형 SaaS | - | 워크플로우 엔진 | 배칭 기능 내장 |
| OneSignal | 관리형 SaaS | - | Push, Email, SMS, 인앱 | 모바일 푸시 → 풀 메시징 플랫폼 확장 |

### 5.5 도메인별 정리

| 사례 | 핵심 MQ/기술 | 핵심 전략 | 적용 시나리오 |
|------|:----------:|----------|:----------:|
| Uber | Kafka + gRPC | 시퀀스 번호 ACK, 150만 동시 연결 | A, B |
| Netflix | Kafka + SQS | Push-Pull 하이브리드, 우선순위별 큐 분리 | B |
| LinkedIn | Kafka + RocksDB | ML 기반 최적 채널/시점 선택 | B, F |
| WhatsApp | Erlang/BEAM | 디바이스 ACK + offline queue + 멱등성 | A, B |
| Slack | - | 컨텍스트 인식 기본값, 디바이스 간 알림 억제 [R8] | F |
| 의료 | RabbitMQ/SQS | 30초→2분→5분 에스컬레이션 [R9] | A, C |
| 금융 | Kafka/RabbitMQ | Push→SMS→Email→우편 4단계 fallback + 감사 로그 | B, C |

### 5.6 산업 트렌드 (2024~2025)

| 트렌드 | 현황 |
|--------|------|
| 관리형 서비스 압도적 채택 | 관리형이 2025년 매출의 61.2% 차지. 서버리스 시장 $182억→$1,569억 (CAGR 24.1%) |
| 오픈소스 알림 플랫폼 성장 | Novu (38K+ stars) 선두. 자체 호스팅·코드 제어 필요한 팀의 대안 |
| AI/ML 통합 | ML 기반 지능형 알림 라우팅 (LinkedIn ATC, RL 기반 최적 시점) |
| 멀티클라우드 | CAGR 23.15%, 복원력·데이터 레지던시·최적 서비스 선택 목적 |
| 대형 테크 공통점 | Kafka가 사실상 표준 — Uber, Netflix, LinkedIn 모두 Kafka 기반 이벤트 파이프라인 |

---

## 7. DexWeaver 기술 스택 권장

### 현재 단계 (소규모, Firebase 생태계)

| 구성 요소 | 권장 기술 | 이유 |
|----------|----------|------|
| 큐잉/재시도 | Google Cloud Tasks | Firebase 네이티브 통합, 무료 티어, 자동 재시도/백오프 내장. 분당 10K 푸시까지 검증됨 |
| 큐 → FCM | Cloud Functions Worker | Firebase SDK v3.20.1+에서 Cloud Tasks 직접 지원 |
| 클라이언트 로컬 Queue | Room DB (Android) | 구조화된 알림 데이터 저장, offline-first |
| 주기적 리마인더 | WorkManager (Android) / BGTaskScheduler (iOS) | OS 배터리 최적화 존중, 재부팅 후에도 유지 |
| 상태 동기화 | Firestore 실시간 리스너 | 멀티 디바이스 동기화, 서버 권위 unread count |

### 규모 성장 시 전환 경로

```
Cloud Tasks (0~10만) → Cloud Pub/Sub (10만~100만) → Kafka (100만+)
```

| 규모 | MQ | 전환 이유 |
|:----:|:--:|----------|
| 0~10만 | Cloud Tasks | 운영 오버헤드 제로, Firebase 통합 |
| 10만~100만 | Cloud Pub/Sub | GCP 생태계 유지하면서 처리량 확장 |
| 100만+ | Kafka 또는 Pulsar | 수백만 msg/s, 이벤트 소싱, 실시간 분석 (Uber/Netflix/LinkedIn이 모두 Kafka 사용) |

---

## 8. 학술 논문 조사 결과 (21건)

### 7.1 전달 신뢰성 관련 (6건)

| # | 논문 | 발표 | 핵심 기여 |
|---|------|------|----------|
| [P1] | Reliable Push Notification for Mobile Users in Interactive Smart Mobile Applications | IoT 학회 | BLE 환경 DCAE 적용 콘텐츠 전달 성공률 개선 |
| [P3] | An Approach for Modeling and Analyzing Mobile Push Notification Services | IEEE SCC 2014 | Formal verification 기반 신뢰성·보안 취약점 분석 |
| [P4] | Using Adaptive Heartbeat Rate on Long-Lived TCP Connections | IEEE/ACM ToN 2017 | TCP heartbeat 동적 조정으로 배터리-신뢰성 최적화 |
| [P16] | A Comparative Evaluation of AMQP and MQTT over Unstable Networks | 2015 | 불안정 네트워크에서 AMQP vs MQTT 신뢰성 비교 |
| [P17] | Secure Push Notification Service Based on MQTT Protocol | 2017 | MQTT QoS 활용 저대역폭/고지연 환경 보안 push |
| [P18] | Design and Implementation of Push Notification System Based on MQTT Protocol | 2014 | MQTT 기반 자체 push 시스템 아키텍처 |

### 7.2 사용자 인게이지먼트 및 알림 피로도 관련 (6건)

| # | 논문 | 발표 | 핵심 발견 |
|---|------|------|----------|
| [P5] | Effects of Push Notifications on Learner Engagement | IEEE 2016 | Push가 인게이지먼트를 유의미하게 증가 |
| [P6] | Mobile Apps in Retail: Effect of Push Notification Frequency | 2021 | 과도한 알림은 효과 감소, 중요 알림이 묻힘 |
| [P7] | Consumer Acceptance of App Push Notifications: Systematic Review | 2020 | 과도한 빈도 → 비활성화/삭제 |
| [P8] | An In-Situ Study of Mobile Phone Notifications | 2016 | 인터럽트 가능한 순간 전달 시 응답 시간 49.7%↓ |
| [P9] | Exploring User's Experience of Push Notifications | 2022 | 부적절한 타이밍·빈도 → 성가신 경험 |
| [P10] | Empowering Individual Preferences in Mobile Notifications | IEEE Access 2025 | 3가지 수신 모드 설정 시 피로도↓ |

### 7.3 QoS 측정 및 평가 관련 (3건)

| # | 논문 | 발표 | 핵심 기여 |
|---|------|------|----------|
| [P11] | An Exploration of Evaluation Metrics for Mobile Push Notifications | ACM SIGIR 2016 | 관련성·적시성·참신성 3축 평가 |
| [P12] | Alert Notification as a Service | IEEE 2014 | 알림 서비스화 모델과 품질 관리 프레임워크 |
| [P15] | A Survey of Distributed Message Broker Queues | arXiv 2017 | 분산 메시지 브로커의 QoS별 전달 보장 비교 |

### 7.4 강화학습 기반 알림 최적화 관련 (4건)

| # | 논문 | 발표 | 핵심 기여 |
|---|------|------|----------|
| [P19] | Nurture: Notifying Users at the Right Time Using RL | ACM UbiComp 2018 | RL로 최적 알림 전달 시점 자동 식별 |
| [P20] | Offline RL for Mobile Notifications | ACM CIKM 2022 | 오프라인 RL 기반 sequential notification 최적화 |
| [P21] | Multi-objective Optimization of Notifications Using Offline RL | arXiv 2022 | 2개 RL 모델 동시 활용 (알림 선택 + 순간 식별) |
| [P22] | ML Approach to Manage Adaptive Push Notifications | ACM MobiQuitous 2020 | 지도학습 기반 적응형 알림으로 CTR 향상 |

### 7.5 보안 관련 (2건)

| # | 논문 | 발표 | 핵심 기여 |
|---|------|------|----------|
| [P23] | When Push Comes to Shove | ACM ACSAC 2023 | Web Push 보안 취약점 대규모 실증 분석 |
| [P24] | DaPanda: Detecting Aggressive Push Notifications in Android | ACM/IEEE ASE 2019 | 공격적 push notification 대규모 탐지·특성화 |

---

## 9. 조사 자료 디렉토리 구조

```
research/
├── 01-academic-research-survey.md        # 학술 논문 24건 조사 (9개 주제 영역)
├── 02-notification-reliability-patterns.md  # 알림 신뢰성 보장 패턴 및 산업 사례
└── 03-fcm-alternatives-message-queue.md    # Message Queue 대안 및 하이브리드 아키텍처
```

---

## 용어 해설

| 약어 | 풀이 | 설명 |
|------|------|------|
| RPS | Requests Per Second | 초당 처리 요청 수. 시스템의 처리량을 나타내는 단위 |
| msg/s | Messages Per Second | 초당 처리 메시지 수. MQ의 처리량을 나타내는 단위 |
| p99 | 99th Percentile Latency | 전체 요청 중 99%가 이 시간 이내에 완료됨을 의미하는 지연시간 지표 |
| CAGR | Compound Annual Growth Rate | 연평균 복합 성장률. 시장 규모의 연간 성장 속도 |
| ACK | Acknowledgement | 수신 확인. 메시지를 받았음을 송신자에게 알리는 응답 |
| DLQ | Dead Letter Queue | 처리 실패한 메시지를 별도 보관하는 큐. 이후 분석·재처리에 사용 |
| FIFO | First In, First Out | 선입선출. 먼저 들어온 메시지가 먼저 처리되는 순서 보장 방식 |
| TTL | Time To Live | 메시지의 유효 기간. 이 시간이 지나면 자동으로 만료·삭제됨 |
| SSE | Server-Sent Events | 서버에서 클라이언트로 단방향 실시간 데이터를 전송하는 HTTP 기반 프로토콜 |
| gRPC | Google Remote Procedure Call | Google이 개발한 고성능 RPC 프레임워크. 양방향 스트리밍과 바이너리 직렬화(Protobuf) 지원 |
| BEAM VM | Bogdan/Björn's Erlang Abstract Machine | Erlang/Elixir의 가상 머신. 경량 프로세스, 장애 격리, 핫 코드 배포가 특징 |
| XMPP | Extensible Messaging and Presence Protocol | 실시간 메시징을 위한 XML 기반 통신 프로토콜 |
| NIF | Native Implemented Function | Erlang/Elixir에서 C/Rust 등 네이티브 코드를 호출하는 인터페이스 |
| CTR | Click-Through Rate | 클릭률. 알림을 본 사용자 중 실제로 클릭한 비율 |
| DND | Do Not Disturb | 방해 금지 모드. 알림을 일시적으로 차단하는 디바이스 설정 |
| CDC | Change Data Capture | 데이터베이스 변경 사항을 실시간으로 감지·전파하는 기법 |
| MDP | Markov Decision Process | 마르코프 결정 과정. 강화학습에서 순차적 의사결정을 수학적으로 모델링하는 프레임워크 |
| QoS | Quality of Service | 서비스 품질. 메시지 전달의 신뢰성 수준을 나타내는 등급 체계 |

---

## 참고 문헌

### 학술 논문

- [P1] T. Yang et al., "Reliable Push Notification for Mobile Users in Interactive Smart Mobile Applications," IoT/센서 학회 Poster. [링크](https://www.researchgate.net/profile/Taehun-Yang/publication/325415954)
- [P2] "A Prototype Framework for High Performance Push Notifications," ResearchGate, 2017. [링크](https://www.researchgate.net/publication/317058597)
- [P3] "An Approach for Modeling and Analyzing Mobile Push Notification Services," IEEE SCC, 2014. [링크](https://ieeexplore.ieee.org/document/6930601)
- [P4] "Using Adaptive Heartbeat Rate on Long-Lived TCP Connections," IEEE/ACM ToN, 2017. [링크](https://dl.acm.org/doi/abs/10.1109/TNET.2017.2774275)
- [P5] "Effects of Push Notifications on Learner Engagement in a Mobile Learning App," IEEE, 2016. [링크](https://ieeexplore.ieee.org/document/7756930/)
- [P6] "Mobile Apps in Retail: Effect of Push Notification Frequency on App User Behavior," ResearchGate, 2021. [링크](https://www.researchgate.net/publication/351932011)
- [P7] "Consumer Acceptance of App Push Notifications: Systematic Review on the Influence of Frequency," 2020. [링크](https://www.researchgate.net/publication/343658086)
- [P8] "An In-Situ Study of Mobile Phone Notifications," ResearchGate, 2016. [링크](https://www.researchgate.net/publication/291009197)
- [P9] "Exploring User's Experience of Push Notifications: A Grounded Theory Approach," ResearchGate, 2022. [링크](https://www.researchgate.net/publication/358869000)
- [P10] "Empowering Individual Preferences in Mobile Notifications," IEEE Access, 2025. [링크](https://ieeexplore.ieee.org/iel8/6287639/10820123/10916668.pdf)
- [P11] "An Exploration of Evaluation Metrics for Mobile Push Notifications," ACM SIGIR, 2016. [링크](https://dl.acm.org/doi/10.1145/2911451.2914694)
- [P12] "Alert Notification as a Service," IEEE, 2014. [링크](https://ieeexplore.ieee.org/document/6859584/)
- [P13] "Analysis of Notification Methods with Respect to Mobile System Characteristics," ResearchGate, 2016. [링크](https://www.researchgate.net/publication/300337924)
- [P14] "Towards a More Reliable Store-and-forward Protocol for Mobile Text Messages," ResearchGate, 2018. [링크](https://www.researchgate.net/publication/326760677)
- [P15] V. John, "A Survey of Distributed Message Broker Queues," arXiv, 2017. [링크](https://arxiv.org/pdf/1704.00411)
- [P16] "A Comparative Evaluation of AMQP and MQTT Protocols over Unstable and Mobile Networks," ResearchGate, 2015. [링크](https://www.researchgate.net/publication/282914203)
- [P17] C. S. Villafuerte et al., "Secure Push Notification Service Based on MQTT Protocol for Mobile Platforms," ResearchGate, 2017. [링크](https://www.researchgate.net/publication/321534381)
- [P18] "Design and Implementation of Push Notification System Based on the MQTT Protocol," ResearchGate, 2014. [링크](https://www.researchgate.net/publication/266650239)
- [P19] "Nurture: Notifying Users at the Right Time Using Reinforcement Learning," ACM UbiComp, 2018. [링크](https://dl.acm.org/doi/10.1145/3267305.3274107)
- [P20] Y. Yuan et al., "Offline Reinforcement Learning for Mobile Notifications," ACM CIKM, 2022. [링크](https://dl.acm.org/doi/10.1145/3511808.3557083)
- [P21] "Multi-objective Optimization of Notifications Using Offline Reinforcement Learning," arXiv, 2022. [링크](https://arxiv.org/abs/2207.03029)
- [P22] "Machine Learning Approach to Manage Adaptive Push Notifications for Improving User Experience," ACM MobiQuitous, 2020. [링크](https://dl.acm.org/doi/abs/10.1145/3448891.3448956)
- [P23] "When Push Comes to Shove: Empirical Analysis of Web Push Implementations in the Wild," ACM ACSAC, 2023. [링크](https://dl.acm.org/doi/10.1145/3627106.3627186)
- [P24] "DaPanda: Detecting Aggressive Push Notifications in Android," ACM/IEEE ASE, 2019. [링크](https://dl.acm.org/doi/abs/10.1109/ASE.2019.00017)

### 산업 보고서 및 기술 자료

- [R1] "Understanding FCM Message Delivery on Android," Firebase Blog, 2024. [링크](https://firebase.blog/posts/2024/07/understand-fcm-delivery-rates/)
- [R2] "The Push Notification Delivery Rate Report 2021," MoEngage, 2021. [링크](https://www.moengage.com/blog/the-push-notifications-delivery-rate-report-is-here/)
- [R3] "What is FCM Aggregated Delivery Data," Medium, 2019. [링크](https://medium.com/firebase-developers/what-is-fcm-aggregated-delivery-data-d6d68396b83b)
- [R4] "DontKillMyApp.com — OEM 배터리 최적화 영향." [링크](https://dontkillmyapp.com/)
- [R5] "Amazon SNS Message Delivery Retries," AWS Documentation. [링크](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)
- [R6] "Digest Notifications Best Practices," Novu Blog. [링크](https://novu.co/blog/digest-notifications-best-practices-example/)
- [R7] "How to Help Users Avoid Notification Fatigue," MagicBell Blog. [링크](https://www.magicbell.com/blog/help-your-users-avoid-notification-fatigue)
- [R8] "How Slack Builds Smart Notification Systems Users Want," Courier Blog. [링크](https://www.courier.com/blog/how-slack-builds-smart-notification-systems-users-want)
- [R9] "Evaluating Effectiveness of Clinical Alerts," PMC. [링크](https://pmc.ncbi.nlm.nih.gov/articles/PMC3243147/)
- [R10] "MQTT QoS Levels Explained," HiveMQ Blog. [링크](https://www.hivemq.com/blog/mqtt-essentials-part-6-mqtt-quality-of-service-levels/)
- [R11] "On the Performance of Web Services, GCM and FCM," Digital Communications and Networks, 2019. [링크](https://www.sciencedirect.com/science/article/pii/S235286481830035X)
- [R12] "Outbox Pattern for Reliable Messaging — System Design," GeeksforGeeks. [링크](https://www.geeksforgeeks.org/system-design/outbox-pattern-for-reliable-messaging-system-design/)
- [R13] "CQRS Pattern," Microsoft Azure Architecture Center. [링크](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [R14] "Choosing The Right Message Queue for Notification Systems," DEV Community. [링크](https://dev.to/nikl/choosing-the-right-message-queue-technology-for-your-notification-system-2mji)
- [R15] "FCM Architectural Overview," Firebase Documentation. [링크](https://firebase.google.com/docs/cloud-messaging/fcm-architecture)

### MQ 벤치마크 및 산업 사례 자료

- [R16] "I Benchmarked Kafka, RabbitMQ, and Redis Streams," Medium, 2024. [링크](https://medium.com/@ThreadSafeDiaries/i-benchmarked-kafka-rabbitmq-and-redis-streams-the-winner-surprised-me-cf3f484eb7b2)
- [R17] "Benchmarking Redis, Dragonfly, Kafka, MQTT, and RabbitMQ for High Load Messaging," DevOps.dev, 2024. [링크](https://blog.devops.dev/benchmarking-redis-dragonfly-kafka-mqtt-and-rabbitmq-for-high-load-messaging-5a6ca8c2b853)
- [R18] "Kafka Fastest Messaging System (Benchmarking vs RabbitMQ vs Pulsar)," Confluent Blog. [링크](https://www.confluent.io/blog/kafka-fastest-messaging-system/)
- [R19] "Comparison: Apache Pulsar vs RabbitMQ vs NATS JetStream," StreamNative Blog. [링크](https://streamnative.io/blog/comparison-of-messaging-platforms-apache-pulsar-vs-rabbitmq-vs-nats-jetstream)
- [R20] "Uber's Next Gen Push Platform on gRPC," Uber Engineering Blog. [링크](https://www.uber.com/blog/ubers-next-gen-push-platform-on-grpc/)
- [R21] "Uber's Real-Time Push Platform (RAMEN)," Uber Engineering Blog. [링크](https://www.uber.com/blog/real-time-push-platform/)
- [R22] "Netflix RENO — Rapid Event Notification System," InfoQ, 2022. [링크](https://www.infoq.com/news/2022/03/netflix-reno/)
- [R23] "How Kafka Is Used by Netflix," Confluent Blog. [링크](https://www.confluent.io/blog/how-kafka-is-used-by-netflix/)
- [R24] "Air Traffic Controller: Member-First Notifications at LinkedIn," LinkedIn Engineering Blog, 2018. [링크](https://engineering.linkedin.com/blog/2018/03/air-traffic-controller--member-first-notifications-at-linkedin)
- [R25] "How WhatsApp Handles 40 Billion Messages Per Day," ByteByteGo, 2024. [링크](https://blog.bytebytego.com/p/how-whatsapp-handles-40-billion-messages)
- [R26] "Using Rust to Scale Elixir for 11 Million Concurrent Users," Discord Engineering Blog. [링크](https://discord.com/blog/using-rust-to-scale-elixir-for-11-million-concurrent-users)
- [R27] "Firebase Cloud Tasks — Task Queue Functions," Firebase Documentation. [링크](https://firebase.google.com/docs/functions/task-functions)
- [R28] "Managing 10K Push Notifications per Minute with Cloud Tasks," DEV Community. [링크](https://dev.to/vunguyendev/how-i-manage-a-ten-thousand-push-notifications-a-minute-firebase-1phb)
- [R29] "Novu — Open-Source Notification Infrastructure," GitHub. [링크](https://github.com/novuhq/novu)
- [R30] "Best Notification Infrastructure Software 2025," Courier Blog. [링크](https://www.courier.com/blog/best-notification-infrastructure-software-2025)
