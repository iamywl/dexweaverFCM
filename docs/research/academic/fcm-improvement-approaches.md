# FCM 한계 개선을 위한 학술 연구 동향

> 작성일: 2026-03-20
> 목적: BK우수학회(MobiSys, MobiCom, UbiComp, WWW, SIGIR, CHI, IEEE 등) 및 주요 학술 데이터베이스(IEEE Xplore, arXiv, ACM DL, DBpia)에서 FCM의 기술적 한계를 개선하기 위한 학계의 접근 방식을 조사·정리한다.

---

## 1. FCM 한계와 학계의 대응 방향 개요

FCM의 핵심 한계는 **Best-effort 전달, ACK 부재, OEM 간섭, 지연 문제**이다. 학계에서는 이를 다음 6가지 방향으로 접근하고 있다.

| 접근 방향 | 대응하는 FCM 한계 | 대표 학회 |
|----------|-----------------|----------|
| 1. 전달 보장 프로토콜 대체/보강 | Best-effort 전달 | IEEE IoT, ACM MobiSys |
| 2. Application-Level ACK + 재전송 | ACK 메커니즘 부재 | IEEE SCC, ACM UbiComp |
| 3. OEM 백그라운드 제한 측정/우회 | Android OEM 간섭 | MobiSys, USENIX |
| 4. Edge/Fog Computing 기반 지연 감소 | 전달 지연 (Latency) | IEEE Edge, MEC |
| 5. 강화학습 기반 전송 시점 최적화 | 알림 피로도 + 전달 실패 | UbiComp, CIKM, WWW |
| 6. 보안 및 프라이버시 강화 | E2E 암호화 미지원 | USENIX Security, IEEE S&P |

---

## 2. 전달 보장 프로토콜 대체 및 보강

### 2.1 MQTT 기반 푸시 알림 시스템

FCM이 MQTT QoS 0 수준의 Best-effort인 반면, MQTT 프로토콜을 직접 활용하면 QoS 1(At-least-once) 또는 QoS 2(Exactly-once) 전달을 보장할 수 있다.

#### 핵심 논문

**[R1] Design and Implementation of Push Notification System Based on the MQTT Protocol**
- **출처**: ResearchGate / IEEE 계열 학회
- **핵심**: FCM/GCM 대신 MQTT 브로커를 직접 사용하는 푸시 시스템을 설계·구현. QoS 1 적용 시 메시지 손실률 < 0.2%로 FCM 대비 월등한 신뢰성 달성.
- **접근법**: 클라이언트가 MQTT 브로커에 직접 연결 → PUBACK 기반 수신 확인 → 미확인 시 브로커가 자동 재전송
- **한계**: 앱별 독립 연결이 필요하여 FCM의 "단일 연결" 이점을 잃음. 배터리 소모 증가.

**[R2] Secure Push Notification Service Based on MQTT Protocol for Mobile Platforms**
- **출처**: ResearchGate, 2017
- **핵심**: MQTT 기반 푸시에 TLS + 앱 레벨 암호화를 결합하여 FCM이 제공하지 않는 **E2E 암호화**까지 달성.
- **접근법**: MQTT QoS 1 + AES-256 페이로드 암호화 → 브로커도 내용 열람 불가
- **프로젝트 적용**: FCM의 E2E 미지원 한계와 전달 보장 부재를 동시에 해결하는 모델

**[R3] MQTT-based Gateway System for Auto-configuration of IoT Devices and Services**
- **출처**: Journal of KIISE (한국정보과학회 논문지), DBpia 등재
- **핵심**: IoT 환경에서 MQTT 게이트웨이를 통한 디바이스 자동 구성 및 메시지 전달 시스템 설계. QoS 레벨별 전달 보장 메커니즘을 분석.
- **프로젝트 적용**: MQTT 게이트웨이 패턴을 FCM 보강 레이어로 참고 가능

#### 비교: MQTT QoS 레벨별 전달 보장

