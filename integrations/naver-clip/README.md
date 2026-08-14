# 네이버 클립 연동 모듈

다른 Node.js 프로젝트에서 네이버 클립 프로필·게시물 주소를 읽고, 동영상 업로드부터 최종 등록까지 실행할 수 있는 모듈입니다.

## 포함된 기능

- 내 클립 프로필 주소와 현재 게시된 클립 3개의 주소
- 로컬 동영상 경로 검증
- 네이버 로그인 상태 확인
- 로그인되지 않았으면 사용자가 열린 브라우저에서 직접 로그인할 때까지 대기
- 여러 동영상 업로드
- 설명, 카테고리, 공개 상태 설정
- `등록` 실행 및 콘텐츠 목록에서 게시 상태 확인

비밀번호, 인증번호, 쿠키는 코드에 넣지 않습니다. 첫 실행 때 전용 브라우저 창에서 직접 로그인하면 `userDataDir`에 해당 브라우저의 로그인 상태가 유지됩니다.

## 설치

```powershell
cd C:\path\to\your-project
npm install playwright
npx playwright install chromium
```

이 폴더를 프로젝트 안에 복사하거나, 로컬 패키지로 설치합니다.

```powershell
npm install "C:\path\to\naver-clip-integration"
```

## 프로필과 게시물 주소만 사용하기

```js
import {
  NAVER_CLIP_PROFILE_URL,
  PUBLISHED_CLIPS,
  naverClipAccount
} from "naver-clip-integration";

console.log(NAVER_CLIP_PROFILE_URL);
console.table(PUBLISHED_CLIPS);
console.log(naverClipAccount.profileName);
```

## 동영상 업로드 후 최종 등록하기

```js
import { NaverClipClient } from "naver-clip-integration";

const client = new NaverClipClient({
  userDataDir: ".naver-clip-browser",
  headless: false
});

try {
  await client.start();

  const result = await client.uploadVideos({
    finalize: true,
    videos: [
      {
        filePath: "H:\\대전 동영상\\1.mp4",
        caption: "치어리더 공연 영상 1",
        category: ["프로스포츠", "야구"],
        visibility: "public"
      },
      {
        filePath: "H:\\대전 동영상\\2.mp4",
        caption: "2025 KBO 치어리더 Top 5",
        category: ["프로스포츠", "야구"],
        visibility: "public"
      }
    ]
  });

  console.log(result);
} finally {
  await client.close();
}
```

## 외부 프로젝트에서 전달할 값

각 동영상은 다음 형식입니다.

```js
{
  filePath: "동영상의 절대 경로",
  caption: "네이버 클립에 표시할 설명",
  category: ["대분류", "소분류"],
  visibility: "public" // public, private, current 중 하나
}
```

- `finalize: true`가 기본 동작이며 최종 `등록`까지 진행합니다.
- 카테고리는 임의로 만들지 않습니다. 외부 프로젝트가 실제 카테고리를 전달해야 합니다.
- `finalize: false`이면 업로드 후 임시 상태로 두고 등록하지 않습니다.
- 네이버 화면 구조가 변경되면 `src/naver-clip-client.js`의 접근성 이름 기반 선택자를 조정해야 할 수 있습니다.
