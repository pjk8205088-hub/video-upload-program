import { TikTokClient } from "../src/index.js";

const client = new TikTokClient({
  userDataDir: ".tiktok-browser",
  browserChannel: "chrome",
  headless: false
});

try {
  await client.start();
  const result = await client.uploadVideos({
    finalize: true,
    videos: [
      {
        filePath: "H:\\대전 동영상\\1.mp4",
        caption: "",
        visibility: "current"
      }
    ]
  });
  console.log(result);
} finally {
  await client.close();
}
