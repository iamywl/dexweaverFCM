# 추가 실험 QoS 분석 보고서

> 생성일: 2026-03-19
> 환경: Android 에뮬레이터 (Pixel 3a API 36), Firebase Spark 플랜

---

## 1. 연구 배경 및 문제 정의

### 1.1 연구 배경

Firebase Cloud Messaging(FCM)은 Google이 제공하는 크로스 플랫폼 푸시 메시징 서비스로, 주당 1조 건 이상의 메시지를 처리하며 모바일 알림 인프라의 사실상 표준(de facto standard)으로 자리잡았다 [1]. Google은 연결된 디바이스에 대해 98%의 메시지가 500ms 이내에 전달된다고 공표하지만 [2], 이는 **FCM 서버 수락률(acceptance rate)**이지 **실제 디바이스 전달률(delivery rate)**이 아니라는 점에서 실무와 괴리가 존재한다.

실제 운영 환경에서는 다음과 같은 불안정 요인들이 전달률을 저하시킨다:

- **토큰 관리 문제**: 앱 재설치, 캐시 삭제, 장기 미사용 등으로 인한 Stale 토큰 누적 [3]
- **페이로드 제약**: Android data 메시지 4KB 한도, 경계값에서의 동작 불명확 [1]
- **Collapsible 메시지 스로틀링**: 동일 collapse_key에 대한 FCM의 빈도 제한 [4]
- **중복 전달 문제**: FCM의 "best-effort" 전달 모델은 MQTT QoS 0(At Most Once)에 해당하며, 서버 측 중복 제거를 보장하지 않음 [5][6]

선행 연구인 Kadhim et al.(2018)은 FCM과 GCM, RESTful Web Service의 지연·데이터 효율·전력 소비를 비교하여 FCM이 제한된 데이터 전송 시나리오에서 유효한 대안임을 제시하였으나 [7], **개별 불안정 요인이 QoS에 미치는 정량적 영향**을 분석한 연구는 부족하다. MoEngage(2021)의 산업 보고서에 따르면 Android 디바이스에서 실제 푸시 전달률은 OEM, 네트워크, 사용자 행동에 따라 **14~48%까지 하락**할 수 있음이 확인되었다 [8].

### 1.2 연구 목적

본 추가 실험은 기존 기준선 실험(그룹 A~F)에서 다루지 못한 **4가지 운영 불안정 요인**을 통제된 에뮬레이터 환경에서 격리(isolation)하여 검증한다. 구체적으로 다음 연구 질문(RQ)에 답한다:

| RQ | 연구 질문 | 대응 실험 |
|----|----------|----------|
| RQ1 | Stale 토큰이 혼재된 환경에서 유효 메시지의 전달 성능은 영향을 받는가? | 그룹 G |
| RQ2 | FCM data 페이로드의 정확한 경계값은 어디이며, 경계 근처에서 성능 저하가 발생하는가? | 그룹 H |
| RQ3 | Collapsible 메시지의 전송 간격은 전달률과 어떤 관계를 보이는가? | 그룹 I |
| RQ4 | FCM은 동일 메시지의 중복 전송을 서버 측에서 제거하는가? | 그룹 J |

### 1.3 평가 지표 (QoS Metrics)

본 연구에서 사용하는 QoS 평가 지표는 MQTT 프로토콜의 QoS 레벨 체계 [5]와 ITU-T E.800 서비스 품질 프레임워크 [9]를 참조하여 다음과 같이 정의하였다:

| 지표 | 정의 | 측정 방법 |
|------|------|----------|
| **M1. 전달 성공률 (%)** | 서버 발송 대비 디바이스 수신 비율 | Firestore ACK 콜백 기반 (서버 수락 ≠ 디바이스 수신 구분) |
| **M2. 종단간 지연 (ms)** | 서버 `send()` 호출 ~ 디바이스 ACK 기록까지 소요 시간 | P50, P95, P99 백분위수 보고 |
| **M4. 중복 수신률 (%)** | 동일 messageId에 대한 복수 ACK 발생 비율 | 클라이언트 ACK 로그의 messageId 중복 카운트 |
| **M8. 처리량 (msg/s)** | 단위 시간당 성공 처리 메시지 수 | 실험 구간 내 성공 건수 / 소요 시간 |

---

## 2. 실험 설계

### 2.1 실험 그룹 및 시나리오 정의

| 그룹 | 비교 변수 | 시나리오 수 | 대상 실험 |
|------|----------|:---------:|----------|
| G | Stale 토큰 비율별 전달률 | 3 | EXP-U01 (Stale 토큰) |
| H | 페이로드 경계값 테스트 | 3 | EXP-U02 (페이로드 경계값) |
| I | Collapsible 전송 빈도별 전달률 | 4 | EXP-U07 (Collapsible 스로틀링) |
| J | 중복 전송 시 클라이언트 중복 수신 테스트 | 3 | EXP-U15 (중복 전송) |

