# 동영상 업로드 프로그램 구현 전략

## 현재 구조

- Node 내장 HTTP 서버가 정적 화면과 `/api`를 제공한다.
- 동영상은 스트림으로 `uploads/`에 저장한다.
- 영상·계정·예약 작업은 JSON 컬렉션으로 유지한다.
- Electron이 임시 로컬 포트의 HTTP 서버를 실행하고 BrowserWindow에 로드한다.
- preload는 최소화·최대화·닫기 IPC만 context bridge로 노출한다.

## 프론트엔드

- 데스크톱 작업창 중심의 고정 레이아웃을 사용한다.
- 레드 포인트, 밀도 높은 카드·목록, 상태 태그를 활용한 관리자형 UI다.
- 영상 → SNS 계정은 SVG 선으로 시각화한다.
- YouTube 체크 항목은 입력 상태에 따라 자동 체크하며 법적·정책적 판단이 필요한 항목은 수동으로 남긴다.

## SNS adapter 확장

현재 `POST /api/campaigns`는 공통 콘텐츠와 계정별 `queued` 작업까지만 만든다. 다음 단계에서 provider별 adapter를 붙인다.

- YouTube: Data API 업로드, privacy, category, playlist
- Facebook·Instagram: Graph API 페이지·릴스 게시
- TikTok: Content Posting API
- 네이버: 실제 사용 서비스별 공식 API 범위 확인

각 adapter는 `validate()`, `upload()`, `publish()`, `refreshToken()` 계약으로 통일한다.

## 보안·운영

- 비밀번호를 받지 않는다.
- OAuth access token은 암호화된 서버 저장소에 보관한다.
- 외부 공개 전 HTTPS, CSRF, rate limit, 재시도, 토큰 만료 처리, 업로드 결과 callback을 추가한다.
- 배포 시 `npm run dist:desktop`으로 Windows portable EXE를 생성한다.

## 테스트

- Node 구문 검사와 단위 테스트
- API 수동 검증: 계정 생성, 캠페인 생성, 잘못된 입력
- 브라우저 검증: 파일 업로드, 계정 연결, 연결 맵, YouTube 자동 체크, 다중 계정 예약
- 실제 SNS API를 붙일 때는 플랫폼별 sandbox 계정과 mock adapter를 사용한다.
