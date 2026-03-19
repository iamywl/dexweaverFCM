# DexWeaver FCM — FCM QoS 연구 프로젝트

Firebase Cloud Messaging(FCM)의 QoS(Quality of Service) 지표를 다양한 시나리오에서 정량적으로 측정하고 분석하는 연구 프로젝트이다.

## 아키텍처

```
MacBook (ts-node scripts)  →  FCM HTTP v1 API  →  Android 에뮬레이터 (Flutter App)
        ↓                                                    ↓
   Firestore (messages)                              Firestore (acks)
        ↓
   MetricsCollector → QoS 지표 (M1~M8) → CSV / Markdown 보고서
```

- **전송**: MacBook 로컬에서 Firebase Admin SDK를 통해 FCM 메시지 전송
- **수신**: Android 에뮬레이터(Pixel 3a API 36)에서 Flutter 앱이 메시지 수신 후 ACK를 Firestore에 기록
- **분석**: Firestore의 messages/acks 데이터를 기반으로 M1~M8 QoS 지표 계산
- **제약**: Firebase Spark(무료) 플랜만 사용, Cloud Functions 미사용

## 측정 지표 (M1~M8)

| 지표 | 설명 | 단위 |
|------|------|------|
| M1 | 전달률 (Delivery Rate) — ACK 수신 기준 | % |
| M2 | 평균 지연시간 (Average Latency) | ms |
| M3 | P95 지연시간 | ms |
| M4 | P99 지연시간 | ms |
| M5 | 재시도율 (Retry Rate) | % |
| M6 | DLQ 비율 (Dead Letter Queue Rate) | % |
| M7 | 중복 수신율 (Duplicate Rate) | % |
| M8 | 처리량 (Throughput) | msg/s |

## 디렉토리 구조

```
dexweaverFCM/
├── src/                          # Node.js 백엔드 (TypeScript)
│   ├── config/
│   │   └── firebase.ts           # Firebase Admin SDK 초기화 (serviceAccountKey.json 참조)
│   ├── modules/
│   │   ├── ack/
│   │   │   └── ackMatcher.ts     # 메시지-ACK 매칭 로직
│   │   ├── metrics/
│   │   │   └── metricsCollector.ts  # M1~M8 QoS 지표 계산 엔진
│   │   ├── qos/
│   │   │   ├── qosEngine.ts      # QoS 레벨(L0/L1/L2) 처리 엔진
│   │   │   ├── retryManager.ts   # L1 재시도 관리 (지수 백오프)
│   │   │   └── deadLetterQueue.ts # L2 DLQ(Dead Letter Queue) 처리
│   │   └── safety/
│   │       └── safetyClassifier.ts  # 안전 분류기 (알림 유형 분류)
│   └── scripts/
│       ├── send.ts               # 단일 FCM 메시지 전송 (CLI 도구)
│       ├── register-token.ts     # 디바이스 FCM 토큰 수동 등록
│       ├── ack-listener.ts       # Firestore ACK 컬렉션 실시간 리스너
│       ├── run-experiment.ts     # 단일 실험 실행기
│       ├── run-all-experiments.ts  # Phase 1: 기본 시나리오 8종 일괄 실행
│       ├── run-server-to-phone.ts  # Phase 2: 서버→폰 16개 시나리오 실험
│       └── recalculate-metrics.ts  # 완료된 실험의 메트릭 재계산 + 보고서 생성
│
├── app/                          # Flutter 클라이언트 앱 (Android)
│   └── lib/
│       ├── main.dart             # 앱 진입점, Firebase 초기화
│       ├── models/
│       │   └── message_model.dart # 수신 메시지 데이터 모델
│       ├── screens/
│       │   └── home_screen.dart   # 메인 화면 (수신 메시지 목록 표시)
│       └── services/
│           ├── fcm_service.dart   # FCM 토큰 관리 및 메시지 수신 처리
│           ├── ack_service.dart   # ACK Firestore 기록 서비스
│           └── dedup_service.dart # 중복 메시지 감지 서비스
│
├── docs/                         # 기술 조사 및 설계 문서
│   ├── 01-fcm-research.md        # FCM 기술 조사 (프로토콜, 아키텍처, 제약)
│   ├── 02-fcm-case-analysis.md   # FCM 활용 사례 분석 (카카오톡, 배민 등)
│   ├── 03-qos-evaluation-metrics.md  # QoS 평가 지표 설계 (M1~M8 정의)
│   ├── 04-experiment-design.md   # 실험 설계서 (시나리오, 변수, 절차)
│   ├── 05-development-plan.md    # 개발 계획서 (마일스톤, 일정)
│   ├── 06-serverless-implementation-plan.md  # Serverless(Spark 플랜) 구현 계획
│   ├── 07-serverless-dev-plan.md # Serverless 개발 상세 계획
│   ├── dev-plan.csv              # 개발 계획 CSV (일정 관리)
│   └── progress-report.md        # 진행 상황 보고서
│
├── evaluation/                   # 평가 자료 (학술 문체, ~이다 체)
│   ├── 01-evaluation-metrics.md  # 평가 지표 정의서 (M1~M8 수식, 코드 수준 설명)
│   ├── 02-fcm-scenarios.md       # FCM 송수신 시나리오 분석 (Unicast/Topic/조건별)
│   └── 03-reliability-guide.md   # FCM 신뢰성 확보 가이드 (QoS L0/L1/L2, 중복제거)
│
├── results/                      # 실험 결과 데이터
│   ├── experiment-results.json   # Phase 1 실험 JSON 결과
│   ├── qos-metrics-report.md     # Phase 1 QoS 지표 보고서 (8 시나리오, 920건)
│   ├── server-to-phone-results.json   # Phase 2 실험 JSON 결과 (실행 후 생성)
│   ├── server-to-phone-raw.csv        # Phase 2 원시 데이터 CSV (엑셀 호환)
│   ├── server-to-phone-summary.csv    # Phase 2 시나리오별 요약 CSV
│   └── server-to-phone-report.md      # Phase 2 서버→폰 QoS 분석 보고서
│
├── reports/                      # 프로젝트 보고서
│   └── 01-setup-progress-report.md  # 환경 구축 보고서 (이슈, iOS→Android 전환 등)
│
├── firebase.json                 # Firebase 프로젝트 설정
├── firestore.rules               # Firestore 보안 규칙
├── firestore.indexes.json        # Firestore 인덱스 설정
├── package.json                  # Node.js 의존성 및 스크립트
├── tsconfig.json                 # TypeScript 컴파일 설정
└── .gitignore                    # Git 제외 (serviceAccountKey, google-services 등)
```