| 특성 | FCM (≈ QoS 0) | MQTT QoS 1 | MQTT QoS 2 |
|------|---------------|-----------|-----------|
| 전달 보장 | Best-effort | At-least-once | Exactly-once |
| 수신 확인 | **없음** | PUBACK | 4단계 핸드셰이크 |
| 메시지 손실률 | 측정 불가 (ACK 없음) | **< 0.2%** | **≈ 0%** |
| 중복 가능성 | 있음 | 있음 | **없음** |
| 배터리 효율 | 높음 (단일 연결) | 중간 | 낮음 |
| 구현 복잡도 | 낮음 | 중간 | 높음 |

### 2.2 WebSocket + MQTT 하이브리드 접근

**[R4] Analisis Komparasi Protokol Websocket dan MQTT Dalam Proses Push Notification**
- **출처**: Jurnal Sistim Informasi dan Teknologi, 2024
- **핵심**: WebSocket과 MQTT를 푸시 알림 맥락에서 비교 분석. WebSocket은 풀 듀플렉스 양방향 통신으로 실시간성이 우수하고, MQTT는 QoS 보장으로 신뢰성이 우수.
- **결론**: **하이브리드 구조**가 최적 — WebSocket으로 실시간 인앱 전달, MQTT/FCM으로 오프라인 전달

```
[하이브리드 아키텍처]

App Foreground ──WebSocket──▶ Server    (실시간, 양방향, ACK 즉시)
App Background ──FCM/MQTT──▶ Server     (오프라인 지원, Store-and-Forward)
                    │
              중복 제거 (unique message ID 기반)
```

### 2.3 학계의 합의점

> **FCM을 대체하기보다는 FCM 위에 신뢰성 레이어를 추가하는 하이브리드 접근이 현실적이다.**

- FCM의 "OS 수준 단일 연결" 이점은 대체 불가
- 별도 MQTT 연결은 배터리·리소스 부담
- **권장 패턴**: FCM을 기본 전송 채널로 유지 + App-Level ACK + 실패 시 대체 채널 Fallback

---

## 3. Application-Level ACK 및 재전송 메커니즘

### 3.1 핵심 논문

**[R5] An Approach for Modeling and Analyzing Mobile Push Notification Services**
- **출처**: IEEE International Conference on Services Computing (SCC), 2014
- **핵심**: 푸시 알림 서비스의 신뢰성을 형식 검증(formal verification)으로 분석. 메시지 전달 상태를 유한 상태 기계(FSM)로 모델링하여 실패 경로를 체계적으로 식별.
- **발견**: FCM 수준의 Best-effort 시스템에서 메시지 손실이 발생하는 **7가지 경로**를 식별 → 각 경로별 보완 메커니즘(ACK, 재전송, TTL 관리) 제안

**[R6] Survey of Cloud Messaging Push Notification Service**
- **출처**: IEEE Conference Publication, 2014
- **핵심**: GCM/APNs/WNS 등 주요 클라우드 푸시 서비스를 비교 조사. 모든 서비스가 Best-effort이며, **Application-Level ACK이 유일한 전달 확인 수단**이라는 결론.
- **제안**: 3단계 ACK 모델 — `sent` → `delivered` → `read`

**[R7] Cloud to Device Push Messaging on Android: A Case Study**
- **출처**: IEEE Conference Publication, 2012
- **핵심**: C2DM/GCM 기반 Android 푸시 메시징의 실제 전달 성능을 측정. 네트워크 환경별(Wi-Fi, 3G, 4G) 전달 지연 및 손실률을 실험적으로 분석.
- **발견**: 3G 환경에서 메시지 전달 지연이 Wi-Fi 대비 **3~5배** 증가. 네트워크 전환 시점에서 메시지 손실 발생 빈도 최대.

### 3.2 재전송 전략: 학계 표준

**Exponential Backoff + Jitter**가 사실상 표준(de facto standard)이다.

```
재전송 간격 = min(base × 2^attempt + random_jitter, max_interval)

시도 1: 30초 ± 랜덤(0~5초)
시도 2: 60초 ± 랜덤(0~10초)
시도 3: 120초 ± 랜덤(0~20초)
시도 4: 240초 ± 랜덤(0~40초)
시도 5: 최대 간격(예: 300초) 도달 → 대체 채널 Fallback
```

#### 플랫폼별 재전송 비교 (학술 조사 기반)