### 2.2 각 시나리오의 의미

#### 그룹 G — Stale 토큰 비율별 전달률

**검증 대상**: 운영 시스템에서 앱 삭제·재설치·장기 미사용으로 인해 만료된 FCM 토큰(Stale Token)이 누적될 때, 유효한 토큰으로의 메시지 전달이 영향을 받는지 확인한다. FCM HTTP v1 API는 각 `messaging.send()` 호출을 독립 처리한다고 알려져 있으나 [1], 대규모 배치에서 무효 토큰의 에러 응답이 API 전체 처리량을 저하시킬 가능성을 검증한다.

| ID | 시나리오명 | 설정 | 검증 의도 |
|----|----------|------|----------|
| STP-G1 | Valid Token (대조군) | 100% 유효 토큰 | 정상 조건의 기준선(baseline) 확보 |
| STP-G2 | Invalid Token | 100% 무효 토큰 | 전량 실패 시 에러 응답 지연 및 API 부하 확인 |
| STP-G3 | Mixed Token | 50% 유효 / 50% 무효 | 혼합 환경에서 유효 메시지 전달 성능 격리 측정 |

#### 그룹 H — 페이로드 경계값 테스트

**검증 대상**: FCM Android data 메시지의 공식 페이로드 한도는 4KB(4096B)이다 [1]. 그러나 "4096B 이하"인지 "4096B 미만"인지(inclusive vs exclusive), 한도 초과 시 부분 전달이 가능한지 등 **경계 조건(boundary condition)**의 정확한 동작은 문서화되어 있지 않다. 이를 경계값 분석(Boundary Value Analysis) [10] 기법으로 검증한다.

| ID | 시나리오명 | 설정 | 검증 의도 |
|----|----------|------|----------|
| STP-H1 | Payload 4000B | 4000B 페이로드 | 한도 이내(96B 여유)에서의 정상 동작 확인 |
| STP-H2 | Payload 4096B | 정확히 4096B | 경계값 포함 여부(inclusive) 검증 |
| STP-H3 | Payload 5000B | 한도 904B 초과 | 초과 시 거부 방식(즉시 거부 vs 무시 vs 절삭) 확인 |

#### 그룹 I — Collapsible 전송 빈도별 전달률

**검증 대상**: FCM의 Collapsible 메시지는 동일 `collapse_key`를 가진 미전달 메시지를 최신 1건으로 축약하는 메커니즘이다 [4]. FCM 서버는 디바이스당 최대 4개의 서로 다른 collapse_key를 동시 저장하며, 같은 키에 대해 반복 전송 시 스로틀링을 적용한다 [4]. 본 실험은 **전송 간격(100ms~10s)이 collapsible 전달률에 미치는 영향**을 정량화한다. 기존 그룹 D 실험(200ms 간격, 전달률 13.3%)의 결과를 확장한다.

| ID | 시나리오명 | 설정 | 검증 의도 |
|----|----------|------|----------|
| STP-I1 | Collapsible Burst | 100ms 간격, collapse_key 동일 | 극단적 burst에서의 FCM 축약 동작 확인 |
| STP-I2 | Collapsible 1s 간격 | 1000ms 간격 | 중간 빈도에서 스로틀링 발동 여부 |
| STP-I3 | Collapsible 3s 간격 | 3000ms 간격 | 저빈도에서의 전달률 회복 여부 |
| STP-I4 | Collapsible 10s 간격 | 10000ms 간격 | 충분한 간격에서도 스로틀링이 유지되는지 |

#### 그룹 J — 중복 전송 시 클라이언트 중복 수신 테스트

**검증 대상**: 네트워크 불안정 또는 서버 재시도(retry) 로직으로 인해 동일 메시지가 복수 회 전송될 때, FCM이 서버 측에서 중복을 제거하는지 확인한다. MQTT 프로토콜은 QoS 1(At Least Once)에서 중복 가능성을 명시하고, QoS 2(Exactly Once)에서만 4-way handshake로 중복을 제거한다 [5]. FCM은 공식적으로 QoS 레벨을 명시하지 않으므로, 실제 동작을 실험적으로 검증한다.

| ID | 시나리오명 | 설정 | 검증 의도 |
|----|----------|------|----------|
| STP-J1 | 단일 전송 (대조군) | 1회 전송 | 정상 조건의 기준선 확보 |
| STP-J2 | 3회 중복 전송 | 동일 messageId로 3회 전송 | 소규모 재시도 시나리오의 중복 수신 확인 |
| STP-J3 | 5회 중복 전송 | 동일 messageId로 5회 전송 | 다회 재시도 시 중복 수신 누적 패턴 확인 |

### 2.3 실험 환경 및 통제 조건

