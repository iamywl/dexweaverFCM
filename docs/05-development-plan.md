# DexWeaver FCM 개발 계획서

> 작성일: 2026-03-18
> 목적: 01~04 문서의 조사/분석/실험설계를 기반으로, **무엇을 어떤 순서로 개발하고, 어떻게 실험하여, 어떻게 평가**하는지를 정의한다.

---

## 1. 프로젝트 목표

| 목표 | 설명 | 근거 |
|------|------|------|
| **크로스플랫폼 푸시** | Android + iOS 모두 지원 | 요구사항 |
| **QoS 보장** | FCM의 best-effort 한계를 보완하는 QoS 엔진 구축 | FCM ≈ MQTT QoS 0 수준 [01-fcm-research.md §5] |
| **안정/불안정 대응** | 15개 불안정 케이스에 대한 체계적 대응 | [02-fcm-case-analysis.md §3] |
| **멀티노드 브로드캐스팅** | 토픽/배치 기반 대규모 전송 | 요구사항 |
| **정량적 QoS 평가** | 8개 지표로 QoS를 측정하고 등급화 | [03-qos-evaluation-metrics.md] |

---

## 2. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    Client Layer                          │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Android App │  │  iOS App    │  │ (HMS App)   │     │
│  │ Kotlin      │  │  Swift      │  │ 향후 확장    │     │
│  │ FCM SDK     │  │  FCM SDK    │  │             │     │
│  │ + ACK Agent │  │  + ACK Agent│  │             │     │
│  └──────┬──────┘  └──────┬──────┘  └─────────────┘     │
│         │                │                               │
└─────────┼────────────────┼───────────────────────────────┘
          │   ACK callback │
          ▼                ▼
┌─────────────────────────────────────────────────────────┐
│                   Backend Layer                          │
│                                                         │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ API      │──→│ Token        │──→│ Safety         │  │
│  │ Gateway  │   │ Manager      │   │ Classifier     │  │
│  │ (REST)   │   │ (등록/갱신/   │   │ (유효성 검증,  │  │
│  │          │   │  정리)       │   │  페이로드 검사) │  │
│  └──────────┘   └──────────────┘   └───────┬────────┘  │
│                                            │           │
│  ┌──────────────────────────────────────────▼────────┐  │
│  │              Message Dispatcher                   │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │  │
│  │  │ Unicast  │  │ Multicast│  │ Topic          │  │  │
│  │  │ (단일)   │  │ (배치500)│  │ Broadcast      │  │  │
│  │  └──────────┘  └──────────┘  └────────────────┘  │  │
│  └──────────────────────┬───────────────────────────┘  │
│                         │                               │
│  ┌──────────────────────▼───────────────────────────┐  │
│  │              QoS Engine                           │  │
│  │  ┌─────────┐  ┌───────────┐  ┌───────────────┐  │  │
│  │  │ Level 0 │  │ Level 1   │  │ Level 2       │  │  │
│  │  │ (1회)   │  │ (재시도)  │  │ (재시도+중복  │  │  │
│  │  │         │  │ +ACK 추적 │  │  제거)        │  │  │
│  │  └─────────┘  └───────────┘  └───────────────┘  │  │
│  │                                                   │  │
│  │  ┌─────────────┐  ┌────────────┐                 │  │
│  │  │ Retry Queue │  │ Dead Letter│                 │  │
│  │  │ (Exp Backoff)│  │ Queue     │                 │  │
│  │  └─────────────┘  └────────────┘                 │  │
│  └──────────────────────┬───────────────────────────┘  │
│                         │                               │
│  ┌──────────────────────▼───────────────────────────┐  │
│  │         Firebase Admin SDK (HTTP v1)              │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐                    │
│  │ ACK Receiver │  │ Metrics      │                    │
│  │ (수신 확인    │  │ Collector    │                    │
│  │  수집 서버)   │  │ (Prometheus) │                    │
│  └──────────────┘  └──────────────┘                    │
└─────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│                  Storage Layer                           │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ PostgreSQL │  │ Redis      │  │ Message Archive  │  │
│  │ - 토큰 저장 │  │ - Rate     │  │ - 전송 이력      │  │
│  │ - 전송 이력 │  │   Limiting │  │ - ACK 대조       │  │
│  │ - ACK 로그 │  │ - 재시도 큐│  │ - 감사 로그      │  │
│  └────────────┘  └────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 개발 단계

