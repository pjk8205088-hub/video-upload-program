import test from "node:test";
import assert from "node:assert/strict";
import { classifyUploadState } from "../src/index.js";

const draftUrl = "https://clipcreators.naver.com/web/draft/358318";
const fileName = "naver-clip-live-test.mp4";

test("Naver Clip draft remains processing while encoding", () => {
  assert.equal(classifyUploadState({
    url: draftUrl,
    bodyText: `${fileName} 동영상 인코딩 진행 중 48%`,
    fileName,
    playable: false
  }), "processing");
});

test("Naver Clip draft becomes ready when playback is available", () => {
  assert.equal(classifyUploadState({
    url: draftUrl,
    bodyText: `${fileName} 00:15 등록`,
    fileName,
    playable: true
  }), "ready");
});

test("Naver Clip processing failure is detected", () => {
  assert.equal(classifyUploadState({
    url: draftUrl,
    bodyText: `${fileName} 인코딩 실패`,
    fileName,
    playable: false
  }), "failed");
});

test("Naver Clip upload page is not mistaken for a ready draft", () => {
  assert.equal(classifyUploadState({
    url: "https://clipcreators.naver.com/web/upload",
    bodyText: fileName,
    fileName,
    playable: true
  }), "waiting");
});
