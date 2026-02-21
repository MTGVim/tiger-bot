# tiger-bot

LeetCode 문제 출제 + 잡다한 사교용 기능을 한 번에 쓰는 범용 Discord 봇입니다.

- `!랜덤 문제 [난이도]` : 난이도별 랜덤 문제 1개 조회
- `!오늘의 문제 [난이도]` : 오늘 날짜 기준 난이도별 고정 문제 1개 조회
- `!오늘의 문제 리셋` : 당일 출제 문제 캐시 초기화 (관리자 전용)
- `!추첨 [N]` : 온라인 멤버 추첨
- `!가위바위보 <가위|바위|보>` : 가위바위보 한 판 진행
- `!가위바위보 전적` : 내 전적 조회
- `!가위바위보 랭킹 [N]` : 가위바위보 랭킹 조회
- `!도움` : 사용 가능한 명령어

난이도
- `쉬움` (`easy`, `e`) : Easy
- `중간` (`medium`, `m`) : Medium (기본)
- `어려움` (`hard`, `h`) : Hard

## 실행 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | 예 | - | 디스코드 봇 토큰 |
| `LEETCODE_GRAPHQL_URL` | 아니오 | `https://leetcode.com/graphql` | LeetCode GraphQL 엔드포인트 |
| `LEETCODE_FETCH_TIMEOUT_MS` | 아니오 | `5000` | 문제 조회 타임아웃(ms) |
| `LEETCODE_TODAY_CACHE_PATH` | 아니오 | `/app/data/leetcode-today.json` | 오늘의 문제 캐시 파일 경로 |
| `LEETCODE_TODAY_TIMEZONE` | 아니오 | `Asia/Seoul` | 오늘의 문제 날짜 기준 타임존 |
| `ADMIN_USER_IDS` | 아니오 | `""` | `!오늘의 문제 리셋` 실행 가능한 Discord 사용자 ID 목록(쉼표 구분) |
| `RPS_STATS_PATH` | 아니오 | `/app/data/rps-stats.json` | 가위바위보 전적 저장 파일 경로 |
| `RPS_PERSIST_LOG_INTERVAL` | 아니오 | `20` | 가위바위보 전적 저장 로그 출력 간격(쓰기 횟수 기준, `0` 이하면 1회만 출력) |
| `RPS_RANKING_MIN_GAMES_FOR_WIN_RATE` | 아니오 | `10` | 랭킹에서 승률 표기 임계값 |

`ADMIN_USER_IDS`가 비어 있으면 리셋은 비활성화됩니다.

## 선택 기준

- `!랜덤 문제`/`!오늘의 문제`는 LeetCode 문제를 대상으로 합니다.
- 한글 제목이 있으면 한글 제목을 우선 표기하고, 없으면 영문 제목으로 fallback합니다.
- TypeScript 코드 스니펫(`TypeScript`) 지원이 확인되는 문제만 선별합니다.

## 실행 예시

```bash
docker compose up -d
```

## 명령어

- `!도움`
- `!랜덤 문제 [쉬움|중간|어려움]`
- `!오늘의 문제 [(쉬움|중간|어려움)]`
- `!오늘의 문제 리셋` (관리자)
- `!추첨 [N]`
- `!가위바위보 <가위|바위|보>`
- `!가위바위보 전적`
- `!가위바위보 랭킹 [N]`