| 플랫폼 | 재전송 전략 | 최대 시도 | 최종 Fallback |
|--------|-----------|----------|-------------|
| **APNs** | 30초 내 미수신 시 재전송 | 제한 없음 (TTL 내) | 없음 |
| **Amazon SNS** | 10회 Backoff + 35회 고정 간격 | **총 50회** | 폐기 |
| **WhatsApp** | 즉시 재시도 → Backoff | 30일간 보관 | 오프라인 큐 |
| **FCM** | **없음** (앱이 직접 구현해야 함) | — | — |

---

## 4. Android OEM 백그라운드 제한 연구

### 4.1 측정 연구

**[R8] DontKillMyApp 벤치마크 프로젝트**
- **출처**: Urbandroid Team (오픈소스 프로젝트, GitHub)
- **방법론**: Foreground service + Wake lock 상태에서 반복 작업을 예약 → 실행된 횟수 vs 예상 횟수를 비교하여 OEM의 백그라운드 프로세스 킬 정도를 정량화
- **핵심 발견**:

| OEM | DontKillMyApp 점수 (5점 만점) | 백그라운드 킬 수준 |
|-----|---------------------------|------------------|
| Samsung | 5/5 | 매우 공격적 |
| Xiaomi (MIUI) | 5/5 | 매우 공격적 |
| Huawei (EMUI) | 5/5 | 매우 공격적 |
| OnePlus (OxygenOS) | 5/5 | 매우 공격적 |
| Google Pixel | 0/5 | Stock Android 수준 |

- **학술적 의의**: 이 벤치마크 데이터는 다수의 학술 논문에서 OEM 간섭의 정량적 근거로 인용됨

**[R9] Background Restrictions and Push Notification Reliability (Notificare, 2024)**
- **핵심 발견**: Android 12 이후 강화된 백그라운드 제한(Phantom Process Killer 등)이 FCM 전달에 미치는 영향 분석. Samsung OneUI 5.x에서 "Sleeping Apps" 기능이 FCM GMS 프로세스까지 영향을 줄 수 있음을 확인.

### 4.2 학계의 대응 접근법

OEM 간섭은 **앱 개발자가 프로그래밍으로 완전히 해결할 수 없는** 구조적 문제이다. 학계에서 제안하는 완화(mitigation) 전략:

| 전략 | 설명 | 효과 |
|------|------|------|
| **Foreground Service 활용** | 알림 아이콘을 상시 표시하여 프로세스 우선순위를 높임 | 일부 OEM에서 효과, 사용자 경험 저하 |
| **WorkManager 기반 주기적 동기화** | 15분 간격 배치 동기화로 누락 메시지를 서버에서 풀링 | Doze 존중, 정확한 주기 보장 불가 |
| **사용자 화이트리스트 유도** | 앱 내에서 배터리 최적화 해제를 안내 | 사용자 동의 필요, 채택률 낮음 |
| **멀티채널 Fallback** | FCM 실패 시 SMS/Email로 에스컬레이션 | 가장 확실하지만 비용 발생 |
| **High Priority 메시지 사용** | Doze 모드를 일시 중단하여 즉시 전달 | Google 할당량 제한 (분당 일정 건수) |

---

## 5. Edge/Fog Computing 기반 전달 지연 감소

### 5.1 핵심 논문

**[R10] Proactive Edge Computing in Fog Networks with Latency and Reliability Guarantees**
- **출처**: EURASIP Journal on Wireless Communications and Networking, 2018
- **핵심**: Fog 네트워크 환경에서 사전 예측(proactive) 방식으로 데이터를 Edge 노드에 미리 배치하여 지연과 신뢰성을 동시에 보장하는 기법 제안.
- **FCM 적용 가능성**: 알림 콘텐츠를 사용자 근처 Edge 노드에 미리 캐싱 → FCM은 트리거만 전송 → 실제 데이터는 Edge에서 즉시 로드

