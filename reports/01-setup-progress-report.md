# DexWeaver FCM 프로젝트 셋업 진행 보고서

> 작성일: 2026-03-19
> 작성 시점: Phase 0 (인프라 구축) 진행 중

---

## 1. 프로젝트 개요

DexWeaver FCM QoS 연구 시스템의 인프라 구축 과정을 기록한 보고서.
Firebase Spark(무료) 플랜 + 맥북 로컬 스크립트 방식으로 FCM 푸시 알림의 QoS를 측정하는 시스템을 구축한다.

---

## 2. 최종 결정 아키텍처

### 변경 이력

| 단계 | 아키텍처 | 변경 사유 |
|------|---------|----------|
| 최초 설계 | Node.js + Express 상시 서버 + PostgreSQL + Redis | 개인 MacBook 환경에서 서버 24/7 운영 불가 |
| 1차 변경 | Cloud Functions + Firestore (서버리스) | Blaze 플랜 전환 필요 ($0이지만 신용카드 등록 필요) |
| 2차 변경 | **맥북 로컬 스크립트 + Firestore** | Cloud Functions 없이 Spark 플랜(무료)으로 진행 |
| 3차 변경 | iOS → **Android 에뮬레이터**로 전환 | Apple Developer Program ($99/년) 비용 문제 |

### 최종 아키텍처

```
맥북 (ts-node 스크립트)  →  FCM API  →  Android 에뮬레이터 (Flutter 앱)
        ↕                                              ↕
     Firestore  ←←←←←←←←←←←  ACK 전송  ←←←←←←←←←←←←←┘
```

| 항목 | 결정 |
|------|------|
| 요금제 | Firebase Spark (무료) |
| 백엔드 | 맥북 로컬 스크립트 (ts-node) — Cloud Functions 사용 안 함 |
| FCM 전송 | Firebase Admin SDK (serviceAccountKey.json) |
| 데이터 저장 | Cloud Firestore (무료 한도: 50K 읽기/20K 쓰기/일) |
| 테스트 디바이스 | Android 에뮬레이터 (Pixel 3a API 36) |
| 클라이언트 | Flutter 앱 (크로스플랫폼) |
| ACK 전송 | 앱 → Firestore 직접 쓰기 |

---

## 3. 진행 현황 (시간순)

### 2026-03-19

