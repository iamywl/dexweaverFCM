# Push Notification 신뢰성 및 QoS 관련 학술 연구 조사

> 작성일: 2026-03-19
> 목적: FCM 기반 Push Notification의 전달 신뢰성, 사용자 인게이지먼트, QoS 측정, End-to-End ACK 패턴에 대한 학술 논문 및 기술 조사 결과를 정리한다.

---

## 1. 전달 신뢰성 (Delivery Reliability)

### 1.1 핵심 논문

#### P1. Reliable Push Notification for Mobile Users in Interactive Smart Mobile Applications
- **저자**: Taehun Yang et al.
- **발표**: IoT/센서 관련 학회 Poster
- **핵심 내용**: BLE(Bluetooth Low Energy) beacon 인프라 위에서 이동 중인 모바일 사용자에게 신뢰성 있는 push notification을 전달하는 문제를 다룸. 사용자가 다양한 속도로 이동할 때 적절한 콘텐츠를 신뢰성 있게 전달하는 DCAE(Dynamic Content Adaptation Engine)를 push notification 서버에 적용하여 기존 방식 대비 콘텐츠 전달 성공률을 개선함.
- **프로젝트 관련성**: 네트워크 불안정 환경에서의 전달 성공률 향상 기법으로, DexWeaver의 불안정 네트워크 실험 시나리오와 직접 연관됨.

#### P2. A Prototype Framework for High Performance Push Notifications
- **저자**: ResearchGate 등재 논문
- **발표**: 2017
- **핵심 내용**: 고성능 push notification을 위한 프로토타입 프레임워크 제안. 대규모 메시지 전송 시 성능과 신뢰성을 동시에 확보하는 아키텍처를 다룸.
- **프로젝트 관련성**: 대량 전송 시나리오에서의 성능 벤치마크 설계에 참고 가능.

#### P3. An Approach for Modeling and Analyzing Mobile Push Notification Services
- **저자**: IEEE International Conference on Services Computing, 2014
- **핵심 내용**: 모바일 push notification 서비스의 보안과 신뢰성 취약점을 formal specification과 verification을 통해 분석. 시스템 속성을 이해하고 품질을 보증하기 위한 모델링 기법 제안.
- **프로젝트 관련성**: Push notification 시스템의 신뢰성을 형식적 방법(formal methods)으로 검증하는 접근법 참고 가능.

#### P4. Using Adaptive Heartbeat Rate on Long-Lived TCP Connections
- **저자**: IEEE/ACM Transactions on Networking, 2017
- **핵심 내용**: Push notification 서비스에서 사용하는 long-lived TCP 연결의 heartbeat/keep-alive 간격을 동적으로 조정하는 기법 제안. 배터리 소모와 연결 유지 신뢰성 간의 trade-off를 최적화.
- **프로젝트 관련성**: FCM이 내부적으로 사용하는 persistent connection의 신뢰성 메커니즘을 이해하는 데 도움.

### 1.2 FCM 공식 데이터

| 항목 | 수치 |
|------|------|
| 연결된 디바이스 전달 성공률 | 98% (500ms 이내 전달) |
| 주간 전송량 | 1조 건 이상 |
| HTTP v1 API 응답 SLO | 95%가 350ms 이내 (30일 기준) |
| 실제 렌더링 기준 산업 평균 | 14~48% |

**중요**: FCM 서버 수락(HTTP 200)과 디바이스 실제 수신은 다른 개념이다. FCM 공식 전달률 ~99%는 서버 수락률이며, 실제 디바이스 렌더링 기준 산업 평균은 14~48%로 큰 차이가 있다.

### 1.3 전달 실패 원인

- **Doze 모드**: Android 배터리 절약 모드에서 normal priority 메시지 지연
- **중국 OEM 제한**: Xiaomi, Vivo, Oppo 등에서 백그라운드 프로세스 제한
- **네트워크 단절**: 오프라인 디바이스에 대한 메시지 TTL 만료
- **앱 강제 종료**: 사용자가 앱을 강제 종료한 경우 수신 불가

---

## 2. 사용자 인게이지먼트 및 알림 피로도 (User Engagement & Notification Fatigue)

### 2.1 핵심 논문