### Phase 0: 실험 인프라 구축 (Week 1)

> 실험을 먼저 수행하기 위한 최소 인프라를 구축한다.

#### 0-1. Firebase 프로젝트 설정

| 작업 | 상세 |
|------|------|
| Firebase 테스트 프로젝트 생성 | 프로덕션 격리된 전용 프로젝트 |
| Android 앱 등록 | 패키지명: `com.dexweaver.fcm.test` |
| iOS 앱 등록 | Bundle ID: `com.dexweaver.fcm.test` |
| 서비스 계정 키 발급 | HTTP v1 API용 OAuth2 |
| APNs Auth Key 등록 | iOS 푸시를 위한 Apple 키 |

#### 0-2. 테스트 앱 개발

**Android 테스트 앱 (Kotlin)**

```
기능 목록:
1. FCM 토큰 등록 → 서버 전송 (POST /api/tokens/register)
2. onMessageReceived() 구현
   - message_id, received_at, app_state 기록
   - 즉시 ACK 서버로 HTTP POST
3. onDeletedMessages() 구현 → 서버 보고
4. 토큰 갱신 콜백 → 서버에 새 토큰 전송
5. 수신 메시지 ID 로컬 저장 (Room DB) — 중복 감지
6. 앱 상태(foreground/background) 자동 감지
7. 배터리 최적화 상태 조회 API 노출
```

**iOS 테스트 앱 (Swift)**

```
기능 목록:
1. FCM 토큰 등록 → 서버 전송
2. userNotificationCenter delegate 구현
3. application(_:didReceiveRemoteNotification:) 구현 (silent push)
4. Notification Service Extension (수신 확인용)
   - 30초 내 ACK 전송
5. 토큰 갱신 처리
6. APNs 토큰 ↔ FCM 토큰 매핑 확인
7. 수신 ID 로컬 저장 (Core Data) — 중복 감지
```

#### 0-3. 테스트 서버 개발

```
기술: Node.js + TypeScript + Express

모듈:
1. /api/tokens/register     — 토큰 등록/갱신
2. /api/tokens/cleanup       — stale 토큰 정리
3. /api/messages/send        — 단일 전송
4. /api/messages/multicast   — 배치 전송 (최대 500)
5. /api/messages/topic       — 토픽 전송
6. /api/ack/receive          — ACK 수신 엔드포인트
7. /api/metrics              — Prometheus 메트릭 노출

의존성:
- firebase-admin (HTTP v1 API)
- pg (PostgreSQL)
- ioredis (Redis)
- prom-client (Prometheus)
```

#### 0-4. 측정 인프라

```
1. PostgreSQL 스키마:
   - messages: 전송 로그 (message_id, sent_at, fcm_response, ...)
   - acks: 수신 확인 로그 (message_id, received_at, device_model, ...)
   - experiments: 실험 메타데이터

2. Analyzer 스크립트:
   - messages ⟕ acks LEFT JOIN → 손실 메시지 식별
   - 지표 계산: M1~M8
   - 결과 카드 자동 생성

3. Grafana 대시보드:
   - 실시간 전송/수신 현황
   - 에러 코드 분포
   - 지연시간 히스토그램
```

---

### Phase 1: 대조군 실험 수행 (Week 2)

> [04-experiment-design.md §3] Phase 1 실행

| 실험 | 대상 | 예상 소요 |
|------|------|----------|
| EXP-S01 | 단일 디바이스 정상 전송 | 1일 |
| EXP-S02 | Background + Notification | 0.5일 |
| EXP-S03 | 소규모 토픽 브로드캐스트 | 0.5일 |
| EXP-S04 | Collapsible 적정 빈도 | 1일 (5시간 × 3회) |
| EXP-S05 | Data/Notification/Combined × 앱상태 | 2일 |

**산출물**: Baseline 지표 확정 문서 (`results/phase1-baseline.md`)

---

### Phase 2: 비교군 실험 수행 (Week 3-4)

> [04-experiment-design.md §4] Phase 2 실행

**Week 3: Layer 1~2 원인 (서버/FCM 인프라)**

