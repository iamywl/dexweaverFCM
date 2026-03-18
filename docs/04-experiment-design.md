# FCM QoS 실험 설계서

> 작성일: 2026-03-18
> 목적: 02-fcm-case-analysis.md에서 분류한 안정/불안정 케이스에 대해
> 03-qos-evaluation-metrics.md에서 정의한 지표를 **어떤 순서로, 어떤 환경에서, 어떻게 실험**하는지 구체적으로 설계한다.

---

## 1. 실험 개요

### 1.1 실험 목표

| # | 목표 | 검증 대상 |
|---|------|----------|
| G1 | FCM 안정 사용 시 QoS 기준선(Baseline) 확립 | STABLE-01~05 |
| G2 | 각 불안정 요인이 QoS에 미치는 개별 영향 정량화 | UNSTABLE-01~15 (개별) |
| G3 | 복합 불안정 요인의 가중 효과 확인 | 불안정 요인 조합 |
| G4 | QoS 보장 메커니즘(L0/L1/L2)의 실효성 검증 | 각 불안정 케이스 × QoS Level |

### 1.2 실험 범위

```
총 실험 수: 4 Phase × 세부 시나리오

Phase 1: 대조군 (5개 시나리오)
Phase 2: 비교군 - 개별 요인 (15개 시나리오)
Phase 3: 비교군 - 복합 요인 (6개 시나리오)
Phase 4: QoS 메커니즘 효과 (주요 불안정 케이스 × 3 Level)
```

---

## 2. 실험 환경

### 2.1 하드웨어

| 구성 요소 | 사양 | 수량 | 용도 |
|----------|------|------|------|
| **테스트 서버** | AWS EC2 t3.large (2vCPU, 8GB RAM) | 1대 | FCM 전송, 로그 수집, ACK 수신 |
| **Android - Pixel 7** | Google Pixel 7, Android 14 | 1대 | 대조군 기준 기기 (OEM 간섭 없음) |
| **Android - Samsung S23** | Samsung Galaxy S23, OneUI 6.0 | 1대 | OEM 간섭 테스트 |
| **Android - Xiaomi 13** | Xiaomi 13, MIUI 14 | 1대 | OEM 간섭 테스트 |
| **iOS - iPhone 14** | iPhone 14, iOS 17 | 1대 | iOS 대조군 + 스로틀링 테스트 |
| **iOS - iPhone 12** | iPhone 12, iOS 16 | 1대 | iOS 버전 차이 확인 |
| **네트워크 프록시** | Charles Proxy / Linux TC 호스트 | 1대 | 네트워크 장애 시뮬레이션 |

### 2.2 소프트웨어

| 구성 요소 | 기술 | 버전 |
|----------|------|------|
| Firebase 프로젝트 | 전용 테스트 프로젝트 (프로덕션 격리) | — |
| Firebase Admin SDK | Node.js | ^12.x |
| Android 테스트 앱 | Kotlin + Firebase Messaging SDK | latest |
| iOS 테스트 앱 | Swift + Firebase Messaging SDK | latest |
| 부하 생성 | k6 | latest |
| DB | PostgreSQL | 15+ |
| 시간 동기화 | NTP (pool.ntp.org) | — |
| 모니터링 | Prometheus + Grafana | latest |

### 2.3 테스트 앱 요구사항

테스트 앱은 다음 기능을 포함해야 한다:

```
[Android/iOS 공통]
1. FCM 토큰 등록 및 서버 전송
2. 메시지 수신 시 즉시 ACK 서버로 콜백 전송
   - ACK 페이로드: { message_id, received_at, app_state, device_model }
3. 수신 메시지 ID 로컬 저장 (중복 감지용)
4. 앱 상태(foreground/background/killed) 기록
5. NTP 시간 동기화 상태 확인

[Android 추가]
6. onDeletedMessages() 콜백 감지 및 보고
7. 배터리 최적화 상태 조회 API

[iOS 추가]
8. Silent notification 수신 콜백 구현
9. Notification Service Extension (수신 확인용)
```