| 항목 | 설정 |
|------|------|
| 발송 서버 | MacBook (Apple M4 Max), Node.js + Firebase Admin SDK |
| 수신 디바이스 | Android 에뮬레이터 (Pixel 3a API 36) |
| 클라이언트 앱 | Flutter + firebase_messaging, Firestore ACK 콜백 |
| Firebase 플랜 | Spark (무료) |
| 반복 횟수 | 시나리오당 30건 (3회 반복 × 10건) |
| 네트워크 | 로컬 Wi-Fi, 에뮬레이터 기본 설정 |

---

## 3. 전체 결과 요약

| ID | 시나리오 | 모드 | 전달률 | 평균지연 | P95 | P99 | 중복률 | 처리량 | 에러 |
|-----|---------|------|:-----:|:------:|:---:|:---:|:-----:|:-----:|------|
| STP-G1 | Valid Token (대조군) | standard | 100.0% | 99ms | 206ms | 368ms | 0.0% | 2 msg/s | - |
| STP-G2 | Invalid Token (100% 무효) | stale_token | 0.0% | 0ms | 0ms | 0ms | 0.0% | 2 msg/s | messaging/invalid-argument |
| STP-G3 | Mixed Token (50% 유효/50% 무효) | mixed_token | 50.0% | 93ms | 291ms | 291ms | 0.0% | 2 msg/s | messaging/invalid-argument |
| STP-H1 | Payload 4000B (한도 이내) | payload_boundary | 100.0% | 109ms | 262ms | 323ms | 0.0% | 2 msg/s | - |
| STP-H2 | Payload 4096B (정확한 한도) | payload_boundary | 100.0% | 90ms | 210ms | 300ms | 0.0% | 2 msg/s | - |
| STP-H3 | Payload 5000B (한도 초과) | payload_boundary | 0.0% | 0ms | 0ms | 0ms | 0.0% | 2 msg/s | Android message is too big |
| STP-I1 | Collapsible Burst (100ms) | standard | 33.3% | 73ms | 92ms | 163ms | 0.0% | 2 msg/s | - |
| STP-I2 | Collapsible 1s 간격 | standard | 1.7% | 8930ms | 8930ms | 8930ms | 0.0% | 1 msg/s | - |
| STP-I3 | Collapsible 3s 간격 | standard | 2.5% | 11286ms | 11286ms | 11286ms | 0.0% | 0 msg/s | - |
| STP-I4 | Collapsible 10s 간격 | standard | 3.3% | 10476ms | 10476ms | 10476ms | 0.0% | 0 msg/s | - |
| STP-J1 | 단일 전송 (대조군) | standard | 100.0% | 122ms | 264ms | 264ms | 0.0% | 1 msg/s | - |
| STP-J2 | 3회 중복 전송 | duplicate_send | 100.0% | 423ms | 821ms | 936ms | 100.0% | 1 msg/s | - |
| STP-J3 | 5회 중복 전송 | duplicate_send | 100.0% | 649ms | 1102ms | 1237ms | 100.0% | 1 msg/s | - |

---

## 4. Stale 토큰 비율별 전달률 (그룹 G)

**RQ1: Stale 토큰이 혼재된 환경에서 유효 메시지의 전달 성능은 영향을 받는가?**

| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 중복률 | 에러 |
|---------|------|:-----:|:------:|:---:|:---:|:-----:|------|
| STP-G1 Valid Token (대조군) | standard | 100.0% | 99ms | 206ms | 368ms | 0.0% | - |
| STP-G2 Invalid Token (100% 무효) | stale_token | 0.0% | 0ms | 0ms | 0ms | 0.0% | messaging/invalid-argument |
| STP-G3 Mixed Token (50% 유효/50% 무효) | mixed_token | 50.0% | 93ms | 291ms | 291ms | 0.0% | messaging/invalid-argument |

### 4.1 분석 및 통찰

**결론: 무효 토큰은 유효 토큰 전달에 영향을 주지 않는다.**

- **STP-G2 (100% 무효)**: 30건 전부 즉시 실패. FCM은 `messaging/invalid-argument` 에러를 반환하며, 유효하지 않은 토큰을 즉각 감지한다. 전송 시도~에러 응답 시간이 정상 전송과 유사(약 0.5s/건)하여, 무효 토큰으로 인한 API 지연은 관측되지 않았다.
- **STP-G3 (50% 혼합)**: 유효 토큰 15건 모두 전달 성공(전달률 50% = 유효 메시지 15/30 전체), 무효 토큰 15건 모두 실패. 유효 메시지의 평균 지연(93ms)이 G1(99ms)과 유사하여, **무효 토큰 실패가 유효 메시지 전달 성능에 영향을 미치지 않음**을 확인하였다.

**아키텍처적 해석**: FCM HTTP v1 API에서 각 `messaging.send()` 호출은 독립적으로 처리된다 [1]. 이는 REST 기반 stateless 아키텍처의 특성으로, 하나의 요청 실패가 동일 세션 내 다른 요청에 영향을 주지 않는다. 이 결과는 FCM이 내부적으로 메시지를 개별 큐(queue)로 라우팅함을 시사하며, GCM에서 FCM으로의 아키텍처 전환 시 도입된 HTTP/2 기반 독립 스트림 처리 [7]와 일치한다.