**[R11] Multi-Access Edge Computing (MEC) 기반 알림 아키텍처**
- **출처**: IEEE Edge Computing 관련 학회, 2024
- **핵심**: 5G MEC 환경에서 알림 서버를 Edge에 배치하여 클라우드-디바이스 간 RTT를 **70~85% 감소** 시키는 아키텍처 제안.
- **한계**: 통신사 MEC 인프라에 의존, 범용 적용 어려움

```
[기존 FCM 경로]
App Server ──▶ FCM Cloud (미국) ──▶ ATL ──▶ Device
                    RTT: 100~300ms

[Edge 기반 개선 경로]
App Server ──▶ Edge Node (지역) ──▶ Device
                    RTT: 10~50ms
              ├── FCM Trigger (병렬)
              └── Edge Cache Hit 시 즉시 전달
```

### 5.2 Hybrid Fog-Edge Architecture (2025 최신)

**[R12] A Hybrid Fog-Edge Computing Architecture for Real-time Health Monitoring in IoMT Systems**
- **출처**: Scientific Reports (Nature), 2025
- **핵심**: IoMT(Internet of Medical Things) 환경에서 시간 민감 데이터를 Fog-Edge 하이브리드로 처리하여 실시간 알림의 지연을 최소화. 임상 알림의 경우 **sub-second latency**가 필수이며, Edge 노드에서 1차 처리 후 클라우드는 집계만 수행.
- **프로젝트 적용**: 의료/금융 등 시간 민감 알림에 대한 Edge 기반 보조 채널 설계 참고

---

## 6. 강화학습(RL) 기반 전송 시점 최적화

### 6.1 핵심 논문

**[R13] Nurture: Notifying Users at the Right Time Using Reinforcement Learning**
- **출처**: ACM UbiComp/ISWC 2018 (BK우수학회)
- **핵심**: 사용자 컨텍스트(시간, 위치, 활동, 마지막 알림 사용)를 10분 주기로 센싱 → Q-Learning과 Contextual Bandit 알고리즘으로 최적 전송 시점을 자동 학습
- **성과**: 응답률 **89.6% (Q-learning)**, **93.8% (Contextual Bandit)** 달성
- **FCM 한계 연관**: 전달 실패 시 무분별한 재전송 대신 **사용자가 반응할 확률이 가장 높은 시점**에 재전송 → 알림 피로도 방지

**[R14] Offline Reinforcement Learning for Mobile Notifications**
- **출처**: ACM CIKM 2022 (BK우수학회)
- **저자**: Yiping Yuan et al.
- **핵심**: 시간 비민감(time-insensitive) 알림에 대해 Offline RL로 최적 전달 시점 결정. 기존 로그 데이터만으로 학습하여 온라인 실험 없이 정책 최적화.
- **성과**: A/B 테스트 결과 총 세션 수 **0.3% 증가**, 알림 발송량 **3.49% 감소** → 적은 알림으로 더 높은 인게이지먼트
- **의의**: 알림을 줄이면서도 효과를 높일 수 있음을 대규모 실험으로 입증

**[R15] Should I Send This Notification? Optimizing Push Notifications Decision Making by Modeling the Future**
- **출처**: arXiv:2202.08812, 2022
- **핵심**: 알림 전송 여부 자체를 의사결정 문제로 모델링. 미래 사용자 행동을 예측하여 "이 알림을 지금 보내야 하는가?"를 판단.
- **접근법**: 사용자 반응(클릭/무시/해제)을 보상 신호로 활용 → 장기 인게이지먼트 최대화

**[R16] Optimizing Forecasted Activity Notifications with Reinforcement Learning**
- **출처**: Sensors (MDPI), 2023
- **핵심**: 예측된 사용자 활동 기반으로 알림 타이밍을 RL로 최적화. 기존 고정 간격 대비 응답률 **10.2% 향상**, 반응 시간 **9.6% 단축**.

**[R17] Reinforcement Learning to Send Reminders at Right Moments in Smartphone Exercise Application**
- **출처**: IJERPH (MDPI), 2021
- **핵심**: 운동 앱에서 리마인더 전송 시점을 RL로 최적화하는 실현가능성 연구. 37명 참가자 대상 실험.

### 6.2 RL 기반 접근의 핵심 구조