---

## 3. Phase 1: 대조군 실험 (Baseline)

> 목표: 정상 조건에서의 QoS 기준선을 확립한다.

### EXP-S01: 단일 디바이스 정상 전송

| 항목 | 값 |
|------|-----|
| **대상 케이스** | STABLE-01 |
| **조건** | 유효 토큰, 1KB data 메시지, HIGH 우선순위, 앱 Foreground |
| **디바이스** | Pixel 7, iPhone 14 (각각) |
| **전송 수** | 디바이스당 2,500건 × 3회 반복 = 7,500건 |
| **전송 간격** | 1초 간격 (Rate limit 안전 범위) |
| **측정 지표** | M1, M2, M3, M4 |
| **예상 소요** | 약 2.5시간 (디바이스당) |

**실행 절차:**
1. 테스트 앱 설치, FCM 토큰 등록
2. NTP 시간 동기화 확인 (오차 < 100ms)
3. 1초 간격으로 2,500건 전송
4. 24시간 ACK 수집 대기
5. 데이터 수집 후 지표 계산
6. 2회 더 반복 (반복 간 1시간 간격)

### EXP-S02: Background 앱 + Notification 메시지

| 항목 | 값 |
|------|-----|
| **대상 케이스** | STABLE-02 |
| **조건** | 유효 토큰, Notification 메시지, HIGH 우선순위, 앱 Background |
| **디바이스** | Pixel 7, iPhone 14 |
| **전송 수** | 디바이스당 2,500건 × 3회 |
| **특이사항** | 앱을 Background로 전환 후 전송 시작 |
| **측정 지표** | M1, M2, M3 |

### EXP-S03: 소규모 토픽 브로드캐스트

| 항목 | 값 |
|------|-----|
| **대상 케이스** | STABLE-03 |
| **조건** | 토픽 구독 디바이스 5대 (전체 테스트 기기), 유효 토큰 |
| **전송 수** | 500건 × 3회 |
| **측정 지표** | M1, M2 (마지막 디바이스 수신까지) |

### EXP-S04: Collapsible 메시지 (적정 빈도)

| 항목 | 값 |
|------|-----|
| **대상 케이스** | STABLE-04 |
| **조건** | collapse_key="status_update", 3분 간격 전송 |
| **전송 수** | 100건 × 3회 (5시간 소요) |
| **측정 지표** | M1, M2, 이전 메시지 대체 확인 |

### EXP-S05: Data vs Notification vs Combined (앱 상태별)

| 항목 | 값 |
|------|-----|
| **대상 케이스** | STABLE-01 + 앱 상태 조합 |
| **조건 매트릭스** | |

```
메시지 타입 × 앱 상태 = 3 × 3 = 9 조합 (Android)
메시지 타입 × 앱 상태 = 3 × 3 = 9 조합 (iOS)

각 조합: 300건 × 3회 = 900건
총: 18 조합 × 900건 = 16,200건
```

| 측정 포인트 | 설명 |
|-----------|------|
| Android Killed + Data | **드롭 확인** (공식 문서 기반) |
| iOS Background + Data only | **스로틀링 수준 측정** |
| iOS Killed + Data only | **완전 차단 확인** |

---

## 4. Phase 2: 비교군 실험 (개별 불안정 요인)

> 목표: 각 불안정 요인을 **하나씩 격리**하여 QoS 저하 정도를 측정한다.
> 원칙: 한 번에 하나의 변수만 조작, 나머지는 대조군 조건 유지.

### EXP-U01: Stale 토큰 비율에 따른 전달률 변화

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-01 |
| **독립변수** | 무효 토큰 비율: 0%, 10%, 25%, 50%, 75%, 100% |
| **방법** | 유효 토큰 + 의도적으로 변조한 무효 토큰을 혼합하여 배치 전송 |
| **전송 수** | 비율별 1,000건 × 3회 |
| **핵심 질문** | 무효 토큰이 유효 토큰의 전달에 영향을 주는가? |
| **측정 지표** | M1 (유효/무효 분리 측정), M2, 에러 코드 분포 |