| 시간 | 작업 | 상태 | 담당 | 비고 |
|------|------|:----:|------|------|
| 10:00 | Firebase 프로젝트 생성 | ✅ | 사용자 | 프로젝트 ID: `dummyfcm-6dcc3` |
| 10:05 | Blaze 플랜 전환 여부 논의 | ✅ | 공동 | Spark 플랜 유지로 결정 |
| 10:10 | 서비스 계정 키 발급 | ✅ | 사용자 | Firebase Console → 서비스 계정 → 새 비공개 키 생성 |
| 10:12 | 첫 번째 키 채팅에 노출 (보안 사고) | ⚠️ | - | 키 재발급 권고, 이전 키 폐기 필요 |
| 10:15 | 두 번째 키 발급 + serviceAccountKey.json 생성 | ✅ | 공동 | `cp` 명령으로 프로젝트 루트에 복사 |
| 10:20 | .gitignore 보안 파일 패턴 추가 | ✅ | Claude | `*-firebase-adminsdk-*.json`, `GoogleService-Info.plist` 등 |
| 10:25 | npm install 실패 (캐시 권한 문제) | ⚠️→✅ | Claude | `sudo chown -R 501:20 ~/.npm`으로 해결 |
| 10:26 | npm install 성공 | ✅ | Claude | 197 packages 설치 |
| 10:27 | .firebaserc 프로젝트 ID 수정 | ✅ | Claude | `dummyfcm` → `dummyfcm-6dcc3` |
| 10:28 | TypeScript 빌드 (tsc) | ✅ | Claude | 에러 없음 |
| 10:29 | Firebase CLI 설치 | ✅ | Claude | `npm install -g firebase-tools` |
| 10:30 | Firebase CLI 로그인 | ✅ | 사용자 | `firebase login` → 브라우저 인증 |
| 10:31 | Firestore 보안 규칙 + 인덱스 배포 | ✅ | Claude | Firestore DB 자동 생성됨 |
| 10:32 | Flutter 의존성 설치 | ✅ | Claude | 67 packages |
| 10:33 | GoogleService-Info.plist 다운로드 | ✅ | 사용자 | Firebase Console에서 iOS 앱 등록 |
| 10:34 | Flutter iOS 프로젝트 생성 | ✅ | Claude | `flutter create --platforms ios` |
| 10:35 | iOS Info.plist 백그라운드 모드 추가 | ✅ | Claude | `remote-notification`, `fetch` |
| 10:36 | Firebase 연결 테스트 | ✅ | Claude | Firestore 접속 성공 확인 |
| 10:37 | APNs Key 등록 시도 | ❌ | 사용자 | Apple Developer Program 미등록 → $99/년 비용 |
| 10:40 | iOS → Android 에뮬레이터 전환 결정 | ✅ | 공동 | 비용 문제로 Android로 전환 |
| 10:41 | Flutter Android 플랫폼 추가 | ✅ | Claude | `flutter create --platforms android` |
| 10:42 | Android 에뮬레이터 실행 | ✅ | Claude | Pixel 3a API 36 (30초 부팅) |
| 10:45 | google-services.json 다운로드 | ✅ | 사용자 | Firebase Console에서 Android 앱 등록 |
| 10:46 | Android 패키지명 변경 | ✅ | Claude | `com.example.dexweaver_fcm` → `com.dexweaver.fcm` |
| 10:47 | Google Services 플러그인 추가 | ✅ | Claude | build.gradle.kts, settings.gradle.kts 수정 |
| 10:48 | Flutter 빌드 실패 (Java 버전) | ⚠️→✅ | Claude | Java 11 → Java 24로 flutter config 변경 |
| 10:50 | Flutter 앱 Android 빌드 성공 | ✅ | Claude | app-debug.apk 설치 완료 |
| 10:51 | FCM 토큰 미등록 (iOS 코드 하드코딩) | ⚠️→✅ | Claude | `iosInfo` → Platform 분기로 수정 |
| 10:55 | Flutter 앱 재빌드 + FCM 토큰 발급 확인 | ✅ | Claude | `fKNavIzvTT-Bczw8cQfh...` |
| 10:56 | **FCM 메시지 전송 성공** | ✅ | Claude | `npm run send -- --auto` |
| 10:57 | **ACK 수신 확인 (E2E 완료)** | ✅ | Claude | 지연시간 479ms, foreground, wifi |

---

## 4. 이슈 및 해결

### 이슈 1: 서비스 계정 키 채팅 노출 (보안)
- **상황**: 사용자가 서비스 계정 키(private_key 포함) JSON 내용을 채팅에 붙여넣음
- **위험도**: 높음 — private key 노출 시 Firebase 프로젝트에 무단 접근 가능
- **조치**: 즉시 경고, 키 재발급 권고
- **교훈**: 서비스 계정 키는 절대 외부에 공유하지 말 것. 노출 시 즉시 폐기 후 재발급

### 이슈 2: npm 캐시 권한 오류
- **상황**: `npm install` 시 `EACCES: permission denied` 에러
- **원인**: `~/.npm` 폴더가 root 소유로 되어 있었음 (이전 `sudo npm` 사용 흔적)
- **해결**: `sudo chown -R 501:20 "/Users/ywlee/.npm"`
- **소요 시간**: 약 2분

### 이슈 3: .firebaserc 프로젝트 ID 불일치
- **상황**: `.firebaserc`에 `dummyfcm`으로 설정되어 있었으나 실제 프로젝트 ID는 `dummyfcm-6dcc3`
- **원인**: 프로젝트 생성 시 Firebase가 자동으로 suffix 추가
- **해결**: `.firebaserc` 수정

