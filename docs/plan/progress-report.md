# DexWeaver FCM 진행 보고서

> 최종 업데이트: 2026-03-19

---

## 아키텍처 결정

| 항목 | 결정 |
|------|------|
| **요금제** | Firebase Spark (무료) 플랜 유지 |
| **백엔드** | Cloud Functions 사용 안 함 → 맥북 로컬 스크립트 (ts-node) |
| **FCM 전송** | 맥북에서 Firebase Admin SDK로 직접 호출 |
| **데이터 저장** | Cloud Firestore (무료 한도 내) |
| **클라이언트** | Flutter iOS 앱 (iPhone) |
| **ACK 전송** | 앱에서 Firestore에 직접 쓰기 |

```
맥북 (ts-node 스크립트)  →  FCM API  →  APNs  →  iPhone (Flutter 앱)
        ↕                                              ↕
     Firestore  ←←←←←←←←←←←  ACK 전송  ←←←←←←←←←←←←←┘
```

---

## 진행 현황

### 2026-03-19

| 시간 | 작업 | 상태 | 비고 |
|------|------|------|------|
| 10:00 | Firebase 프로젝트 생성 (dummyfcm-6dcc3) | ✅ 완료 | 사용자 직접 수행 |
| 10:10 | 서비스 계정 키 발급 | ✅ 완료 | Firebase Console에서 다운로드 |
| 10:15 | serviceAccountKey.json 생성 | ✅ 완료 | 프로젝트 루트에 복사 |
| 10:20 | .gitignore 보안 파일 패턴 추가 | ✅ 완료 | 서비스 계정 키, GoogleService-Info.plist 등 |
| 10:25 | npm 캐시 권한 문제 해결 | ✅ 완료 | `sudo chown -R 501:20 ~/.npm` |
| 10:26 | npm install (백엔드 의존성) | ✅ 완료 | firebase-admin, uuid, typescript 등 197 packages |
| 10:27 | .firebaserc 프로젝트 ID 수정 | ✅ 완료 | `dummyfcm` → `dummyfcm-6dcc3` |
| 10:28 | TypeScript 빌드 (tsc) | ✅ 완료 | 에러 없음 |
| 10:29 | Firebase CLI 설치 | ✅ 완료 | `npm install -g firebase-tools` |
| 10:30 | Firebase CLI 로그인 | ✅ 완료 | 사용자 직접 수행 |
| 10:31 | Firestore 보안 규칙 + 인덱스 배포 | ✅ 완료 | `firebase deploy --only firestore` |
| 10:32 | Flutter 의존성 설치 (pub get) | ✅ 완료 | 67 packages |
| 10:33 | GoogleService-Info.plist 다운로드 | ✅ 완료 | 사용자 직접 수행 |
| 10:34 | Flutter iOS 프로젝트 생성 | ✅ 완료 | `flutter create --platforms ios` |
| 10:35 | GoogleService-Info.plist → ios/Runner/ 복사 | ✅ 완료 | |
| 10:36 | iOS Info.plist 백그라운드 모드 추가 | ✅ 완료 | `remote-notification`, `fetch` |
| 10:37 | Firebase 연결 테스트 (send 스크립트) | ✅ 완료 | Firestore 접속 성공 (토큰 없어서 전송은 대기) |
| - | iPhone 연결 + Flutter 앱 빌드/설치 | ⏳ 대기 | iPhone USB 연결 필요 |
| - | FCM E2E 테스트 (토큰→전송→ACK) | ⏳ 대기 | 앱 설치 후 진행 |

---

## 완료된 코드 구성

### 백엔드 (TypeScript)
- `src/config/firebase.ts` — Firebase Admin SDK 초기화
- `src/modules/qos/qosEngine.ts` — QoS L0/L1/L2 엔진
- `src/modules/qos/retryManager.ts` — 인메모리 재시도 관리
- `src/modules/qos/deadLetterQueue.ts` — DLQ 관리
- `src/modules/ack/ackMatcher.ts` — ACK 매칭 + 지연시간 계산
- `src/modules/metrics/metricsCollector.ts` — M1~M8 메트릭 수집
- `src/modules/safety/safetyClassifier.ts` — 페이로드 검증
- `src/scripts/send.ts` — FCM 전송 스크립트
- `src/scripts/register-token.ts` — 토큰 수동 등록
- `src/scripts/ack-listener.ts` — ACK 실시간 리스너
- `src/scripts/run-experiment.ts` — 실험 자동화

### Flutter 앱 (Dart)
- `app/lib/main.dart` — 앱 엔트리포인트
- `app/lib/services/fcm_service.dart` — FCM 초기화, 토큰 등록
- `app/lib/services/ack_service.dart` — ACK 전송
- `app/lib/services/dedup_service.dart` — 중복 제거 (L2)
- `app/lib/models/message_model.dart` — 메시지 모델
- `app/lib/screens/home_screen.dart` — 수신 현황 UI

### 인프라
- `firestore.rules` — Firestore 보안 규칙 (배포 완료)
- `firestore.indexes.json` — Firestore 인덱스 (배포 완료)
- `.firebaserc` — Firebase 프로젝트 연결 (dummyfcm-6dcc3)

---

## 다음 단계

1. iPhone USB 연결
2. Flutter 앱 iPhone에 빌드/설치
3. 앱 실행 → FCM 토큰 Firestore 등록 확인
4. `npm run send -- --auto` → iPhone 푸시 수신 확인
5. ACK 리스너로 지연시간 측정 확인
6. Phase 1 Baseline 실험 시작 (EXP-S01)

---

## 필요 사항 (사용자 액션)

| 항목 | 상태 | 비고 |
|------|------|------|
| Firebase 프로젝트 생성 | ✅ | dummyfcm-6dcc3 |
| 서비스 계정 키 발급 | ✅ | |
| Firebase CLI 로그인 | ✅ | |
| GoogleService-Info.plist 다운로드 | ✅ | |
| Firestore 활성화 | ✅ | 배포 시 자동 생성됨 |
| **iPhone USB 연결** | ⏳ | 앱 설치에 필요 |
| **APNs Key 등록** | ⏳ | 실제 푸시 수신에 필요 (Apple Developer 계정) |