## 사용법

### 사전 준비

1. `npm install` — 의존성 설치
2. Firebase Console에서 서비스 계정 키 다운로드 → 프로젝트 루트에 `serviceAccountKey.json`으로 저장
3. Android 에뮬레이터에 Flutter 앱 설치 및 실행 (`cd app && flutter run`)

### 주요 명령어

```bash
# 단일 메시지 전송
npm run send -- --auto --title "제목" --body "내용"
npm run send -- --token <FCM_TOKEN> --type data --body "데이터 메시지"

# ACK 리스너 실행 (메시지 수신 확인 모니터링)
npm run ack-listener

# FCM 토큰 수동 등록
npm run register-token -- <FCM_TOKEN>

# Phase 1 실험 (기본 시나리오 8종)
npx tsx src/scripts/run-all-experiments.ts

# Phase 2 실험 (서버→폰 16개 시나리오)
npx tsx src/scripts/run-server-to-phone.ts

# 실험 결과 메트릭 재계산
npx tsx src/scripts/recalculate-metrics.ts
```

### Firestore 컬렉션

| 컬렉션 | 용도 |
|---------|------|
| `tokens` | 디바이스 FCM 토큰 (Flutter 앱이 자동 등록) |
| `messages` | 전송된 메시지 기록 (ID, 페이로드, 상태, 타임스탬프) |
| `acks` | 수신 확인 (Flutter 앱이 메시지 수신 시 기록) |
| `experiments` | 실험 메타데이터 (시나리오, 파라미터, 상태) |

## 실험 환경

| 항목 | 값 |
|------|-----|
| 전송 장비 | MacBook (Apple M4 Max, macOS 15.7.4) |
| 수신 디바이스 | Android 에뮬레이터 (Pixel 3a, API 36) |
| 네트워크 | 로컬 (에뮬레이터 ↔ 호스트) |
| FCM 전송 | Firebase Admin SDK (Node.js, TypeScript) |
| Firebase 플랜 | Spark (무료) |
| 클라이언트 | Flutter 3.41.5 |

## 보안 주의사항

다음 파일은 `.gitignore`에 등록되어 있으며, 절대 GitHub에 업로드하지 않는다:

- `serviceAccountKey.json` — Firebase 서비스 계정 키
- `*-firebase-adminsdk-*.json` — Firebase Admin SDK 키 파일
- `google-services.json` — Android Firebase 설정
- `GoogleService-Info.plist` — iOS Firebase 설정