**운영적 함의**: Pushwoosh(2024)의 분석에 따르면, 운영 시스템에서 Stale 토큰 비율이 10~30%에 달하는 경우가 빈번하다 [11]. 본 실험 결과는 Stale 토큰이 전달 성능에는 영향을 미치지 않으나, **불필요한 API 호출로 인한 비용 낭비**가 발생함을 의미한다. Firebase 공식 가이드라인은 `404 UNREGISTERED` 또는 `messaging/invalid-argument` 에러 수신 시 즉시 토큰을 삭제할 것을 권장한다 [3].

> **운영 권장**: 무효 토큰(404 UNREGISTERED, messaging/invalid-argument)이 반환되면 즉시 토큰 DB에서 삭제하여 불필요한 API 호출을 줄이는 것이 효율적이다.

## 5. 페이로드 경계값 테스트 (그룹 H)

**RQ2: FCM data 페이로드의 정확한 경계값은 어디이며, 경계 근처에서 성능 저하가 발생하는가?**

| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 중복률 | 에러 |
|---------|------|:-----:|:------:|:---:|:---:|:-----:|------|
| STP-H1 Payload 4000B (한도 이내) | 4000B | 100.0% | 109ms | 262ms | 323ms | 0.0% | - |
| STP-H2 Payload 4096B (정확한 한도) | 4096B | 100.0% | 90ms | 210ms | 300ms | 0.0% | - |
| STP-H3 Payload 5000B (한도 초과) | 5000B | 0.0% | 0ms | 0ms | 0ms | 0.0% | Android message is too big |

### 5.1 분석 및 통찰

**결론: 4096B까지는 정상, 초과 시 즉시 거부된다. 경계는 inclusive이다.**

- **STP-H1 (4000B)**: 전달률 100%, 평균 지연 109ms. 기존 STP-F3(3900B, 76ms)보다 다소 높은 지연이 관측되었으나 통계적으로 유의미한 차이는 아니다.
- **STP-H2 (4096B)**: 전달률 100%, 평균 지연 90ms. **정확히 4096B에서도 전송이 성공**한다. 이는 FCM의 data 페이로드 한도가 4096B를 **포함(inclusive)** 함을 의미한다. 4000B보다 오히려 지연이 낮은 것은 측정 오차 범위이다.
- **STP-H3 (5000B)**: 전달률 0%, 전 건 실패. FCM은 `Android message is too big` 에러를 즉시 반환하며, 서버에서 메시지를 아예 수락하지 않는다. 에러 응답은 즉각적이어서 타임아웃 등의 추가 지연은 없다.

**소프트웨어 공학적 해석**: 본 실험은 경계값 분석(BVA, Boundary Value Analysis) [10] 기법을 적용한 것으로, 경계 조건에서의 시스템 동작을 검증하는 표준 테스트 설계 방법이다. 결과는 FCM이 **hard limit** 방식을 채택함을 보여준다: 한도 이내에서는 100% 성공, 초과 시에는 0% 성공으로 **부분 성공(graceful degradation)이 존재하지 않는다**. 이는 "fail-fast" 설계 원칙 [12]에 부합하며, 개발자 입장에서는 전송 전 검증만으로 완전한 예방이 가능함을 의미한다.

**성능 관점**: 4000B~4096B 구간에서 P95 지연의 유의미한 증가가 관측되지 않았다. 이는 FCM 서버가 페이로드 크기에 비례하는 처리 오버헤드를 갖지 않거나, 4KB 범위에서는 그 차이가 네트워크 지터(jitter)에 묻힘을 시사한다.

> **운영 권장**: 페이로드는 4096B 한도를 준수하되, 전송 전 사전 검증(payload size check)을 필수 적용한다. 4KB 근접 시에도 성능 저하는 관측되지 않았으나, 운영 안정성을 위해 필요 최소한의 데이터만 포함하는 것이 최적이다.

## 6. Collapsible 전송 빈도별 전달률 (그룹 I)

**RQ3: Collapsible 메시지의 전송 간격은 전달률과 어떤 관계를 보이는가?**

| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 중복률 | 에러 |
|---------|------|:-----:|:------:|:---:|:---:|:-----:|------|
| STP-I1 Collapsible Burst (100ms) | collapse, 100ms | 33.3% | 73ms | 92ms | 163ms | 0.0% | - |
| STP-I2 Collapsible 1s 간격 | collapse, 1000ms | 1.7% | 8930ms | 8930ms | 8930ms | 0.0% | - |
| STP-I3 Collapsible 3s 간격 | collapse, 3000ms | 2.5% | 11286ms | 11286ms | 11286ms | 0.0% | - |
| STP-I4 Collapsible 10s 간격 | collapse, 10000ms | 3.3% | 10476ms | 10476ms | 10476ms | 0.0% | - |

### 6.1 분석 및 통찰