**기대 결과**: 무효 토큰 메시지만 실패하고 유효 토큰 메시지에는 영향 없음 (독립적).
FCM이 무효 토큰을 즉시 감지(404 UNREGISTERED)하는지 확인.

### EXP-U02: 페이로드 크기 경계값 테스트

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-02 |
| **독립변수** | 페이로드 크기: 1KB, 2KB, 3KB, 3.9KB, 4.0KB, 4.1KB, 8KB |
| **전송 수** | 크기별 500건 × 3회 |
| **핵심 질문** | 4KB 경계에서 정확히 어떤 동작을 하는가? |
| **측정 지표** | M1, 에러 응답 시간, 에러 코드 |

### EXP-U03: Rate Limit 초과 패턴

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-03 |
| **독립변수** | 전송 속도: 100, 1K, 5K, 8K, 10K, 12K msg/sec |
| **방법** | k6로 각 속도를 30초간 지속 |
| **핵심 질문** | (a) 429 발생 시작 속도는? (b) 429 이후 복구까지 시간은? (c) 정상 범위 메시지도 영향받는가? |
| **측정 지표** | M1, M5 (MTTR), M8 (유효 처리량), 429 응답 비율 |

### EXP-U04: OAuth2 인증 만료 시뮬레이션

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-04 |
| **방법** | (a) 정상 자동 갱신 시나리오, (b) 의도적으로 만료된 토큰 사용, (c) 잘못된 credentials |
| **전송 수** | 시나리오별 500건 |
| **핵심 질문** | 자동 갱신 중 메시지가 유실되는가? |
| **측정 지표** | M1, M3, M5 |

### EXP-U05: Non-Collapsible 100건 한도 테스트

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-05 |
| **방법** | 디바이스를 비행기 모드로 전환 → 50건/80건/100건/101건/150건 전송 → 비행기 모드 해제 |
| **핵심 질문** | (a) 정확히 101건째에서 전체 삭제가 발생하는가? (b) onDeletedMessages() 콜백이 호출되는가? |
| **측정 지표** | M1, M3, onDeletedMessages 호출 여부 |

**주의**: 이 실험은 비행기 모드를 수동으로 조작해야 하므로 반자동 실험.

### EXP-U06: 토픽 팬아웃 지연 (시뮬레이션)

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-06 |
| **방법** | 토픽 5개에 테스트 기기 구독 + 5개 토픽 동시 전송으로 팬아웃 부하 생성 |
| **제한** | 실제 100만 구독자 테스트는 비용상 불가 → 가용 기기로 최대한 테스트 |
| **측정 지표** | M2 (팬아웃 완료 시간) |

### EXP-U07: Collapsible 스로틀링 테스트

| 항목 | 값 |
|------|-----|
| **대상 케이스** | STABLE-04 대비 |
| **독립변수** | 전송 간격: 3분(정상), 1분, 30초, 10초, 1초 |
| **핵심 질문** | 20건 버스트 이후 정확히 3분/1건 리필이 적용되는가? |
| **측정 지표** | M1, M2, 스로틀링 시작 시점 |

### EXP-U08: Android OEM 배터리 최적화 (핵심 실험)

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-08 |
| **디바이스** | Pixel 7 (대조군), Samsung S23, Xiaomi 13 |
| **조건 매트릭스** | |

```
OEM × 배터리최적화 상태 × 앱 상태 = 3 × 2 × 3 = 18 조합

배터리 최적화: (a) 기본 설정 (b) 화이트리스트 등록
앱 상태: Foreground / Background / Killed

각 조합: 500건 × 3회 = 1,500건
총: 18 조합 × 1,500건 = 27,000건
```

| 핵심 질문 | 설명 |
|----------|------|
| OEM별 전달률 차이는 얼마인가? | Pixel (기준) vs Samsung vs Xiaomi |
| 화이트리스트 등록 시 개선 효과는? | 기본 설정 vs 화이트리스트 |
| 앱 상태별 차이는? | Foreground vs Background vs Killed |
| 시간에 따라 전달률이 저하되는가? | 설치 직후 vs 1주 후 vs 2주 후 (장기 실험) |

