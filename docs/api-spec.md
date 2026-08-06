# 동영상 업로드 프로그램 API 명세

Base URL: `/api`

## GET /videos

- Request body: 없음
- 인증 필요 여부: MVP에서는 없음 (로컬 접근 전제)
- 권한 조건: 로컬 워크스페이스 접근 권한
- 성공 응답 `200`:

```json
{
  "videos": [
    {
      "id": "m0abc-1234abcd",
      "originalName": "product-demo.mp4",
      "storedName": "m0abc-1234abcd.mp4",
      "mimeType": "video/mp4",
      "size": 1048576,
      "sizeLabel": "1.0 MB",
      "status": "ready",
      "createdAt": "2026-08-07T01:00:00.000Z",
      "url": "/uploads/m0abc-1234abcd.mp4"
    }
  ]
}
```

- 관련 화면: 업로드 센터 / 내 동영상
- 관련 기능: 영상 목록, 저장공간 표시

## POST /videos

- Request body: 동영상 바이너리 스트림
- Headers:
  - `X-File-Name`: 원본 파일명
  - `X-File-Type`: MIME 타입
  - `X-File-Size`: 바이트 단위 파일 크기
- 인증 필요 여부: MVP에서는 없음
- 권한 조건: 로컬 워크스페이스 쓰기 권한
- 성공 응답 `201`:

```json
{ "video": { "id": "...", "originalName": "...", "status": "ready" } }
```

- 실패 응답:
  - `400 INCOMPLETE_UPLOAD`: 선언된 크기와 실제 스트림 크기가 다름
  - `413 FILE_TOO_LARGE`: 2 GB 초과 또는 크기 누락
  - `415 UNSUPPORTED_VIDEO`: 허용하지 않는 확장자·MIME 타입
  - `500 UPLOAD_FAILED`: 파일 저장 실패
- 관련 화면: 업로드 센터
- 관련 기능: 동영상 선택, 업로드 진행률

## DELETE /videos/:id

- Request body: 없음
- 인증 필요 여부: MVP에서는 없음
- 권한 조건: 로컬 워크스페이스 쓰기 권한
- 성공 응답 `200`:

```json
{ "deleted": "m0abc-1234abcd" }
```

- 실패 응답:
  - `404 VIDEO_NOT_FOUND`: ID에 해당하는 영상 없음
  - `500 INTERNAL_ERROR`: 삭제 처리 실패
- 관련 화면: 내 동영상
- 관련 기능: 영상 삭제

## GET /uploads/:storedName

저장된 바이너리를 영상 MIME 타입으로 반환한다. MVP의 재생·다운로드 확장을 위한 엔드포인트이며 목록 화면에서는 직접 사용하지 않는다.