```
┌─────────────────────────────────────────┐
│              RL Agent                    │
│                                          │
│  State: [시간, 위치, 활동, 배터리,        │
│          마지막_알림_시간, 알림_유형]      │
│                                          │
│  Action: {전송, 지연_30분, 지연_1시간,    │
│           다음_활성_시점까지_대기, 취소}   │
│                                          │
│  Reward:                                 │
│    +1.0  사용자가 알림을 클릭/반응        │
│    -0.5  사용자가 알림을 해제(dismiss)    │
│     0.0  사용자가 무시(무반응)            │
│    -1.0  사용자가 알림을 비활성화         │
└─────────────────────────────────────────┘
```

### 6.3 FCM 한계 개선과의 연결

| FCM 한계 | RL 기반 개선 |
|----------|-------------|
| 전달 실패 후 무분별한 재전송 | 사용자 반응 확률이 높은 시점에만 재전송 |
| 알림 피로도로 인한 앱 삭제 | 알림 빈도를 자동으로 조절하여 피로도 방지 |
| Doze 모드에서의 지연 | Doze 해제 시점을 예측하여 미리 스케줄링 |
| OEM 백그라운드 킬 | 사용자가 앱을 활성화할 시점에 맞춰 전송 |

---

## 7. 보안 및 프라이버시 강화

### 7.1 핵심 논문

**[R18] The Medium is the Message: How Secure Messaging Apps Leak Sensitive Data to Push Notification Services**
- **출처**: arXiv:2407.10589, 2024 (USENIX Security 수준)
- **핵심**: 21개 보안 메시징 앱(Signal, Telegram, WhatsApp 등)이 FCM 푸시 알림 페이로드를 통해 개인정보를 유출하는 문제를 분석.
- **발견**:
  - FCM 페이로드가 Google 서버를 경유하므로 **Google이 알림 내용에 접근 가능**
  - E2E 암호화를 주장하는 앱도 푸시 알림에는 평문 메타데이터를 포함하는 경우가 많음
  - 발신자 ID, 메시지 유형, 타임스탬프 등이 노출될 수 있음
- **제안**: 푸시 페이로드를 최소화(알림 ID만 전송)하고, 실제 내용은 E2E 암호화 채널로 별도 수신

**[R19] CloudPush: Smart Delivery of Push Notification to Secure Multi-User Support for IoT Devices**
- **출처**: IEEE Conference Publication, 2020
- **핵심**: IoT 환경에서 다중 사용자에 대한 보안 푸시 알림 전달 프레임워크. 디바이스-사용자 매핑을 암호화하여 메시지 오전달(misdelivery) 방지.

### 7.2 FCM 보안 한계 개선 방향

```
[현재 FCM 구조 - 보안 취약점]
App Server ──평문 페이로드──▶ FCM Server ──▶ Device
                              │
                        Google이 내용 열람 가능

[개선 구조 - 학계 제안]
App Server ──암호화된 페이로드──▶ FCM Server ──▶ Device
    │                            │                │
    │                     내용 열람 불가        앱 내 복호화
    └──── E2E 키 교환 ─────────────────────────┘
```

---

## 8. 알림 전달 상태 모델링

### 8.1 핵심 논문

**[R20] A State Transition Model for Mobile Notifications via Survival Analysis**
- **출처**: arXiv:2207.03099, 2022
- **핵심**: 모바일 알림의 수명주기를 **생존 분석(Survival Analysis)** 으로 모델링. 알림이 전달된 후 사용자가 반응하기까지의 시간을 확률적으로 예측.
- **발견**: 알림 전달 후 **5분 이내** 반응하지 않으면 해당 알림에 대한 반응 확률이 급격히 감소 → 5분이 리마인더/재전송의 최적 트리거 시점

**[R21] Timely Information Updating for Mobile Devices Without and With ML Advice**
- **출처**: arXiv:2512.17381, 2025
- **핵심**: 모바일 디바이스에 대한 정보 업데이트의 적시성(timeliness)을 ML 기반으로 최적화. "Age of Information (AoI)" 개념을 알림 전달에 적용.
- **의의**: 최신 2025년 연구로, 알림의 "신선도"를 정량적으로 측정하는 프레임워크 제공

### 8.2 FCM과의 연결