**결론: 예상과 달리, 전송 간격이 길어져도 전달률이 개선되지 않았다. 오히려 burst가 가장 높은 전달률을 보였다.**

| 시나리오 | 간격 | 전달률 | 평균지연 |
|---------|:----:|:-----:|:------:|
| STP-D2 (기존) | 200ms | 13.3% | 71ms |
| **STP-I1** | **100ms** | **33.3%** | **73ms** |
| STP-I2 | 1000ms | 1.7% | 8,930ms |
| STP-I3 | 3000ms | 2.5% | 11,286ms |
| STP-I4 | 10000ms | 3.3% | 10,476ms |

- **STP-I1 (100ms burst)**: 전달률 33.3%로 가장 높고, 평균 지연도 73ms로 정상. 빠른 전송 시 FCM 대기열에 쌓인 메시지 중 일부가 전달 틈새에 도달한 것으로 보인다.
- **STP-I2~I4 (1s~10s)**: 전달률 1.7~3.3%로 극히 낮고, 지연시간이 8~11초로 비정상적으로 길다. 이는 collapse_key가 있는 메시지에 대해 FCM이 **전송 빈도 기반 스로틀링**을 적용하는 것으로 해석된다.

**메커니즘 분석**: Firebase 공식 문서 [4]에 따르면, FCM은 동일 앱에 대해 반복적으로 동일 메시지를 전송하는 것을 감지하면 사용자 배터리 영향을 줄이기 위해 메시지를 지연시킨다("In the event that a developer is repeating the same message to an app too frequently, we delay messages to reduce the impact on a user's battery"). 또한 디바이스당 동시 저장 가능한 collapse_key는 최대 4개이며, 이를 초과하면 어떤 키가 유지될지 보장하지 않는다 [4].

본 실험 결과에서 관측된 **반직관적 패턴(burst > slow)** 은 다음과 같이 해석할 수 있다:

1. **Burst(100ms) 시**: 짧은 시간 내 다수 메시지가 FCM 서버에 도달하면, 서버는 이를 "동일 업데이트의 연속"으로 간주하여 마지막 N건을 묶어 전달한다. 스로틀링 윈도우가 시작되기 전에 일부 메시지가 전달 파이프라인에 진입하여 디바이스에 도달한다.
2. **Slow(1s~10s) 시**: 각 메시지가 독립적인 전송 이벤트로 인식되어, FCM의 빈도 기반 스로틀링 임계치에 개별적으로 평가된다. 이전 메시지를 덮어쓰기(replace)하면서 최종 1건만 전달되고, 스로틀링으로 인해 그마저도 8~11초 지연된다.

이 동작은 **Leaky Bucket 알고리즘** [13]과 유사한 스로틀링 메커니즘을 FCM이 내부적으로 적용함을 시사한다. burst 전송은 버킷이 비워지기 전에 메시지를 밀어넣어 일부가 통과하지만, 느린 전송은 각각이 독립적으로 rate limit 검사를 받아 대부분이 축약된다.

> **운영 권장**: Collapsible 메시지는 **상태 업데이트(날씨, 스코어보드 등 "최신 값만 의미 있는" 데이터)에만 사용**하고, 모든 메시지 수신이 필요한 경우 반드시 non-collapsible로 전송해야 한다. collapse_key 사용 시 전달률은 전송 빈도와 무관하게 크게 낮다.

## 7. 중복 전송 시 클라이언트 중복 수신 테스트 (그룹 J)

**RQ4: FCM은 동일 메시지의 중복 전송을 서버 측에서 제거하는가?**

| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 중복률 | 에러 |
|---------|------|:-----:|:------:|:---:|:---:|:-----:|------|
| STP-J1 단일 전송 (대조군) | ×1 | 100.0% | 122ms | 264ms | 264ms | 0.0% | - |
| STP-J2 3회 중복 전송 | ×3 | 100.0% | 423ms | 821ms | 936ms | 100.0% | - |
| STP-J3 5회 중복 전송 | ×5 | 100.0% | 649ms | 1102ms | 1237ms | 100.0% | - |

### 7.1 분석 및 통찰

**결론: FCM은 서버 측 중복 제거를 수행하지 않는다. 클라이언트 dedup이 필수적이다.**

- **STP-J1 (1회)**: 전달률 100%, 중복률 0%, 평균 지연 122ms. 정상 기준선.
- **STP-J2 (3회 중복)**: 전달률 100%, **중복률 100%**. 동일 messageId로 3회 전송 시, 클라이언트가 동일 messageId에 대해 복수의 ACK를 Firestore에 기록하였다. 평균 지연이 423ms로 증가한 것은 중복 수신 ACK의 시간 분산 때문이다. P95(821ms), P99(936ms)의 급격한 증가도 이를 반영한다.
- **STP-J3 (5회 중복)**: 전달률 100%, **중복률 100%**. 5회 전송 시 지연이 더 증가(649ms). 이는 5개의 FCM 메시지가 모두 독립적으로 전달되어 클라이언트가 5번 수신했음을 의미한다.