| 실험 | 대상 | 예상 소요 |
|------|------|----------|
| EXP-U01 | Stale 토큰 비율별 영향 | 1일 |
| EXP-U02 | 페이로드 경계값 | 0.5일 |
| EXP-U03 | Rate Limit 초과 | 0.5일 |
| EXP-U04 | 인증 만료 시뮬레이션 | 0.5일 |
| EXP-U05 | Non-collapsible 100건 | 1일 |
| EXP-U06 | 팬아웃 지연 | 0.5일 |
| EXP-U07 | Collapsible 스로틀링 | 1일 |

**Week 4: Layer 3~4 원인 (플랫폼/환경) — 핵심 실험**

| 실험 | 대상 | 예상 소요 |
|------|------|----------|
| EXP-U08 | **Android OEM 배터리 최적화** | 2일 (18조합) |
| EXP-U09 | Doze 모드 | 0.5일 |
| EXP-U10 | App Standby Bucket | 0.5일 |
| EXP-U11 | **iOS Silent 스로틀링** | 1.5일 (빈도별 3시간) |
| EXP-U12 | iOS Force Kill | 0.5일 |
| EXP-U13 | 디바이스 오프라인 + 복구 | 0.5일 |
| EXP-U14 | 네트워크 장애 시뮬레이션 | 1일 |
| EXP-U15 | 중복 전송 | 0.5일 |

**산출물**: 케이스별 결과 카드 (`results/phase2-{case}.md`)

---

### Phase 3: 복합 요인 + QoS 메커니즘 실험 (Week 5)

> [04-experiment-design.md §5, §6] Phase 3~4 실행

**복합 요인 (2.5일)**

| 실험 | 조합 |
|------|------|
| EXP-C01 | Stale 토큰 + 네트워크 장애 |
| EXP-C02 | Rate Limit + 대규모 배치 |
| EXP-C03 | OEM 최적화 + Doze + Background |
| EXP-C04 | iOS Silent + 저전력 + Background |
| EXP-C05 | Stale 토큰 + OEM 최적화 |
| EXP-C06 | 네트워크 지연 + Collapsible 스로틀링 |

**QoS 메커니즘 효과 (2.5일)**

- UNSTABLE-03, 04, 07, 14에 대해 L0/L1/L2 적용
- 각 1,000건 × 3회 × 3 Level × 4 케이스 = 36,000건

**산출물**:
- 복합 요인 분석 (`results/phase3-combined.md`)
- QoS 메커니즘 효과 분석 (`results/phase4-qos-effect.md`)
- **종합 비교 매트릭스** (`results/final-comparison.md`)

---

### Phase 4: 본 시스템 개발 (Week 6-10)

> 실험 결과를 반영하여 프로덕션 시스템을 구축한다.

#### 4-1. 핵심 백엔드 개발 (Week 6-7)

| 모듈 | 기능 | 우선순위 |
|------|------|---------|
| **Token Manager** | 토큰 CRUD, 30일 stale 자동 정리, 404/403 즉시 삭제 | P0 |
| **Safety Classifier** | 페이로드 검증(< 4KB), 토큰 유효성, Rate limit 사전 검사 | P0 |
| **Message Dispatcher** | Unicast/Multicast(500)/Topic 전송, HTTP v1 API 호출 | P0 |
| **QoS Engine** | L0/L1/L2 구현, Retry Queue(exponential backoff), DLQ | P0 |
| **ACK Receiver** | 디바이스 수신 확인 수집, message_id 대조 | P0 |
| **Metrics Collector** | M1~M8 실시간 계산, Prometheus 노출 | P1 |

#### 4-2. 클라이언트 앱 개발 (Week 7-8)

| 플랫폼 | 기능 |
|--------|------|
| **Android** | FCM 수신, ACK 전송, 중복 제거(L2), 토큰 갱신, 배터리 최적화 감지 및 사용자 안내 |
| **iOS** | FCM 수신, ACK 전송, 중복 제거(L2), 토큰 갱신, Notification Service Extension |

#### 4-3. 브로드캐스팅 시스템 (Week 8-9)

