# Repository Guidelines

## Project Structure & Module Organization
- `index.js` : Discord 이벤트 처리, 명령 분기, 핵심 동작 로직
- `rps-core.js` : 가위바위보 관련 점수/전적 로직
- `docker-compose.yml`, `Dockerfile` : 실행/배포 구성
- `.github/workflows/docker.yml` : GHCR 빌드·푸시·배포 알림 파이프라인
- `README.md` : 사용법 및 운영 가이드
- `docs/` : 부가 문서
- 런타임 데이터: `./data`(컨테이너 볼륨 `/app/data`)는 실행 시 생성되며 커밋 대상이 아닙니다.

## Build, Test, and Development Commands
- `yarn install` : 의존성 설치
- `node index.js` : 로컬 직접 실행(필수 환경변수 필요)
- `docker build -t tiger-bot:dev .` : 로컬 이미지 빌드
- `docker compose up -d` : 컨테이너 기동
- `docker compose logs -f tiger-bot` : 실시간 동작 확인
- `docker compose down` : 종료
- `bash -lc 'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock containrrr/watchtower:latest --run-once --label-enable --scope tiger-bot'` : 수동 업데이트(운영 스코프 기준)

## Coding Style & Naming Conventions
- JavaScript(CommonJS) 기준으로 작성합니다.
- 들여쓰기 2칸, 세미콜론 사용, 함수/변수는 `camelCase`.
- 상수는 `UPPER_SNAKE_CASE`.
- 환경변수 이름은 `UPPER_SNAKE_CASE`로 통일.

## Testing Guidelines
- 별도 자동 테스트 프레임워크는 없음.
- 기능 변경 시 아래 2개는 최소 수행:
  1) `node index.js` 실행으로 구문 오류 확인
  2) `docker compose up -d` 후 수동 명령(`!오늘의 문제`, `!도움`, `!가위바위보`)로 응답 확인
- 이미지/배포 변경은 푸시 전 `docker compose down` + 재기동 테스트 포함.

## Security & Configuration Tips
- 토큰/비밀번호는 절대 코드/커밋에 넣지 않습니다.
- `WATCHTOWER_SCOPE`, `BOT_IMAGE`(기본 이미지), `ADMIN_USER_IDS`는 운영 환경마다 구분해 관리합니다.
- 동일 호스트 다중 봇 운영 시 `watchtower scope` 라벨을 서로 다르게 설정하세요.

## Commit & Pull Request Guidelines
- 커밋 메시지: `type(scope): 한글 요약` 형식, Conventional Commit 사용.
  예) `feat(bot): 오늘의 문제 캐시 초기화 조건 분기 추가`
- PR에는 다음을 포함:
  - 변경 요약(무슨 동작이 달라지는지)
  - 설정/환경변수 영향
- `docker-compose.yml` 또는 런타임 동작 관련 변경 시 `README.md`와 동시 업데이트 필수.
