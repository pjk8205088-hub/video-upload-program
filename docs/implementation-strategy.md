# 구현 전략

## 구조

```text
public/                 슬롯 보드 UI, 캘린더, 통계·댓글 화면
server.js               로컬 HTTP API, scheduler, 영속화
lib/ai.js               OpenAI 지점 + local fallback
lib/thumbnail.js        SVG thumbnail generator
lib/providers.js        ProviderAdapter + sandbox 구현
desktop/main.cjs        Electron 창, 시작 프로그램, updater IPC
desktop/preload.cjs     제한된 contextBridge
```

## 전송 경계

UI가 직접 SNS API를 호출하지 않는다. `CampaignJob`을 저장한 뒤 scheduler가 `getProviderAdapter(provider)`를 통해 adapter를 호출한다. 현재 adapter는 네트워크 게시를 하지 않는 sandbox다. 실서비스 provider는 OAuth token을 별도 보안 저장소에서 읽고 `publish`, `getAnalytics`, `listComments`, `replyComment`, `hideComment`를 구현한다.

## 재시도 정책

시도 횟수는 job에 누적하고, 실패 시 `retrying`과 `nextRetryAt`을 저장한다. 대기 시간은 `min(1000 * 2^(attempt-1), 300000)`이며 최대 시도 수는 3회다. 사용자가 수동 재시도를 누르면 due 상태로 바꾸고 즉시 실행한다.

## 배포

Electron Builder는 NSIS 설치 프로그램과 portable EXE를 함께 만든다. GitHub publish 설정은 placeholder이므로 실제 저장소와 코드 서명 환경을 배포 전에 지정한다. `electron-updater`는 packaged 앱에서만 자동 확인한다.