**장기 추적 (선택적)**: 2주간 매일 100건씩 전송하여 시간 경과에 따른 전달률 변화 관찰.
근거: Oppo/Vivo에서 2주 내 전달률 급격 저하 보고됨 [^1].

### EXP-U09: Android Doze 모드

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-09 |
| **방법** | `adb shell dumpsys deviceidle force-idle`로 Doze 강제 진입 |
| **독립변수** | 우선순위: HIGH vs NORMAL |
| **전송 수** | 우선순위별 500건 × 3회 |
| **핵심 질문** | HIGH는 Doze를 바이패스하는가? NORMAL의 지연 분포는? |
| **측정 지표** | M1, M2 (특히 NORMAL의 지연 분포) |

### EXP-U10: Android App Standby Bucket

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-10 |
| **방법** | `adb shell am set-standby-bucket <package> <bucket>`으로 버킷 설정 |
| **독립변수** | Bucket: active, working_set, frequent, rare, restricted |
| **전송 수** | 버킷별 500건 × 3회 |
| **핵심 질문** | Android 14 기기에서 Standby Bucket이 FCM에 영향을 주는가? |
| **측정 지표** | M1, M2 |

### EXP-U11: iOS Silent Notification 스로틀링

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-11 |
| **방법** | Data-only 메시지 (`content-available: true`), 다양한 빈도로 전송 |
| **독립변수** | 전송 빈도: 1건/시간, 2건/시간, 3건/시간, 5건/시간, 10건/시간, 30건/시간 |
| **전송 수** | 빈도별 3시간 지속 × 3회 |
| **핵심 질문** | (a) 정확한 스로틀링 임계점은? (b) 스로틀링 패턴(일정/랜덤)은? (c) 배터리 잔량이 영향을 주는가? |
| **측정 지표** | M1 (시간대별 수신률), M2 |
| **추가 변수** | 저전력 모드 ON/OFF, 배터리 잔량 100%/50%/20% |

### EXP-U12: iOS 앱 Force Kill + Silent Push

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-12 |
| **방법** | 앱 스와이프 종료 → 전송 → 앱 재실행 → 다시 전송 |
| **전송 수** | 500건 (Kill 상태) + 500건 (재실행 후) × 3회 |
| **핵심 질문** | (a) Kill 상태에서 Notification 타입은 수신되는가? (b) 재실행 후 밀린 메시지가 전달되는가? |
| **측정 지표** | M1 (메시지 타입별), M3 |

### EXP-U13: 디바이스 오프라인 + 복구

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-13 |
| **방법** | 비행기 모드 ON → N건 전송 → 10분/1시간/24시간 후 비행기 모드 OFF |
| **독립변수** | 오프라인 기간, 대기 메시지 수(10건/50건/99건) |
| **핵심 질문** | (a) 오프라인 기간과 전달 성공률의 관계는? (b) 99건 대기 시 모두 전달되는가? |
| **측정 지표** | M1, M2 (복구 후 전달 시간), M3 |

### EXP-U14: 네트워크 장애 시뮬레이션

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-14 |
| **방법** | Charles Proxy 또는 Linux TC로 네트워크 조건 조작 |
| **독립변수** | |

```
(a) 지연 주입: +200ms, +500ms, +2s, +5s, +10s
(b) 패킷 손실: 5%, 10%, 20%, 30%, 50%
(c) 대역폭 제한: 1Mbps, 256Kbps, 64Kbps
(d) 완전 단절 30초 → 복구
```

| 전송 수 | 조건별 500건 × 3회 |
| **핵심 질문** | (a) 서버→FCM 전송 실패 시 자동 재시도하는가? (b) 디바이스 측 네트워크 불안정이 수신에 미치는 영향은? |
| **측정 지표** | M1, M2, M5 (복구 시간) |