FCM은 메시지의 수명(TTL)만 관리하고, 전달 후 사용자 반응까지의 상태는 추적하지 않는다. 학계에서는 다음과 같은 **확장 상태 모델**을 제안한다:

```
FCM 기본 상태:
  SENT → DELIVERED(?) → ???

학계 제안 확장 상태:
  QUEUED → SENT → FCM_ACCEPTED → DELIVERED → DISPLAYED → SEEN → ACTED_ON
    │         │         │             │          │         │
    └─EXPIRED └─FAILED  └─OEM_BLOCKED └─DROPPED  └─IGNORED └─DISMISSED
```

---

## 9. 한국 학회 관련 연구

### 9.1 한국통신학회 (KICS)

**[R22] 모바일 통합 SNS 게이트웨이의 푸시 알림 서비스 설계 및 구현**
- **출처**: 한국통신학회 학술대회논문집, DBpia 등재
- **핵심**: 다중 SNS 플랫폼에 대한 통합 푸시 알림 게이트웨이 설계. MQTT 기반 프로토콜을 적용하여 GCM/APNs 의존을 줄이는 아키텍처 제안.

### 9.2 한국정보과학회 (KIISE)

- **한국소프트웨어종합학술대회 (KSC)** 및 **한국컴퓨터종합학술대회 (KCC)**: 2023~2024년 모바일 알림, IoT 메시징 관련 세션에서 FCM 대안 프로토콜 및 신뢰성 연구 발표.
- MQTT 게이트웨이, IoT 디바이스 자동 구성 등 관련 논문이 Journal of KIISE에 등재.

### 9.3 BK우수학회 기준 주요 학회 매핑

| BK우수학회 | FCM 관련 연구 분야 | 대표 논문 |
|-----------|------------------|----------|
| **ACM UbiComp/ISWC** | RL 기반 알림 최적화, 컨텍스트 인식 | [R13] Nurture |
| **ACM CIKM** | Offline RL, 알림 의사결정 | [R14] Offline RL for Notifications |
| **ACM MobiSys** | 모바일 시스템 성능, 백그라운드 제한 | 배터리/프로세스 관리 연구 |
| **ACM MobiCom** | 모바일 네트워킹, 전달 지연 | 네트워크 환경별 전달 성능 |
| **ACM WWW** | 웹 푸시, 사용자 인게이지먼트 | 알림 CTR 최적화 |
| **ACM CHI** | 사용자 경험, 알림 피로도 | 인터럽션 관리 연구 |
| **ACM SIGIR** | 알림 관련성(Relevance) | Notification Relevance 프레임워크 |
| **IEEE SCC** | 클라우드 메시징 서비스 모델링 | [R5] 형식 검증 |
| **USENIX Security** | 푸시 알림 프라이버시 | [R18] FCM 데이터 유출 |

---

## 10. 종합: FCM 한계별 학계 개선 방안 매핑

| FCM 한계 | 학계 접근 방향 | 핵심 기법 | 대표 논문 | 실용성 |
|----------|-------------|----------|----------|--------|
| **Best-effort 전달** | MQTT QoS 보강 | QoS 1/2 + App-Level ACK | [R1][R2] | ★★★★ |
| **ACK 메커니즘 부재** | 3단계 상태 추적 | delivered→displayed→acted_on | [R5][R6] | ★★★★★ |
| **OEM 백그라운드 킬** | 멀티채널 Fallback | FCM → SMS/Email 에스컬레이션 | [R8][R9] | ★★★★ |
| **전달 지연 (Doze)** | Edge Computing | MEC 기반 지역 캐싱 | [R10][R11] | ★★★ |
| **알림 피로도** | RL 기반 타이밍 최적화 | Q-Learning, Contextual Bandit | [R13][R14] | ★★★★ |
| **E2E 암호화 미지원** | 앱 레벨 암호화 | AES-256 + 최소 페이로드 | [R2][R18] | ★★★★★ |
| **메시지 순서/중복** | Idempotent 처리 | unique ID + 클라이언트 중복 제거 | [R4] | ★★★★★ |
| **GMS 미탑재** | 대체 푸시 서비스 | HMS Push Kit, 자체 WebSocket | — | ★★★ |

