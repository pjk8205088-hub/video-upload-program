# 동영상 업로드 프로그램

Windows용 Upload Desk 데스크톱 앱입니다. 하나의 동영상 원본을 YouTube·네이버·TikTok·Facebook·Instagram 계정에 연결하고, 제목·설명·예약일을 입력해 멀티 채널 업로드 작업을 관리합니다.

## 실행

웹 프리뷰/로컬 서버:

```bash
npm start
```

브라우저에서 `http://localhost:3000`을 엽니다.

Windows 데스크톱 셸:

```bash
npm install
npm run start:desktop
```

포터블 EXE:

```bash
npm run dist:desktop
```

## 구현 범위

- MP4, MOV, WebM, MKV 업로드
- 드래그 앤 드롭, 업로드 진행률, 로컬 동영상 목록
- YouTube, 네이버, TikTok, Facebook, Instagram 계정 연결 관리
- 하나의 영상에서 여러 SNS 계정으로 이어지는 그래프형 업로드 맵
- 제목·설명·공개 범위·예약일 입력
- YouTube 업로드 항목 자동 체크와 수동 확인 항목 분리
- 여러 계정에 동시에 예약 작업 생성
- Windows 타이틀바, 최소화·최대화·닫기 컨트롤

현재 SNS에 실제 게시하려면 각 서비스의 OAuth 앱 등록과 API 토큰이 필요합니다. 이번 버전은 계정 메타데이터, 예약 작업, 계정별 전송 대기 큐를 구현하고 실제 API adapter를 연결할 수 있도록 설계했습니다.

테스트:

```bash
npm test
```
