# 문서 디렉토리 구조

## [research/](research/) — 기술 조사 및 학술 연구

> [총괄 요약 (README)](research/README.md) — 전체 연구 내용을 한눈에 파악할 수 있는 인덱스

| 디렉토리 | 파일 | 내용 |
|---------|------|------|
| `fcm/` | `technical-overview.md` | FCM 아키텍처, API, 메시지 유형, 토큰, 전달 보장, 제한사항 |
| `fcm/` | `stability-analysis.md` | FCM 안정 5케이스 + 불안정 15케이스 분석, OEM별 전달률 |
| `academic/` | `literature-survey.md` | 학술 논문 24편 (신뢰성, 인게이지먼트, QoS, ACK, RL) |
| `patterns/` | `reliability-patterns.md` | ACK 구현, 리마인더, 영속성, 피로도 방지, 산업별 사례 |
| `alternatives/` | `message-queue-comparison.md` | MQ 6종 비교, 하이브리드 아키텍처, 클라이언트 패턴 |

## design/ — 실험 설계 및 평가 체계

| 파일 | 내용 |
|------|------|
| `01-qos-evaluation-metrics.md` | 8개 QoS 평가 지표 (M1~M8) 정의 |
| `02-experiment-design.md` | 4단계 실험 설계 (기준선 + 15개 불안정 요인 검증) |
| `03-evaluation-metrics.md` | QoS 지표 상세 명세 (계산 방법, 측정 단위, 코드 구현 가이드) |
| `04-fcm-scenarios.md` | FCM 전송 시나리오 분석 (유니캐스트, 멀티캐스트, 토픽, 조건부) |
| `05-reliability-guide.md` | QoS 레벨별 신뢰성 메커니즘 구현 가이드 |

## plan/ — 개발 계획 및 진행 보고

| 파일 | 내용 |
|------|------|
| `01-development-plan.md` | DexWeaver FCM 전체 개발 로드맵 |
| `02-serverless-implementation-plan.md` | 서버리스 아키텍처 전환 계획 (Firebase Cloud Functions) |
| `03-serverless-dev-plan.md` | Flutter iOS + Cloud Functions 구체적 개발 계획 |
| `04-setup-progress-report.md` | 환경 구축 진행 보고 (아키텍처 반복, 최종 결정) |
| `dev-plan.csv` | 4개 Phase 전체 태스크 스프레드시트 |
| `progress-report.md` | 현재 진행 상황 보고서 (기술 스택, 구현 현황) |

## results/ — 실험 결과 및 분석

| 파일 | 내용 |
|------|------|
| `01-server-to-phone-report.md` | 서버→디바이스 전송 실험 분석 (16개 시나리오) |
| `server-to-phone-raw.csv` | 서버→디바이스 실험 원시 데이터 |
| `server-to-phone-results.json` | 서버→디바이스 실험 결과 JSON |
| `server-to-phone-summary.csv` | 서버→디바이스 실험 요약 |
| `02-additional-report.md` | 운영 불안정 요인 4가지 실험 분석 |
| `additional-raw.csv` | 추가 실험 원시 데이터 |
| `additional-results.json` | 추가 실험 결과 JSON |
| `additional-summary.csv` | 추가 실험 요약 |
| `03-qos-metrics-report.md` | QoS 지표 8개 측정 결과 비교 분석 |
| `04-notification-reliability-research-report.md` | 알림 신뢰성 종합 연구 보고서 |
| `experiment-results.json` | 기본 실험 결과 JSON |
| `ttl-rerun-results.json` | TTL 재실험 결과 JSON |

## presentation/ — 발표 및 보고서 파일

| 파일 | 내용 |
|------|------|
| `DexWeaver_FCM_QoS_발표자료.pptx` | 프로젝트 발표 자료 |
| `DexWeaver_FCM_QoS_연구보고서.docx` | 프로젝트 연구 보고서 |
