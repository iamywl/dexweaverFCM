# DexWeaver FCM 서버리스 개발 계획서 (방안 A)

> 작성일: 2026-03-19
> 목적: 방안 A (FCM + Google Cloud Functions)를 채택하여, MacBook + iPhone 환경에서 서버리스로 DexWeaver FCM QoS 연구 시스템을 구축하는 **구체적 개발 계획**을 정의한다.
> 근거: [06-serverless-implementation-plan.md](06-serverless-implementation-plan.md) §4 방안 A

---

## 1. 환경 제약 및 전제

| 항목 | 값 |
|------|-----|
| **개발 장비** | MacBook (macOS) |
| **테스트 디바이스** | iPhone (iOS) — Android 기기 없음 |
| **클라이언트 프레임워크** | Flutter + FlutterFire |
| **백엔드** | Cloud Functions for Firebase (Node.js + TypeScript) |
| **DB** | Cloud Firestore |
| **재시도 큐** | Cloud Tasks |
| **모니터링** | Cloud Logging + Cloud Monitoring |
| **비용** | Firebase Spark(무료) 플랜 시작, 필요 시 Blaze(종량제) 전환 |

### 실험 범위 조정

iPhone만 보유하므로 실험 범위를 다음과 같이 조정한다:

| 원래 계획 (04-experiment-design.md) | 조정 |
|-------------------------------------|------|
| Android Pixel 7, Samsung S23, Xiaomi 13 | **제외** (기기 미보유) |
| iOS iPhone 14, iPhone 12 | **iPhone 1대**로 축소 |
| EXP-U08 (Android OEM 배터리 최적화) | **제외** |
| EXP-U09 (Android Doze) | **제외** |
| EXP-U10 (Android App Standby Bucket) | **제외** |
| EXP-U11 (iOS Silent 스로틀링) | **유지** (핵심 실험) |
| EXP-U12 (iOS Force Kill) | **유지** |

> Android 관련 실험은 추후 기기 확보 시 별도 Phase로 추가 가능.

---

## 2. 기술 스택

| 레이어 | 기술 | 선정 근거 |
|--------|------|----------|
| **Backend** | Cloud Functions (Node.js 20 + TypeScript) | Firebase Admin SDK 네이티브 통합 |
| **API** | Cloud Functions HTTP Trigger | Express 대체, 서버리스 |
| **DB** | Cloud Firestore | 무료 티어, 실시간 리스너, Trigger 지원 |
| **Retry Queue** | Cloud Tasks | 지연 실행, 자동 재시도, 무료 100만/월 |
| **iOS App** | Flutter 3.x + FlutterFire | 크로스플랫폼 (추후 Android 확장 용이) |
| **모니터링** | Cloud Logging + Cloud Monitoring | 무료 50GB/월, 커스텀 메트릭 |
| **실험 스크립트** | TypeScript (ts-node) | Cloud Functions 코드 재사용 |
| **분석** | Python + pandas | Firestore 데이터 export 후 분석 |

---

## 3. 시스템 아키텍처

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
│              Serverless Backend (Firebase)               │
│                                                         │
│  ┌──────────────────┐   ┌──────────────────────────┐    │
│  │ Cloud Functions  │   │ Cloud Functions           │    │
│  │ (HTTP Trigger)   │   │ (Firestore/Schedule)      │    │
│  │                  │   │                            │    │
│  │ - /api/send      │   │ - onTokenCreate → 검증     │    │
│  │ - /api/ack       │   │ - onMessageCreate → 전송   │    │
│  │ - /api/tokens    │   │ - onSchedule → stale 정리  │    │
│  └────────┬─────────┘   └─────────────┬──────────────┘   │
│           │                           │                   │
│  ┌────────▼───────────────────────────▼──────────────┐   │
│  │              QoS Engine                            │   │
│  │  ┌─────────┐  ┌───────────┐  ┌───────────────┐   │   │
│  │  │ Level 0 │  │ Level 1   │  │ Level 2       │   │   │
│  │  │ (1회)   │  │ (재시도)  │  │ (재시도+중복  │   │   │
│  │  │         │  │ +ACK 추적 │  │  제거)        │   │   │
│  │  └─────────┘  └───────────┘  └───────────────┘   │   │
│  │                                                    │   │
│  │  ┌──────────────┐  ┌─────────────┐                │   │
│  │  │ Cloud Tasks  │  │ Dead Letter │                │   │
│  │  │ (Retry Queue)│  │ (Firestore) │                │   │
│  │  └──────────────┘  └─────────────┘                │   │
│  └───────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Firebase Admin SDK (HTTP v1)               │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│                  Storage Layer (Firestore)                │
│                                                         │
│  tokens/         messages/       acks/       experiments/│
│  - fcmToken      - payload       - messageId  - phase   │
│  - platform      - sentAt        - receivedAt - params  │
│  - lastActive    - fcmResponse   - appState   - results │
│  - deviceModel   - qosLevel      - deviceInfo           │
│                  - status                                │
│                  - retryCount                            │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 디렉토리 구조

