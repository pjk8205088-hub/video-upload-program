import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRegistrationState,
  classifyUploadState,
  normalizeCreatorText
} from "../src/index.js";

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

test("unsupported no-sandbox warning does not interfere with upload state", () => {
  const warning = "지원되지 않는 명령줄 플래그(--no-sandbox)를 사용 중이므로 안정성과 보안에 문제가 발생합니다.";
  assert.equal(normalizeCreatorText(`${warning}\n${fileName} 등록`), `${fileName} 등록`);
  assert.equal(classifyUploadState({
    url: draftUrl,
    bodyText: `${warning}\n카테고리 등록`,
    fileName,
    playable: true
  }), "ready");
});

test("public registration requires the video in the content list", () => {
  assert.equal(classifyRegistrationState({
    url: "https://clipcreators.naver.com/web/contents/clips",
    bodyText: "내 콘텐츠 등록 완료",
    itemText: "새 쇼핑 클립 오늘",
    visibility: "public"
  }), "published");
});

test("success message alone is not treated as final registration", () => {
  assert.equal(classifyRegistrationState({
    url: "https://clipcreators.naver.com/web/contents/clips",
    bodyText: "등록 완료",
    itemText: "",
    visibility: "public"
  }), "uncertain");
});

test("private registration is verified from the content list state", () => {
  assert.equal(classifyRegistrationState({
    url: "https://clipcreators.naver.com/web/contents/clips",
    bodyText: "내 콘텐츠",
    itemText: "새 쇼핑 클립 비공개",
    visibility: "private"
  }), "private");
});

test("registration failure is detected before content verification", () => {
  assert.equal(classifyRegistrationState({
    url: draftUrl,
    bodyText: "등록 오류가 발생했습니다.",
    itemText: "",
    visibility: "public"
  }), "failed");
});
