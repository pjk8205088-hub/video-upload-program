# 동영상 업로드 프로그램 데이터 모델

## Video

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---:|---|---|
| id | string | 예 | 서버 생성 | 영상 식별자 |
| originalName | string | 예 | - | 사용자가 선택한 원본 파일명 |
| storedName | string | 예 | - | ID 기반 안전한 저장 파일명 |
| mimeType | string | 예 | - | 업로드된 MIME 타입 |
| size | number | 예 | - | 바이트 단위 크기 |
| sizeLabel | string | 예 | - | UI 표시용 사람이 읽는 크기 |
| status | enum | 예 | `ready` | `ready`, `failed` 확장 가능 |
| createdAt | ISO datetime | 예 | 현재 시각 | 업로드 완료 시각 |
| url | string | 예 | - | 업로드 파일 접근 경로 |

## 저장 구조

```text
data/videos.json       # Video[] 메타데이터
uploads/{id}.{ext}     # 실제 원본 영상
```

## 관계

MVP는 사용자·프로젝트 테이블 없이 단일 워크스페이스에 Video를 직접 소속시킨다. 이후 다중 사용자로 확장할 때 `userId`, `workspaceId`, `folderId`를 추가한다.

## 무결성 정책

- Video 생성 시 메타데이터 기록 전에 바이너리 저장이 완료되어야 한다.
- 삭제 시 바이너리를 먼저 제거하고 메타데이터에서 제거한다.
- 읽기 실패 또는 손상된 JSON은 빈 배열로 복구하되, 운영 환경에서는 별도 경고 로깅이 필요하다.
- 서버 생성 ID를 파일명으로 사용해 원본 이름이 경로 해석에 영향을 주지 않게 한다.

## 확장 설계

실서비스 전환 시 JSON 파일을 PostgreSQL 또는 SQLite로 교체하고, 파일 자체는 오브젝트 스토리지에 저장한다. `status`는 `pending`, `uploading`, `ready`, `failed`, `deleted`로 확장할 수 있다.