### 이슈 4: Firebase CLI 비인터랙티브 로그인 불가
- **상황**: Claude 환경에서 `firebase login` 실행 시 브라우저를 열 수 없음
- **해결**: 사용자가 직접 터미널에서 `firebase login` 실행

### 이슈 5: Flutter iOS 프로젝트 미생성 상태
- **상황**: `app/ios/Runner/` 디렉토리가 존재하지 않아 GoogleService-Info.plist 복사 실패
- **원인**: `flutter create`가 아직 실행되지 않은 상태 (코드만 존재, 네이티브 프로젝트 미생성)
- **해결**: `flutter create --platforms ios .` 실행

### 이슈 6: Java 버전 불일치 (Java 11 vs 17+)
- **상황**: Flutter Android 빌드 시 `Android Gradle plugin requires Java 17 to run. You are currently using Java 11` 에러
- **원인**: Android Studio가 내장한 JBR(JetBrains Runtime)이 Java 11이었음
- **해결**: Homebrew로 설치된 OpenJDK 24를 Flutter에 설정 (`flutter config --jdk-dir=...`)

### 이슈 7: iOS 전용 코드가 Android에서 크래시
- **상황**: `fcm_service.dart`와 `ack_service.dart`에서 `deviceInfo.iosInfo`를 하드코딩하여 Android에서 실행 시 토큰 등록 실패
- **원인**: 최초 코드가 iOS 전용으로 작성됨
- **해결**: `Platform.isAndroid` 분기 추가, `androidInfo`와 `iosInfo`를 플랫폼별로 사용하도록 수정

### 이슈 8: Apple Developer Program 비용 ($99/년)
- **상황**: iOS에서 실제 푸시 알림을 받으려면 APNs Key가 필요하고, 이를 위해 Apple Developer Program 등록 필수
- **비용**: $99/년 (약 13만원)
- **결정**: iOS 대신 Android 에뮬레이터로 전환
- **영향**:
  - iOS 전용 실험 (EXP-U11 Silent 스로틀링, EXP-U12 Force Kill) 제외
  - Android 에뮬레이터에서 FCM 직접 수신 가능 (APNs 불필요)
  - Flutter 크로스플랫폼이므로 코드 변경 최소

---

## 5. 사전 설정 작업 목록 (체크리스트)

### Firebase 설정
- [x] Firebase 프로젝트 생성
- [x] 서비스 계정 키 발급 및 프로젝트에 배치
- [x] Firebase CLI 설치 및 로그인
- [x] Firestore 데이터베이스 생성
- [x] Firestore 보안 규칙 배포
- [x] Firestore 인덱스 배포
- [x] .firebaserc 프로젝트 ID 확인
- [x] iOS 앱 등록 + GoogleService-Info.plist 다운로드
- [ ] Android 앱 등록 + google-services.json 다운로드

### 보안 설정
- [x] .gitignore에 serviceAccountKey.json 등록
- [x] .gitignore에 firebase-adminsdk 키 패턴 등록
- [x] .gitignore에 GoogleService-Info.plist 등록
- [x] 노출된 서비스 계정 키 재발급 (사용자 확인 필요)

### 개발 환경
- [x] Node.js + npm 확인
- [x] npm 캐시 권한 문제 해결
- [x] npm install (백엔드 의존성)
- [x] TypeScript 빌드 확인
- [x] Flutter SDK 확인 (3.41.5)
- [x] Flutter pub get (앱 의존성)
- [x] Flutter iOS 프로젝트 생성
- [x] Flutter Android 프로젝트 생성
- [ ] Android 에뮬레이터 실행 확인
- [ ] Flutter 앱 Android 빌드 및 설치

### iOS 관련 (보류)
- [x] GoogleService-Info.plist 복사
- [x] Info.plist 백그라운드 모드 설정
- [ ] ~~APNs Key 발급~~ → Apple Developer Program 미등록으로 불가
- [ ] ~~APNs Key Firebase 등록~~ → 위와 동일

---

## 6. iOS 포기 사유 정리

