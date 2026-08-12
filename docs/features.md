# 기능 목록

## 1. 10-slot source board

1~10 슬롯에 영상을 고정 저장한다. 빈 슬롯 자동 배정, 특정 슬롯 교체, 삭제, 업로드 진행률을 지원한다. 각 영상 저장 시 AI metadata와 SVG 썸네일을 함께 만든다.

## 2. 계정별 번호 라우팅

네이버·TikTok·Facebook·Instagram 계정을 연결하고, 계정 카드의 1~10 체크박스로 해당 슬롯 영상의 게시 대상을 고른다. 체크 상태는 `slotNumbers`로 저장한다.

## 3. 예약·전송 작업

예약 시각과 공통 제목·설명·해시태그·공개 범위를 입력하면 계정×슬롯마다 job을 만든다. 동일 영상×계정 조합은 중복 차단한다. scheduler는 due job을 sandbox adapter에 동시에 전달한다.

## 4. 실패와 관찰성

job마다 `progress`, `attempt`, `maxAttempts`, `nextRetryAt`, `lastError`, `logs`를 표시한다. 실패하면 1초부터 지수 백오프로 최대 3회 재시도하고, 수동 재시도 버튼을 제공한다.

## 5. AI·썸네일

OpenAI API 키가 있으면 `lib/ai.js`의 외부 adapter를 사용하고, 키가 없거나 실패하면 파일명 토큰 기반 로컬 fallback을 사용한다. 썸네일은 외부 편집기 없이 SVG로 생성한다.

## 6. 게시 후 관리

mock provider가 조회수·좋아요·댓글을 만들며 통계 갱신, 댓글 답글, 숨김·숨김 해제를 지원한다. `lib/providers.js`에서 실제 OAuth/API adapter로 교체할 수 있다.

## 7. 데스크톱 운영

예약 캘린더, 활동 로그, Windows 로그인 시작·백그라운드 옵션, Electron Builder NSIS/portable 빌드, electron-updater 확인 IPC를 제공한다.

## 8. 계정 로그인 페이지

환경설정 아래에 Instagram, 네이버 클립, TikTok, Facebook 로그인 페이지를 제공한다. 각 페이지는 OAuth 권한과 연결 상태를 서비스별로 표시하고, sandbox에서는 기존 안전한 계정 식별자 연결 화면으로 이어진다.
TikTok 연결은 Facebook 계정이 먼저 연결되어 있어야 하며, 선행 조건이 충족되지 않으면 로그인과 빠른 업로드 경로를 차단한다.
