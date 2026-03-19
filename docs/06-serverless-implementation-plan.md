# DexWeaver FCM 서버리스 구현 방안

> 작성일: 2026-03-19
> 목적: 상시 서버 운영이 어려운 환경(MacBook + iPhone)에서 DexWeaver FCM 프로젝트를 구현하기 위한 **서버리스 아키텍처 전환 방안** 및 **무료 푸시 알림 서비스 비교 분석**을 정리한다.

---

## 1. 배경 및 제약 조건

### 1-1. 현재 환경

| 항목 | 상세 |
|------|------|
| **개발 장비** | MacBook (macOS) |
| **테스트 디바이스** | iPhone (iOS) |
| **서버 운영** | 상시 구동 불가 (개인 개발 환경) |

### 1-2. 기존 설계와의 차이

[05-development-plan.md](05-development-plan.md) §2 시스템 아키텍처는 다음을 전제로 설계되었다:

- **Node.js + Express** 상시 서버
- **PostgreSQL** (토큰 저장, 전송 이력, ACK 로그)
- **Redis** (Rate Limiting, 재시도 큐)
- **Prometheus + Grafana** (모니터링)

이 구성은 서버를 24/7 운영해야 하므로, 개인 MacBook 환경에서는 실용적이지 않다. 본 문서에서는 동일한 QoS 연구 목표를 달성하면서 **서버리스/매니지드 서비스**로 전환하는 방안을 제시한다.

---

## 2. 무료 푸시 알림 서비스 비교

### 2-1. 서비스별 비교표

| 서비스 | 무료 한도 | iOS 지원 | 서버 필요 | QoS 커스터마이징 | 적합 용도 |
|--------|----------|---------|----------|-----------------|----------|
| **FCM** | 완전 무료, 무제한 [^1] | O (APNs 경유) | 트리거용 백엔드 필요 | 완전 제어 가능 | 프로덕션 앱, QoS 연구 |
| **OneSignal** | 모바일 푸시 무제한 [^2] | O | X (대시보드 제공) | 제한적 (API 기반) | 빠른 프로토타입 |
| **ntfy.sh** | 완전 무료, 가입 불필요 [^3] | O (iOS 앱) | X (curl 한 줄) | 불가 | 개인 알림, 스크립트 |
| **Pushover** | $5 일회성 구매 [^4] | O | X (REST API) | 불가 | 개인 알림 |

### 2-2. 서비스별 상세 분석

#### FCM (Firebase Cloud Messaging)

- **가격**: Spark(무료) 플랜에서 완전 무료, 메시지 수/디바이스 수 제한 없음 [^1]
- **iOS 지원**: APNs를 자동으로 경유하여 iOS 디바이스에 전달
- **처리량 제한**: 1,000 messages/sec downstream (소프트 리밋, 증설 요청 가능) [^5]
- **장점**: QoS 엔진 직접 구현 가능, HTTP v1 API로 세밀한 제어, 기존 리서치 문서와 완전 호환
- **단점**: 프로그래밍 방식 전송 시 백엔드(서버리스 함수라도) 필요
- **참고**: FCM HTTP v1 API는 OAuth2 기반 인증을 사용하며, Firebase Admin SDK가 이를 추상화 [^6]

#### OneSignal

- **가격**: 모바일 푸시 무제한 무료, 웹 푸시 10,000 구독자 제한, 이메일 10,000건/월 [^2]
- **iOS 지원**: APNs 자격증명 등록 후 완전 지원
- **장점**: 대시보드에서 수동 발송 가능 → 서버 없이 즉시 시작 가능, REST API 단순
- **단점**: QoS 로직(재시도, ACK 추적, 중복 제거)을 OneSignal 내부에서 커스터마이징할 수 없음
- **적합 시나리오**: QoS 연구보다는 빠르게 푸시 기능을 구현하고 싶을 때

#### ntfy.sh

- **가격**: 완전 무료, 오픈소스 (Apache 2.0 / GPLv2) [^3]
- **iOS 지원**: App Store에 iOS 앱 제공, 단 iOS 즉시 알림은 ntfy.sh 중앙 서버 경유 필요 [^7]
- **사용법**: 가입 불필요, 토픽 기반 Pub/Sub