#### P5. Effects of Push Notifications on Learner Engagement in a Mobile Learning App
- **저자**: IEEE Conference Publication, 2016
- **핵심 내용**: Push notification이 앱 사용 빈도, 인게이지먼트 시간, 전체 인게이지먼트 비율을 유의미하게 증가시킴. 특히 수신 메시지 관련 알림이 학습자 인게이지먼트를 가장 많이 증가시킴.
- **프로젝트 관련성**: 알림의 종류에 따른 사용자 반응 차이를 이해하는 데 유용.

#### P6. Mobile Apps in Retail: Effect of Push Notification Frequency on App User Behavior
- **저자**: 2021, ResearchGate
- **핵심 내용**: 과도한 알림은 오히려 효과를 감소시킴. 대다수 사용자가 연령대와 관계없이 일일 알림 빈도에 불만을 가지며, 중요한 알림이 불필요한 알림 더미에 묻히는 현상 발생.
- **프로젝트 관련성**: 재전송(retry) 전략 설계 시 알림 피로도를 고려해야 함을 시사.

#### P7. Consumer Acceptance of App Push Notifications: Systematic Review on the Influence of Frequency
- **저자**: 2020, Systematic Review
- **핵심 내용**: Push notification 빈도가 소비자 수용도에 미치는 영향에 대한 체계적 문헌 리뷰. 과도한 빈도는 알림 비활성화 또는 앱 삭제로 이어짐.
- **프로젝트 관련성**: QoS 재전송 정책 설계 시 빈도 제한의 근거.

#### P8. An In-Situ Study of Mobile Phone Notifications
- **저자**: 2016, ResearchGate
- **핵심 내용**: 알림에 대한 응답 시간과 방해 인식은 알림의 표현 방식, 경고 유형, 발신자-수신자 관계, 사용자의 현재 작업 유형/완료도/복잡도에 영향을 받음. **인터럽트 가능한 순간까지 알림 전달을 지연하면 사용자 응답 시간이 49.7% 감소**.
- **프로젝트 관련성**: 알림 전달 타이밍 최적화의 학술적 근거.

#### P9. Exploring User's Experience of Push Notifications: A Grounded Theory Approach
- **저자**: 2022, ResearchGate
- **핵심 내용**: 부적절한 메시지 전달 타이밍, 인식된 가치 부족, 부적절한 콘텐츠, 과도한 빈도는 알림을 침입적이고 성가시며 환영받지 못하게 만듦.
- **프로젝트 관련성**: 사용자 경험 관점에서의 알림 품질 평가.

#### P10. Empowering Individual Preferences in Mobile Notifications
- **저자**: IEEE Access, 2025
- **핵심 내용**: 사용자 주도 알림 수신 모드 설정 시스템 제안 (Immediate, While in Use, On Demand 3가지 모드). 알림 볼륨 감소, 습관적 폰 확인 감소, 스마트폰 중독 점수 및 알림 피로도 감소 효과 입증.
- **프로젝트 관련성**: 사용자 선호도 기반 알림 전달 모드 설계에 참고.

### 2.2 핵심 통계

| 항목 | 수치 |
|------|------|
| 젊은 성인 일일 평균 알림 수 | 60~80건 |
| 헤비 유저 일일 알림 수 | 200건 이상 |
| 적절한 순간 전달 시 응답 시간 감소율 | 49.7% |

---

## 3. QoS 측정 및 평가 (Quality of Service Measurement)

### 3.1 핵심 논문

#### P11. An Exploration of Evaluation Metrics for Mobile Push Notifications
- **저자**: ACM SIGIR 2016 (39th International Conference)
- **핵심 내용**: 소셜 미디어 스트림을 필터링하여 push notification으로 전송하는 시스템의 평가 지표를 탐색. 알림은 **관련성(relevant), 적시성(timely), 참신성(novel)**을 갖춰야 함. TREC 2015 Microblog 평가에서 사용된 지표 분석.
- **프로젝트 관련성**: Push notification QoS 평가 지표 설계의 학술적 기반. DexWeaver의 QoS 평가 프레임워크(03-qos-evaluation-metrics.md)와 직접 연관.

#### P12. Alert Notification as a Service
- **저자**: IEEE Conference Publication, 2014
- **핵심 내용**: 알림 서비스의 서비스화(as-a-Service) 모델 제안. 알림의 품질 보증과 서비스 수준 관리를 다룸.
- **프로젝트 관련성**: 알림 시스템의 서비스 품질 관리 관점 참고.