```
dexweaverFCM/
├── docs/                               # 문서
│
├── functions/                          # Cloud Functions 백엔드
│   ├── src/
│   │   ├── index.ts                    # 엔트리포인트 (함수 export)
│   │   ├── config/
│   │   │   └── firebase.ts             # Firebase Admin 초기화
│   │   ├── api/                        # HTTP Trigger 핸들러
│   │   │   ├── send.ts                 # POST /api/send
│   │   │   ├── ack.ts                  # POST /api/ack
│   │   │   └── tokens.ts              # POST /api/tokens
│   │   ├── triggers/                   # Firestore/Schedule Trigger
│   │   │   ├── onTokenCreate.ts        # 토큰 생성 시 검증
│   │   │   ├── onMessageCreate.ts      # 메시지 생성 시 전송
│   │   │   └── scheduledCleanup.ts     # 주기적 stale 토큰 정리
│   │   ├── modules/
│   │   │   ├── token/
│   │   │   │   ├── tokenService.ts     # 토큰 CRUD
│   │   │   │   └── tokenValidator.ts   # 토큰 유효성 검증
│   │   │   ├── dispatcher/
│   │   │   │   ├── messageDispatcher.ts# FCM 전송 (unicast/multicast/topic)
│   │   │   │   └── payloadBuilder.ts   # 메시지 페이로드 생성
│   │   │   ├── qos/
│   │   │   │   ├── qosEngine.ts        # QoS L0/L1/L2 분기
│   │   │   │   ├── retryManager.ts     # Cloud Tasks 기반 재시도
│   │   │   │   └── deadLetterQueue.ts  # DLQ 관리
│   │   │   ├── ack/
│   │   │   │   ├── ackService.ts       # ACK 수신/대조
│   │   │   │   └── ackMatcher.ts       # message-ack 매칭
│   │   │   ├── safety/
│   │   │   │   └── safetyClassifier.ts # 페이로드 검증, rate limit 검사
│   │   │   └── metrics/
│   │   │       └── metricsCollector.ts # M1~M8 지표 계산
│   │   └── utils/
│   │       └── timestamp.ts            # 타임스탬프 유틸
│   ├── package.json
│   ├── tsconfig.json
│   └── .eslintrc.js
│
├── app/                                # Flutter iOS 앱
│   ├── lib/
│   │   ├── main.dart                   # 앱 엔트리포인트
│   │   ├── services/
│   │   │   ├── fcm_service.dart        # FCM 초기화, 토큰 관리
│   │   │   ├── ack_service.dart        # ACK 전송
│   │   │   └── dedup_service.dart      # 메시지 중복 제거 (L2)
│   │   ├── models/
│   │   │   └── message_model.dart      # 수신 메시지 모델
│   │   └── screens/
│   │       └── home_screen.dart        # 수신 현황 UI
│   ├── ios/                            # iOS 네이티브 설정
│   │   └── Runner/
│   │       ├── AppDelegate.swift
│   │       └── Info.plist
│   ├── pubspec.yaml
│   └── analysis_options.yaml
│
├── scripts/                            # 실험/분석 스크립트
│   ├── experiments/                    # Phase별 실험 자동화
│   │   ├── phase1-baseline.ts          # EXP-S01~S05
│   │   ├── phase2-individual.ts        # EXP-U01~U15 (iOS 해당분)
│   │   ├── phase3-combined.ts          # EXP-C01~C06 (iOS 해당분)
│   │   └── phase4-qos-effect.ts        # QoS L0/L1/L2 효과
│   ├── analyzer/                       # 결과 분석
│   │   ├── export_firestore.py         # Firestore → CSV 추출
│   │   ├── calculate_metrics.py        # M1~M8 지표 계산
│   │   └── generate_report.py          # 결과 카드 자동 생성
│   └── package.json                    # ts-node, firebase-admin 의존성
│
├── results/                            # 실험 결과
│
├── firebase.json                       # Firebase 프로젝트 설정
├── firestore.rules                     # Firestore 보안 규칙
├── firestore.indexes.json              # Firestore 인덱스
├── .firebaserc                         # Firebase 프로젝트 alias
└── README.md
```

