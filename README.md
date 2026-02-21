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
| `RPS_STATS_PATH` | 아니오 | `/app/data/rps-stats.json` | 가위바위보 전적 저장 파일 경로 |
| `RPS_PERSIST_LOG_INTERVAL` | 아니오 | `20` | 가위바위보 전적 저장 로그 출력 간격(쓰기 횟수 기준, `0` 이하면 1회만 출력) |
| `RPS_RANKING_MIN_GAMES_FOR_WIN_RATE` | 아니오 | `10` | 랭킹에서 승률 표기 임계값 |

`ADMIN_USER_IDS`가 비어 있으면 리셋은 비활성화됩니다.

## 실행 예시

```bash
docker compose up -d
```

## 봇 업데이트

이 저장소는 이미지를 갱신하는 Watchtower 방식으로 운영한다.

GitHub Actions에서 `BOT_IMAGE`에 지정한 태그(기본: `ghcr.io/mtgvim/tiger-bot:latest`)로 최신 이미지가 push되면
라벨 `com.centurylinklabs.watchtower.enable=true`가 있는 컨테이너만 자동 갱신된다.
(`.github/workflows/docker.yml` 기준 `master/main` 브랜치 푸시 시 `ghcr.io/<owner>/<repo>:latest` 태그로 push)

수동으로 1회 갱신하려면 아래 명령을 실행한다.

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ${WATCHTOWER_IMAGE:-containrrr/watchtower:latest} \
  --run-once \
  --label-enable \
  --cleanup
```

`palworld-server-bot`와 동일하게 별도 스크립트 없이 watchtower one-shot 실행 방식이다.

## 명령어

- `!도움`
- `!랜덤 문제 [쉬움|중간|어려움]`
- `!오늘의 문제 [(쉬움|중간|어려움)]`
- `!오늘의 문제 리셋` (관리자)
- `!추첨 [N]`
- `!가위바위보 <가위|바위|보>`
- `!가위바위보 전적`
- `!가위바위보 랭킹 [N]`