#### P13. Analysis of Notification Methods with Respect to Mobile System Characteristics
- **저자**: ResearchGate, 2016
- **핵심 내용**: 모바일 시스템 특성(배터리, 네트워크, OS)에 따른 알림 방식 분석. 각 알림 방식의 장단점과 적합한 사용 시나리오를 비교.
- **프로젝트 관련성**: 다양한 네트워크/디바이스 조건에서의 알림 방식 선택 기준.

### 3.2 Push Notification QoS 핵심 지표 (학술 연구 기반)

| 지표 | 설명 | 측정 방법 |
|------|------|-----------|
| Delivery Rate | 전송 대비 실제 수신 비율 | 클라이언트 ACK 콜백 |
| E2E Latency | 서버 전송~디바이스 수신 시간 | NTP 동기화 후 타임스탬프 차이 |
| Message Loss Rate | 전송 후 미수신 비율 | 전송 ID 대조 |
| Notification Relevance | 알림의 관련성/적시성/참신성 | 사용자 설문 또는 CTR |
| User Response Time | 알림 수신~사용자 반응 시간 | 앱 내 이벤트 로깅 |

---

## 4. End-to-End Acknowledgment 패턴

### 4.1 Application-Level ACK 메커니즘

FCM 자체는 디바이스 수신 확인을 제공하지 않으므로, **application-level ACK**이 필수적이다.

#### 4.1.1 기본 패턴

```
[Server] ──notification──→ [FCM] ──push──→ [Device/App]
   │                                           │
   │         ◄──── HTTP ACK callback ──────────┘
   │         (notification_id, timestamp, status)
   │
   └── Delivery Ledger 업데이트
       - notification_id
       - sent_at
       - acked_at
       - status: pending → sent → acknowledged → expired
```

#### 4.1.2 재전송 전략 (Retry with Exponential Backoff)

| 재시도 | 대기 시간 | 누적 시간 |
|--------|-----------|-----------|
| 1차 | 30초 | 30초 |
| 2차 | 60초 | 1분 30초 |
| 3차 | 120초 | 3분 30초 |
| 4차 | 240초 | 7분 30초 |
| 최대 | 제한 설정 필요 | - |

**Jittering**: 재시도 간격에 랜덤 변동을 추가하여 retry amplification(동시 재시도 폭주)을 방지.

#### 4.1.3 플랫폼별 ACK 메커니즘

**FCM (Firebase Cloud Messaging)**:
- FCM 자체적으로는 디바이스 수신 확인 미제공
- 앱 레벨에서 수신 시 서버로 ACK 전송 필요
- HTTP 200은 FCM 서버 수락만 의미, 디바이스 전달 보장 아님
- 실패 시 10초 이상 대기 후 재시도, 60분 exponential backoff 후 폐기 고려

**APNs (Apple Push Notification service)**:
- 디바이스가 알림을 수신하고 표시하면 서버에 acknowledgment 전송
- 30초 내 ACK 미수신 시 서버가 재전송

**Amazon SNS**:
- Backoff phase: 10회 재시도 (1~60초 exponential delay)
- Post-backoff phase: 35회 재시도 (60초 고정 간격)
- 총 50회 전달 시도 후 폐기

### 4.2 Negative Acknowledgment (NACK)

NACK은 메시지 처리 불가를 신호하는 메커니즘으로, 다음과 같은 상황에서 사용:
- 오류 발생
- 리소스 제약
- 데이터 손상

NACK은 데이터 무결성과 시스템 견고성 유지에 필수적이며, 메시지를 재처리 큐로 이동시키는 트리거로 활용됨.

---

## 5. Store-and-Forward 및 Message Queuing 패턴

### 5.1 핵심 논문

#### P14. Towards a More Reliable Store-and-forward Protocol for Mobile Text Messages
- **저자**: 2018, ResearchGate
- **핵심 내용**: SMS 브로커를 통한 모바일 텍스트 메시지 전송에서 기존 프로토콜이 신뢰성을 위해 설계되지 않아 메시지 유실이 발생하는 문제를 지적. 신뢰성 향상을 위한 새로운 프로토콜 제안.
- **프로젝트 관련성**: Store-and-forward 기반 메시지 전달의 신뢰성 한계와 개선 방향.