```bash
# 맥북에서 아이폰으로 알림 전송 (이것이 전부)
curl -d "빌드 완료!" ntfy.sh/dexweaver-alerts
```

- **장점**: 설정 0분, 즉시 사용 가능
- **단점**: 프로덕션 앱용이 아님, QoS 커스터마이징 불가, 토픽명이 공개(누구나 구독 가능)
- **적합 시나리오**: 개발 중 개인 알림, CI/CD 결과 알림, 모니터링 트리거

#### Pushover

- **가격**: 30일 무료 체험 후 플랫폼당 $5 일회성 구매, 10,000 메시지/월/앱 [^4]
- **iOS 지원**: 완전 지원
- **장점**: REST API가 매우 단순, 안정적
- **단점**: 완전 무료는 아님, QoS 커스터마이징 불가

---

## 3. 서버리스 백엔드 옵션 비교

FCM을 사용하되 상시 서버 대신 서버리스 함수로 트리거하는 방안이다.

| 서비스 | 무료 한도 | FCM 연동 | 특징 | 참고 |
|--------|----------|---------|------|------|
| **Google Cloud Functions** | 200만 호출/월, 400K GB-sec [^8] | Firebase와 네이티브 통합 | Firestore 이벤트 트리거, 스케줄 트리거 지원 | [^9] |
| **Cloudflare Workers** | 10만 요청/일 [^10] | REST API 호출 | 콜드 스타트 없음, 글로벌 엣지 배포 | [^11] |
| **AWS Lambda** | 100만 요청/월, 400K GB-sec (영구 무료) [^12] | SNS 또는 직접 호출 | AWS SNS로 APNs 직접 전송도 가능 | [^13] |

### 스토리지 대체 옵션

| 기존 설계 | 서버리스 대체 | 무료 한도 | 참고 |
|----------|-------------|----------|------|
| PostgreSQL | **Firestore** | 1GB 저장, 50K 읽기/20K 쓰기/일 [^1] | NoSQL이므로 스키마 재설계 필요 |
| Redis (Rate Limiting) | **Firestore + Cloud Functions** | 위와 동일 | 카운터 기반 rate limiting 구현 |
| Redis (재시도 큐) | **Cloud Tasks** | 100만 작업/월 무료 [^14] | 지연 실행, 재시도 정책 내장 |
| Prometheus + Grafana | **Cloud Logging + Cloud Monitoring** | 50GB 로그/월 무료 [^15] | 또는 Firebase Performance Monitoring |

---

## 4. 구현 방안

### 방안 A: FCM + Google Cloud Functions (추천)

> 기존 리서치(01~04 문서)를 최대한 활용하면서 서버리스로 전환하는 방안

#### 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    Client Layer                          │
│                                                         │
│  ┌─────────────┐                                        │
│  │  iOS App    │  (Flutter + FlutterFire)                │
│  │  FCM SDK    │                                        │
│  │  + ACK Agent│                                        │
│  └──────┬──────┘                                        │
│         │                                               │
└─────────┼───────────────────────────────────────────────┘
          │   ACK callback / Token 등록
          ▼
