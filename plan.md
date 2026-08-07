# Upload Desk 구현 계획

## 완료된 범위

- [x] 1~10 고정 영상 슬롯, 다중 파일 업로드, 교체·삭제
- [x] SNS 계정별 1~10 번호 체크와 저장형 라우팅
- [x] 계정×슬롯 독립 job 생성, 예약 시각, 중복 업로드 방지
- [x] sandbox provider adapter와 실제 OAuth adapter 분리 지점
- [x] AI metadata adapter + 로컬 규칙 기반 fallback
- [x] SVG 자동 썸네일 생성
- [x] 동시 전송 구조, 진행률, 성공·실패·재시도 횟수, 지수 백오프, job 로그
- [x] 게시 후 조회수·좋아요·댓글 mock 수집 및 갱신
- [x] 댓글 조회·답글·숨김·숨김 해제
- [x] 월간 예약 캘린더
- [x] Windows 로그인 시작·백그라운드 옵션 IPC
- [x] Electron Builder NSIS 설치 프로그램 + portable EXE 설정
- [x] electron-updater 자동 업데이트 확인 지점
- [x] API/통합 테스트, 문서 및 화면 검증

## 외부 연동 전환 작업

- [ ] YouTube·네이버·TikTok·Facebook·Instagram OAuth authorization code 교환
- [ ] 각 provider의 upload/resumable upload, analytics, comments API 구현
- [ ] 실제 토큰 암호화 저장소와 만료·철회 처리
- [ ] 운영 publish 저장소 owner/repo와 코드 서명 인증서 설정