#### P15. A Survey of Distributed Message Broker Queues
- **저자**: Vineet John, 2017, arXiv
- **핵심 내용**: RabbitMQ, Kafka, ActiveMQ 등 분산 메시지 브로커의 비교 분석. QoS 수준별 메시지 전달 보장 (reliable delivery, guaranteed delivery) 기능 비교.
- **프로젝트 관련성**: 서버 측 메시지 큐 선택 시 QoS 요구사항과의 매칭.

#### P16. A Comparative Evaluation of AMQP and MQTT Protocols over Unstable and Mobile Networks
- **저자**: 2015, ResearchGate
- **핵심 내용**: 불안정한 모바일 네트워크 환경에서 AMQP와 MQTT 프로토콜의 신뢰성 비교. 연결 끊김 시 메시지 큐에 보관 후 재연결 시 전달하는 메커니즘 테스트. 일부 프로토콜만 모든 메시지를 전달하는 데 성공.
- **프로젝트 관련성**: 불안정 네트워크 시나리오에서의 프로토콜별 메시지 손실률 비교 데이터.

### 5.2 MQTT QoS 레벨

| QoS 레벨 | 이름 | 설명 | 메시지 손실률 |
|-----------|------|------|--------------|
| 0 | At most once | Fire and forget | 손실 가능 |
| 1 | At least once | ACK 기반, 중복 가능 | < 0.2% |
| 2 | Exactly once | 4-way handshake | 손실 없음 (오버헤드 최대) |

#### P17. Secure Push Notification Service Based on MQTT Protocol for Mobile Platforms
- **저자**: Carlos Silva Villafuerte et al., 2017
- **핵심 내용**: MQTT 프로토콜 기반의 보안 push notification 서비스 제안. MQTT의 경량성과 QoS 레벨을 활용하여 저대역폭/고지연 환경에서의 신뢰성 확보.
- **프로젝트 관련성**: FCM 대안으로서의 MQTT 기반 알림 시스템 아키텍처 참고.

#### P18. Design and Implementation of Push Notification System Based on the MQTT Protocol
- **저자**: 2014, ResearchGate
- **핵심 내용**: MQTT 프로토콜 기반 push notification 시스템의 설계와 구현. 클라이언트-서버 간 persistent connection 관리와 메시지 전달 보장 메커니즘.
- **프로젝트 관련성**: 자체 push notification 시스템 구축 시 참고 아키텍처.

---

## 6. 강화학습 기반 알림 최적화 (RL-based Notification Optimization)

### 6.1 핵심 논문

#### P19. Nurture: Notifying Users at the Right Time Using Reinforcement Learning
- **저자**: ACM UbiComp 2018
- **핵심 내용**: 강화학습 기반으로 사용자 컨텍스트에 적합한 알림 전송 시점을 자동 식별하는 Nurture 시스템 제안. 사용자의 현재 활동, 위치, 시간대 등을 고려하여 최적 전달 시점 결정.
- **프로젝트 관련성**: 알림 전달 시점 최적화를 통한 QoS 향상 가능성.

#### P20. Offline Reinforcement Learning for Mobile Notifications
- **저자**: Yiping Yuan et al., ACM CIKM 2022
- **핵심 내용**: 알림 전달 시점 최적화를 MDP(Markov Decision Process)로 정형화. 오프라인 강화학습 프레임워크를 통해 sequential notification 결정을 최적화하여 장기적 사용자 인게이지먼트 향상.
- **프로젝트 관련성**: 데이터 기반 알림 전달 정책 최적화의 이론적 기반.

#### P21. Multi-objective Optimization of Notifications Using Offline Reinforcement Learning
- **저자**: 2022, arXiv
- **핵심 내용**: 알림 선택과 적절한 순간 식별을 위한 두 개의 RL 모델을 동시에 사용. 장기적 컨텍스트와 순간적 컨텍스트 변화를 각각 포착.
- **프로젝트 관련성**: 다목적 최적화 관점에서의 알림 전략 설계.

#### P22. Machine Learning Approach to Manage Adaptive Push Notifications for Improving User Experience
- **저자**: ACM MobiQuitous 2020
- **핵심 내용**: 지도 학습(supervised ML) 기반 적응형 알림 시스템이 클릭률(CTR)을 유의미하게 향상시킴을 입증.
- **프로젝트 관련성**: ML 기반 알림 최적화의 실증적 효과 데이터.

---