┌─────────────────────────────────────────────────────────┐
│              Serverless Backend (Google Cloud)            │
│                                                         │
│  ┌──────────────────┐   ┌──────────────────────────┐    │
│  │ Cloud Functions  │   │ Cloud Functions           │    │
│  │ (HTTP Trigger)   │   │ (Firestore Trigger)       │    │
│  │                  │   │                            │    │
│  │ - /api/send      │   │ - onTokenCreate → 검증     │    │
│  │ - /api/ack       │   │ - onMessageCreate → 전송   │    │
│  │ - /api/tokens    │   │ - onSchedule → stale 정리  │    │
│  └────────┬─────────┘   └─────────────┬──────────────┘    │
│           │                           │                   │
│  ┌────────▼───────────────────────────▼──────────────┐    │
│  │              QoS Engine (Cloud Functions 내)       │    │
│  │  ┌─────────┐  ┌───────────┐  ┌───────────────┐   │    │
│  │  │ Level 0 │  │ Level 1   │  │ Level 2       │   │    │
│  │  │ (1회)   │  │ (재시도)  │  │ (재시도+중복  │   │    │
│  │  │         │  │ +ACK 추적 │  │  제거)        │   │    │
│  │  └─────────┘  └───────────┘  └───────────────┘   │    │
│  │                                                    │    │
│  │  ┌──────────────┐  ┌─────────────┐                │    │
│  │  │ Cloud Tasks  │  │ Dead Letter │                │    │
│  │  │ (Retry Queue)│  │ (Firestore) │                │    │
│  │  └──────────────┘  └─────────────┘                │    │
│  └───────────────────────┬───────────────────────────┘    │
│                           │                               │
│  ┌────────────────────────▼──────────────────────────┐    │
│  │         Firebase Admin SDK (HTTP v1)               │    │
│  └───────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│                  Storage Layer (Firestore)                │
│  ┌────────────────┐  ┌────────────────┐                  │
│  │ tokens/        │  │ messages/      │                  │
│  │ - fcmToken     │  │ - payload      │                  │
│  │ - platform     │  │ - sentAt       │                  │
│  │ - lastActive   │  │ - fcmResponse  │                  │
│  │ - deviceModel  │  │ - qosLevel     │                  │
│  └────────────────┘  └────────────────┘                  │
│  ┌────────────────┐  ┌────────────────┐                  │
│  │ acks/          │  │ experiments/   │                  │
│  │ - messageId    │  │ - phase        │                  │
│  │ - receivedAt   │  │ - parameters   │                  │
│  │ - appState     │  │ - results      │                  │
│  └────────────────┘  └────────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

#### 기술 스택 매핑

| 기존 설계 (05-development-plan.md §4) | 서버리스 전환 | 전환 근거 |
|--------------------------------------|-------------|----------|
| Node.js + Express | **Cloud Functions (Node.js)** | 동일 런타임, Firebase Admin SDK 그대로 사용 |
| PostgreSQL | **Firestore** | 무료 티어 충분, 실시간 리스너 지원 |
| Redis (Rate Limiting) | **Firestore 카운터 + Cloud Functions** | 분당 전송 수 카운팅으로 대체 |
| Redis Streams (재시도 큐) | **Cloud Tasks** | 지연 실행, 자동 재시도, 최대 30일 보관 [^14] |
| Prometheus + Grafana | **Cloud Logging + Cloud Monitoring** | 무료 티어 내 충분, 커스텀 메트릭 지원 |
| Docker + Docker Compose | **불필요** | 매니지드 서비스로 인프라 관리 불필요 |

#### 장점

- **기존 리서치 100% 활용**: 01~04 문서의 QoS 설계, 실험 프로토콜이 그대로 적용됨
- **비용**: FCM 무제한 무료 + Cloud Functions 200만 호출/월 무료 → 실험 규모에서 과금 가능성 거의 없음
- **서버 관리 불필요**: 맥북은 개발/배포 전용, 상시 구동 불필요
- **스케일**: 프로덕션 전환 시 동일 아키텍처로 확장 가능

#### 제약 사항

- Cloud Functions 콜드 스타트: 첫 호출 시 수 초 지연 (실험 측정 시 보정 필요)
- Firestore 무료 한도: 일 50K 읽기/20K 쓰기 → Phase 2~3 대규모 실험 시 Blaze 플랜(종량제) 전환 필요할 수 있음
- Firestore는 NoSQL → PostgreSQL 대비 복잡한 JOIN 쿼리 불가, Analyzer 스크립트 재설계 필요

#### 디렉토리 구조 (변경안)