---

## 5. Firestore 스키마

### tokens 컬렉션

```
tokens/{tokenId}
{
  fcmToken: string,          // FCM 등록 토큰
  platform: "ios",           // 플랫폼
  deviceModel: string,       // e.g. "iPhone 14"
  osVersion: string,         // e.g. "iOS 17.4"
  appVersion: string,        // 앱 버전
  lastActive: Timestamp,     // 마지막 활성 시각
  createdAt: Timestamp,
  isValid: boolean           // 유효성 플래그
}
```

### messages 컬렉션

```
messages/{messageId}
{
  messageId: string,         // 고유 메시지 ID (UUID)
  payload: map,              // FCM 페이로드
  targetToken: string,       // 대상 FCM 토큰
  qosLevel: number,          // 0, 1, 2
  status: string,            // "pending" | "sent" | "delivered" | "failed" | "dlq"
  sentAt: Timestamp,         // 서버 전송 시각
  fcmResponse: map,          // FCM API 응답
  retryCount: number,        // 재시도 횟수
  experimentId: string,      // 실험 ID (nullable)
  createdAt: Timestamp
}
```

### acks 컬렉션

```
acks/{ackId}
{
  messageId: string,         // 대응되는 메시지 ID
  receivedAt: Timestamp,     // 디바이스 수신 시각
  ackSentAt: Timestamp,      // ACK 전송 시각
  appState: string,          // "foreground" | "background" | "terminated"
  deviceModel: string,
  osVersion: string,
  batteryLevel: number,      // 배터리 잔량 (%)
  networkType: string        // "wifi" | "cellular" | "unknown"
}
```

### experiments 컬렉션

```
experiments/{experimentId}
{
  name: string,              // e.g. "EXP-S01"
  phase: number,             // 1, 2, 3, 4
  description: string,
  parameters: map,           // 실험 파라미터
  status: string,            // "planned" | "running" | "completed"
  startedAt: Timestamp,
  completedAt: Timestamp,
  messageCount: number,      // 전송 메시지 수
  results: map               // M1~M8 결과
}
```

---

## 6. 개발 단계

### Phase 0: 인프라 구축 (Week 1)

> Firebase 프로젝트 생성 + Cloud Functions 최소 배포 + Flutter 앱 최소 동작

#### 0-1. Firebase 프로젝트 설정 ⚙️

| # | 작업 | 상세 | 담당 |
|---|------|------|------|
| 1 | Firebase 프로젝트 생성 | Firebase Console에서 `dexweaver-fcm` 프로젝트 생성 | **사용자** |
| 2 | Blaze 플랜 전환 | Cloud Functions 배포에 필요 (종량제, 무료 한도 내 과금 없음) | **사용자** |
| 3 | iOS 앱 등록 | Bundle ID: `com.dexweaver.fcm` | **사용자** |
| 4 | APNs Auth Key 등록 | Apple Developer → Keys → APNs Key 발급 → Firebase에 등록 | **사용자** |
| 5 | Firestore 활성화 | Firebase Console → Firestore Database → 생성 | **사용자** |
| 6 | Cloud Functions 활성화 | `firebase init functions` 실행 | 코드 |
| 7 | Cloud Tasks API 활성화 | GCP Console → Cloud Tasks API 활성화 | **사용자** |

#### 0-2. Cloud Functions 초기 구현

