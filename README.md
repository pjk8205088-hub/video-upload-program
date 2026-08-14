# Upload Desk

Windows용 10-slot 멀티 SNS 영상 게시 보드입니다. 영상 원본을 1~10번 슬롯에 고정하고, SNS 계정별 번호 체크만으로 게시·예약 경로를 만들 수 있습니다.

## 실행

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000`을 엽니다. Electron 데스크톱 앱은 다음으로 실행합니다.

```bash
npm run start:desktop
```

## 기능

- MP4, MOV, WebM, MKV 영상 10개 고정 슬롯 저장, 교체, 삭제
- 각 SNS 계정별 1~10 번호 체크 라우팅과 저장된 체크 상태
- AI 제목·설명·해시태그 생성: `OPENAI_API_KEY`가 있으면 OpenAI adapter, 없거나 실패하면 로컬 규칙 기반 fallback
- 업로드 파일명과 슬롯 번호를 사용한 자동 SVG 썸네일 생성
- 계정×슬롯별 독립 job, 동시 sandbox 전송, 진행률·시도 횟수·상태·로그
- 중복 업로드 방지, 실패 시 1초→2초→4초 지수 백오프, 수동 재시도
- 게시 후 mock 조회수·좋아요·댓글 통계, 댓글 답글·숨김·숨김 해제
- 예약 캘린더, Windows 시작 프로그램/백그라운드 옵션, Electron Builder NSIS/portable 설정
- `electron-updater` 기반 자동 업데이트 확인 지점

현재 외부 SNS OAuth 자격 증명은 연결하지 않았습니다. `lib/providers.js`의 `ProviderAdapter`가 실제 API 연결 경계이며, 기본 구현은 sandbox 결과를 반환합니다.

## 네이버 클립 브라우저 연동

`integrations/naver-clip`에는 네이버 클립 로그인 확인, 다중 영상 업로드, 카테고리·공개 설정, 최종 등록 확인을 담당하는 독립 모듈이 포함되어 있습니다. 루트 패키지의 로컬 의존성으로 연결되어 있으므로 설치 후 CommonJS 코드에서는 동적 import로 사용할 수 있습니다.

```bash
npm install
npx playwright install chromium
```

```js
const { NaverClipClient } = await import('naver-clip-integration');

const client = new NaverClipClient({
  userDataDir: '.naver-clip-browser',
  headless: false
});

await client.start();
const result = await client.uploadVideos({
  finalize: true,
  videos: [{
    filePath: 'H:\\대전 동영상\\1.mp4',
    caption: '치어리더 공연 영상 1',
    category: ['프로스포츠', '야구'],
    visibility: 'public'
  }]
});
await client.close();
```

처음 실행할 때 열린 브라우저에서 사용자가 직접 로그인합니다. 비밀번호, 인증번호, 쿠키는 코드에 저장하지 않습니다. 카테고리는 실행하는 프로젝트가 명시적으로 전달해야 하며 `finalize: true`이면 최종 등록까지 진행합니다.

## 빌드

```bash
npm run dist:desktop
```

NSIS 설치 프로그램과 portable EXE를 `dist/`에 만듭니다. 자동 업데이트를 배포하려면 `package.json`의 GitHub publish owner/repo를 실제 릴리스 저장소로 바꾸고 Electron Builder 환경 변수를 설정하세요.

## 테스트

```bash
npm test
```

통합 테스트는 임시 저장소에서 슬롯 업로드, 라우팅, 중복 차단, sandbox 게시, 통계·댓글, 실패 후 재시도를 검증합니다.
