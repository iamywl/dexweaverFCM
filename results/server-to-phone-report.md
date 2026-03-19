# 서버→폰 FCM 알림 수신 시나리오별 QoS 분석 보고서

> 생성일: 2026-03-19
> 환경: Android 에뮬레이터 (Pixel 3a API 36), Firebase Spark 플랜

---

## 1. 실험 목적

서버에서 FCM을 통해 모바일 디바이스로 푸시 알림을 전송할 때, FCM의 다양한 설정(메시지 유형, 우선순위, TTL, collapse key, 전송 속도, 페이로드 크기)이 QoS 지표에 미치는 영향을 정량적으로 측정하는 것이 본 실험의 목적이다.

---

## 2. 실험 설계

총 16개 시나리오를 6개 그룹으로 분류하였다. 각 시나리오는 50건의 메시지를 3회 반복 전송하여 재현성을 확보하였다.

| 그룹 | 비교 변수 | 시나리오 수 | 통제 변수 |
|------|----------|:---------:|----------|
| A | 메시지 유형 (data/notification/combined) | 3 | priority=high, interval=200ms |
| B | 우선순위 (high/normal) | 2 | type=combined, interval=200ms |
| C | TTL (0s/24h/28d) | 3 | type=combined, priority=high |
| D | Collapse Key (있음/없음) | 2 | type=data, priority=high |
| E | 전송 속도 (10ms/200ms/1000ms) | 3 | type=combined, priority=high |
| F | 페이로드 크기 (minimal/2KB/4KB) | 3 | priority=high, interval=200ms |

---

## 3. 전체 결과 요약

| ID | 시나리오 | 유형 | 우선순위 | 간격 | 전달률 | 평균지연 | P95 | P99 | 처리량 |
|-----|---------|------|:------:|:----:|:-----:|:------:|:---:|:---:|:-----:|
| STP-A1 | Data-only (Silent Push) | data | high | 200ms | 100.0% | 99ms | 234ms | 306ms | 2 msg/s |
| STP-A2 | Notification-only | notification | high | 200ms | 100.0% | 94ms | 186ms | 272ms | 2 msg/s |
| STP-A3 | Combined (Data+Notification) | combined | high | 200ms | 100.0% | 69ms | 162ms | 233ms | 2 msg/s |
| STP-B1 | High Priority | combined | high | 200ms | 100.0% | 70ms | 182ms | 282ms | 2 msg/s |
| STP-B2 | Normal Priority | combined | normal | 200ms | 100.0% | 66ms | 158ms | 274ms | 2 msg/s |
| STP-C1 | TTL=0 (즉시 전달 또는 폐기) | combined | high | 200ms | 100.0% | 62ms | 194ms | 328ms | 2 msg/s |
| STP-C2 | TTL=86400 (24시간) | combined | high | 200ms | 100.0% | 86ms | 217ms | 300ms | 2 msg/s |
| STP-C3 | TTL=2419200 (28일, 최대) | combined | high | 200ms | 100.0% | 86ms | 217ms | 278ms | 2 msg/s |
| STP-D1 | Non-collapsible (각각 고유) | data | high | 200ms | 100.0% | 73ms | 175ms | 212ms | 2 msg/s |
| STP-D2 | Collapsible (동일 키) | data | high | 200ms | 13.3% | 71ms | 148ms | 180ms | 2 msg/s |
| STP-E1 | Burst (10ms 간격) | combined | high | 10ms | 100.0% | 79ms | 173ms | 239ms | 2 msg/s |
| STP-E2 | Moderate (200ms 간격) | combined | high | 200ms | 100.0% | 68ms | 190ms | 251ms | 2 msg/s |
| STP-E3 | Slow (1000ms 간격) | combined | high | 1000ms | 100.0% | 91ms | 197ms | 264ms | 1 msg/s |
| STP-F1 | Minimal payload (<100B) | combined | high | 200ms | 100.0% | 68ms | 176ms | 252ms | 2 msg/s |
| STP-F2 | Medium payload (2KB) | data | high | 200ms | 100.0% | 66ms | 172ms | 261ms | 2 msg/s |
| STP-F3 | Large payload (4KB, 한도) | data | high | 200ms | 100.0% | 76ms | 186ms | 236ms | 2 msg/s |

