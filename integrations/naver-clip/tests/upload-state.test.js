import test from "node:test";
import assert from "node:assert/strict";
import { classifyUploadState } from "../src/index.js";

const draftUrl = "https://clipcreators.naver.com/web/draft/358318";
const fileName = "naver-clip-live-test.mp4";

test("upload state is processing while Naver is encoding the draft", () => {
  assert.equal(classifyUploadState({
    url: draftUrl,
    bodyText: `${fileName} 동영상 인코딩 진행 중 48%`,
    fileName,
    playable: false
  }), "processing");
});

test("upload state is ready when encoding text is gone and playback is available", () => {
  assert.equal(classifyUploadState({
    url: draftUrl,
    bodyText: `${fileName} 00:15 등록`,
    fileName,
    playable: true
  }), "ready");
});

test("upload state reports Naver processing failures", () => {
  assert.equal(classifyUploadState({
    url: draftUrl,
    bodyText: `${fileName} 인코딩 실패`,
    fileName,
    playable: false
  }), "failed");
});

test("upload state does not finish before the draft page is created", () => {
  assert.equal(classifyUploadState({
    url: "https://clipcreators.naver.com/web/upload",
    bodyText: fileName,
    fileName,
    playable: true
  }), "waiting");
});