```
dexweaverFCM/
├── docs/                               # 문서
│
├── functions/                          # Cloud Functions (기존 server/ 대체)
│   ├── src/
│   │   ├── config/                     # Firebase 설정
│   │   ├── modules/
│   │   │   ├── token/                  # 토큰 관리
│   │   │   ├── safety/                 # 안전성 분류기
│   │   │   ├── dispatcher/             # 메시지 전송
│   │   │   ├── qos/                    # QoS 엔진 (L0/L1/L2)
│   │   │   ├── ack/                    # ACK 수신/대조
│   │   │   └── metrics/                # 메트릭 수집
│   │   ├── triggers/                   # Firestore/Schedule 트리거
│   │   └── api/                        # HTTP 트리거 (REST 엔드포인트)
│   ├── package.json
│   └── tsconfig.json
│
├── app/                                # Flutter iOS 앱 (기존 ios/ 대체)
│   ├── lib/
│   │   ├── fcm/                        # FCM 서비스, 토큰 관리
│   │   ├── ack/                        # ACK 전송
│   │   └── dedup/                      # 중복 제거 (L2)
│   └── pubspec.yaml
│
├── scripts/                            # 실험/분석 스크립트
│   ├── experiments/                    # Phase 1~4 실험 자동화
│   └── analyzer/                       # 결과 분석 (Firestore 쿼리)
│
├── results/                            # 실험 결과
│
├── firebase.json                       # Firebase 프로젝트 설정
├── firestore.rules                     # Firestore 보안 규칙
├── firestore.indexes.json              # Firestore 인덱스
└── README.md
```

---

### 방안 B: OneSignal (서버 코드 없이 빠른 시작)

> QoS 연구보다 푸시 기능 자체를 빠르게 구현하고 싶을 때

#### 아키텍처

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  iOS App     │ ←─────→ │  OneSignal   │ ←─────→ │  APNs        │
│  (Flutter)   │  SDK    │  Platform    │  자동    │  (Apple)     │
│  + OneSignal │         │  - 대시보드   │         │              │
│    SDK       │         │  - REST API  │         │              │
└──────────────┘         │  - 세그먼트  │         └──────────────┘
                         │  - A/B 테스트│
      ┌─────────────────→│  - 분석     │
      │  curl / Script   └──────────────┘
┌─────┴────────┐
│  MacBook     │
│  터미널/스크립트│
└──────────────┘
```

#### 사용 흐름

```bash
# 1. OneSignal REST API로 맥북에서 직접 푸시 발송
curl -X POST https://onesignal.com/api/v1/notifications \
  -H "Authorization: Basic YOUR_REST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "YOUR_APP_ID",
    "include_player_ids": ["DEVICE_PLAYER_ID"],
    "contents": {"en": "DexWeaver 테스트 메시지"}
  }'

# 2. 또는 OneSignal 대시보드 웹 UI에서 수동 발송
```

#### 장점

- **서버 코드 0줄**: 대시보드 또는 curl로 즉시 발송
- **무료 무제한**: 모바일 푸시 메시지 수 제한 없음 [^2]
- **빠른 시작**: 1시간 이내 첫 푸시 가능
- **분석 내장**: 전달률, 클릭률 등 기본 분석 제공

#### 단점

- **QoS 커스터마이징 불가**: 재시도 로직, ACK 추적, 중복 제거 등을 OneSignal 내부에서 제어할 수 없음
- **기존 리서치 활용 제한**: 01~04 문서의 QoS 엔진 설계를 구현할 수 없음
- **FCM 직접 제어 불가**: OneSignal이 FCM/APNs를 추상화하므로 HTTP v1 API 레벨의 제어 불가
- **벤더 종속**: OneSignal 서비스에 의존

#### 적합 시나리오

- DexWeaver QoS 연구 **이전에** 푸시 기능 자체의 프로토타입을 빠르게 만들어보고 싶을 때
- QoS보다는 사용자 경험/UI 측면을 먼저 검증하고 싶을 때

---

### 방안 C: ntfy.sh (개인 알림 전용)

> DexWeaver 연구 목적이 아닌, 개발 중 개인 알림이 필요할 때

#### 아키텍처

```
┌──────────────┐    HTTP POST     ┌──────────────┐    APNs     ┌──────────────┐
│  MacBook     │ ───────────────→ │  ntfy.sh     │ ──────────→ │  iPhone      │
│  터미널       │                  │  (호스팅 서버) │             │  ntfy 앱     │
│  cron job    │                  │              │             │              │
│  CI/CD       │                  │  토픽 기반    │             │  토픽 구독    │
└──────────────┘                  │  Pub/Sub     │             └──────────────┘
                                  └──────────────┘
