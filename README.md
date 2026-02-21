# tiger-bot

백준 문제 출제 + 잡다한 사교용 기능을 한 번에 쓰는 범용 Discord 봇입니다.

- `!랜덤 문제 [난이도]` : 난이도별 랜덤 문제 1개 조회
- `!오늘의 문제 [난이도]` : 오늘 날짜 기준 난이도별 고정 문제 1개 조회
- `!오늘의 문제 리셋` : 당일 출제 문제 캐시 초기화 (관리자 전용)
- `!추첨 [N]` : 온라인 멤버 추첨
- `!가위바위보 <가위|바위|보>` : 가위바위보 한 판 진행
- `!가위바위보 전적` : 내 전적 조회
- `!가위바위보 랭킹 [N]` : 가위바위보 랭킹 조회
- `!도움` : 사용 가능한 명령어

난이도
- `쉬움` (`easy`, `e`) : 티어 1..7
- `중간` (`medium`, `m`) : 티어 8..12 (기본)
- `어려움` (`hard`, `h`) : 티어 13..17

## 실행 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | 예 | - | 디스코드 봇 토큰 |
| `BOJ_SEARCH_API_URL` | 아니오 | `https://solved.ac/api/v3/search/problem` | solved.ac 검색 API 엔드포인트 |
| `BOJ_FETCH_TIMEOUT_MS` | 아니오 | `5000` | 문제 조회 타임아웃(ms) |
| `BOJ_TODAY_CACHE_PATH` | 아니오 | `/app/data/boj-today.json` | 오늘의 문제 캐시 파일 경로 |
| `BOJ_TODAY_TIMEZONE` | 아니오 | `Asia/Seoul` | 오늘의 문제 날짜 기준 타임존 |
| `ADMIN_USER_IDS` | 아니오 | `""` | `!오늘의 문제 리셋` 실행 가능한 Discord 사용자 ID 목록(쉼표 구분) |
| `ALLOWED_CHANNEL_IDS` | 아니오 | `""` | 봇이 반응할 채널 ID 목록(쉼표 구분). 빈 값이면 모든 채널 허용 |
| `RPS_STATS_PATH` | 아니오 | `/app/data/rps-stats.json` | 가위바위보 전적 저장 파일 경로 |
| `RPS_PERSIST_LOG_INTERVAL` | 아니오 | `20` | 가위바위보 전적 저장 로그 출력 간격(쓰기 횟수 기준, `0` 이하면 1회만 출력) |
| `RPS_RANKING_MIN_GAMES_FOR_WIN_RATE` | 아니오 | `10` | 랭킹에서 승률 표기 임계값 |

`ADMIN_USER_IDS`가 비어 있으면 리셋은 비활성화됩니다.

## 실행 예시

```bash
docker compose up -d
```

## 디스코드 초대 가이드

봇을 서버에 붙이려면 Discord 개발자 포털에서 초대 링크를 직접 만들어야 한다.

1. Discord Developer Portal → `Applications` → 앱 선택 → `OAuth2` → `URL Generator`
2. `SCOPES`에서 `bot`만 체크
3. `Bot Permissions`에서 최소 권한:
   - `Read Message History`
   - `Send Messages`
   - `Embed Links`
   - `Attach Files`(선택)
4. 생성된 URL로 서버를 선택해 초대
5. 봇 토큰 발급/등록 후 아래 인텐트 ON:
   - `Message Content`
   - `Guild Members` (온라인 멤버 추첨 기능 사용 시)
   - `Guild Presences` (온라인 상태 판별 시)

실수 줄이기 체크
- `Read Message History` 누락: 일부 채널에서 응답이 가끔 안 보이는 것처럼 보임
- `Message Content` 누락: `!랜덤 문제` 계열 명령이 아예 안 들어옴
- 초대할 채널만 쓰려면 `ALLOWED_CHANNEL_IDS`에 채널 ID를 넣어서 제한

채널 ID는 개발자 모드에서 채널 우클릭 → `ID 복사`로 얻는다.

## 봇 업데이트

이 저장소는 이미지를 갱신하는 Watchtower 방식으로 운영한다.

GitHub Actions에서 `ghcr.io/mtgvim/tiger-bot:latest`로 최신 이미지가 push되면
라벨 `com.centurylinklabs.watchtower.enable=true`가 있는 컨테이너만 자동 갱신된다.
(`.github/workflows/docker.yml` 기준 `master/main` 브랜치 푸시 시 `ghcr.io/mtgvim/tiger-bot:latest` 태그로 push)
`com.centurylinklabs.watchtower.scope=tiger-bot` 라벨로 갱신 대상 스택을 고정한다.

수동으로 1회 갱신하려면 아래 명령을 실행한다.

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ${WATCHTOWER_IMAGE:-containrrr/watchtower:latest} \
  --run-once \
  --label-enable \
  --scope ${WATCHTOWER_SCOPE:-tiger-bot} \
  --cleanup
```

`palworld-server-bot`와 동일하게 별도 스크립트 없이 watchtower one-shot 실행 방식이다.

### GitHub Actions 배포 알림

이 저장소는 GHCR 이미지 빌드/푸시 CI에서 배포 알림을 Discord Webhook으로 전송한다.

- 알림은 `.github/workflows/docker.yml`의 `Notify Discord (success/failure)`에서 처리한다.
- GitHub Repository → `Settings` → `Secrets and variables` → `Actions`에 `DISCORD_WEBHOOK_URL`을 등록해야 알림이 전송된다.
- Secret이 없으면 CI는 자동으로 알림을 생략한다(배포는 정상 동작).

알림 메시지에는 커밋 요약, 비교 링크, 업로드된 이미지 태그 정보가 포함된다.

## 명령어

- `!도움`
- `!랜덤 문제 [쉬움|중간|어려움]`
- `!오늘의 문제 [(쉬움|중간|어려움)]`
- `!오늘의 문제 리셋` (관리자)
- `!추첨 [N]`
- `!가위바위보 <가위|바위|보>`
- `!가위바위보 전적`
- `!가위바위보 랭킹 [N]`