## 7. 멀티채널 Fallback 전략

### 7.1 아키텍처 패턴

Push notification 전달 실패 시 대체 채널로 에스컬레이션하는 멀티채널 전략:

```
[1차] Push Notification (최고 인게이지먼트)
    │
    ├── 전달 실패 또는 미확인 (Grace Period: 2~5분)
    │
[2차] In-App Messaging (앱 실행 시 표시)
    │
    ├── 미확인 지속
    │
[3차] Email (상세 콘텐츠 전달)
    │
    ├── 미확인 지속 (Critical 메시지인 경우)
    │
[4차] SMS (최고 전달률, 최후 수단)
```

### 7.2 설계 원칙

| 원칙 | 설명 |
|------|------|
| Grace Period | 메시지 긴급도에 따라 2~5분 대기 후 fallback |
| Idempotent Delivery | 중복 전송 방지를 위한 멱등성 보장 |
| User Preference | 사용자 선호 채널 우선 적용 |
| Cost-Optimized Routing | 비용 효율적 채널 순서 |
| Delivery Ledger | 모든 메시지의 retry/채널별 상태 추적 |

### 7.3 전달 보장 수준

| 수준 | 설명 |
|------|------|
| At-least-once | 모든 알림이 최소 1회 전송됨을 보장 |
| Exactly-once | 중복 방지와 신뢰성을 동시에 보장 |

---

## 8. 보안 및 무결성 (Security & Integrity)

#### P23. When Push Comes to Shove: Empirical Analysis of Web Push Implementations in the Wild
- **저자**: ACM ACSAC 2023 (39th Annual Computer Security Applications Conference)
- **핵심 내용**: 실제 운영 중인 Web Push 구현의 보안 취약점을 대규모 실증 분석. Push notification 시스템의 보안 위험과 개선 방향 제시.
- **프로젝트 관련성**: Push notification 시스템의 보안 고려사항.

#### P24. DaPanda: Detecting Aggressive Push Notifications in Android
- **저자**: ACM/IEEE ASE 2019 (34th International Conference on Automated Software Engineering)
- **핵심 내용**: 글로벌 모바일 앱 생태계에서 공격적인(aggressive) push notification을 대규모로 탐지하고 특성화하는 최초의 연구.
- **프로젝트 관련성**: 과도한 알림 전송의 탐지 및 방지 기준.

---

## 9. 종합 시사점 및 DexWeaver 프로젝트 적용 방안

### 9.1 핵심 교훈

1. **FCM 서버 수락 != 디바이스 전달**: HTTP 200은 FCM 서버 수락만 의미하므로 반드시 application-level ACK을 구현해야 함
2. **Exponential Backoff + Jittering**: 재전송 시 지수적 대기 + 랜덤 변동이 업계 표준
3. **알림 피로도 관리 필수**: 재전송 정책이 과도한 알림으로 이어지지 않도록 빈도 제한 설정
4. **멀티채널 Fallback**: 단일 채널 의존은 전달 보장 불가, 에스컬레이션 전략 필요
5. **적절한 순간 전달**: 인터럽트 가능한 순간에 전달하면 응답 시간 49.7% 개선
6. **MQTT QoS 참고**: QoS 레벨 0/1/2의 trade-off가 push notification 설계에도 적용 가능

### 9.2 DexWeaver QoS 평가에 직접 활용 가능한 지표

| 기존 지표 (03-qos-evaluation-metrics.md) | 학술 연구 보완 사항 |
|------------------------------------------|---------------------|
| M1. 전송 성공률 | MQTT QoS 1 기준 < 0.2% 손실률을 벤치마크로 활용 |
| M2. 전송 지연시간 | FCM SLO: 95% < 350ms (API), 실제 E2E는 Doze/OEM 영향 |
| M3. 메시지 손실률 | Store-and-forward 프로토콜 비교 연구 데이터 참고 |
| 신규 제안: 사용자 응답 시간 | 알림 수신~사용자 반응 시간 (P8 연구 기반) |
| 신규 제안: 알림 관련성 점수 | SIGIR 2016 연구의 relevance/timeliness/novelty 프레임워크 |

---

## 참고 문헌 (References)