### EXP-U15: 중복 전송 테스트

| 항목 | 값 |
|------|-----|
| **대상 케이스** | UNSTABLE-08 참조 (중복 관련) |
| **방법** | 동일 메시지 ID로 1회/2회/5회/10회 전송 |
| **핵심 질문** | FCM은 동일 request_id로 중복 제거하는가? |
| **측정 지표** | M4 (중복 수신 횟수) |

---

## 5. Phase 3: 복합 불안정 요인 실험

> 목표: 실제 운영 환경에서는 불안정 요인이 동시에 발생한다.
> 복합 요인이 QoS에 **가산적(additive)** 또는 **가중적(multiplicative)** 영향을 미치는지 확인한다.

### EXP-C01: Stale 토큰 + 네트워크 장애

| 조건 | 무효 토큰 25% + 패킷 손실 10% |
| 비교 대상 | EXP-U01(25%) + EXP-U14(10%) 개별 결과의 합산 vs 실측 |
| 핵심 질문 | 복합 효과가 개별 효과의 합보다 큰가? |

### EXP-C02: Rate Limit 초과 + 대규모 배치

| 조건 | 12K msg/sec + 500건 멀티캐스트 동시 |
| 비교 대상 | EXP-U03 + EXP-S03 |
| 핵심 질문 | 배치 전송이 Rate Limit에 미치는 영향은? |

### EXP-C03: OEM 최적화 + Doze + Background

| 조건 | Samsung S23 + Doze 활성 + 앱 Background |
| 비교 대상 | EXP-U08(Samsung) + EXP-U09(Doze) |
| 핵심 질문 | OEM 최적화 + Doze가 동시 적용될 때의 전달률은? |

### EXP-C04: iOS Silent + 저전력 모드 + Background

| 조건 | Data-only 메시지 + Low Power Mode ON + 앱 Background |
| 비교 대상 | EXP-U11 + Low Power Mode |
| 핵심 질문 | 저전력 모드가 Silent push 스로틀링을 더 악화시키는가? |

### EXP-C05: Stale 토큰 + OEM 최적화

| 조건 | 무효 토큰 25% + Xiaomi 기본 설정 |
| 비교 대상 | EXP-U01(25%) + EXP-U08(Xiaomi) |
| 핵심 질문 | 가장 현실적인 최악의 시나리오에서 전달률은 얼마인가? |

### EXP-C06: 네트워크 지연 + Collapsible 스로틀링

| 조건 | 네트워크 지연 +2s + Collapsible 10초 간격 |
| 비교 대상 | EXP-U14(지연) + EXP-U07(스로틀링) |
| 핵심 질문 | 네트워크 지연이 collapsible 스로틀링 메커니즘에 영향을 주는가? |

---

## 6. Phase 4: QoS 보장 메커니즘 효과 검증

> 목표: 자체 구현한 QoS 메커니즘이 불안정 케이스에서 얼마나 QoS를 개선하는지 측정한다.

### 6.1 QoS Level 정의

| Level | 동작 | 구현 |
|-------|------|------|
| **L0 (Best Effort)** | FCM 1회 전송, 실패 무시 | Raw FCM API 호출 |
| **L1 (At Least Once)** | ACK 미수신 시 재시도 (최대 5회, exponential backoff) | 서버 측 재시도 큐 |
| **L2 (Exactly Once)** | L1 + 클라이언트 측 message_id 기반 중복 제거 | 서버 재시도 + 클라이언트 dedup |

### 6.2 QoS 효과 실험 매트릭스

Phase 2에서 **QoS 개선이 기대되는 케이스**에 대해서만 L0/L1/L2를 적용한다:

| 케이스 | QoS 개선 기대 | 이유 |
|--------|-------------|------|
| UNSTABLE-01 (Stale 토큰) | **No** | 토큰 자체가 무효이므로 재시도 무의미 |
| UNSTABLE-03 (Rate Limit) | **Yes** | 재시도로 다음 윈도우에 전송 가능 |
| UNSTABLE-04 (인증 만료) | **Yes** | 갱신 후 재시도로 복구 |
| UNSTABLE-07 (서버 장애) | **Yes** | 일시적 장애이므로 재시도 효과적 |
| UNSTABLE-08 (OEM) | **No** | 디바이스 측 문제이므로 서버 재시도 무효 |
| UNSTABLE-09 (Doze) | **Partial** | HIGH 우선순위 사용으로 일부 개선 |
| UNSTABLE-11 (iOS Silent) | **No** | Apple 정책이므로 재시도 무효 |
| UNSTABLE-14 (네트워크) | **Yes** | 일시적 장애이므로 재시도 효과적 |

**실험 대상**: UNSTABLE-03, 04, 07, 14에 대해 L0/L1/L2 적용

각 실험: 불안정 조건 재현 → QoS Level 0/1/2로 각각 1,000건 × 3회 전송 → M1~M5 비교

---

## 7. 실험 일정

```
Week 1: 환경 구축
  - Firebase 테스트 프로젝트 설정
  - Android/iOS 테스트 앱 개발
  - 테스트 서버, ACK 서버, 분석기 구축
  - 측정 인프라 검증 (시간 동기화, ACK 정확도)

Week 2: Phase 1 (대조군)
  - EXP-S01 ~ EXP-S05 실행
  - Baseline 지표 확정
  - 결과 문서화

Week 3-4: Phase 2 (비교군 - 개별 요인)
  - EXP-U01 ~ EXP-U08 실행 (Week 3)
  - EXP-U09 ~ EXP-U15 실행 (Week 4)
  - 각 케이스 결과 카드 작성

Week 5: Phase 3 (복합 요인)
  - EXP-C01 ~ EXP-C06 실행
  - 복합 효과 분석

Week 6: Phase 4 (QoS 메커니즘)
  - QoS L0/L1/L2 적용 실험
  - 효과 분석 및 종합 보고서 작성

Week 7: 결과 종합 및 문서화
  - 전체 결과 종합 비교 매트릭스 작성
  - 최종 QoS 보장 방안 도출
  - 개발 계획 확정
```

---

## 8. 실험 결과 활용

### 8.1 개발 계획 반영

실험 결과를 기반으로 다음을 결정한다:

| 결정 사항 | 근거 실험 |
|----------|----------|
| QoS Level 기본값 설정 | Phase 4 결과 (L1 vs L2 비용/효과) |
| OEM 대응 전략 (FCM 단독 vs 대안 채널) | EXP-U08 + EXP-C03 결과 |
| iOS Silent Push 사용 여부 | EXP-U11 + EXP-U12 결과 |
| 재시도 정책 파라미터 (최대 횟수, 간격) | Phase 4 재시도 횟수 분포 |
| 토큰 정리 주기 | EXP-U01 비율별 영향 |
| Collapsible vs Non-collapsible 전략 | EXP-U05 + EXP-U07 결과 |
| 대안 채널 도입 필요성 (MQTT, WebSocket, HMS) | Phase 2~3 종합 (FCM 단독으로 목표 QoS 달성 불가 시) |

---

## 참고 문헌

[^1]: DontKillMyApp.com — Oppo/Vivo 2주 내 전달률 저하 보고. https://dontkillmyapp.com/

- Firebase, "Understanding message delivery," https://firebase.google.com/docs/cloud-messaging/understand-delivery
- Firebase, "Throttling and Quotas," https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas
- Firebase, "Manage FCM registration tokens," https://firebase.google.com/docs/cloud-messaging/manage-tokens
- Android Developers, "Optimize for Doze and App Standby," https://developer.android.com/training/monitoring-device-state/doze-standby
- Apple Developer Forums, "Silent Push Throttling," https://developer.apple.com/forums/thread/47901
- Sangwoo Rhie, "Beyond Token Validation," DEV Community, 2024
- G. Albertengo et al., "On the Performance of Web Services, GCM and FCM," Digital Communications and Networks, 2019. DOI: 10.1016/j.dcan.2019.02.002