```
구현 모듈:
1. config/firebase.ts          — Firebase Admin SDK 초기화
2. api/tokens.ts               — POST: 토큰 등록/갱신
3. api/send.ts                 — POST: 단일 메시지 전송 (L0)
4. api/ack.ts                  — POST: ACK 수신
5. triggers/onTokenCreate.ts   — 토큰 생성 시 유효성 검증

의존성:
- firebase-admin
- firebase-functions
- uuid
```

#### 0-3. Flutter 앱 초기 구현

```
구현 모듈:
1. services/fcm_service.dart   — FCM 초기화, 토큰 등록, 메시지 수신
2. services/ack_service.dart   — ACK 콜백 전송
3. main.dart                   — 앱 초기화, 권한 요청

의존성:
- firebase_core
- firebase_messaging
- http
```

#### 0-4. E2E 검증

```
검증 시나리오:
1. Flutter 앱 실행 → FCM 토큰 발급 → Firestore tokens/ 에 저장 확인
2. Cloud Functions /api/send 호출 → iPhone에 푸시 도착 확인
3. 앱에서 ACK 전송 → Firestore acks/ 에 저장 확인
4. messages → acks 매칭 → 지연시간 계산 확인
```

---

### Phase 1: 대조군 실험 (Week 2)

> iOS 환경에서의 Baseline 확립

| 실험 | 내용 | 전송 수 | 비고 |
|------|------|---------|------|
| EXP-S01 | 단일 디바이스 정상 전송 (iPhone) | 2,500건 × 3회 | Foreground, data 메시지 |
| EXP-S02 | Background + Notification 메시지 | 2,500건 × 3회 | 앱 Background 상태 |
| EXP-S04 | Collapsible 메시지 (적정 빈도) | 100건 × 3회 | 3분 간격 |
| EXP-S05 | Data/Notification/Combined × 앱상태 | 9조합 × 900건 | iOS 3×3 매트릭스 |

> EXP-S03 (토픽 브로드캐스트): 디바이스 1대이므로 축소 실행 (구독자 1인 토픽 전송 테스트)

**산출물**: `results/phase1-baseline.md`

**구현 필요**:
- `scripts/experiments/phase1-baseline.ts` — 실험 자동화 스크립트
- `scripts/analyzer/calculate_metrics.py` — M1~M4 지표 계산

---

### Phase 2: 비교군 실험 — iOS 해당 요인 (Week 3)

| 실험 | 내용 | 비고 |
|------|------|------|
| EXP-U01 | Stale 토큰 비율별 전달률 | 무효 토큰 혼합 배치 전송 |
| EXP-U02 | 페이로드 크기 경계값 (4KB) | 1KB~8KB 단계별 |
| EXP-U03 | Rate Limit 초과 패턴 | 전송 속도 단계별 증가 |
| EXP-U04 | OAuth2 인증 만료 시뮬레이션 | 자동 갱신 중 유실 확인 |
| EXP-U05 | Non-collapsible 100건 한도 | 비행기 모드 활용 |
| EXP-U07 | Collapsible 스로틀링 | 전송 간격 단계별 감소 |
| **EXP-U11** | **iOS Silent 스로틀링** | **핵심 실험** — 빈도별 3시간 |
| **EXP-U12** | **iOS Force Kill + Silent** | Kill 상태 수신 여부 |
| EXP-U13 | 디바이스 오프라인 + 복구 | 비행기 모드 ON/OFF |
| EXP-U14 | 네트워크 장애 시뮬레이션 | Charles Proxy 활용 |
| EXP-U15 | 중복 전송 테스트 | 동일 ID 반복 전송 |

> EXP-U06 (토픽 팬아웃 지연): 디바이스 1대이므로 API 응답 시간만 측정
> EXP-U08~U10 (Android 전용): **제외**

**구현 필요**:
- QoS Engine (L0만 우선 구현, L1/L2는 Phase 4 전에 구현)
- `modules/safety/safetyClassifier.ts` — 페이로드 검증
- 실험 자동화 스크립트

**산출물**: `results/phase2-{case}.md` × 11

---

### Phase 3: 복합 요인 + QoS 메커니즘 실험 (Week 4)

#### 복합 요인 (iOS 해당분)

| 실험 | 조합 |
|------|------|
| EXP-C04 | iOS Silent + 저전력 모드 + Background |
| EXP-C06 | 네트워크 지연 + Collapsible 스로틀링 |
| EXP-C-iOS01 | iOS Force Kill + 오프라인 복구 (추가) |

