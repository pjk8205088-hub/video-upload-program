# 동영상 업로드 프로그램 API 명세

Base URL: `/api`

## GET /videos

저장된 영상 목록을 반환한다.

## POST /videos

동영상 바이너리를 스트리밍 저장한다.

- Headers: `X-File-Name`, `X-File-Type`, `X-File-Size`
- 성공 `201`: `{ "video": { "id": "...", "originalName": "...", "status": "ready" } }`
- 실패: `400 INCOMPLETE_UPLOAD`, `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_VIDEO`, `500 UPLOAD_FAILED`

## DELETE /videos/:id

영상 원본과 메타데이터를 삭제한다.

- 성공 `200`: `{ "deleted": "..." }`
- 실패 `404 VIDEO_NOT_FOUND`

## GET /accounts

```json
{ "accounts": [{ "id": "...", "provider": "youtube", "displayName": "브랜드 공식 채널", "handle": "@brand", "status": "connected" }] }
```

## POST /accounts

```json
{ "provider": "youtube", "displayName": "브랜드 공식 채널", "handle": "@brand" }
```

- 성공 `201`: 저장된 account 객체
- 실패: `400 UNSUPPORTED_PROVIDER`, `400 ACCOUNT_FIELDS_REQUIRED`
- 현재는 개발 모드 메타데이터 저장이며, 실서비스에서는 OAuth authorization code를 서버에서 교환한다.

## DELETE /accounts/:id

- 성공 `200`: `{ "deleted": "..." }`
- 실패 `404 ACCOUNT_NOT_FOUND`

## GET /campaigns

예약 작업과 계정별 job 목록을 반환한다.

## POST /campaigns

```json
{
  "videoId": "video-id",
  "title": "콘텐츠 제목",
  "description": "설명과 #태그",
  "scheduledAt": "2026-08-08T09:00",
  "privacy": "public",
  "accountIds": ["youtube-account-id", "instagram-account-id"],
  "youtubeChecklist": { "title": true, "thumbnail": false }
}
```

- 성공 `201`: `scheduled` campaign 및 account별 `queued` job
- 실패: `400 CAMPAIGN_FIELDS_REQUIRED`, `400 TARGET_ACCOUNTS_REQUIRED`

## DELETE /campaigns/:id

- 성공 `200`: `{ "deleted": "..." }`
- 실패 `404 CAMPAIGN_NOT_FOUND`

## GET /uploads/:storedName

저장된 영상 바이너리를 반환한다. 향후 데스크톱 상세 재생·다운로드에 사용한다.