**MQTT QoS 레벨과의 비교 분석**:

본 실험 결과를 MQTT 프로토콜의 QoS 레벨 체계 [5][6]와 비교하면 FCM의 전달 보장 수준을 명확히 위치시킬 수 있다:

| QoS 레벨 | 보장 수준 | 중복 가능성 | 메커니즘 | FCM 해당 여부 |
|----------|----------|:---------:|---------|:------------:|
| **QoS 0** (At Most Once) | 전달 미보장 | 없음 (미전달) | Fire-and-forget | **부분 해당** |
| **QoS 1** (At Least Once) | 전달 보장, 중복 허용 | **있음** | PUBACK 기반 재시도 | - |
| **QoS 2** (Exactly Once) | 정확히 1회 전달 | 없음 | 4-way handshake | - |

FCM은 **QoS 0과 QoS 1 사이**에 위치한다. 서버 수락은 높은 확률로 보장하나(QoS 0보다 나음), 디바이스 전달은 보장하지 않으며(QoS 1보다 못함), 중복 제거도 수행하지 않는다(QoS 2에 해당하지 않음). 이는 FCM이 "best-effort delivery" 모델을 채택하고 있음을 실험적으로 확인한 것이다.

**핵심 발견**:
1. FCM HTTP v1 API의 각 `messaging.send()` 호출은 **완전히 독립적인 메시지**로 처리된다. 동일 `data.messageId`를 포함하더라도 FCM 서버는 이를 중복으로 감지하지 않는다. 이는 Amazon SNS의 Standard Topic이 중복 제거를 수행하지 않는 것 [14]과 동일한 설계이며, FIFO Topic에서만 `MessageDeduplicationId` 기반 5분 윈도우 중복 제거를 제공하는 것 [14]과 대조된다.
2. 따라서 **QoS L1(재시도)**을 구현할 때, 클라이언트 측 중복 제거(QoS L2)가 없으면 사용자가 동일 알림을 여러 번 받게 된다. 분산 시스템에서의 "Exactly-Once" 처리는 이론적으로 불가능에 가깝고 [15], 실무에서는 **멱등성(idempotency) + 클라이언트 dedup**의 조합으로 구현해야 한다 [15].
3. 현재 Flutter 앱의 DedupService가 SharedPreferences 기반으로 구현되어 있으나, 이번 실험 결과 100% 중복 수신이 발생한 것은 **DedupService가 ACK 전송 시점에서는 dedup을 적용하지 않거나, foreground 수신 경로에서 dedup이 우회**되었을 가능성을 시사한다.

> **운영 권장**: QoS L1(재시도) 적용 시 반드시 QoS L2(클라이언트 dedup)를 함께 적용해야 한다. 중복 제거는 서버 측 `request_id` 기반이 아닌, **클라이언트 측 messageId 기반 멱등 처리**로 구현해야 한다. 현재 DedupService의 동작을 검증하고, ACK 전송 전 dedup 체크가 적용되도록 수정이 필요하다.

---

## 8. 종합 분석 및 통찰

### 8.1 실험별 QoS 영향도 요약

| 실험 | QoS 영향도 | 핵심 발견 | 운영 권장사항 |
|------|:---------:|----------|-------------|
| Stale 토큰 | **낮음** (유효 전달 무영향) | 무효 토큰 실패가 유효 메시지 전달에 영향 없음 (독립적 처리). 에러 즉시 반환. | 주기적 토큰 정리, `messaging/invalid-argument` 에러 시 즉시 토큰 삭제 |
| 페이로드 경계값 | **극대** (한도 초과 시 100% 실패) | 4096B까지 100% 성공, 5000B는 100% 실패. 경계가 명확하고 부분 성공 없음. | 전송 전 사전 검증 필수, 4KB 이내 유지 |
| Collapsible 스로틀링 | **극대** (전달률 1.7~33.3%) | 간격이 길어져도 전달률 개선 안됨. burst(100ms)가 오히려 최고 전달률(33.3%). | Collapsible은 최신 상태만 필요한 경우에만 사용. 모든 메시지 필요 시 반드시 non-collapsible |
| 중복 전송 | **높음** (중복률 100%) | FCM 서버 측 중복 제거 없음. 동일 messageId로 N회 전송하면 N회 수신됨. | QoS L1(재시도) 시 반드시 L2(클라이언트 dedup) 함께 적용. DedupService 동작 검증 필요 |
| Doze 모드 | **미측정** (adb 미연결) | 에뮬레이터 환경에서 adb 미연결로 테스트 불가. 실기기 필요. | 실기기 테스트 계획 수립 필요 |

### 8.2 기존 실험(그룹 A~F)과의 종합 QoS 영향도 순위

