# 동영상 업로드 프로그램 데이터 모델

## Video

`id`, `originalName`, `storedName`, `mimeType`, `size`, `sizeLabel`, `status`, `createdAt`, `url`을 가진다.

## Account

`id`, `provider`, `displayName`, `handle`, `status`, `connectedAt`을 가진다.

- `provider`: `youtube`, `naver`, `tiktok`, `facebook`, `instagram`
- `status`: `connected`, `expired`, `revoked` 확장 가능
- 실제 OAuth 토큰은 브라우저나 JSON 파일에 저장하지 않고 암호화된 서버 측 저장소에 둔다.

## Campaign

`id`, `videoId`, `title`, `description`, `scheduledAt`, `youtubeChecklist`, `status`, `createdAt`, `jobs[]`를 가진다.

## CampaignJob

`accountId`, `provider`, `handle`, `status`를 가진다.

- 초기 상태: `queued`
- 확장 상태: `uploading`, `published`, `failed`

## 저장 구조

```text
data/videos.json       # Video[]
data/accounts.json     # Account[]
data/campaigns.json    # Campaign[]
uploads/{id}.{ext}     # 실제 영상 원본
```

## 관계

Campaign은 하나의 Video를 여러 Account로 라우팅한다. 실제 게시 단계에서는 CampaignJob 하나가 플랫폼 API 호출 한 건을 담당한다.
