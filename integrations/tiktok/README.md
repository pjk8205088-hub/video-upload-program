# TikTok 연동 모듈

Playwright의 영구 브라우저 프로필을 사용해 TikTok Studio에 동영상을 업로드하고 게시 결과 URL을 확인하는 모듈입니다.

## 준비

```powershell
npm install
npx playwright install chromium
```

첫 실행 시 열린 일반 Chrome 창에서 사용자가 직접 로그인합니다. 비밀번호, 인증 코드, 쿠키를 코드에 입력하거나 저장하지 않습니다. 로그인 세션은 지정한 전용 `userDataDir`에 유지됩니다.

## 사용

```js
import { TikTokClient } from "tiktok-integration";

const client = new TikTokClient({
  userDataDir: ".tiktok-browser",
  browserChannel: "chrome",
  headless: false
});

try {
  await client.start();
  const result = await client.uploadVideos({
    finalize: true,
    videos: [{
      filePath: "C:\\videos\\clip.mp4",
      caption: "영상 설명 #태그",
      visibility: "current"
    }]
  });
  console.log(result);
} finally {
  await client.close();
}
```

`visibility`은 `public`, `private`, `friends`, `current` 중 하나입니다. `current`는 TikTok Studio의 현재 기본값을 그대로 사용합니다. 게시 성공은 콘텐츠 목록에서 새 `/video/{id}` URL이 확인될 때만 반환됩니다.

`browserChannel`의 기본값은 설치된 일반 Chrome을 뜻하는 `chrome`입니다. 전용 `userDataDir`을 사용하므로 현재 열려 있는 개인 Chrome의 쿠키나 프로필을 읽지 않습니다. Playwright 번들 브라우저를 쓰려면 `chromium`으로 설정하세요.