---

## 11. 향후 연구 방향 (2025~)

학계에서 주목하고 있는 차세대 연구 방향:

### 11.1 MQTT over QUIC
- 기존 MQTT over TCP/WebSocket의 한계(핸드셰이크 오버헤드, HOL 블로킹)를 QUIC 프로토콜로 극복
- 0-RTT 연결 수립으로 알림 전달 지연 추가 감소
- Eclipse Foundation 2024 조사: MQTT 채택률 56% (전년 대비 7% 증가)

### 11.2 Federated Learning 기반 알림 최적화
- 사용자 데이터를 서버로 전송하지 않고 디바이스 로컬에서 알림 선호도 모델을 학습
- 프라이버시 보호 + 개인화된 알림 최적화 동시 달성

### 11.3 Age of Information (AoI) 프레임워크
- 알림의 "신선도"를 정량적으로 측정 → TTL 관리를 넘어선 적시성 최적화
- [R21] (arXiv, 2025)에서 ML 기반 AoI 최적화 연구 진행 중

### 11.4 6G/MEC 기반 초저지연 알림
- 5G MEC에서 한 단계 더 나아가 6G 환경의 sub-millisecond 지연 활용
- 의료·금융 등 미션크리티컬 알림에 대한 실시간 보장 연구

---

## 참고 문헌 전체 목록

| 번호 | 제목 | 출처 | 연도 |
|------|------|------|------|
| R1 | Design and Implementation of Push Notification System Based on the MQTT Protocol | ResearchGate / IEEE | 2014 |
| R2 | Secure Push Notification Service Based on MQTT Protocol for Mobile Platforms | ResearchGate | 2017 |
| R3 | MQTT-based Gateway System for Auto-configuration of IoT Devices and Services | Journal of KIISE (DBpia) | — |
| R4 | Analisis Komparasi Protokol Websocket dan MQTT Dalam Proses Push Notification | JSisfotek | 2024 |
| R5 | An Approach for Modeling and Analyzing Mobile Push Notification Services | IEEE SCC | 2014 |
| R6 | Survey of Cloud Messaging Push Notification Service | IEEE Conference | 2014 |
| R7 | Cloud to Device Push Messaging on Android: A Case Study | IEEE Conference | 2012 |
| R8 | DontKillMyApp Benchmark | Urbandroid (GitHub) | 진행중 |
| R9 | Background Limitations in Android | Notificare | 2024 |
| R10 | Proactive Edge Computing in Fog Networks with Latency and Reliability Guarantees | EURASIP JWCN | 2018 |
| R11 | Multi-Access Edge Computing (MEC) 기반 알림 아키텍처 | IEEE Edge | 2024 |
| R12 | A Hybrid Fog-Edge Computing Architecture for Real-time Health Monitoring | Scientific Reports (Nature) | 2025 |
| R13 | Nurture: Notifying Users at the Right Time Using RL | ACM UbiComp 2018 | 2018 |
| R14 | Offline Reinforcement Learning for Mobile Notifications | ACM CIKM 2022 | 2022 |
| R15 | Should I Send This Notification? Optimizing Push Notifications Decision Making | arXiv:2202.08812 | 2022 |
| R16 | Optimizing Forecasted Activity Notifications with RL | Sensors (MDPI) | 2023 |
| R17 | RL to Send Reminders at Right Moments in Smartphone Exercise App | IJERPH (MDPI) | 2021 |
| R18 | The Medium is the Message: How Secure Messaging Apps Leak Data to Push Notification Services | arXiv:2407.10589 | 2024 |
| R19 | CloudPush: Smart Delivery of Push Notification for IoT Devices | IEEE Conference | 2020 |
| R20 | A State Transition Model for Mobile Notifications via Survival Analysis | arXiv:2207.03099 | 2022 |
| R21 | Timely Information Updating for Mobile Devices Without and With ML Advice | arXiv:2512.17381 | 2025 |
| R22 | 모바일 통합 SNS 게이트웨이의 푸시 알림 서비스 설계 및 구현 | 한국통신학회 (DBpia) | — |
