import { FacebookClient } from "../src/index.js";

const client = new FacebookClient({
  userDataDir: ".facebook-browser",
  headless: false
});

try {
  await client.start();
  const result = await client.uploadVideos({
    finalize: true,
    videos: [
      {
        filePath: "H:\\대전 동영상\\1.mp4",
        caption: ""
      }
    ]
  });
  console.log(result);
} finally {
  await client.close();
}