| 기능 | 구현 |
|------|------|
| 토픽 구독/해제 | FCM Topic API 래핑, 구독 상태 DB 동기화 |
| 배치 멀티캐스트 | 500건 단위 청킹, 병렬 전송 |
| 팬아웃 관리 | 동시 팬아웃 수 모니터링, 초과 시 큐잉 |
| 메시지 큐 | Redis Streams — 노드 간 분산 처리 |

#### 4-4. 모니터링 및 대시보드 (Week 9-10)

| 구성 | 상세 |
|------|------|
| Grafana 대시보드 | 전달률, 지연시간, 에러율, DLQ 상태 |
| 알림 규칙 | 전달률 < 95% 시 Slack 알림, DLQ > 100건 시 알림 |
| 토큰 헬스 리포트 | 주간 stale 토큰 비율, OEM별 전달률 |

---

### Phase 5: 통합 테스트 및 안정화 (Week 11-12)

| 작업 | 상세 |
|------|------|
| E2E 테스트 | Phase 1 대조군 실험을 프로덕션 시스템으로 재실행 |
| 부하 테스트 | k6로 점진적 부하 → 유효 처리량(M8) 확인 |
| OEM 실기기 테스트 | Samsung/Xiaomi에서 프로덕션 앱 테스트 |
| QoS 등급 검증 | 종합 QoS Grade A (≥ 4.5) 달성 확인 |
| 문서화 | API 문서, 운영 가이드, 트러블슈팅 가이드 |

---

## 4. 기술 스택 확정

| 레이어 | 기술 | 선정 근거 |
|--------|------|----------|
| **Backend** | Node.js + TypeScript | Firebase Admin SDK 공식 지원, 비동기 I/O |
| **API** | Express + REST | 간결, 클라이언트 호환성 |
| **DB** | PostgreSQL 15 | 전송 이력, ACK 로그 ACID 보장 |
| **Cache/Queue** | Redis 7 (Streams) | Rate limiting, 재시도 큐, 노드간 메시지 분산 |
| **Android** | Kotlin + Firebase Messaging SDK | 공식 지원 |
| **iOS** | Swift + Firebase Messaging SDK + APNs | 공식 지원 |
| **모니터링** | Prometheus + Grafana | QoS 메트릭 실시간 시각화 |
| **부하 테스트** | k6 | 스크립트 기반, 높은 동시성 |
| **컨테이너** | Docker + Docker Compose | 로컬 개발 및 테스트 환경 통일 |

---

## 5. 디렉토리 구조

```
dexweaverFCM/
├── docs/                           # 문서 (현재 파일들)
│   ├── 01-fcm-research.md          # FCM 기술 조사
│   ├── 02-fcm-case-analysis.md     # 안정/불안정 케이스 분석
│   ├── 03-qos-evaluation-metrics.md# QoS 평가 지표
│   ├── 04-experiment-design.md     # 실험 설계서
│   └── 05-development-plan.md      # 개발 계획서 (본 문서)
│
├── results/                        # 실험 결과 (Phase 1~4 이후)
│   ├── phase1-baseline.md
│   ├── phase2-{case}.md
│   ├── phase3-combined.md
│   ├── phase4-qos-effect.md
│   └── final-comparison.md
│
├── server/                         # 백엔드 서버
│   ├── src/
│   │   ├── config/                 # Firebase, DB, Redis 설정
│   │   ├── modules/
│   │   │   ├── token/              # 토큰 관리
│   │   │   ├── safety/             # 안전성 분류기
│   │   │   ├── dispatcher/         # 메시지 전송 (unicast/multicast/topic)
│   │   │   ├── qos/                # QoS 엔진 (L0/L1/L2, 재시도, DLQ)
│   │   │   ├── ack/                # ACK 수신/대조
│   │   │   └── metrics/            # 메트릭 수집
│   │   ├── api/                    # REST 라우터
│   │   └── workers/                # 큐 컨슈머
│   ├── tests/                      # 실험 스크립트
│   │   ├── experiments/            # Phase 1~4 실험 자동화
│   │   └── unit/                   # 단위 테스트
│   ├── package.json
│   └── tsconfig.json
│
├── android/                        # Android 테스트/프로덕션 앱
│   └── app/src/main/kotlin/
│       ├── fcm/                    # FCM 서비스, 토큰 관리
│       ├── ack/                    # ACK 전송
│       └── dedup/                  # 중복 제거 (L2)
│
├── ios/                            # iOS 테스트/프로덕션 앱
│   └── DexWeaverFCM/
│       ├── FCM/                    # FCM 서비스, 토큰 관리
│       ├── ACK/                    # ACK 전송
│       ├── Dedup/                  # 중복 제거 (L2)
│       └── NotificationServiceExtension/ # 수신 확인용
│
├── infra/                          # 인프라 설정
│   ├── docker-compose.yml          # 로컬 개발 (PostgreSQL, Redis, Grafana)
│   └── grafana/                    # 대시보드 JSON
│
├── k6/                             # 부하 테스트 스크립트
│   ├── stable-baseline.js
│   ├── rate-limit-test.js
│   └── broadcast-test.js
│
└── README.md
```

