# FCM 대안 조사: Message Queue 기반 알림 전송 아키텍처

## 목차
1. [RabbitMQ를 활용한 Push Notification](#1-rabbitmq를-활용한-push-notification)
2. [기타 Message Queue 기술 비교](#2-기타-message-queue-기술-비교)
3. [하이브리드 아키텍처](#3-하이브리드-아키텍처)
4. [클라이언트 사이드 Message Queue + Cron Reminder 패턴](#4-클라이언트-사이드-message-queue--cron-reminder-패턴)

---

## 1. RabbitMQ를 활용한 Push Notification

### 1.1 아키텍처 개요

RabbitMQ는 AMQP(Advanced Message Queuing Protocol) 기반의 메시지 브로커로, 알림 시스템에서 **미들웨어** 역할을 수행할 수 있다.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Application │────▶│   RabbitMQ   │────▶│  Notification    │────▶│  FCM/APNs   │
│   Server     │     │   Broker     │     │  Worker(Consumer)│     │  (최종 전송) │
└──────────────┘     └──────────────┘     └──────────────────┘     └─────────────┘
                           │
                     ┌─────┴─────┐
                     │           │
              ┌──────┴──┐  ┌────┴────┐
              │ Push Q  │  │ Email Q │  ...
              └─────────┘  └─────────┘
```

**동작 방식:**
- 애플리케이션에서 알림 이벤트를 RabbitMQ의 Exchange로 발행(Publish)
- Exchange는 라우팅 규칙(Direct, Topic, Fanout)에 따라 적절한 Queue로 메시지를 분배
- 각 알림 유형(Push, Email, SMS)별 전용 Queue를 운영
- Consumer(Worker)가 Queue에서 메시지를 소비하며 실제 전송 처리

### 1.2 전송 보장 메커니즘(Delivery Guarantees)

| 보장 수준 | 설명 | RabbitMQ 지원 |
|-----------|------|--------------|
| **At-most-once** | 메시지가 최대 한 번 전송됨 (유실 가능) | 기본 모드 (auto-ack) |
| **At-least-once** | 메시지가 최소 한 번 전송됨 (중복 가능) | Manual ACK + Publisher Confirms + Persistent Queue |
| **Exactly-once** | 메시지가 정확히 한 번만 전송됨 | 완벽한 지원은 어려움. Idempotent Consumer 패턴으로 근사 구현 |

### 1.3 Acknowledgment 메커니즘

RabbitMQ의 AMQP 모델은 양방향 확인 메커니즘을 제공한다:

**Publisher Confirms (생산자 확인):**
- Publisher가 메시지를 Broker에 전송한 후, Broker가 메시지 수신을 확인하는 비동기 메커니즘
- 메시지가 Queue에 안전하게 저장되었음을 보장

**Consumer Acknowledgments (소비자 확인):**
- Consumer가 메시지를 성공적으로 처리한 후 Broker에 ACK 전송
- ACK를 받지 못한 메시지는 다른 Consumer에게 재전송
- `basic.ack` (성공), `basic.nack` (실패, 재큐잉 가능), `basic.reject` (거부) 지원

### 1.4 Dead Letter Queue (DLQ)

전송 실패한 알림을 처리하기 위한 핵심 메커니즘:

```
┌────────────┐     실패/TTL 만료     ┌──────────────────┐
│  Main Queue │──────────────────────▶│  Dead Letter Queue│
└────────────┘                       └──────────────────┘
                                              │
                                     ┌────────┴────────┐
                                     │   재처리 Worker  │
                                     │   (분석/알림)    │
                                     └─────────────────┘
```

**DLQ로 이동하는 경우:**
- Consumer가 메시지를 reject/nack 처리
- 메시지 TTL(Time-To-Live) 만료
- Queue의 최대 길이 초과
- 최대 재시도 횟수 초과

**활용 방안:**
- 실패 알림에 대한 모니터링 및 분석
- 일정 시간 후 자동 재시도
- 관리자에게 실패 보고 알림

### 1.5 FCM 전송 모델과의 비교

| 항목 | FCM | RabbitMQ + FCM |
|------|-----|----------------|
| **전송 보장** | Best-effort (at-most-once). 오프라인 시 최대 4주 저장 후 전달 | At-least-once 보장. DLQ로 실패 추적 |
| **메시지 우선순위** | High/Normal 2단계 | 무제한 Priority Queue 구성 가능 |
| **실패 처리** | 자동 재시도 (제한적), 에러 응답 코드 제공 | DLQ + 커스텀 재시도 로직 + Exponential Backoff |
| **메시지 순서** | 보장하지 않음 | FIFO 보장 가능 |
| **모니터링** | Firebase Console (제한적) | 상세한 Queue 모니터링, Consumer 상태 확인 가능 |
| **처리량 제한** | Quota 제한 존재 (topic 600건/초 등) | 자체 인프라 제한만 적용 |
| **복잡도** | 낮음 (SaaS) | 높음 (자체 인프라 운영 필요) |

### 1.6 구현 복잡도

- **난이도:** 중~상
- RabbitMQ 클러스터 구축 및 운영 필요
- Consumer 워커 개발 및 스케일링 관리
- CloudAMQP 같은 Managed Service를 사용하면 운영 부담 감소

### 1.7 실제 사례

- **스타트업:** 낮은 볼륨의 트랜잭션 알림에 RabbitMQ를 사용하여 이메일, SMS, Push를 통합 관리
- **RabbitMQ + Firebase + Socket.IO:** RabbitMQ로 메시지를 안정적으로 큐잉하고, Firebase/Socket.IO로 실시간 전달하는 하이브리드 구성

---

## 2. 기타 Message Queue 기술 비교

### 2.1 Apache Kafka

**아키텍처 개요:**
- 분산 이벤트 스트리밍 플랫폼
- Topic 기반 Pub/Sub 모델, Partition을 통한 병렬 처리
- Consumer Group으로 수평 확장
- Pull 기반 메시지 소비

**전송 보장:**
- At-least-once (기본)
- Exactly-once semantics (Idempotent Producer + Transactional API)
- 메시지를 디스크에 영구 저장하며 보존 기간 설정 가능

**알림 시스템에서의 장점:**
- 초당 수백만 건의 높은 처리량(Throughput)
- 메시지 재처리(Replay) 가능 — 알림 감사 로그 용도
- Consumer Group으로 알림 워커 수평 확장 용이

**알림 시스템에서의 단점:**
- Point-to-point 큐잉에는 부적합 (기본이 Pub/Sub)
- 운영 복잡도가 높음 (ZooKeeper/KRaft 클러스터 관리)
- 저지연(Low latency) 실시간 알림에는 과한 솔루션일 수 있음

**실제 사례:**
- 배달 앱에서 대량 알림 처리 (주문 상태 변경 이벤트 → Push 알림)
- **GeTui**(중국 대형 Push 알림 서비스): Kafka에서 Apache Pulsar로 전환

**구현 복잡도:** 상

---

### 2.2 Redis Streams / Redis Pub/Sub

**아키텍처 개요:**

| 기능 | Redis Pub/Sub | Redis Streams |
|------|-------------|--------------|
| 모델 | Fire-and-forget Pub/Sub | 로그 기반 스트림 (Kafka 유사) |
| 영속성 | 없음 (메모리만) | 있음 (AOF/RDB 저장) |
| Consumer Group | 미지원 | 지원 |
| 메시지 재처리 | 불가 | 가능 |

**전송 보장:**
- **Redis Pub/Sub:** At-most-once — Subscriber가 오프라인이면 메시지 유실
- **Redis Streams:** At-least-once — Consumer Group + XACK 메커니즘으로 미확인 메시지 재전송

**알림 시스템에서의 장점:**
- 매우 낮은 지연 시간(Sub-millisecond)
- 기존 Redis 인프라를 활용 가능
- 캐시 + 큐 + Pub/Sub을 단일 시스템으로 통합

**알림 시스템에서의 단점:**
- Redis Pub/Sub은 영속성이 없어 알림 유실 가능
- 메모리 기반이므로 대량 메시지 저장에 비용이 높음
- Kafka/RabbitMQ 대비 메시지 라우팅 기능이 제한적

**실제 사례:**
- 금융 기관에서 실시간 거래 알림에 Redis Pub/Sub 사용 (저지연 필수)
- Redis Streams로 알림 큐를 구성하여 소규모 알림 시스템 운영

**구현 복잡도:** 하~중

---

### 2.3 Amazon SQS / SNS

**아키텍처 개요:**
```
                    ┌──── SQS Queue ──── Push Worker
SNS Topic ─────────┼──── SQS Queue ──── Email Worker
                    └──── SQS Queue ──── SMS Worker
                    └──── Lambda (직접 처리)
```

- **SNS (Simple Notification Service):** Push 기반 Pub/Sub — 메시지를 즉시 여러 구독자에게 전달
- **SQS (Simple Queue Service):** Pull 기반 메시지 큐 — 비동기 처리를 위한 버퍼링

**전송 보장:**
- **SQS Standard:** At-least-once (순서 보장 안 됨)
- **SQS FIFO:** Exactly-once 처리 + 순서 보장 (처리량 제한: 3,000 msg/sec)
- **SNS:** At-least-once (구독자에게 최소 한 번 전달)
- 메시지 보존 기간: 최대 14일

**알림 시스템에서의 장점:**
- **완전 관리형(Fully Managed)** — 서버 운영 불필요
- AWS 생태계(Lambda, CloudWatch 등)와의 자연스러운 통합
- DLQ 기본 지원
- 자동 스케일링

**알림 시스템에서의 단점:**
- AWS 종속(Vendor Lock-in)
- 메시지당 과금 — 대량 처리 시 비용 증가
- SQS FIFO의 처리량 제한

**실제 사례:**
- **Slack:** SNS를 사용하여 전 세계 모바일/데스크톱 클라이언트에 실시간 Push 알림 전달
- 다수의 AWS 기반 SaaS에서 SNS → SQS Fanout 패턴으로 알림 시스템 구축

**구현 복잡도:** 하 (AWS 환경 기준)

---

### 2.4 NATS

**아키텍처 개요:**
- 경량 고성능 메시징 시스템 (Cloud Native, CNCF 프로젝트)
- Core NATS: 순수 Pub/Sub (메모리 기반, 영속성 없음)
- **JetStream:** 영속성 + 스트리밍 + Exactly-once 지원 (선택적 활성화)

**전송 보장:**

| 모드 | 보장 수준 |
|------|----------|
| Core NATS | At-most-once |
| JetStream | At-least-once, Exactly-once |

- JetStream의 Consumer가 ACK 추적을 담당하며, 미확인(un-acked) 메시지는 자동 재전송
- 단일 연결에서 발행된 메시지의 순서 보장

**알림 시스템에서의 장점:**
- 극도로 낮은 지연 시간과 높은 처리량
- 바이너리 크기가 작고 리소스 소모가 적음 (Edge/IoT에 적합)
- JetStream으로 필요 시 영속성 추가 가능
- Key-Value Store 내장 (디바이스 토큰 관리에 활용 가능)

**알림 시스템에서의 단점:**
- Core NATS는 영속성이 없어 메시지 유실 가능
- RabbitMQ/Kafka 대비 생태계와 커뮤니티가 작음
- 복잡한 라우팅(Exchange/Binding) 기능 부재

**실제 사례:**
- Kubernetes 클러스터 내부 마이크로서비스 간 이벤트 전달
- IoT 디바이스 알림에서 경량 메시징으로 사용

**구현 복잡도:** 하~중

---

### 2.5 Apache Pulsar

**아키텍처 개요:**
- **저장(Storage)과 서빙(Serving)을 분리**한 아키텍처 (BookKeeper + Broker)
- Pub/Sub + Message Queue 모두 지원 (Shared Subscription으로 Queue 시뮬레이션)
- Multi-tenancy 네이티브 지원
- Geo-replication 내장

**전송 보장:**
- At-least-once (기본)
- Idempotent writes 지원 (중복 메시지 저장 방지)
- Exactly-once processing은 제한적 (transactional reads 미완전 지원)

**알림 시스템에서의 장점:**
- 저장과 서빙 분리로 독립적 수평 확장 가능
- Multi-tenancy로 여러 알림 서비스를 단일 클러스터에서 운영
- Geo-replication으로 글로벌 알림 시스템에 적합
- Kafka보다 유연한 Subscription 모델

**알림 시스템에서의 단점:**
- 운영 복잡도가 Kafka보다도 높음 (BookKeeper + Broker + ZooKeeper)
- 커뮤니티가 Kafka 대비 작음
- 학습 곡선이 가파름

**실제 사례:**
- **GeTui (개추):** 중국 최대 Push 알림 서비스 — Kafka에서 Pulsar로 마이그레이션. Message Queue 지원과 멀티 테넌시가 주요 전환 이유
- Yahoo/Verizon Media에서 알림 및 메시징에 Pulsar 사용

**구현 복잡도:** 상

---

### 2.6 종합 비교표

| 기술 | 전송 보장 | 영속성 | 처리량 | 지연시간 | 모바일 알림 적합도 | 운영 복잡도 |
|------|----------|--------|--------|---------|------------------|-----------|
| **RabbitMQ** | At-least-once | O | 중 | 낮음 | ★★★★ | 중 |
| **Kafka** | Exactly-once 가능 | O | 매우 높음 | 중 | ★★★ | 상 |
| **Redis Streams** | At-least-once | O (제한적) | 높음 | 매우 낮음 | ★★★ | 하 |
| **Redis Pub/Sub** | At-most-once | X | 높음 | 매우 낮음 | ★★ | 하 |
| **SQS/SNS** | At-least-once ~ Exactly-once | O | 높음 | 중 | ★★★★★ | 하 |
| **NATS JetStream** | At-least-once ~ Exactly-once | O | 매우 높음 | 매우 낮음 | ★★★ | 중 |
| **Apache Pulsar** | At-least-once | O | 매우 높음 | 낮음 | ★★★★ | 상 |

---

## 3. 하이브리드 아키텍처

### 3.1 Message Queue를 FCM/APNs 앞단에 배치하는 신뢰성 계층

FCM/APNs만 사용할 때 발생하는 주요 문제점:
- FCM은 **Best-effort 전송**이므로 100% 전달 보장이 불가
- 토큰 만료(270일 이상 미사용 시), 앱 삭제 시 무효 토큰 누적
- 플랫폼별 제한 (iOS의 Silent Notification은 20~21분당 1회 제한, 저전력 모드 시 차단)
- Peak 시간대 Rate Limiting

**해결 아키텍처:**
```
┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌──────────┐
│  App     │───▶│ Message  │───▶│ Notification │───▶│ FCM/APNs │───▶│  Device  │
│  Server  │    │  Queue   │    │   Gateway    │    │          │    │          │
└──────────┘    └──────────┘    └──────┬───────┘    └──────────┘    └──────────┘
                     │                 │
                     │           ┌─────┴─────┐
                ┌────┴────┐     │  Fallback  │
                │   DLQ   │     │  Router    │
                └─────────┘     └─────┬──────┘
                                      │
                              ┌───────┼────────┐
                              ▼       ▼        ▼
                            Email    SMS    In-App
```

**핵심 이점:**
- Message Queue가 **버퍼 역할**을 하여 트래픽 스파이크 흡수
- 전송 실패 시 **자동 재시도** 및 **DLQ를 통한 실패 추적**
- **멀티 채널 Fallback** 가능 (Push 실패 → Email → SMS)
- 알림 우선순위 관리 (보안 알림 > 프로모션 알림)

### 3.2 Store-and-Forward 패턴

메시지를 영구 저장소에 먼저 저장한 뒤, 비동기적으로 전송하는 패턴.

```
1. 알림 요청 → DB에 저장 (status: PENDING)
2. Worker가 PENDING 상태의 알림을 조회
3. FCM/APNs로 전송 시도
4. 성공 → status: SENT 업데이트
5. 실패 → retry_count 증가, 재시도 또는 DLQ 이동
```

**구현 시 고려사항:**
- **TTL 관리:** RabbitMQ의 Delayed Message Plugin을 사용하여 메시지 유효 기간 설정. 유효 기간이 지난 메시지는 자동 폐기하여 재접속 시 불필요한 알림 폭주 방지
- **멱등성(Idempotency):** 중복 전송 방지를 위해 메시지 ID 기반 중복 체크
- **순서 보장:** FIFO Queue 또는 시퀀스 번호 활용

**FCM의 기본 Store-and-Forward:**
- FCM 서버는 오프라인 기기에 대해 최대 **4주간** 메시지를 저장
- 기기 재접속 시 순서대로 전달
- 그러나 서버 측에서의 전송 상태 추적이 불가하여 신뢰성 확인이 어려움

### 3.3 Outbox 패턴 (Transactional Outbox)

분산 시스템에서 **데이터 변경과 메시지 발행의 원자성**을 보장하는 패턴.

```
┌─────────────────────────────────────────────┐
│              Single Transaction              │
│                                             │
│  ┌──────────────┐     ┌──────────────────┐  │
│  │ Business     │     │  Outbox Table    │  │
│  │ Data Update  │     │  (메시지 저장)   │  │
│  └──────────────┘     └──────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
                    │
            ┌───────┴────────┐
            │ Message Relay  │ (Polling 또는 CDC)
            │ (Background)   │
            └───────┬────────┘
                    │
            ┌───────▼────────┐
            │ Message Broker │ (RabbitMQ/Kafka)
            │ → FCM/APNs    │
            └────────────────┘
```

**Outbox 테이블 구조 예시:**
```sql
CREATE TABLE notification_outbox (
    id            UUID PRIMARY KEY,
    aggregate_id  VARCHAR(255),     -- 관련 엔티티 ID
    event_type    VARCHAR(100),     -- 'PUSH_NOTIFICATION', 'EMAIL' 등
    payload       JSONB,            -- 알림 내용
    status        VARCHAR(20),      -- 'PENDING', 'SENT', 'FAILED'
    retry_count   INT DEFAULT 0,
    created_at    TIMESTAMP,
    processed_at  TIMESTAMP
);
```

**Message Relay 전략:**
1. **Polling 방식:** Background Worker가 주기적으로 Outbox 테이블에서 PENDING 메시지를 조회하여 전송
2. **CDC(Change Data Capture) 방식:** Debezium 같은 CDC 도구를 사용하여 DB 트랜잭션 로그를 감시하고, 새 Outbox 레코드를 자동으로 Message Broker에 발행
3. **Event-Driven 방식:** Outbox 레코드 생성 시 트리거/이벤트로 즉시 전송

**장점:**
- 비즈니스 로직과 알림 발송의 **원자성 보장** (주문 생성 ↔ 주문 알림이 반드시 함께 처리)
- 서비스 장애 시에도 메시지 유실 방지
- 감사 로그(Audit Trail) 자동 생성
- 수평 확장 가능

**단점:**
- 시스템 복잡도 증가
- 중복 전송 가능 → Idempotent Consumer 필요
- Outbox 테이블 정기 정리(Cleanup) 필요
- DB에 추가적인 I/O 부하

**실제 사례:**
- 이커머스 플랫폼: 주문 처리와 주문 확인 알림/이메일을 원자적으로 보장
- 금융 서비스: 거래 처리와 감사 로그 알림을 동시에 보장
- 라이드셰어링 앱: 드라이버-승객 매칭 알림의 안정적 전송

### 3.4 CQRS + Event Sourcing을 활용한 알림 시스템

**아키텍처 개요:**
```
┌───────────┐    Command     ┌───────────────┐
│  Client   │───────────────▶│  Write Model  │
└───────────┘                └───────┬───────┘
                                     │
                              ┌──────▼──────┐
                              │ Event Store │ (모든 이벤트를 순차 저장)
                              └──────┬──────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
            │ Read Model   │ │ Notification │ │   Analytics  │
            │ (Query)      │ │   Handler    │ │   Handler    │
            └──────────────┘ └──────┬───────┘ └──────────────┘
                                    │
                             ┌──────▼───────┐
                             │  FCM/APNs    │
                             │  Email/SMS   │
                             └──────────────┘
```

**동작 원리:**
1. Command(예: "주문 생성")가 Write Model에서 처리됨
2. 상태 변경이 Event로 Event Store에 저장 (예: `OrderCreated`, `PaymentCompleted`)
3. Notification Handler가 Event를 구독하여 자동으로 알림을 생성/전송
4. 모든 이벤트가 영구 저장되므로 알림 재전송, 감사 추적이 가능

**알림 시스템에서의 장점:**
- 이벤트 기반으로 알림이 자동 트리거되어 비즈니스 로직과 알림 로직의 **완전한 분리**
- Event Store가 불변 로그 역할 → 알림 이력 완벽 추적
- 이벤트 재생(Replay)으로 누락된 알림 재전송 가능
- Read Model을 알림 상태 조회에 최적화 가능

**알림 시스템에서의 단점:**
- 아키텍처 복잡도가 매우 높음
- Eventual Consistency로 인해 알림 전송에 약간의 지연 가능
- Event Store 관리 및 스냅샷 전략 필요
- 소규모 시스템에는 과한 설계(Over-engineering)

**구현 복잡도:** 상

---

## 4. 클라이언트 사이드 Message Queue + Cron Reminder 패턴

### 4.1 로컬 알림 Queue 저장 패턴

앱 내부에 미확인/미읽은 알림을 로컬 Queue에 저장하고, 주기적으로 리마인더를 표시하는 전략.

```
┌─────────────────────────────────────────────────┐
│                  Mobile App                      │
│                                                 │
│  ┌─────────────┐     ┌──────────────────────┐   │
│  │ FCM/APNs   │────▶│  Local Notification  │   │
│  │ Receiver   │     │  Queue (SQLite/Room) │   │
│  └─────────────┘     └──────────┬───────────┘   │
│                                 │               │
│                        ┌────────┴────────┐      │
│                        │  Periodic Sync  │      │
│                        │  (WorkManager / │      │
│                        │  BGTaskScheduler)│      │
│                        └────────┬────────┘      │
│                                 │               │
│                        ┌────────▼────────┐      │
│                        │ Local           │      │
│                        │ Notification    │      │
│                        │ (리마인더 표시) │      │
│                        └─────────────────┘      │
│                                                 │
└─────────────────────────────────────────────────┘
```

**로컬 Queue 구조 예시 (SQLite/Room):**
```sql
CREATE TABLE local_notification_queue (
    id              INTEGER PRIMARY KEY,
    notification_id TEXT UNIQUE,       -- 서버 알림 ID
    title           TEXT,
    body            TEXT,
    priority        INTEGER,           -- 우선순위
    status          TEXT,              -- 'UNREAD', 'READ', 'DISMISSED', 'REMINDED'
    received_at     TIMESTAMP,
    read_at         TIMESTAMP,
    reminder_count  INTEGER DEFAULT 0, -- 리마인더 횟수
    next_reminder   TIMESTAMP,         -- 다음 리마인더 시각
    max_reminders   INTEGER DEFAULT 3  -- 최대 리마인더 횟수
);
```

### 4.2 주기적 동기화 (Cron-like 패턴)

**Android: WorkManager**
- `PeriodicWorkRequest`를 사용하여 **최소 15분 간격**으로 반복 작업 수행
- 기기 재부팅 후에도 작업이 유지됨
- 배터리 최적화 및 Doze 모드를 존중하면서 실행
- `ExistingPeriodicWorkPolicy.KEEP`으로 중복 작업 방지

```kotlin
// Android WorkManager 예시
val reminderWork = PeriodicWorkRequestBuilder<NotificationReminderWorker>(
    1, TimeUnit.HOURS  // 1시간마다 실행
)
    .setConstraints(Constraints.Builder()
        .setRequiresBatteryNotLow(true)
        .build())
    .addTag("notification_reminder")
    .build()

WorkManager.getInstance(context)
    .enqueueUniquePeriodicWork(
        "notification_reminder",
        ExistingPeriodicWorkPolicy.KEEP,
        reminderWork
    )
```

**iOS: BGTaskScheduler**
- `BGAppRefreshTask`: 짧은 주기(약 30초 실행 시간)의 백그라운드 작업
- `BGProcessingTask`: 긴 처리 시간(수 분)의 백그라운드 작업
- OS가 실행 시점을 최적화하여 결정 (정확한 주기 보장은 불가)
- 사용자 앱 사용 패턴에 따라 실행 빈도가 달라짐

```swift
// iOS BGTaskScheduler 예시
BGTaskScheduler.shared.register(
    forTaskWithIdentifier: "com.app.notificationReminder",
    using: nil
) { task in
    self.handleNotificationReminder(task: task as! BGAppRefreshTask)
}

func scheduleReminder() {
    let request = BGAppRefreshTaskRequest(
        identifier: "com.app.notificationReminder"
    )
    request.earliestBeginDate = Date(timeIntervalSinceNow: 3600) // 최소 1시간 후
    try? BGTaskScheduler.shared.submit(request)
}
```

### 4.3 Batching과 Digest 알림 전략

개별 알림을 모아서 요약 알림으로 전달하여 사용자 피로도를 줄이는 전략.

**Digest 유형:**

| 유형 | 주기 | 적합한 알림 |
|------|------|-----------|
| **즉시(Immediate)** | 실시간 | 보안 알림, 결제 알림 |
| **Near-real-time** | 5~15분 | 채팅 메시지, 주문 업데이트 |
| **시간별(Hourly)** | 1시간 | SNS 활동, 좋아요/댓글 |
| **일간(Daily)** | 1일 | 뉴스 요약, 추천 콘텐츠 |
| **주간(Weekly)** | 1주 | 활동 보고서, 주간 하이라이트 |

**Batching 로직 예시:**
```
1. 알림 수신 → 로컬 Queue에 저장
2. 동일 카테고리 알림이 N건 이상 누적 → Digest로 변환
   예: "홍길동님 외 5명이 회원님의 게시글에 좋아요를 눌렀습니다"
3. 시간 기반: 특정 시간대에 누적된 알림을 요약
   예: "오늘 읽지 않은 알림 12건이 있습니다"
```

### 4.4 에스컬레이션 패턴 (Escalation Pattern)

알림의 중요도와 사용자 반응에 따라 채널을 단계적으로 확대하는 전략.

```
시간축 →

[Push 알림]
    │
    ├── 확인됨 → 종료
    │
    ├── 미확인 (5분~2시간) → [리마인더 Push]
    │                          │
    │                          ├── 확인됨 → 종료
    │                          │
    │                          ├── 미확인 (2~24시간) → [Digest 알림 / In-App]
    │                          │                         │
    │                          │                         ├── 확인됨 → 종료
    │                          │                         │
    │                          │                         └── 미확인 (24시간+) → [Email 전송]
    │                          │
    │                          └── 채널 차단 → [대체 채널로 Fallback]
    │
    └── Push 전송 실패 → [즉시 Fallback 채널]
```

**에스컬레이션 타이밍 가이드라인:**

| 알림 유형 | 1차 (Push) | 2차 (리마인더) | 3차 (Digest) | 4차 (Email/SMS) |
|-----------|-----------|-------------|------------|----------------|
| **보안 알림** | 즉시 | 2~5분 | - | 5분 (SMS 동시) |
| **결제/주문** | 즉시 | 30분 | 2시간 | 24시간 |
| **소셜 활동** | 즉시 | - | 1시간(배치) | 일간 요약 |
| **마케팅** | 즉시 | - | - | 주간 Digest |

**Fallback 채널 선택 기준:**

| 채널 | 도달률 | 비용 | 콘텐츠 풍부도 | 사용 시점 |
|------|--------|------|-------------|----------|
| **Push** | 중 | 매우 낮음 | 중 | 1차 전송 |
| **In-App** | 높음 (앱 사용 시) | 없음 | 높음 | 앱 활성 상태 |
| **Email** | 높음 | 낮음 | 매우 높음 | 상세 내용 전달, 장기 미확인 |
| **SMS** | 매우 높음 | 높음 | 낮음 | 긴급 알림, 최종 Fallback |
| **Slack/Teams** | 높음 (업무) | 낮음 | 중 | B2B/업무 알림 |

**모니터링 지표:**
- Fallback 사용률 (20~30% 초과 시 1차 채널 문제 조사 필요)
- 채널별 전달 시간 분석
- 알림 제공자 장애 빈도
- 사용자별 채널 선호도 및 반응률

### 4.5 구현 시 고려사항

**배터리 및 성능 최적화:**
- WorkManager/BGTaskScheduler 모두 OS가 배터리 상태를 고려하여 실행 시점을 조절
- 불필요한 Wake-up 최소화: 확인할 알림이 없으면 빠르게 종료
- 네트워크 요청은 Wi-Fi 연결 시에만 수행하는 옵션 제공

**사용자 경험:**
- 리마인더 빈도에 대한 사용자 설정 제공
- "방해 금지(DND)" 시간대 존중
- Digest 알림의 그루핑 기준을 사용자가 커스텀 가능

**데이터 동기화:**
- 서버와의 주기적 동기화로 로컬 Queue의 정합성 유지
- 서버에서 "읽음" 상태가 변경된 알림은 로컬에서도 업데이트
- 충돌 해결(Conflict Resolution) 전략 필요 (Last-Write-Wins 등)

---

## 5. 종합 권장 사항

### DexWeaver FCM QoS 프로젝트에 대한 적용 제안

| 접근법 | 적합도 | 이유 |
|--------|--------|------|
| **RabbitMQ + FCM** | ★★★★ | FCM 앞단에 신뢰성 계층 추가. 중간 규모에 적합 |
| **SQS/SNS + FCM** | ★★★★★ | Serverless 아키텍처와 최적 조합. 운영 부담 최소 |
| **Outbox 패턴** | ★★★★ | DB 트랜잭션과 알림의 원자성 보장에 필수 |
| **클라이언트 로컬 Queue + WorkManager** | ★★★★★ | FCM 전달 실패 보완에 가장 실용적 |
| **에스컬레이션 패턴** | ★★★★ | 알림 중요도에 따른 차등 처리로 QoS 향상 |
| **Kafka/Pulsar** | ★★ | 프로젝트 규모 대비 과한 솔루션 |
| **CQRS + Event Sourcing** | ★★ | 아키텍처 복잡도가 프로젝트 범위를 초과 |

---

## 참고 자료

### RabbitMQ 관련
- [Building a Scalable Notification System with RabbitMQ - Medium](https://ikabolo59.medium.com/building-a-scalable-notification-system-with-rabbitmq-part-1-architecture-setup-e513a55ac63d)
- [RabbitMQ and Firebase Real-Time Notifications - DEV Community](https://dev.to/eslamali/understanding-rabbitmq-and-implementing-real-time-notifications-with-firebase-and-socketio-3ldp)
- [Push Notification using RabbitMQ and NodeJS - Medium](https://medium.com/@sysagar07/push-notification-using-rabbitmq-and-nodejs-276ff73433c2)
- [AMQP 0-9-1 Model Explained - RabbitMQ](https://www.rabbitmq.com/tutorials/amqp-concepts)

### Message Queue 비교
- [Choosing The Right Message Queue for Notification Systems - DEV Community](https://dev.to/nikl/choosing-the-right-message-queue-technology-for-your-notification-system-2mji)
- [Comparison of NATS, RabbitMQ, NSQ, and Kafka - Gcore](https://gcore.com/learning/nats-rabbitmq-nsq-kafka-comparison)
- [Kafka vs NATS - DZone](https://dzone.com/articles/kafka-vs-nats-message-processing)
- [Apache Pulsar vs Kafka vs RabbitMQ - HashStudioz](https://www.hashstudioz.com/blog/apache-pulsar-vs-kafka-vs-rabbitmq-choosing-the-right-messaging-system/)
- [Queue Systems Comparison - Astro Vault](https://vault.llbbl.com/content/queues/queue-systems)

### 하이브리드 아키텍처 및 패턴
- [Why Mobile Push Notification Architecture Fails - Netguru](https://www.netguru.com/blog/why-mobile-push-notification-architecture-fails)
- [Outbox Pattern for Reliable Messaging - GeeksforGeeks](https://www.geeksforgeeks.org/system-design/outbox-pattern-for-reliable-messaging-system-design/)
- [Transactional Outbox/Inbox Pattern - The Excited Engineer](https://theexcitedengineer.substack.com/p/guaranteeing-message-delivery-distributed?action=share)
- [FCM Architectural Overview - Firebase](https://firebase.google.com/docs/cloud-messaging/fcm-architecture)

### 알림 시스템 설계
- [How to Design a Notification System - System Design Handbook](https://www.systemdesignhandbook.com/guides/design-a-notification-system/)
- [Push Notification Fallbacks - Courier](https://www.courier.com/blog/push-notification-fallbacks-ensuring-message-delivery-with-email-slack-sms)
- [Designing a Notification System at Scale - DEV Community](https://dev.to/sgchris/designing-a-notification-system-push-email-and-sms-at-scale-kio)

### 클라이언트 사이드 구현
- [Periodic Notifications with WorkManager - Blog](https://blog.sanskar10100.dev/implementing-periodic-notifications-with-workmanager)
- [Scheduling Notifications with WorkManager - Medium](https://medium.com/android-ideas/scheduling-notifications-on-android-with-workmanager-adrian-tache)
- [Building a Reminder App with WorkManager - DEV Community](https://dev.to/blazebrain/building-a-reminder-app-with-local-notifications-using-workmanager-api-385f)

### CQRS / Event Sourcing
- [CQRS Pattern - Microsoft Azure Architecture](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [Event Sourcing Pattern - Microsoft Azure Architecture](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