### 문제
iOS에서 FCM 푸시 알림을 수신하려면 **APNs (Apple Push Notification service)** 연동이 필수이며, APNs Key를 발급하려면 **Apple Developer Program** 등록이 필요하다.

### 비용
- Apple Developer Program: **$99/년** (약 13만원)
- 개인 개발자 기준, 연간 갱신 필요

### 무료 Apple ID로 가능한 것 vs 불가능한 것

| | 무료 Apple ID | Apple Developer Program ($99/년) |
|---|:---:|:---:|
| Xcode 설치 | O | O |
| iPhone에 앱 설치 (개발용) | O (7일 제한) | O |
| APNs Key 생성 | **X** | O |
| 실제 푸시 알림 수신 | **X** | O |
| App Store 배포 | X | O |

### 결론
- QoS 연구의 핵심은 "푸시 알림 전송 → 디바이스 수신 → ACK 응답"의 E2E 파이프라인이므로, 실제 푸시 수신이 불가능하면 연구 자체가 불가
- Android 에뮬레이터는 Google Play Services가 내장되어 있어 FCM을 **무료로, APNs 없이** 직접 수신 가능
- Flutter 크로스플랫폼 프레임워크를 사용하므로 코드 변경 없이 Android로 전환 가능
- 추후 Apple Developer Program 등록 시 iOS 실험도 추가 가능

### 영향받는 실험

| 실험 | 내용 | 영향 |
|------|------|------|
| EXP-U11 | iOS Silent Push 스로틀링 | **제외** (iOS 전용) |
| EXP-U12 | iOS Force Kill + Silent | **제외** (iOS 전용) |
| 기타 모든 실험 | FCM 기본 동작, QoS 메커니즘 등 | Android로 대체 수행 가능 |

---

## 7. 현재 프로젝트 파일 구조

```
dexweaverFCM/
├── docs/                           # 연구 문서 (01~07)
├── reports/                        # 진행 보고서 (이 파일)
├── src/                            # 백엔드 (TypeScript)
│   ├── config/firebase.ts          # Firebase Admin SDK 초기화
│   ├── modules/
│   │   ├── qos/                    # QoS 엔진 (L0/L1/L2)
│   │   ├── ack/                    # ACK 매칭
│   │   ├── metrics/                # M1~M8 메트릭 수집
│   │   └── safety/                 # 페이로드 검증
│   └── scripts/                    # 실행 스크립트
│       ├── send.ts                 # FCM 전송
│       ├── register-token.ts       # 토큰 등록
│       ├── ack-listener.ts         # ACK 리스너
│       └── run-experiment.ts       # 실험 자동화
├── app/                            # Flutter 앱
│   ├── lib/
│   │   ├── main.dart
│   │   ├── services/               # FCM, ACK, 중복제거
│   │   ├── models/                 # 메시지 모델
│   │   └── screens/                # UI
│   ├── ios/                        # iOS (보류)
│   └── android/                    # Android (활성)
├── serviceAccountKey.json          # 🔒 .gitignore 등록됨
├── GoogleService-Info.plist        # 🔒 .gitignore 등록됨
├── firebase.json
├── firestore.rules                 # 배포 완료
├── firestore.indexes.json          # 배포 완료
├── .firebaserc                     # dummyfcm-6dcc3
├── package.json
└── tsconfig.json
```

---

## 8. 다음 단계

| 순서 | 작업 | 비고 |
|------|------|------|
| 1 | Firebase Console에서 Android 앱 등록 | 패키지명: `com.dexweaver.fcm` |
| 2 | google-services.json 다운로드 → `app/android/app/` 배치 | |
| 3 | Android 에뮬레이터에 Flutter 앱 빌드/설치 | `flutter run` |
| 4 | FCM 토큰 Firestore 등록 확인 | |
| 5 | `npm run send -- --auto` → 에뮬레이터 푸시 수신 확인 | |
| 6 | ACK 리스너로 지연시간 측정 확인 | |
| 7 | Phase 1 Baseline 실험 시작 (EXP-S01) | |