---

## 6. 마일스톤 요약

| 마일스톤 | 주차 | 산출물 | 판단 기준 |
|---------|------|--------|----------|
| **M0: 실험 인프라** | W1 | 테스트 앱 + 서버 + DB | 단일 메시지 전송→ACK 수신 E2E 동작 |
| **M1: Baseline 확립** | W2 | phase1-baseline.md | STABLE-01 전달률 ≥ 99% 확인 |
| **M2: 개별 요인 분석** | W3-4 | phase2-{case}.md × 15 | 모든 케이스 결과 카드 작성 완료 |
| **M3: 종합 분석** | W5 | final-comparison.md | 종합 비교 매트릭스 + QoS 메커니즘 효과 정량화 |
| **M4: 본 시스템 개발** | W6-10 | 서버 + Android + iOS | QoS L1/L2 동작, 멀티캐스트/토픽 브로드캐스트 |
| **M5: 안정화/검증** | W11-12 | 최종 QoS 보고서 | 프로덕션 환경에서 Grade B 이상 달성 |

---

## 7. 리스크 및 대응

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| OEM 기기에서 FCM 단독으로 목표 QoS 미달 | **높음** | 높음 | EXP-U08 결과에 따라 대안 채널(MQTT/WebSocket/HMS) 도입 결정 |
| iOS Silent Push 스로틀링이 예상보다 심함 | 중간 | 중간 | Notification 타입 우선 사용, Silent은 보조 채널로 한정 |
| FCM 할당량 부족 (600K/분 초과) | 낮음 | 높음 | 배치 최적화 + Google에 할당량 증설 요청 (80%+ 사용 시) |
| 테스트 기기 확보 어려움 | 중간 | 중간 | 최소 3종(Pixel, Samsung, iPhone) 확보 우선, 나머지 순차 |
| 실험 결과 재현성 부족 (CV ≥ 10%) | 중간 | 중간 | 반복 횟수 증가 (3회→5회), 시간대 통제 강화 |

---

## 8. 의사결정 포인트

실험 결과에 따라 다음 사항을 결정한다. **코드 개발 전에 실험 데이터를 먼저 확보한다.**

| # | 의사결정 | 판단 근거 | 결정 시점 |
|---|---------|----------|----------|
| D1 | QoS 기본 Level (L1 vs L2) | Phase 4 비용/효과 분석 | M3 이후 |
| D2 | 대안 채널 필요 여부 | EXP-U08 OEM 전달률 결과 | M2 이후 |
| D3 | iOS Silent Push 사용 범위 | EXP-U11 스로틀링 실측 | M2 이후 |
| D4 | Collapsible vs Non-collapsible 전략 | EXP-U05 + EXP-U07 결과 | M2 이후 |
| D5 | 재시도 파라미터 (횟수, 간격) | Phase 4 재시도 분포 | M3 이후 |
| D6 | 토큰 정리 주기 | EXP-U01 비율별 영향 | M2 이후 |

---

## 참고 문서

- [01-fcm-research.md](01-fcm-research.md) — FCM 기술 조사 보고서
- [02-fcm-case-analysis.md](02-fcm-case-analysis.md) — 안정/불안정 케이스 분석
- [03-qos-evaluation-metrics.md](03-qos-evaluation-metrics.md) — QoS 평가 지표 및 방법론
- [04-experiment-design.md](04-experiment-design.md) — 실험 설계서