```

#### 사용법

```bash
# 기본 알림
curl -d "빌드 완료!" ntfy.sh/dexweaver-alerts

# 제목 + 우선순위 지정
curl -H "Title: 실험 완료" \
     -H "Priority: high" \
     -H "Tags: white_check_mark" \
     -d "Phase 1 baseline 실험이 완료되었습니다." \
     ntfy.sh/dexweaver-alerts

# 맥북 cron으로 주기적 상태 알림
# crontab -e
# */30 * * * * curl -d "서버 상태: OK" ntfy.sh/dexweaver-monitor
```

#### 장점

- **설정 시간 0분**: 가입, API 키, SDK 통합 전부 불필요 [^3]
- **완전 무료**: 호스팅 서비스 무료, 셀프 호스팅도 가능
- **iOS 앱 제공**: App Store에서 ntfy 앱 설치 후 토픽 구독만 하면 됨 [^7]

#### 단점

- **보안**: 토픽명을 아는 누구나 메시지 발송/구독 가능 (유료 플랜에서 인증 지원)
- **프로덕션 부적합**: 앱 사용자에게 푸시를 보내는 용도로는 부적합
- **QoS 연구 불가**: 메시지 제어, 재시도, ACK 등 커스터마이징 불가

#### 적합 시나리오

- 실험 스크립트 완료 알림
- CI/CD 빌드 결과 알림
- 개발 중 서버 상태 모니터링 알림

---

## 5. 방안 비교 매트릭스

| 평가 항목 | 방안 A (FCM + Cloud Functions) | 방안 B (OneSignal) | 방안 C (ntfy.sh) |
|----------|-------------------------------|-------------------|-----------------|
| **기존 리서치 활용** | ★★★★★ 완전 호환 | ★★☆☆☆ 제한적 | ★☆☆☆☆ 불가 |
| **QoS 엔진 구현** | ★★★★★ 완전 제어 | ★☆☆☆☆ 불가 | ★☆☆☆☆ 불가 |
| **설정 난이도** | ★★★☆☆ 보통 | ★★★★★ 매우 쉬움 | ★★★★★ 매우 쉬움 |
| **서버 관리** | 불필요 (서버리스) | 불필요 | 불필요 |
| **무료 범위** | FCM 무제한 + 200만 호출/월 | 모바일 푸시 무제한 | 완전 무료 |
| **iOS 지원** | O (APNs 경유) | O | O (ntfy 앱) |
| **프로덕션 확장성** | ★★★★★ | ★★★★☆ | ★☆☆☆☆ |
| **실험 데이터 수집** | ★★★★★ 완전 제어 | ★★☆☆☆ 제한적 통계 | ★☆☆☆☆ 불가 |

---

## 6. 추천 전략

### 6-1. 단계별 접근

| 단계 | 방안 | 목적 | 기간 |
|------|------|------|------|
| **Step 1** | 방안 C (ntfy.sh) | 개발 중 개인 알림 인프라 즉시 확보 | 당일 |
| **Step 2** | 방안 A (FCM + Cloud Functions) | DexWeaver 본 시스템 서버리스 구현 | 05-development-plan.md 일정 참조 |
| *(선택)* | 방안 B (OneSignal) | UI/UX 프로토타입 빠른 검증 시 | 1~2일 |

### 6-2. 추천 조합

**방안 A를 주 아키텍처로 채택**하되, 개발 과정에서 **방안 C를 보조 도구**로 활용한다.

- 방안 A는 기존 01~04 문서의 연구 설계를 그대로 구현할 수 있는 유일한 방안
- 방안 C는 실험 완료 알림, 빌드 결과 알림 등 개발 생산성 도구로 즉시 활용
- 방안 B는 QoS 연구 완료 후 사용자 대상 서비스 확장 시 고려

### 6-3. 05-development-plan.md 수정 사항

방안 A 채택 시 기존 개발 계획서에서 변경이 필요한 항목:

| 섹션 | 변경 내용 |
|------|----------|
| §2 시스템 아키텍처 | 본 문서 §4 방안 A 아키텍처로 교체 |
| §3 Phase 0 (0-3 테스트 서버) | Express 서버 → Cloud Functions으로 전환 |
| §3 Phase 0 (0-4 측정 인프라) | PostgreSQL → Firestore, Grafana → Cloud Monitoring |
| §4 기술 스택 | 본 문서 §4 방안 A 기술 스택 매핑 참조 |
| §5 디렉토리 구조 | 본 문서 §4 방안 A 디렉토리 구조로 교체 |
| §7 리스크 | Cloud Functions 콜드 스타트, Firestore 무료 한도 리스크 추가 |

---

## 참고 문서 (내부)

- [01-fcm-research.md](01-fcm-research.md) — FCM 기술 조사 보고서
- [02-fcm-case-analysis.md](02-fcm-case-analysis.md) — 안정/불안정 케이스 분석
- [03-qos-evaluation-metrics.md](03-qos-evaluation-metrics.md) — QoS 평가 지표 및 방법론
- [04-experiment-design.md](04-experiment-design.md) — 실험 설계서
- [05-development-plan.md](05-development-plan.md) — 개발 계획서

---

## 참고 문헌 (외부)

[^1]: Firebase Pricing, Google. https://firebase.google.com/pricing — FCM, Analytics, Crashlytics 등 무료 제공 범위 및 Spark/Blaze 플랜 비교.

[^2]: OneSignal Pricing, OneSignal. https://onesignal.com/pricing — 무료 플랜 모바일 푸시 무제한, 웹 푸시 10,000 구독자 제한 등 상세 가격.

[^3]: ntfy - Push Notifications Made Easy, ntfy.sh. https://ntfy.sh/ — 오픈소스 Pub/Sub 기반 알림 서비스, 셀프 호스팅 및 호스팅 서비스 제공.

[^4]: Pushover: Simple Notifications for Android, iPhone, iPad, and Desktop. https://pushover.net/ — 플랫폼당 $5 일회성 구매, 10,000 메시지/월/앱 제한.

[^5]: Firebase Cloud Messaging Throttling and Quotas, Google. https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas — 다운스트림 메시지 처리량 제한, 토픽 메시지 팬아웃 제한 등.

[^6]: Firebase Cloud Messaging HTTP v1 API, Google. https://firebase.google.com/docs/cloud-messaging/migrate-v1 — HTTP v1 API 마이그레이션 가이드 및 OAuth2 인증 방식.

[^7]: ntfy iOS App, Apple App Store. https://apps.apple.com/us/app/ntfy/id1625396347 — iOS용 ntfy 클라이언트 앱.

[^8]: Google Cloud Free Tier, Google Cloud. https://cloud.google.com/free — Cloud Functions 200만 호출/월, 400K GB-sec 무료 등 상세 무료 한도.

[^9]: Cloud Functions for Firebase, Google. https://firebase.google.com/docs/functions — Firestore 트리거, HTTP 트리거, 스케줄 트리거 등 Cloud Functions 가이드.

[^10]: Cloudflare Workers Pricing, Cloudflare. https://developers.cloudflare.com/workers/platform/pricing/ — 무료 플랜 10만 요청/일, 유료 플랜 상세.

[^11]: Cloudflare Workers Limits, Cloudflare. https://developers.cloudflare.com/workers/platform/limits/ — CPU 시간, 메모리, 서브리퀘스트 등 Workers 제한 사항.

[^12]: AWS Lambda Pricing, Amazon Web Services. https://aws.amazon.com/lambda/pricing/ — 100만 요청/월, 400K GB-sec 영구 무료 티어.

[^13]: AWS Serverless Mobile Push Notification Sample, AWS. https://github.com/aws-samples/serverless-mobile-push-notification — Lambda + SNS 기반 서버리스 모바일 푸시 아키텍처 샘플.

[^14]: Cloud Tasks Pricing, Google Cloud. https://cloud.google.com/tasks/pricing — 100만 작업/월 무료, 이후 $0.40/100만 작업.

[^15]: Cloud Logging Pricing, Google Cloud. https://cloud.google.com/logging/pricing — 50GB/월 무료 로그 수집, 이후 $0.50/GB.