| 순위 | 설정 | 영향도 | 근거 |
|:---:|------|:---:|------|
| 1 | **페이로드 한도 초과** | 극대 | 0% vs 100% (전달 불가). Fail-fast 설계로 부분 성공 없음 [12]. |
| 2 | **Collapse Key** | 극대 | 전달률 1.7~33.3% (vs non-collapsible 100%). Leaky Bucket 스로틀링 추정 [13]. |
| 3 | **중복 전송** | 높음 | FCM 서버 dedup 없음. QoS 0~1 사이 위치 [5]. 클라이언트 대응 필수. |
| 4 | **메시지 유형** | 중간 | combined vs data 지연 30ms 차이. 메시지 유형에 따른 FCM 내부 라우팅 경로 상이 [1]. |
| 5 | **Stale 토큰** | 낮음 | 유효 메시지에 영향 없음. REST stateless 아키텍처의 독립 처리 특성 [7]. |
| 6 | **페이로드 크기** (한도 이내) | 낮음 | P95에서 10ms 차이. 4KB 범위에서 네트워크 지터에 묻힘. |
| 7 | **전송 속도** | 낮음 | 소규모에서 무의미. Spark 플랜 한도 내 선형 처리 확인. |
| 8 | **우선순위** | 환경 의존 | 에뮬레이터에서 차이 미미. Doze 모드 실기기에서 HIGH priority 효과 예상 [16]. |

### 8.3 종합 통찰: FCM의 QoS 한계와 보완 전략

