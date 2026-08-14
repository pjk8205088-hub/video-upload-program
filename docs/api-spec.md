# Upload Desk API

Base URL: `/api`. 모든 응답은 JSON이다.

## 영상·AI

- `GET /videos` → `{ videos, maxSlots: 10 }`
- `POST /videos` → 바이너리 스트림. Headers: `X-File-Name`, `X-File-Type`, `X-File-Size`, `X-Slot-Number`, `X-Replace`.
  - `201`: `{ video, replacedVideoId }`
  - 주요 오류: `UNSUPPORTED_VIDEO`, `FILE_TOO_LARGE`, `INVALID_SLOT`, `SLOT_OCCUPIED`, `SLOT_LIMIT_REACHED`, `INCOMPLETE_UPLOAD`
- `DELETE /videos/:id` → 원본·썸네일 삭제, 미게시 job 취소
- `POST /ai/generate` body `{ videoId }` → `{ metadata, video }`

`metadata.source`는 `openai` 또는 `local-fallback`이다. OpenAI 키가 없거나 요청 실패 시 fallback을 반환한다.

## 계정·라우팅

- `GET /accounts` → 계정과 provider 목록
- `POST /accounts` body `{ provider, displayName, handle }`
- `PUT /accounts/:id/routing` body `{ slotNumbers: [1, 2, 10] }`
- `DELETE /accounts/:id`

현재 계정은 `mode: sandbox`로 저장되며 비밀번호·OAuth token은 저장하지 않는다.

## 예약·전송

- `GET /campaigns`
- `POST /campaigns` body:

```json
{
  "title": "콘텐츠 제목",
  "description": "설명",
  "hashtags": ["#영상"],
  "scheduledAt": "2026-08-08T09:00:00.000Z",
  "privacy": "public",
  "routes": [{ "accountId": "acct_...", "slotNumber": 1 }]
}
```

- `POST /campaigns/:id/run` 예약 작업을 즉시 sandbox 실행
- `POST /jobs/:id/retry` 실패 job 수동 재시도
- `DELETE /campaigns/:id` 미게시 job 취소

동일한 `videoId:accountId`가 게시 완료·예약·진행 중이면 `409 DUPLICATE_ROUTES`로 차단한다. 실패 후 `nextRetryAt`은 1초, 2초, 4초…로 증가하며 최대 3회 시도한다.

## 통계·댓글·운영

- `GET /analytics`, `POST /analytics/refresh`
- `GET /comments`
- `POST /comments/:id/reply` body `{ text }`
- `PATCH /comments/:id` body `{ action: "hide" | "unhide" }`
- `GET /logs?limit=80`
- `GET /settings`, `PUT /settings` body `{ launchAtStartup, startMinimized, autoUpdate, providerMode }`; `providerMode`은 `sandbox` 또는 `live`
- `GET /health`

## 실제 API 연결 경계

`lib/providers.js`의 `ProviderAdapter`를 구현하고 `getProviderAdapter()` registry에 provider별 OAuth adapter를 등록한다. `publish`, `getAnalytics`, `listComments`, `replyComment`, `hideComment`가 실제 API 호출 지점이다.
