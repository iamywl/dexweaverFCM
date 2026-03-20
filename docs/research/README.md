# FCM 알림 신뢰성 연구 총괄

> **핵심 결론: FCM은 전달을 보장하지 않는다.** 공식 전달률 ~99%는 서버 수락 기준이며, 실제 디바이스 렌더링 기준 산업 평균은 **14~48%**이다. Android OEM 배터리 최적화(전달률 20~55%)가 가장 치명적이며, 이를 보완하려면 App-Level ACK, 토큰 관리, 멀티채널 Fallback이 필수이다.

각 섹션의 `[상세 →]` 링크를 통해 하위 문서의 세부 내용을 확인할 수 있다.

---

## 목차

0. [FCM 등장 배경과 기술적 한계](#0-fcm-등장-배경과-기술적-한계)
1. [FCM 기술 개요](#1-fcm-기술-개요)
2. [FCM 전달 보장과 한계](#2-fcm-전달-보장과-한계)
3. [안정/불안정 케이스 분석](#3-안정불안정-케이스-분석)
4. [학술 연구 조사](#4-학술-연구-조사)
5. [FCM 한계 개선: 학계 접근 동향](#5-fcm-한계-개선-학계-접근-동향)
6. [알림 신뢰성 패턴](#6-알림-신뢰성-패턴)
7. [메시지 큐 대안 기술](#7-메시지-큐-대안-기술)
8. [핵심 결론 및 프로젝트 적용](#8-핵심-결론-및-프로젝트-적용)

---

## 0. FCM 등장 배경과 기술적 한계

> **FCM 이전에는 Polling → C2DM → GCM 순으로 발전했으며, 각 단계의 한계를 해결하기 위해 FCM이 출시되었다.** FCM은 배터리·크로스플랫폼·보안·확장성 문제를 해결했지만, Best-effort 전달·ACK 부재·OEM 간섭·E2E 미지원이라는 구조적 한계가 남아 있다.
>
> [상세 → FCM 등장 배경과 기술적 한계](fcm/history-and-limitations.md)

---

## 1. FCM 기술 개요

> **Google이 운영하는 무료 크로스플랫폼 푸시 알림 서비스.** HTTP v1 API + OAuth2 인증을 사용하며, iOS는 APNs를 프록시한다. 전송 중 TLS 암호화가 적용되지만 종단 간 암호화(E2E)는 미지원.
>
> [상세 → FCM 기술 조사 보고서](fcm/technical-overview.md)

```
App Server ──HTTP v1 API──▶ FCM Backend ──┬──▶ Android (ATL) ──▶ Device
                                          └──▶ APNs (Apple)  ──▶ Device
```

### 1.1 메시지 유형

**Android Force-stopped 상태에서 Data 메시지는 완전히 드롭되고, iOS Silent Notification은 시간당 2~3건으로 스로틀링된다.** 이것이 메시지 유형 선택의 핵심 제약이다.

| 유형 | 특징 | Background 동작 |
|------|------|----------------|
| **Notification** | 시스템이 자동 표시 | 트레이에 자동 표시 |
| **Data** | 앱이 직접 처리 | Android: 콜백 호출 / iOS: 스로틀링 |
| **Combined** | 두 유형 결합 | 알림은 트레이, data는 탭 시에만 접근 |

[상세: 메시지 유형별 플랫폼/앱 상태별 동작 차이 →](fcm/technical-overview.md#3-메시지-유형)

### 1.2 토큰 생명주기

**토큰을 관리하지 않으면 전체 메시지의 약 15%가 비활성 디바이스로 드롭된다.** 토큰 관리만으로 가장 즉각적인 전달률 개선이 가능하다.

- 앱 최초 실행 시 자동 생성, 재설치·데이터 삭제·270일 비활성 시 갱신
- 30일 이상 비활성 토큰은 stale로 간주 → 월 1회 정리 권장
- `UNREGISTERED`(404), `INVALID_ARGUMENT`(400), `SENDER_ID_MISMATCH`(403) 응답 시 즉시 삭제

[상세: 토큰 갱신 조건, 무효화 감지, 관리 수치 →](fcm/technical-overview.md#4-fcm-토큰-생명주기)

### 1.3 제한사항 및 할당량

**Non-collapsible 메시지가 100건을 초과하면 해당 디바이스의 모든 대기 메시지가 전체 삭제된다.** 이것이 가장 치명적인 제한이다.

| 항목 | 제한 |
|------|------|
| 페이로드 크기 | 최대 **4KB** |
| 프로젝트당 전송 속도 | **600,000건/분** |
| Android 단일 디바이스 | 240건/분, 5,000건/시간 |
| Collapsible 버스트 | 디바이스당 **20건**, 리필 **3분/1건** |
| Non-collapsible 저장 | 디바이스당 **100건** (초과 시 **전체 삭제**) |
| 오프라인 메시지 보관 | 최대 **28일** (TTL 기본값) |

[상세: 전송 속도, 토픽, 팬아웃 제한 →](fcm/technical-overview.md#6-fcm-제한-사항-및-할당량)

---

## 2. FCM 전달 보장과 한계

> **FCM은 공식적으로 어떤 전달 시맨틱(at-most-once, at-least-once, exactly-once)도 보장하지 않는다.** Best-effort delivery이며 MQTT QoS 0 수준이다. `HTTP 200 + message_id`는 "FCM이 수락함"이지 "디바이스가 수신함"이 아니다.
>
> [상세 → FCM 기술 조사 보고서 §5](fcm/technical-overview.md#5-fcm의-전달-보장-수준)

### 이론 vs 현실: 전달률 괴리가 핵심 문제

| 지표 | FCM 이론/공식 | 산업 현실 |
|------|-------------|---------|
| 전달률 | ~99% (서버 수락 기준) | **14~48%** (디바이스 렌더링 기준) |
| 지연시간 | 95%가 350ms 이내 (API 응답) | 수분~수시간 (OEM/Doze 영향 시) |
| 메시지 순서 | 보장 없음 | 보장 없음 |
| 중복 제거 | 없음 | 없음 |

### MQTT QoS와의 비교

| 특성 | FCM | MQTT QoS 1 | MQTT QoS 2 |
|------|-----|-----------|-----------|
| 전달 보장 | Best-effort | At least once | Exactly once |
| 수신 확인 | **없음** | PUBACK | 4단계 핸드셰이크 |
| 중복 제거 | **없음** | 없음 | 보장 |
| 순서 보장 | **없음** | 조건부 | 보장 |

**결론: FCM ≈ MQTT QoS 0 + 오프라인 저장(TTL)**

---

## 3. 안정/불안정 케이스 분석

> **Android OEM 배터리 최적화가 FCM 불안정성의 가장 큰 원인이다.** 전 세계 Android 기기의 약 70%가 중국 OEM이며, 전달률이 20~55%까지 하락한다. 사용자가 직접 화이트리스트에 등록하지 않는 한 시스템적 해결이 불가능하다.
>
> [상세 → FCM 안정/불안정 케이스 분석 보고서](fcm/stability-analysis.md)

### 3.1 안정 케이스: 최적 조건에서는 99% 이상

| 케이스 | 조건 | 기대 전달률 |
|--------|------|-----------|
| 유효 토큰 + Foreground | 30일 이내 활성 토큰, < 4KB | **≥ 99%** |
| Notification + Background | HIGH 우선순위 | **≥ 95%** |
| 소규모 토픽 (≤ 1,000) | 유효 토큰만 구독 | **≥ 95%** |
| Collapsible (적정 빈도) | 3분에 1건 이하 | **≥ 99%** |

[상세: 5가지 안정 케이스 전체 분석 →](fcm/stability-analysis.md#2-안정-케이스-stable-cases)

### 3.2 불안정 케이스: 심각도별 분류

```
Critical (시스템적 해결 불가):
  1. Android OEM 배터리 최적화 — 전달률 20~55%
  2. GMS 미탑재 (Huawei 신규) — 전달률 0%
  3. iOS Silent 스로틀링 — 시간당 2~3건 제한

High (설계로 완화 가능):
  4. Non-collapsible 100건 초과 — 전량 손실
  5. Stale 토큰 미정리 — 12~15% 드롭
  6. iOS 앱 Force Kill — Silent push 100% 드롭

Medium (운영으로 관리 가능):
  7~10. 대규모 팬아웃 지연, Doze 모드, Rate Limit, 인증 만료

Low (즉시 감지/해결 가능):
  11~14. 페이로드 초과, 서버 장애, App Standby, 네트워크 불안정
```

[상세: 15가지 불안정 케이스 전체 분석, 4개 레이어 분류 →](fcm/stability-analysis.md#3-불안정-케이스-unstable-cases)

### 3.3 OEM별 전달률

| OEM | DontKillMyApp 점수 | 전달률 추정 |
|-----|-------------------|-----------|
| **Xiaomi (MIUI)** | 5/5 | 20~40% |
| **Samsung (OneUI)** | 5/5 | 51~55% |
| **Huawei (EMUI)** | 5/5 | 20~35% |
| **OnePlus (OxygenOS)** | 5/5 | 40~55% |
| **Google Pixel** | 0/5 | **95%+** |

[상세: OEM별 간섭 메커니즘, Doze/App Standby/iOS 스로틀링 →](fcm/stability-analysis.md#unstable-08-android-oem-배터리-최적화)

---

## 4. 학술 연구 조사

> **24편의 학술 논문 조사 결과, FCM의 best-effort 전달을 보완하려면 Application-level ACK + Exponential Backoff가 필수이며, 재전송 시 알림 피로도(적절한 순간 전달 시 응답 시간 49.7% 감소)를 반드시 고려해야 한다.**
>
> [상세 → 학술 연구 조사 (24편)](academic/literature-survey.md)

### 4.1 전달 신뢰성

**FCM 서버 수락률 ~99%와 실제 렌더링 기준 14~48%의 괴리가 핵심 문제다.**

- FCM 연결 디바이스 전달 성공률: 98% (500ms 이내), 주간 1조 건 이상 처리
- 실제 렌더링 기준 산업 평균: **14~48%** — OEM 간섭, Doze, 네트워크 단절이 원인
- Adaptive heartbeat로 배터리-신뢰성 트레이드오프 최적화 가능 (IEEE/ACM ToN, 2017)

[상세: 전달 신뢰성 관련 논문 4편 →](academic/literature-survey.md#1-전달-신뢰성-delivery-reliability)

### 4.2 사용자 인게이지먼트 및 알림 피로도

**과도한 알림은 앱 삭제로 이어진다.** 재전송 전략 설계 시 빈도 제한이 필수이다.

- 젊은 성인 일일 평균 알림: **60~80건**, 헤비 유저 **200건+**
- 인터럽트 가능한 순간에 전달하면 응답 시간 **49.7% 감소** (MobileHCI '14)
- 과도한 빈도 → 알림 비활성화 또는 앱 삭제 (Systematic Review, 2020)

[상세: 인게이지먼트/피로도 관련 논문 6편 →](academic/literature-survey.md#2-사용자-인게이지먼트-및-알림-피로도)

### 4.3 QoS 측정 지표

**Delivery Rate, E2E Latency, Message Loss Rate, Notification Relevance** 4가지가 핵심 지표이다.

| 지표 | 설명 | 측정 방법 |
|------|------|-----------|
| Delivery Rate | 전송 대비 실제 수신 비율 | 클라이언트 ACK 콜백 |
| E2E Latency | 서버 전송~디바이스 수신 시간 | NTP 동기화 후 타임스탬프 차이 |
| Message Loss Rate | 전송 후 미수신 비율 | 전송 ID 대조 |
| Notification Relevance | 관련성/적시성/참신성 | SIGIR 2016 프레임워크 |

[상세: QoS 측정 관련 논문 3편 →](academic/literature-survey.md#3-qos-측정-및-평가)

### 4.4 End-to-End ACK 패턴

**FCM은 수신 확인을 제공하지 않으므로 Application-level ACK이 필수이다.** 재전송은 Exponential Backoff + Jittering이 업계 표준이다.

- 재전송 간격: 30s → 60s → 120s → 240s
- APNs: 30초 내 ACK 미수신 시 서버가 재전송
- Amazon SNS: 총 50회 전달 시도(10회 backoff + 35회 고정 간격) 후 폐기

[상세: ACK 패턴, NACK, 플랫폼별 메커니즘 →](academic/literature-survey.md#4-end-to-end-acknowledgment-패턴)

### 4.5 Store-and-Forward / Message Queuing

**MQTT QoS 1 기준 메시지 손실률 < 0.2%로 FCM best-effort 대비 월등한 신뢰성을 제공한다.**

- 불안정 네트워크에서 AMQP vs MQTT 비교: 일부 프로토콜만 모든 메시지 전달 성공 (2015)
- 분산 메시지 브로커(RabbitMQ, Kafka, ActiveMQ) QoS 수준별 비교 분석 (arXiv, 2017)

[상세: Store-and-Forward 관련 논문 5편 →](academic/literature-survey.md#5-store-and-forward-및-message-queuing-패턴)

### 4.6 강화학습 기반 알림 최적화

**RL로 사용자 컨텍스트에 적합한 전송 시점을 자동 식별하여 장기 인게이지먼트를 향상시킬 수 있다.**

- Nurture 시스템: 사용자 활동/위치/시간대 고려 최적 전달 시점 결정 (UbiComp 2018)
- 오프라인 RL로 sequential notification 결정 최적화 (CIKM 2022)
- 지도 학습 기반 적응형 알림 시스템이 CTR을 유의미하게 향상 (MobiQuitous 2020)

[상세: RL 기반 최적화 논문 4편 →](academic/literature-survey.md#6-강화학습-기반-알림-최적화)

---

## 5. FCM 한계 개선: 학계 접근 동향

> **22편의 논문(IEEE, ACM UbiComp, CIKM, USENIX Security 등 BK우수학회 포함)을 조사한 결과, 학계는 FCM을 대체하기보다 FCM 위에 신뢰성 레이어를 추가하는 하이브리드 접근을 권장한다.** MQTT QoS 보강, App-Level ACK, RL 기반 전송 시점 최적화, Edge Computing, E2E 암호화가 6대 개선 방향이다.
>
> [상세 → FCM 한계 개선을 위한 학술 연구 동향](academic/fcm-improvement-approaches.md)

### 5.1 학계의 6대 개선 방향

| 접근 방향 | 대응하는 FCM 한계 | 핵심 기법 | 대표 학회 |
|----------|-----------------|----------|----------|
| **MQTT QoS 보강** | Best-effort 전달 | QoS 1/2 결합 (손실률 < 0.2%) | IEEE, KIISE |
| **App-Level ACK + 재전송** | ACK 메커니즘 부재 | 3단계 상태 추적 + Exponential Backoff | IEEE SCC |
| **OEM 백그라운드 킬 대응** | Android OEM 간섭 | 멀티채널 Fallback + WorkManager | MobiSys, USENIX |
| **Edge/Fog Computing** | 전달 지연 (Latency) | MEC 기반 지역 캐싱 (RTT 70~85%↓) | IEEE Edge, Nature |
| **RL 기반 전송 시점 최적화** | 알림 피로도 + 전달 실패 | Contextual Bandit (응답률 93.8%) | **UbiComp, CIKM** |
| **보안/프라이버시 강화** | E2E 암호화 미지원 | AES-256 + 최소 페이로드 | USENIX Security |

### 5.2 하이브리드 아키텍처: 학계 합의

**FCM의 "OS 수준 단일 연결" 이점은 대체 불가이므로, FCM을 기본 채널로 유지하면서 보강하는 구조가 현실적이다.**

```
App Server ──▶ FCM (기본 채널)                ──▶ Device
    │              │                                 │
    │         전달 실패 감지                     App-Level ACK
    │              │                                 │
    ├──▶ WebSocket (실시간 보조)               ACK 서버 ◀──┘
    ├──▶ Email Fallback                          │
    └──▶ SMS Fallback (최종)              RL Agent (전송 시점 최적화)
```

### 5.3 BK우수학회 기준 핵심 연구

| 학회 | 연구 | 핵심 성과 |
|------|------|----------|
| **ACM UbiComp 2018** | Nurture (RL 기반 알림 타이밍) | 응답률 93.8% (Contextual Bandit) |
| **ACM CIKM 2022** | Offline RL for Mobile Notifications | 세션 +0.3%, 알림량 -3.49% |
| **IEEE SCC 2014** | Push Service Formal Verification | 메시지 손실 7가지 경로 식별 |
| **USENIX Security 2024** | FCM 페이로드 프라이버시 분석 | 21개 보안 앱의 FCM 데이터 유출 발견 |
| **Nature Scientific Reports 2025** | Fog-Edge 하이브리드 아키텍처 | 실시간 알림 sub-second latency 달성 |

### 5.4 향후 연구 방향 (2025~)

| 방향 | 설명 | 기대 효과 |
|------|------|----------|
| **MQTT over QUIC** | 0-RTT 연결로 핸드셰이크 오버헤드 제거 | 알림 전달 지연 추가 감소 |
| **Federated Learning** | 디바이스 로컬에서 알림 선호도 학습 | 프라이버시 보호 + 개인화 동시 달성 |
| **Age of Information (AoI)** | 알림 "신선도" 정량 측정 프레임워크 | TTL 관리를 넘어선 적시성 최적화 |
| **6G/MEC 초저지연** | Edge에서 sub-millisecond 알림 전달 | 의료·금융 미션크리티컬 알림 실시간 보장 |

[상세: 22편 전체 분석, 논문별 접근법, BK우수학회 매핑 →](academic/fcm-improvement-approaches.md)

---

## 6. 알림 신뢰성 패턴

> **FCM이 수신 확인을 제공하지 않으므로 자체 ACK 시스템이 필수이며, 미확인 알림에 대해서는 에스컬레이션 래더(Push → In-App → Email → SMS)로 단계적 fallback해야 한다.** 단, 과도한 재전송은 앱 삭제로 이어지므로 피로도 관리를 병행해야 한다.
>
> [상세 → 알림 신뢰성 및 사용자 인지 보장 패턴 연구](patterns/reliability-patterns.md)

### 6.1 Application-Level ACK

**Data Message만이 foreground/background 모두에서 `onMessageReceived()` 콜백을 보장한다.** Notification Message는 Background에서 시스템이 직접 처리하므로 ACK을 받을 수 없다.

```
Server ──FCM Data Message──▶ Client App
                                 │
                           onMessageReceived()
                                 │
                           알림 표시 + 로컬 저장
                                 │
                           ACK 전송 ──────▶ Server (상태 기록)
```

- **3단계 상태 추적**: `delivered` → `displayed` → `acted_on`
- **서버 타임아웃**: ACK가 5분 내 미도달 시 미수신으로 간주, 재전송 또는 fallback 트리거
- **Firebase Analytics 한계**: 데이터 지연 최대 24시간, iOS Received/Impressions 추적 불가 → 자체 ACK 시스템 구축 권장

[상세: ACK 구현 패턴, Firestore 스키마, Firebase Analytics 연동 →](patterns/reliability-patterns.md#1-application-level-delivery-confirmation-ack)

### 6.2 리마인더 / 에스컬레이션

**미확인 알림은 단계적으로 채널을 확대하여 전달을 보장한다.** Digest 알림 사용 시 engagement rate 35% 증가, opt-out rate 28% 감소.

```
Level 1: Push Notification (즉시)
    ↓ 5분 미확인
Level 2: In-App 알림 + Push 재전송
    ↓ 30분 미확인
Level 3: Email 발송
    ↓ 2시간 미확인
Level 4: SMS 발송 (최종 수단)
```

| 유형 | Push | 리마인더 | Email/SMS |
|------|------|---------|----------|
| 보안 알림 | 즉시 | 2~5분 | 5분 (SMS 동시) |
| 결제/주문 | 즉시 | 30분 | 24시간 |
| 소셜 활동 | 즉시 | — | 일간 요약 |

[상세: Cron 기반 리마인더, Digest 전략, Smart Timing →](patterns/reliability-patterns.md#2-reminder--re-notification-전략)

### 6.3 클라이언트 사이드 영속성

**서버가 unread count의 권위 소스여야 한다.** 클라이언트만으로 관리하면 멀티 디바이스 간 불일치가 발생한다.

- **In-App Notification Inbox**: Push dismiss 후에도 이력 보관
- **Offline-First 저장**: Room DB(Android)에 저장, 온라인 복귀 시 서버와 배치 동기화
- **Badge 불일치 해결**: Push Payload에 badge 숫자 포함 + 앱 열 때 서버에서 정확한 count 갱신

[상세: Inbox UI 패턴 3가지, 동기화 흐름, 데이터 모델 →](patterns/reliability-patterns.md#3-client-side-알림-영속성)

### 6.4 알림 피로도 방지

**포괄적 알림 설정을 제공하는 앱은 opt-out 43% 감소, engagement 31% 증가.** 피로도 관리 없는 재전송은 역효과를 낳는다.

| 전략 | 내용 |
|------|------|
| **Rate Limiting** | 일일 Push 상한 3~10건, Quiet Hours 22:00~07:00 |
| **Priority 기반 필터링** | Critical은 항상 즉시, Low는 Digest로 묶어 전달 |
| **사용자 선호도 관리** | 유형별 on/off, 채널 선호도, 빈도 조절 |
| **DND 인식** | OS DND 중 큐에 보관, 해제 시 배치 전달 |

[상세: Rate Limiting 구현, Priority 분류, 사용자 설정 항목 →](patterns/reliability-patterns.md#4-알림-피로도-방지)

### 6.5 산업별 Best Practices

**각 산업의 신뢰성 요구 수준이 다르며, 의료 시스템은 30초 단위 에스컬레이션, 금융은 감사 로그 의무화가 특징이다.**

| 산업 | 핵심 패턴 | 특이사항 |
|------|---------|---------|
| **WhatsApp** | WebSocket + 더블 체크 ACK | At-least-once + Idempotent storage |
| **Slack** | 데스크톱 활성 시 모바일 억제 | 95% 사용자가 기본값 사용 → **기본값이 핵심** |
| **의료** | Sub-second latency, 다중 채널 동시 | 임상 알람 80~99%가 non-actionable → Alert Fatigue |
| **금융** | 거래일 종료 전 통지 의무 | 전달 실패 시 우편/팩스 의무, 감사 로그 필수 |

[상세: 산업별 아키텍처, 에스컬레이션 체인, 규제 요구사항 →](patterns/reliability-patterns.md#5-산업별-best-practices)

---

## 7. 메시지 큐 대안 기술

> **FCM 앞단에 Message Queue를 배치하면 트래픽 스파이크 흡수, 자동 재시도, DLQ 실패 추적, 멀티채널 Fallback이 가능해진다.** DexWeaver 프로젝트에는 클라이언트 로컬 Queue + WorkManager 또는 SQS/SNS + FCM 조합이 가장 적합하다.
>
> [상세 → MQ 기반 알림 전송 아키텍처](alternatives/message-queue-comparison.md)

### 7.1 기술 비교: SQS/SNS가 Serverless에 최적

| 기술 | 전송 보장 | 처리량 | 지연 | 알림 적합도 | 운영 복잡도 |
|------|----------|--------|------|-----------|-----------|
| **RabbitMQ** | At-least-once | 중 | 낮음 | ★★★★ | 중 |
| **Kafka** | Exactly-once 가능 | 매우 높음 | 중 | ★★★ | 상 |
| **Redis Streams** | At-least-once | 높음 | 매우 낮음 | ★★★ | 하 |
| **SQS/SNS** | At-least-once ~ Exactly-once | 높음 | 중 | **★★★★★** | 하 |
| **NATS JetStream** | At-least-once ~ Exactly-once | 매우 높음 | 매우 낮음 | ★★★ | 중 |
| **Apache Pulsar** | At-least-once | 매우 높음 | 낮음 | ★★★★ | 상 |

[상세: 각 기술별 아키텍처, ACK 메커니즘, DLQ, 실제 사례 →](alternatives/message-queue-comparison.md#2-기타-message-queue-기술-비교)

### 7.2 하이브리드 아키텍처 (MQ + FCM)

**MQ를 FCM 앞단에 배치하여 best-effort를 at-least-once로 보강한다.**

```
App Server ──▶ Message Queue ──▶ Notification Gateway ──▶ FCM/APNs ──▶ Device
                    │                    │
                   DLQ              Fallback Router
                                   ├── Email
                                   ├── SMS
                                   └── In-App
```

- **Store-and-Forward**: DB 저장(PENDING) → 비동기 전송 → 성공 시 SENT 업데이트
- **Outbox 패턴**: 비즈니스 데이터 변경과 알림 발행의 원자성 보장
- **CQRS + Event Sourcing**: 이벤트 재생으로 누락 알림 재전송 가능 (소규모에는 과한 설계)

[상세: Store-and-Forward, Outbox 패턴, CQRS →](alternatives/message-queue-comparison.md#3-하이브리드-아키텍처)

### 7.3 클라이언트 사이드 Queue + Cron 패턴

**FCM 전달 실패를 클라이언트에서 보완하는 가장 실용적인 방법이다.**

- **Android WorkManager**: 최소 15분 간격 반복, 재부팅 후 유지, Doze 존중
- **iOS BGTaskScheduler**: OS가 실행 시점 최적화, 정확한 주기 보장 불가
- 로컬 SQLite Queue에 미확인 알림 저장 → 주기적 리마인더 → 에스컬레이션

[상세: 로컬 Queue 스키마, 코드 예시, Batching/Digest 전략 →](alternatives/message-queue-comparison.md#4-클라이언트-사이드-message-queue--cron-reminder-패턴)

### 7.4 DexWeaver 프로젝트 적합도

| 접근법 | 적합도 | 이유 |
|--------|--------|------|
| **클라이언트 로컬 Queue + WorkManager** | ★★★★★ | FCM 전달 실패 보완에 가장 실용적 |
| **SQS/SNS + FCM** | ★★★★★ | Serverless와 최적 조합, 운영 부담 최소 |
| **RabbitMQ + FCM** | ★★★★ | 신뢰성 계층 추가, 중간 규모 적합 |
| **Outbox 패턴** | ★★★★ | DB 트랜잭션-알림 원자성 보장 |
| **Kafka/Pulsar** | ★★ | 프로젝트 규모 대비 과한 솔루션 |

---

## 8. 핵심 결론 및 프로젝트 적용

### FCM의 구조적 한계 3가지

1. **FCM은 전달을 보장하지 않는다** — Best-effort이며 MQTT QoS 0 수준
2. **HTTP 200은 전달 확인이 아니다** — FCM 서버 수락일 뿐
3. **수신 확인 메커니즘이 없다** — 앱 레벨에서 직접 구현해야 함

### 가장 큰 위험 요소

1. **Android OEM 간섭** — 전 세계 Android의 ~70%가 중국 OEM, 전달률 20~55%
2. **iOS Silent Push 제한** — Apple 의도적 정책, 우회 불가
3. **토큰 미관리** — 이것만 해결해도 **15%p 개선** (가장 비용 대비 효과 큼)

### 필수 구현 사항

| 우선순위 | 항목 | 근거 | 학술 근거 |
|---------|------|------|----------|
| **P0** | App-Level ACK 시스템 | FCM이 수신 확인을 제공하지 않음 | IEEE SCC 2014: 메시지 손실 7가지 경로 식별 |
| **P0** | Stale 토큰 정리 (월 1회) | 15%p 전달률 개선 | Firebase 공식 데이터 |
| **P1** | Data Message 사용 | Background에서도 ACK 콜백 수신 가능 | FCM 기술 문서 |
| **P1** | Exponential Backoff + Jitter 재전송 | 업계 표준 재시도 패턴 | Amazon SNS 50회 재시도 모델 |
| **P2** | 멀티채널 Fallback (Push → Email → SMS) | 단일 채널 의존은 전달 보장 불가 | DontKillMyApp: OEM 전달률 20~55% |
| **P2** | 알림 피로도 관리 (Rate Limit, Digest) | 과도한 재전송은 앱 삭제로 이어짐 | Systematic Review 2020 |
| **P2** | RL 기반 전송 시점 최적화 | 알림량 3.49%↓, 세션 0.3%↑ | ACM CIKM 2022 Offline RL |
| **P3** | In-App Notification Inbox | Push dismiss 후에도 알림 이력 보관 | WhatsApp/Slack 산업 사례 |
| **P3** | Smart Timing (사용자 활동 패턴 분석) | 적절한 순간 전달 시 응답 시간 49.7% 감소 | ACM UbiComp 2018 Nurture |
| **P3** | E2E 암호화 (앱 레벨) | FCM 서버가 페이로드 열람 가능 | USENIX Security 2024 |

### 학계 제안 개선 로드맵

```
[Phase 1: 즉시 적용 가능]
  App-Level ACK + 3단계 상태 추적 (delivered → displayed → acted_on)
  Exponential Backoff + Jitter 재전송
  토큰 관리 자동화

[Phase 2: 설계 반영]
  멀티채널 Fallback (Push → In-App → Email → SMS)
  WebSocket 보조 채널 (실시간 인앱 전달)
  앱 레벨 E2E 암호화

[Phase 3: 고도화]
  RL 기반 전송 시점 최적화 (Contextual Bandit)
  Edge 기반 알림 캐싱/사전 배치
  Age of Information (AoI) 프레임워크 적용
```

---

## 하위 문서 전체 목록

| 디렉토리 | 파일 | 내용 |
|---------|------|------|
| `fcm/` | [history-and-limitations.md](fcm/history-and-limitations.md) | FCM 등장 배경(Polling→C2DM→GCM→FCM), 기술적 한계 10가지 |
| `fcm/` | [technical-overview.md](fcm/technical-overview.md) | FCM 아키텍처, API, 메시지 유형, 토큰, 전달 보장, 제한사항 |
| `fcm/` | [stability-analysis.md](fcm/stability-analysis.md) | 안정 5케이스 + 불안정 15케이스 분석, OEM별 전달률 |
| `academic/` | [literature-survey.md](academic/literature-survey.md) | 학술 논문 24편 분류 (신뢰성, 인게이지먼트, QoS, ACK, RL) |
| `academic/` | [fcm-improvement-approaches.md](academic/fcm-improvement-approaches.md) | FCM 한계 개선 학술 연구 동향 22편 (MQTT 보강, RL 최적화, Edge, 보안) |
| `patterns/` | [reliability-patterns.md](patterns/reliability-patterns.md) | ACK 구현, 리마인더, 영속성, 피로도 방지, 산업별 사례 |
| `alternatives/` | [message-queue-comparison.md](alternatives/message-queue-comparison.md) | MQ 6종 비교, 하이브리드 아키텍처, 클라이언트 패턴 |