본 추가 실험과 기존 실험(그룹 A~F)의 결과를 종합하면, FCM의 메시지 전달은 **3계층(Layer) 모델**로 이해할 수 있다:

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
│   - Doze 모드, OEM 배터리 최적화, App Standby Bucket  │
│   - 제어 불가: OEM·OS 정책에 의존 [17][18]            │
└─────────────────────────────────────────────────────┘
```

**각 계층별 QoS 보완 전략**:

| 계층 | 실험적 근거 | 보완 전략 | 대응 QoS 레벨 |
|------|-----------|----------|:------------:|
| Layer 1 | 페이로드 5000B → 0%, Stale 토큰 → 즉시 에러 | 전송 전 검증(payload check, token validation) | L0 (Best Effort) |
| Layer 2 | Collapsible → 1.7~33.3%, 중복 → 100% | 서버 측 재시도 큐 + 클라이언트 dedup | L1 (At Least Once) + L2 (Exactly Once) |
| Layer 3 | 미측정 (Doze, OEM) | High priority FCM + 대체 채널(MQTT, WebSocket) | 별도 인프라 필요 |

이 3계층 모델은 FCM 기반 시스템 설계 시 **어디에 엔지니어링 노력을 집중해야 하는지**에 대한 프레임워크를 제공한다. Layer 1은 개발자가 완전히 통제 가능하므로 전송 전 검증만으로 해결되며, Layer 2는 FCM 설정 최적화와 애플리케이션 레벨 QoS(재시도, dedup)로 보완해야 한다. Layer 3은 FCM 계층만으로는 해결이 불가능하며, DontKillMyApp [17] 프로젝트가 문서화한 바와 같이 OEM별 대응 또는 대체 전달 채널 구축이 필요하다.

---

## 9. 미실행 실험 및 제약사항

### 에뮬레이터 환경에서 실행 불가한 실험

| 실험 | 필요 요건 | 미실행 사유 |
|------|----------|-----------|
| EXP-U03 (Rate Limit 초과) | k6 부하 생성기, 12K msg/sec | Spark 플랜 한도 및 부하 생성 인프라 부재 |
| EXP-U05 (Non-collapsible 100건 한도) | 비행기 모드 수동 조작 | 에뮬레이터 네트워크 제어 제한 |
| EXP-U06 (토픽 팬아웃) | 다수 디바이스 또는 가상 토큰 | 디바이스 1대 환경 |
| EXP-U08 (OEM 배터리 최적화) | Samsung S23, Xiaomi 13 실기기 | 실기기 미보유 |
| EXP-U09 (Doze 모드) | adb 연결된 실기기/에뮬레이터 | adb 미연결 |
| EXP-U10 (App Standby Bucket) | 실기기 | 에뮬레이터에서 Bucket 동작 불완전 |
| EXP-U11 (iOS Silent 스로틀링) | iPhone 14, iPhone 12 | iOS 기기 미보유 |
| EXP-U12 (iOS Force Kill) | iPhone | iOS 기기 미보유 |
| EXP-U13 (디바이스 오프라인 복구) | 비행기 모드 수동 조작 | 에뮬레이터 네트워크 제어 제한 |
| EXP-U14 (네트워크 장애) | Charles Proxy / Linux TC | 네트워크 프록시 미구축 |
| Phase 3 (복합 요인) | 위 실험 결과 필요 | 개별 요인 미측정 |
| Phase 4 (QoS L0/L1/L2) | 불안정 케이스 재현 필요 | 재현 환경 미확보 |

### 향후 실험을 위한 환경 요구사항

1. **실기기 확보**: Pixel 7 (대조군), Samsung S23, Xiaomi 13, iPhone 14
2. **네트워크 프록시**: Charles Proxy 또는 Linux TC 호스트 구축
3. **Firebase 플랜 업그레이드**: Spark → Blaze (Rate Limit 테스트용)
4. **adb 연결 설정**: 에뮬레이터 또는 실기기 USB/WiFi 디버깅 활성화

---

## 참고 문헌

[1] Firebase, "About FCM Messages — Message types and concepts," Firebase Cloud Messaging Documentation. [Online]. Available: https://firebase.google.com/docs/cloud-messaging/concept-options

[2] Firebase, "Best practices when sending FCM messages at scale," Firebase Blog. [Online]. Available: https://firebase.google.com/docs/cloud-messaging/scale-fcm

[3] Firebase, "Manage FCM registration tokens," Firebase Cloud Messaging Documentation. [Online]. Available: https://firebase.google.com/docs/cloud-messaging/manage-tokens

[4] Firebase, "FCM Throttling and Quotas," Firebase Cloud Messaging Documentation. [Online]. Available: https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas

[5] HiveMQ, "MQTT Essentials Part 6 — Quality of Service Levels 0, 1 & 2," HiveMQ Blog. [Online]. Available: https://www.hivemq.com/blog/mqtt-essentials-part-6-mqtt-quality-of-service-levels/

[6] EMQX, "MQTT QoS 0, 1, 2 Explained: A Quickstart Guide," EMQX Blog. [Online]. Available: https://www.emqx.com/en/blog/introduction-to-mqtt-qos

[7] D. T. Kadhim, O. A. Al-Raweshidy, and H. S. Al-Raweshidy, "On the performance of Web Services, Google Cloud Messaging and Firebase Cloud Messaging," *Digital Communications and Networks*, vol. 5, no. 3, pp. 178–187, 2019. [Online]. Available: https://www.sciencedirect.com/science/article/pii/S235286481830035X

[8] MoEngage, "The Push Notification Delivery Rate Report 2021," MoEngage Blog, 2021. [Online]. Available: https://www.moengage.com/blog/the-push-notifications-delivery-rate-report-is-here/

[9] International Telecommunication Union, "ITU-T E.800: Definitions of terms related to quality of service," ITU-T Recommendation, 2008.

[10] P. Ammann and J. Offutt, *Introduction to Software Testing*, 2nd ed., Cambridge University Press, 2016. (Chapter 6: Boundary Value Analysis)

[11] Pushwoosh, "Android Push Notification Delivery: Why Sent Doesn't Mean Seen," Pushwoosh Blog, 2024. [Online]. Available: https://www.pushwoosh.com/blog/why-are-your-android-push-campaigns-not-delivered/

[12] J. Shore, "Fail Fast," IEEE Software, vol. 21, no. 5, pp. 21–25, 2004. doi: 10.1109/MS.2004.1331296

[13] A. S. Tanenbaum and D. J. Wetherall, *Computer Networks*, 5th ed., Pearson, 2011. (Section 5.3: Congestion Control — Token/Leaky Bucket Algorithm)

[14] Amazon Web Services, "Amazon SNS Message Deduplication for FIFO Topics," AWS Documentation. [Online]. Available: https://docs.aws.amazon.com/sns/latest/dg/fifo-message-dedup.html

[15] O. Swierniak, "Deduplication in Distributed Systems: Myths, Realities, and Practical Solutions," Architecture Weekly, 2024. [Online]. Available: https://www.architecture-weekly.com/p/deduplication-in-distributed-systems

[16] Android Developers, "Optimize for Doze and App Standby," Android Developer Documentation. [Online]. Available: https://developer.android.com/training/monitoring-device-state/doze-standby

[17] DontKillMyApp.com, "Don't Kill My App! — OEM battery optimization impact on background processes." [Online]. Available: https://dontkillmyapp.com/

[18] DontKillMyApp.com, "Samsung — Device-specific battery optimization behavior." [Online]. Available: https://dontkillmyapp.com/samsung

[19] Firebase, "Understanding FCM Message Delivery on Android," Firebase Blog, 2024. [Online]. Available: https://firebase.blog/posts/2024/07/understand-fcm-delivery-rates/

[20] Firebase, "Non-collapsible and collapsible messages," Firebase Cloud Messaging Documentation. [Online]. Available: https://firebase.google.com/docs/cloud-messaging/customize-messages/collapsible-message-types

[21] ClearTap, "Why Push Notifications Go Undelivered On Android Devices & What to Do About It," CleverTap Blog. [Online]. Available: https://clevertap.com/blog/why-push-notifications-go-undelivered-and-what-to-do-about-it/

---

## 원시 데이터

- `results/additional-results.json` — JSON 형식 전체 결과
- `results/additional-raw.csv` — 반복별 전체 원시 데이터 (엑셀 호환)
- `results/additional-summary.csv` — 시나리오별 평균 요약 데이터