### 전달 신뢰성
- [Reliable Push Notification for Mobile Users in Interactive Smart Mobile Applications](https://www.researchgate.net/profile/Taehun-Yang/publication/325415954)
- [A Prototype Framework for High Performance Push Notifications](https://www.researchgate.net/publication/317058597)
- [An Approach for Modeling and Analyzing Mobile Push Notification Services (IEEE 2014)](https://ieeexplore.ieee.org/document/6930601)
- [Using Adaptive Heartbeat Rate on Long-Lived TCP Connections (IEEE/ACM ToN 2017)](https://dl.acm.org/doi/abs/10.1109/TNET.2017.2774275)
- [Understanding FCM Message Delivery on Android (Firebase Blog 2024)](https://firebase.blog/posts/2024/07/understand-fcm-delivery-rates/)
- [Best Practices when Sending FCM Messages at Scale](https://firebase.google.com/docs/cloud-messaging/scale-fcm)

### 사용자 인게이지먼트 및 알림 피로도
- [Effects of Push Notifications on Learner Engagement (IEEE 2016)](https://ieeexplore.ieee.org/document/7756930/)
- [Mobile Apps in Retail: Effect of Push Notification Frequency](https://www.researchgate.net/publication/351932011)
- [Consumer Acceptance of App Push Notifications: Systematic Review](https://www.researchgate.net/publication/343658086)
- [An In-Situ Study of Mobile Phone Notifications](https://www.researchgate.net/publication/291009197)
- [Exploring User's Experience of Push Notifications: A Grounded Theory Approach](https://www.researchgate.net/publication/358869000)
- [Empowering Individual Preferences in Mobile Notifications (IEEE Access 2025)](https://ieeexplore.ieee.org/iel8/6287639/10820123/10916668.pdf)
- [Alert Now or Never: Understanding and Predicting Notification Preferences (ACM TOCHI)](https://dl.acm.org/doi/full/10.1145/3478868)

### QoS 측정 및 평가
- [An Exploration of Evaluation Metrics for Mobile Push Notifications (ACM SIGIR 2016)](https://dl.acm.org/doi/10.1145/2911451.2914694)
- [Alert Notification as a Service (IEEE 2014)](https://ieeexplore.ieee.org/document/6859584/)
- [Analysis of Notification Methods with Respect to Mobile System Characteristics](https://www.researchgate.net/publication/300337924)

### Store-and-Forward / Message Queuing
- [Towards a More Reliable Store-and-forward Protocol for Mobile Text Messages](https://www.researchgate.net/publication/326760677)
- [A Survey of Distributed Message Broker Queues (arXiv 2017)](https://arxiv.org/pdf/1704.00411)
- [A Comparative Evaluation of AMQP and MQTT Protocols over Unstable and Mobile Networks](https://www.researchgate.net/publication/282914203)
- [Secure Push Notification Service Based on MQTT Protocol](https://www.researchgate.net/publication/321534381)
- [Design and Implementation of Push Notification System Based on MQTT Protocol](https://www.researchgate.net/publication/266650239)

### 강화학습 기반 최적화
- [Nurture: Notifying Users at the Right Time Using RL (ACM UbiComp 2018)](https://dl.acm.org/doi/10.1145/3267305.3274107)
- [Offline Reinforcement Learning for Mobile Notifications (ACM CIKM 2022)](https://dl.acm.org/doi/10.1145/3511808.3557083)
- [Multi-objective Optimization of Notifications Using Offline RL (arXiv 2022)](https://arxiv.org/abs/2207.03029)
- [ML Approach to Manage Adaptive Push Notifications (ACM MobiQuitous 2020)](https://dl.acm.org/doi/abs/10.1145/3448891.3448956)

### 보안
- [When Push Comes to Shove: Empirical Analysis of Web Push (ACM ACSAC 2023)](https://dl.acm.org/doi/10.1145/3627106.3627186)
- [DaPanda: Detecting Aggressive Push Notifications (ACM/IEEE ASE 2019)](https://dl.acm.org/doi/abs/10.1109/ASE.2019.00017)

### 멀티채널 Fallback
- [Push Notification Fallbacks: Email, SMS & Slack Integration (Courier)](https://www.courier.com/blog/push-notification-fallbacks-ensuring-message-delivery-with-email-slack-sms)
- [Amazon SNS Message Delivery Retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)
- [Energy Efficient Scheduling for Mobile Push Notifications (EAI 2015)](https://dl.acm.org/doi/10.4108/eai.22-7-2015.2260067)
