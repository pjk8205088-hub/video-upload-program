import {
  NAVER_CLIP_PROFILE_URL,
  NaverClipClient,
  PUBLISHED_CLIPS
} from "../src/index.js";

console.log("내 네이버 클립:", NAVER_CLIP_PROFILE_URL);
console.log("이미 게시된 클립:", PUBLISHED_CLIPS.map(({ title, url }) => ({ title, url })));

const client = new NaverClipClient({
  // 첫 실행 때 열린 브라우저에서 직접 로그인합니다.
  // 이후 로그인 상태는 이 폴더에 유지됩니다.
  userDataDir: ".naver-clip-browser",
  headless: false
});

try {
  await client.start();
  await client.uploadVideos({
    finalize: true,
    videos: [
      {
        filePath: "H:\\대전 동영상\\1.mp4",
        caption: "치어리더 공연 영상 1",
        // 사용 전에 원하는 카테고리로 바꾸세요.
        category: ["프로스포츠", "야구"],
        visibility: "public"
      }
    ]
  });
} finally {
  await client.close();
}