#### QoS 메커니즘 효과 (L0/L1/L2)

**구현 필요** (Phase 3 시작 전까지):
- `modules/qos/qosEngine.ts` — L0/L1/L2 분기 로직
- `modules/qos/retryManager.ts` — Cloud Tasks 기반 재시도 (L1/L2)
- `services/dedup_service.dart` — 클라이언트 중복 제거 (L2)

| 대상 | QoS 개선 기대 | 실험 |
|------|-------------|------|
| EXP-U03 (Rate Limit) | Yes | L0/L1/L2 × 1,000건 × 3회 |
| EXP-U04 (인증 만료) | Yes | L0/L1/L2 × 500건 × 3회 |
| EXP-U14 (네트워크 장애) | Yes | L0/L1/L2 × 1,000건 × 3회 |

**산출물**:
- `results/phase3-combined.md`
- `results/phase4-qos-effect.md`
- `results/final-comparison.md` — 종합 비교 매트릭스

---

### Phase 4: 시스템 완성 및 안정화 (Week 5-6)

> 실험 결과를 반영하여 프로덕션 수준 시스템 완성

| 작업 | Week | 상세 |
|------|------|------|
| QoS 파라미터 확정 | W5 | 실험 결과 기반 재시도 횟수, 간격 확정 |
| 토큰 관리 고도화 | W5 | stale 정리 주기 확정, scheduled cleanup |
| 메트릭 대시보드 | W5 | Cloud Monitoring 커스텀 대시보드 |
| E2E 재검증 | W6 | Phase 1 대조군 재실행으로 시스템 검증 |
| 문서화 | W6 | 최종 QoS 보고서, API 문서 |

---

## 7. 마일스톤 요약

| 마일스톤 | 주차 | 산출물 | 완료 기준 |
|---------|------|--------|----------|
| **M0: 인프라 구축** | W1 | Cloud Functions + Flutter 앱 | 메시지 전송 → ACK 수신 E2E 동작 |
| **M1: Baseline 확립** | W2 | phase1-baseline.md | EXP-S01 전달률 ≥ 99% 확인 |
| **M2: iOS 요인 분석** | W3 | phase2-{case}.md × 11 | 모든 iOS 해당 케이스 결과 카드 완성 |
| **M3: QoS 효과 검증** | W4 | final-comparison.md | QoS L1/L2 효과 정량화 완료 |
| **M4: 시스템 완성** | W5-6 | 최종 시스템 + 보고서 | 프로덕션 수준 코드 + 문서 |

---

## 8. 리스크 및 대응

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| Cloud Functions 콜드 스타트 (수 초 지연) | 높음 | 중간 | 실험 측정 시 첫 호출 제외, min instances 설정 고려 |
| Firestore 무료 한도 초과 (50K 읽기/20K 쓰기/일) | 중간 | 중간 | 대량 실험 시 일별 분산 실행, 필요 시 Blaze 종량제 |
| APNs 인증서 설정 오류 | 중간 | 높음 | FlutterFire 공식 가이드 순서대로 진행 |
| iOS 디바이스 1대로 실험 재현성 부족 | 중간 | 중간 | 반복 횟수 증가 (3회→5회), 시간대 통제 |
| Cloud Tasks 무료 한도 초과 (100만/월) | 낮음 | 낮음 | Phase 3 QoS 실험에서만 사용, 한도 내 |
| Flutter iOS 빌드 이슈 (Xcode 버전 등) | 중간 | 중간 | FlutterFire 호환 매트릭스 확인 후 버전 고정 |

---

## 참고 문서

- [01-fcm-research.md](01-fcm-research.md) — FCM 기술 조사 보고서
- [02-fcm-case-analysis.md](02-fcm-case-analysis.md) — 안정/불안정 케이스 분석
- [03-qos-evaluation-metrics.md](03-qos-evaluation-metrics.md) — QoS 평가 지표 및 방법론
- [04-experiment-design.md](04-experiment-design.md) — 실험 설계서
- [05-development-plan.md](05-development-plan.md) — 원본 개발 계획서
- [06-serverless-implementation-plan.md](06-serverless-implementation-plan.md) — 서버리스 전환 방안