---

## 4. 메시지 유형별 비교

| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 처리량 |
|---------|------|:-----:|:------:|:---:|:---:|:-----:|
| STP-A1 Data-only (Silent Push) | data | 100.0% | 99ms | 234ms | 306ms | 2 msg/s |
| STP-A2 Notification-only | notification | 100.0% | 94ms | 186ms | 272ms | 2 msg/s |
| STP-A3 Combined (Data+Notification) | combined | 100.0% | 69ms | 162ms | 233ms | 2 msg/s |

### 4.1 관찰

세 유형 모두 전달률 100%로 동일하나, 평균 지연시간에서 차이가 관측되었다. combined(69ms) < notification(94ms) < data(99ms) 순으로, combined 유형이 가장 낮은 지연을 보였다. P95에서도 combined(162ms)가 data(234ms)보다 72ms 낮아, 메시지 유형 선택이 tail latency에 영향을 미칠 수 있음을 시사한다. combined 유형은 foreground/background 모두에서 수신 가능하므로 범용성과 성능 모두에서 우위이다.

## 5. 우선순위별 비교

| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 처리량 |
|---------|------|:-----:|:------:|:---:|:---:|:-----:|
| STP-B1 High Priority | high | 100.0% | 70ms | 182ms | 282ms | 2 msg/s |
| STP-B2 Normal Priority | normal | 100.0% | 66ms | 158ms | 274ms | 2 msg/s |

### 5.1 관찰

high(70ms)와 normal(66ms) 우선순위 간 평균 지연시간 차이는 4ms로, 에뮬레이터 환경에서는 유의미한 차이가 관찰되지 않았다. 전달률도 모두 100%이다. 이는 에뮬레이터가 항상 온라인 상태이며 Doze 모드 등 배터리 최적화가 비활성화되어 있기 때문으로 추정된다. 실제 디바이스에서는 normal priority 메시지가 Doze 모드에서 배치 처리될 수 있어 지연 차이가 발생할 가능성이 있다[^4].

## 6. TTL(Time-To-Live)별 비교

| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 처리량 |
|---------|------|:-----:|:------:|:---:|:---:|:-----:|
| STP-C1 TTL=0 (즉시 전달 또는 폐기) | TTL=0s | 100.0% | 62ms | 194ms | 328ms | 2 msg/s |
| STP-C2 TTL=86400 (24시간) | TTL=86400s | 100.0% | 86ms | 217ms | 300ms | 2 msg/s |
| STP-C3 TTL=2419200 (28일, 최대) | TTL=2419200s | 100.0% | 86ms | 217ms | 278ms | 2 msg/s |

### 6.1 관찰

TTL 그룹(C1~C3) 전체에서 전달률 100%를 달성하였다. 초기 실험에서는 `android.ttl` 필드에 문자열(`"86400s"`)을 전달하여 Firebase Admin SDK의 타입 검증(`validator.isNumber`)에 실패, 전달률 0%가 측정되었으나, 이는 TTL 자체의 문제가 아닌 SDK 호출 포맷 오류였다. 수정 후(`ttl: seconds * 1000`, 밀리초 숫자) 재실험한 결과, 세 시나리오 모두 정상 전달되었다.

TTL=0(즉시 전달 또는 폐기)의 평균 지연 62ms가 TTL=86400/2419200의 86ms보다 약 24ms 낮게 측정되었다. 이는 디바이스가 항상 온라인인 에뮬레이터 환경에서 TTL 값과 무관하게 즉시 전달되며, TTL=0의 경우 FCM 서버가 저장 없이 바로 전달을 시도하기 때문으로 추정된다. 오프라인 상태에서 TTL=0은 메시지를 즉시 폐기하므로, 실제 환경에서는 전달률에 차이가 발생할 수 있다[^5].

## 7. Collapse Key 사용 비교

| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 처리량 |
|---------|------|:-----:|:------:|:---:|:---:|:-----:|
| STP-D1 Non-collapsible (각각 고유) | non-collapsible | 100.0% | 73ms | 175ms | 212ms | 2 msg/s |
| STP-D2 Collapsible (동일 키) | collapsible | 13.3% | 71ms | 148ms | 180ms | 2 msg/s |

