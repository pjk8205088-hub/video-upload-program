# 데이터 모델

저장 루트는 `UPLOAD_DESK_DATA_DIR` 아래이며 Electron에서는 `%APPDATA%/upload-desk/storage`입니다.

## Video

```json
{
  "id": "vid_...", "slotNumber": 1, "originalName": "clip.mp4", "storedName": "vid_....mp4",
  "mimeType": "video/mp4", "size": 1234, "status": "ready", "createdAt": "ISO-8601",
  "url": "/uploads/vid_....mp4", "thumbnailUrl": "/thumbnails/vid_....svg",
  "aiMetadata": { "title": "...", "description": "...", "hashtags": ["#영상"], "source": "local-fallback" }
}
```

`slotNumber`는 1~10 사이의 고정 번호다. 교체 시 기존 영상의 미게시 job은 `cancelled`로 바뀐다.

## Account

`id`, `provider`, `displayName`, `handle`, `status`, `mode`, `slotNumbers`, `connectedAt`을 가진다. `slotNumbers`가 해당 계정으로 보낼 영상 번호의 원본이다.

지원 provider: `youtube`, `naver`, `tiktok`, `facebook`, `instagram`.

## Campaign / CampaignJob

Campaign은 공통 게시 정보와 예약 시각을 저장하고, `routes` 및 `jobs`를 가진다. Route는 `{ accountId, slotNumber, videoId }`다.

Job은 `{ id, accountId, provider, handle, slotNumber, videoId, status, progress, attempt, maxAttempts, nextRetryAt, lastError, externalId, analytics, logs }`를 가진다.

Job 상태: `queued` → `uploading` → `published`, 또는 `retrying` → `uploading` → `failed`; 원본 교체·삭제나 예약 취소 시 `cancelled`.

## Comment / Settings / Log

- Comment: provider 댓글 원본, `status`(`visible`/`hidden`), `replies[]`, `jobId`, `accountId`
- Settings: `launchAtStartup`, `startMinimized`, `autoUpdate`, `providerMode`, `maxAttempts`
- Log: `event`, `message`, `meta`, `createdAt`

## 파일

```text
data/videos.json
data/accounts.json
data/campaigns.json
data/comments.json
data/logs.json
data/settings.json
data/thumbnails/{videoId}.svg
uploads/{videoId}.{ext}
```