### 7.1 관찰

Collapse Key의 영향이 가장 극적으로 나타났다. Non-collapsible(D1)은 전달률 100%인 반면, Collapsible(D2)은 13.3%로 크게 낮았다. 이는 FCM의 설계 의도대로 동일 collapse key를 가진 메시지가 대기열에서 최신 것으로 덮어쓰기되어, 50건 중 약 6~7건만 디바이스에 도달한 것이다. 평균 지연시간은 D1(73ms)과 D2(71ms)가 유사하여, 전달된 메시지의 처리 속도 자체에는 차이가 없다. Collapse Key는 채팅 알림처럼 모든 메시지가 필요한 경우 사용하면 안 되며, 날씨 업데이트, 스코어보드 등 최신 상태만 필요한 경우에 적합하다.

## 8. 전송 속도별 비교

| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 처리량 |
|---------|------|:-----:|:------:|:---:|:---:|:-----:|
| STP-E1 Burst (10ms 간격) | 10ms | 100.0% | 79ms | 173ms | 239ms | 2 msg/s |
| STP-E2 Moderate (200ms 간격) | 200ms | 100.0% | 68ms | 190ms | 251ms | 2 msg/s |
| STP-E3 Slow (1000ms 간격) | 1000ms | 100.0% | 91ms | 197ms | 264ms | 1 msg/s |

### 8.1 관찰

세 속도 모두 전달률 100%를 달성하여, 50건 규모에서는 FCM rate limit에 도달하지 않았다. 평균 지연시간은 Burst(79ms), Moderate(68ms), Slow(91ms)로, Moderate가 가장 낮았다. Burst 전송(10ms 간격) 시 평균 지연이 소폭 증가하였으나 P95/P99에서는 오히려 Burst(173ms/239ms)가 Slow(197ms/264ms)보다 낮아, 단일 디바이스 대상 소규모 전송에서는 전송 간격이 QoS에 미치는 영향이 제한적이다. 다만 대규모(수만 건) 전송 시에는 FCM의 rate limiting이 적용될 수 있다[^3].

## 9. 페이로드 크기별 비교

| 시나리오 | 설정 | 전달률 | 평균지연 | P95 | P99 | 처리량 |
|---------|------|:-----:|:------:|:---:|:---:|:-----:|
| STP-F1 Minimal payload (<100B) | <100B | 100.0% | 68ms | 176ms | 252ms | 2 msg/s |
| STP-F2 Medium payload (2KB) | 2048B | 100.0% | 66ms | 172ms | 261ms | 2 msg/s |
| STP-F3 Large payload (4KB, 한도) | 3900B | 100.0% | 76ms | 186ms | 236ms | 2 msg/s |

### 9.1 관찰

세 크기 모두 전달률 100%를 달성하였다. 평균 지연시간은 Minimal(68ms), 2KB(66ms), 4KB(76ms)로, 페이로드 크기에 따른 지연 증가는 미미하다. 다만 4KB(3,900B)에서 P95(186ms)가 Minimal(176ms)보다 10ms 높아, FCM data 메시지 최대 크기(4,096B)에 근접할수록 네트워크 전송 오버헤드가 소폭 증가하는 경향이 관찰되었다. 필요한 데이터만 포함하여 페이로드를 최소화하는 것이 tail latency 최적화에 유리하다.

---

## 10. FCM 사용법별 QoS 영향도 종합

| FCM 설정 | QoS 영향도 | 권장 사용법 | 근거 (측정 데이터) |
|----------|:---------:|-----------|------|
| 메시지 유형 | 중 (지연 30ms 차이) | combined (data+notification) | combined 69ms vs data 99ms (30ms 차이). 전달률 동일 100%. combined가 foreground/background 모두 대응 가능 |
| 우선순위 | 낮음 (에뮬레이터 환경) | high (긴급) / normal (비긴급) | high 70ms vs normal 66ms (4ms 차이, 유의미하지 않음). 실제 디바이스 Doze 모드에서는 차이 예상 |
| TTL | 낮음 (에뮬레이터 환경) | 용도에 따라 선택 | TTL=0 62ms vs TTL=86400 86ms (24ms 차이). 전달률 모두 100%. 오프라인 시 TTL=0은 즉시 폐기되므로 실환경에서 차이 예상 |
| Collapse Key | 높음 (전달률 86.7%p 차이) | 모든 메시지 필요 시 미사용 | non-collapsible 100% vs collapsible 13.3%. 상태 업데이트에만 collapse key 사용 |
| 전송 속도 | 낮음 (50건 규모) | 200ms 간격 권장 | burst 79ms vs moderate 68ms (11ms 차이). 50건 규모에서는 rate limit 미도달 |
| 페이로드 크기 | 낮음 (P95 10ms 차이) | 필요 최소한의 크기 | minimal 68ms vs 4KB 76ms (8ms 차이). P95에서 4KB가 10ms 높음 |

---

## 11. 추가 실험 결과 (그룹 G~J)

본 보고서의 그룹 A~F 실험 이후, 설계 문서(04-experiment-design.md)의 추가 불안정 요인에 대한 실험을 수행하였다. 상세 결과는 `results/additional-report.md`에 기술하며, 핵심 발견만 요약한다.

| 그룹 | 실험 | 핵심 발견 | QoS 영향도 |
|:---:|------|----------|:---------:|
| G | **Stale 토큰** (EXP-U01) | 무효 토큰 실패가 유효 메시지 전달에 영향 없음. 독립적 처리 확인. | 낮음 |
| H | **페이로드 경계값** (EXP-U02) | 4096B까지 100% 성공, 5000B는 100% 실패. `Android message is too big` 즉시 거부. | 극대 |
| I | **Collapsible 스로틀링** (EXP-U07) | 간격 늘려도 전달률 개선 안됨. burst(100ms) 33.3% > 1s 1.7%. collapse_key 자체가 전달률 저하 원인. | 극대 |
| J | **중복 전송** (EXP-U15) | FCM 서버 측 dedup 없음. 3회 전송 시 3회 수신, 중복률 100%. 클라이언트 L2 dedup 필수. | 높음 |

### 종합 QoS 영향도 순위 (전체 실험 기반)

| 순위 | 설정 | 영향도 | 근거 |
|:---:|------|:---:|------|
| 1 | **페이로드 한도 초과** | 극대 | 0% vs 100% (전달 불가) |
| 2 | **Collapse Key** | 극대 | 전달률 1.7~33.3% (vs 100%) |
| 3 | **중복 전송 (dedup 부재)** | 높음 | FCM 서버 dedup 없음, 클라이언트 대응 필수 |
| 4 | **메시지 유형** | 중간 | combined vs data 지연 30ms 차이 |
| 5 | **Stale 토큰** | 낮음 | 유효 메시지에 영향 없음 |
| 6 | **페이로드 크기** (한도 이내) | 낮음 | P95에서 10ms 차이 |
| 7 | **전송 속도** | 낮음 | 소규모에서 무의미 |
| 8 | **우선순위** | 환경 의존 | 에뮬레이터에서 차이 미미 |

---

## 참고 문헌

[^1]: Firebase Cloud Messaging — About FCM Messages. https://firebase.google.com/docs/cloud-messaging/concept-options
[^2]: FCM HTTP v1 API — Message resource. https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages
[^3]: FCM Throttling and Quotas. https://firebase.google.com/docs/cloud-messaging/concept-options#throttling
[^4]: Android message priority. https://firebase.google.com/docs/cloud-messaging/concept-options#setting-the-priority-of-a-message
[^5]: FCM message lifetime (TTL). https://firebase.google.com/docs/cloud-messaging/concept-options#lifetime

---

## 원시 데이터

### 기존 실험 (그룹 A~F)
- `results/server-to-phone-raw.csv` — 반복별 전체 원시 데이터 (엑셀 호환)
- `results/server-to-phone-summary.csv` — 시나리오별 평균 요약 데이터
- `results/server-to-phone-results.json` — JSON 형식 전체 결과

### 추가 실험 (그룹 G~J)
- `results/additional-report.md` — 추가 실험 상세 보고서
- `results/additional-raw.csv` — 반복별 전체 원시 데이터
- `results/additional-summary.csv` — 시나리오별 평균 요약 데이터
- `results/additional-results.json` — JSON 형식 전체 결과