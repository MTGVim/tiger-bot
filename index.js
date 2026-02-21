const { Client, GatewayIntentBits } = require("discord.js");
const { exec } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const {
  createRpsPersistence,
  evaluateRps,
  getOrCreateRpsRecord,
  normalizeRpsChoice,
} = require("./rps-core");

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const BOJ_SEARCH_API_URL = (
  process.env.BOJ_SEARCH_API_URL || "https://solved.ac/api/v3/search/problem"
).trim();
const BOJ_FETCH_TIMEOUT_MS = parseInt(process.env.BOJ_FETCH_TIMEOUT_MS || "5000", 10);
const BOJ_TODAY_CACHE_PATH = (
  process.env.BOJ_TODAY_CACHE_PATH || "/app/data/boj-today.json"
).trim();
const BOJ_TODAY_TIMEZONE = (
  process.env.BOJ_TODAY_TIMEZONE || "Asia/Seoul"
).trim();
const RPS_STATS_PATH = (process.env.RPS_STATS_PATH || "/app/data/rps-stats.json").trim();
const RPS_PERSIST_LOG_INTERVAL = parseInt(
  process.env.RPS_PERSIST_LOG_INTERVAL || "20",
  10
);
const RPS_RANKING_MIN_GAMES_FOR_WIN_RATE = parseInt(
  process.env.RPS_RANKING_MIN_GAMES_FOR_WIN_RATE || "10",
  10
);
const BOT_UPDATE_ENABLED =
  String(process.env.BOT_UPDATE_ENABLED || "false").toLowerCase() === "true";
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ALLOWED_CHANNEL_ID = String(
  process.env.ALLOWED_CHANNEL_ID || ""
)
  .trim()
  .split(",")[0]
  .trim();

let leetTodayLoaded = false;
let leetTodayCache = { byDate: {}, recentByDifficulty: {} };
let leetTodayQueue = Promise.resolve();
let rpsStats = {};
let rpsStatsLoaded = false;
let updateInProgress = false;
const WATCHTOWER_IMAGE = (process.env.WATCHTOWER_IMAGE || "containrrr/watchtower:latest").trim();
const WATCHTOWER_SCOPE = (process.env.WATCHTOWER_SCOPE || "tiger-bot").trim();
const rpsPersistence = createRpsPersistence({
  fs,
  statsPath: RPS_STATS_PATH,
  logInterval: RPS_PERSIST_LOG_INTERVAL,
  logger: (line) => console.log(line),
});

function docker(cmd) {
  console.log("[docker] executing command:", cmd);
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => {
      if (err) {
        console.log("[docker] command failed:", cmd, "| error:", err.message);
        reject(err);
      } else {
        console.log("[docker] command succeeded:", cmd);
        resolve();
      }
    });
  });
}

function isSafeDockerRef(value) {
  return /^[A-Za-z0-9._:@/-]+$/.test(value);
}

function isSafeWatchtowerScope(value) {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function getWatchtowerRunOnceCommand() {
  if (!isSafeDockerRef(WATCHTOWER_IMAGE)) {
    throw new Error(
      "WATCHTOWER_IMAGE 값이 안전하지 않습니다. 영문/숫자/._:@/- 문자만 사용해주세요."
    );
  }
  if (!isSafeWatchtowerScope(WATCHTOWER_SCOPE)) {
    throw new Error(
      "WATCHTOWER_SCOPE 값이 안전하지 않습니다. 영문/숫자/._- 문자만 사용해주세요."
    );
  }

  return (
    "docker run --rm " +
    "-v /var/run/docker.sock:/var/run/docker.sock " +
    `${WATCHTOWER_IMAGE} ` +
    `--run-once --cleanup --label-enable --scope ${WATCHTOWER_SCOPE}`
  );
}

function isAuthorizedUpdater(userId) {
  const adminAuth = requireAdminAuthorization(userId);
  if (!adminAuth.ok) {
    return adminAuth;
  }

  if (!BOT_UPDATE_ENABLED) {
    return {
      ok: false,
      message:
        "⚠️ 봇 업데이트 기능이 비활성화되어 있습니다. `BOT_UPDATE_ENABLED=true`로 설정해주세요.",
    };
  }

  return { ok: true };
}

function pickRandomMembers(members, count) {
  if (!Array.isArray(members) || members.length === 0 || count <= 0) {
    return [];
  }
  const pool = members.slice(0);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function formatRpsRecord(record) {
  const safe = {
    wins: Number.isFinite(record?.wins) ? record.wins : 0,
    losses: Number.isFinite(record?.losses) ? record.losses : 0,
    draws: Number.isFinite(record?.draws) ? record.draws : 0,
    games: Number.isFinite(record?.games) ? record.games : 0,
  };
  const winRate = safe.games > 0 ? ((safe.wins / safe.games) * 100).toFixed(2) : "0.00";

  return `승: ${safe.wins} / 패: ${safe.losses} / 무: ${safe.draws} / 판수: ${safe.games} (승률 ${winRate}%)`;
}

function formatRankingWinRate(record) {
  if (!record || !Number.isFinite(record.games) || record.games < RPS_RANKING_MIN_GAMES_FOR_WIN_RATE) {
    return `${RPS_RANKING_MIN_GAMES_FOR_WIN_RATE}판 미만 🐥`;
  }

  const winRate = ((record.wins / record.games) * 100).toFixed(1);
  return `${winRate}%`;
}

async function ensureRpsStatsLoaded() {
  if (rpsStatsLoaded) {
    return;
  }

  try {
    const raw = await fs.readFile(RPS_STATS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      rpsStats = parsed;
    } else {
      rpsStats = {};
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.log("[rps][WARN] 전적 파일 로드 실패:", err.message, "| path:", RPS_STATS_PATH);
    }
    rpsStats = {};
  } finally {
    rpsStatsLoaded = true;
    const totalUsers = Object.keys(rpsStats).length;
    const totalGames = Object.values(rpsStats).reduce((sum, row) => (
      sum + (Number.isInteger(row?.games) ? row.games : 0)
    ), 0);
    console.log(
      `[rps][INFO] 전적 준비 완료: path=${RPS_STATS_PATH} users=${totalUsers} games=${totalGames}`
    );
  }
}

function getRpsRanking(limit) {
  const rankingLimit = Math.max(1, Math.min(limit, 30));
  return Object.entries(rpsStats)
    .map(([userId, row]) => {
      const record = getOrCreateRpsRecord(rpsStats, userId);
      const safeWins = Number.isInteger(record.wins) ? record.wins : 0;
      const safeGames = Number.isInteger(record.games) ? record.games : 0;
      const winRate = safeGames > 0 ? safeWins / safeGames : 0;
      return {
        userId,
        record,
        wins: safeWins,
        games: safeGames,
        winRate,
      };
    })
    .sort((a, b) => {
      if (a.winRate !== b.winRate) return b.winRate - a.winRate;
      if (a.wins !== b.wins) return b.wins - a.wins;
      return b.games - a.games;
    })
    .slice(0, rankingLimit);
}

async function updateRpsStatsForUser(userId, result) {
  const record = getOrCreateRpsRecord(rpsStats, userId);
  if (result === "승리") {
    record.wins += 1;
  } else if (result === "패배") {
    record.losses += 1;
  } else {
    record.draws += 1;
  }
  record.games += 1;
  record.updatedAt = new Date().toISOString();
  await rpsPersistence.persist(rpsStats);
  return record;
}

function rpsChoiceEmoji(choice) {
  if (choice === "가위") return "✌️";
  if (choice === "바위") return "👊";
  if (choice === "보") return "🖐️";
  return "❓";
}

function rpsResultEmoji(result) {
  if (result === "승리") return "🎉";
  if (result === "패배") return "🤕";
  return "🤝";
}

function isOnlineMember(member) {
  if (!member || member.user?.bot) {
    return false;
  }
  const status = member.presence?.status;
  if (!status) {
    return true;
  }
  return status === "online" || status === "idle" || status === "dnd";
}

async function getOnlineHumanMembers(guild) {
  if (!guild?.members?.fetch) {
    return {
      ok: false,
      message:
        "⚠️ 서버 멤버 조회 권한이 없습니다. `GuildMembers`/`GuildPresences` 인텐트를 켜주세요.",
    };
  }

  let members;
  try {
    members = await guild.members.fetch({ withPresences: true });
  } catch (err) {
    return {
      ok: false,
      message: `⚠️ 온라인 멤버 조회 실패: ${err.message}`,
    };
  }

  const humanOnline = [...members.values()].filter(isOnlineMember);
  return { ok: true, members: humanOnline };
}

function isSafeUserId(value) {
  return /^\d+$/.test(String(value || ""));
}

async function fetchWithTimeout(url, options = {}, timeout = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const result = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return result;
  } catch {
    clearTimeout(id);
    throw new Error("timeout");
  }
}

function normalizeLeetDifficulty(input) {
  const value = String(input || "").trim().toLowerCase();
  const compact = value.replace(/\s+/g, "");
  if (!value) return "MEDIUM";
  if (["easy", "e"].includes(value)) return "EASY";
  if (["medium", "m"].includes(value)) return "MEDIUM";
  if (["hard", "h"].includes(value)) return "HARD";
  if (compact.includes("쉬움") || compact.includes("초급")) return "EASY";
  if (compact.includes("중간") || compact.includes("보통") || compact.includes("중급")) return "MEDIUM";
  if (compact.includes("어려움") || compact.includes("고급")) return "HARD";
  return null;
}

function formatLeetDifficultyLabel(difficulty) {
  if (difficulty === "EASY") return "쉬움";
  if (difficulty === "HARD") return "어려움";
  return "중간";
}

function getBojTierRangeByDifficulty(difficulty) {
  if (difficulty === "EASY") return { min: 1, max: 7 };
  if (difficulty === "HARD") return { min: 13, max: 17 };
  return { min: 8, max: 12 };
}

function formatBojTier(level) {
  const tier = Number.isInteger(level) ? level : parseInt(level || "0", 10);
  if (!Number.isInteger(tier) || tier <= 0) return "Unrated";
  const bands = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ruby"];
  const bandIndex = Math.floor((tier - 1) / 5);
  const withinBand = ((tier - 1) % 5) + 1;
  const band = bands[bandIndex] || "Tier";
  const number = 6 - withinBand;
  return `${band} ${number}`;
}

function hasKoreanCharacters(value) {
  return /[가-힣]/.test(String(value || ""));
}

function ensureLeetTodayCacheShape() {
  if (!leetTodayCache || typeof leetTodayCache !== "object") {
    leetTodayCache = { byDate: {}, recentByDifficulty: {} };
  }
  if (!leetTodayCache.byDate || typeof leetTodayCache.byDate !== "object") {
    leetTodayCache.byDate = {};
  }
  if (!leetTodayCache.recentByDifficulty || typeof leetTodayCache.recentByDifficulty !== "object") {
    leetTodayCache.recentByDifficulty = {};
  }
}

function getRecentHistoryForDifficulty(difficulty) {
  ensureLeetTodayCacheShape();
  const raw = leetTodayCache.recentByDifficulty[difficulty];
  if (!Array.isArray(raw)) {
    leetTodayCache.recentByDifficulty[difficulty] = [];
    return leetTodayCache.recentByDifficulty[difficulty];
  }
  const normalized = raw
    .map((value) => parseInt(String(value), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  leetTodayCache.recentByDifficulty[difficulty] = normalized;
  return normalized;
}

function rememberTodayProblem(difficulty, problemId) {
  const id = parseInt(String(problemId || ""), 10);
  if (!Number.isInteger(id) || id <= 0) return;
  const history = getRecentHistoryForDifficulty(difficulty);
  const next = [id, ...history.filter((value) => value !== id)].slice(0, 120);
  leetTodayCache.recentByDifficulty[difficulty] = next;
}

function collectExcludedTodayProblemIds(difficulty) {
  ensureLeetTodayCacheShape();
  const excluded = new Set(getRecentHistoryForDifficulty(difficulty));
  for (const dayValue of Object.values(leetTodayCache.byDate)) {
    if (!dayValue || typeof dayValue !== "object") continue;
    const row = dayValue[difficulty];
    if (!row || typeof row !== "object") continue;
    const id = parseInt(String(row.problemId || ""), 10);
    if (Number.isInteger(id) && id > 0) excluded.add(id);
  }
  return excluded;
}

function resolveLeetTodayTimeZone() {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: BOJ_TODAY_TIMEZONE }).format(new Date());
    return BOJ_TODAY_TIMEZONE;
  } catch {
    return "Asia/Seoul";
  }
}

function getDateKeyInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
}

async function ensureLeetTodayLoaded() {
  if (leetTodayLoaded) {
    return;
  }

  const dir = path.dirname(BOJ_TODAY_CACHE_PATH);
  let loadMode = "empty";

  try {
    await fs.mkdir(dir, { recursive: true });
    const raw = await fs.readFile(BOJ_TODAY_CACHE_PATH, "utf8");
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.byDate && typeof parsed.byDate === "object") {
        leetTodayCache = parsed;
        ensureLeetTodayCacheShape();
        loadMode = "file";
      } else {
        leetTodayCache = { byDate: {}, recentByDifficulty: {} };
        loadMode = "invalid-reset";
      }
    } catch {
      leetTodayCache = { byDate: {}, recentByDifficulty: {} };
      loadMode = "invalid-reset";
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.log("[boj][WARN] 오늘의문제 캐시 로드 실패:", err.message, "| path:", BOJ_TODAY_CACHE_PATH);
    }
    leetTodayCache = { byDate: {}, recentByDifficulty: {} };
  }

  ensureLeetTodayCacheShape();
  leetTodayLoaded = true;
  console.log(`[boj][INFO] 오늘의문제 캐시 준비 완료: mode=${loadMode} path=${BOJ_TODAY_CACHE_PATH}`);
}

function pruneLeetTodayCache(maxDays) {
  ensureLeetTodayCacheShape();
  const keys = Object.keys(leetTodayCache.byDate).sort();
  while (keys.length > maxDays) {
    const oldest = keys.shift();
    if (!oldest) break;
    delete leetTodayCache.byDate[oldest];
  }
}

async function persistLeetTodayCache() {
  await ensureLeetTodayLoaded();
  pruneLeetTodayCache(14);
  const payload = JSON.stringify(leetTodayCache, null, 2);
  await fs.writeFile(BOJ_TODAY_CACHE_PATH, payload, "utf8");
}

function enqueueLeetTodayTask(task) {
  const scheduled = leetTodayQueue.then(task, task);
  leetTodayQueue = scheduled.catch(() => {});
  return scheduled;
}

async function fetchBojProblemsPage(range, page) {
  const query = `tier:${range.min}..${range.max}`;
  const url = `${BOJ_SEARCH_API_URL}?query=${encodeURIComponent(query)}&page=${page}`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "daily-problem-bot/1.0",
      },
    },
    BOJ_FETCH_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new Error(`solved.ac API HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("solved.ac API 응답 형식이 올바르지 않습니다.");
  }
  return payload;
}

async function pickLeetRandomQuestion(difficulty, options = {}) {
  const excludedProblemIds = options.excludedProblemIds instanceof Set
    ? options.excludedProblemIds
    : new Set();
  const range = getBojTierRangeByDifficulty(difficulty);
  const firstPagePayload = await fetchBojProblemsPage(range, 1);
  const totalCount = Number(firstPagePayload.count);
  const total = Number.isFinite(totalCount) ? totalCount : firstPagePayload.items.length;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("조건에 맞는 문제를 찾지 못했습니다.");
  }

  const pageSize = firstPagePayload.items.length > 0 ? firstPagePayload.items.length : 50;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const maxRandomAttempts = Math.max(6, Math.min(maxPage, 12));
  for (let attempt = 0; attempt < maxRandomAttempts; attempt += 1) {
    const randomPage = 1 + Math.floor(Math.random() * maxPage);
    const payload = randomPage === 1
      ? firstPagePayload
      : await fetchBojProblemsPage(range, randomPage);
    const pool = payload.items
      .filter((item) => Number.isInteger(item.problemId))
      .filter((item) => hasKoreanCharacters(item.titleKo))
      .filter((item) => !excludedProblemIds.has(item.problemId));
    if (pool.length === 0) {
      continue;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    return {
      title: String(picked.titleKo || picked.title || `BOJ ${picked.problemId}`),
      problemId: picked.problemId,
      level: Number.isInteger(picked.level) ? picked.level : 0,
    };
  }

  throw new Error("조건(한글 제목/중복 제외)에 맞는 문제를 찾지 못했습니다.");
}

function formatLeetQuestionLine(prefix, difficulty, question) {
  const label = formatLeetDifficultyLabel(difficulty);
  const url = `https://www.acmicpc.net/problem/${question.problemId}`;
  const tier = formatBojTier(question.level);
  return (
    `${prefix} (${label})\n` +
    `- 제목: ${question.title}\n` +
    `- 티어: ${tier}\n` +
    `- 링크: ${url}`
  );
}

function requireAdminAuthorization(userId) {
  if (ADMIN_USER_IDS.length === 0) {
    return {
      ok: false,
      message: "⚠️ 관리자 권한자가 설정되지 않았습니다. `ADMIN_USER_IDS`에 Discord 사용자 ID를 지정해주세요.",
    };
  }

  if (!isSafeUserId(userId) || !ADMIN_USER_IDS.includes(userId)) {
    return {
      ok: false,
      message: "⛔ 이 명령은 관리자만 실행할 수 있습니다.",
    };
  }

  return { ok: true };
}

function formatAvailableCommands(commands) {
  return (
    "📌 사용 가능한 명령어\n" +
    commands
      .map(({ command, description }) => `- \`${command}\` : ${description}`)
      .join("\n")
  );
}

function getAvailableCommandsMessage() {
  const commands = [
    { command: "!도움", description: "명령어 목록" },
    { command: "!랜덤 문제 [쉬움|중간|어려움]", description: "난이도별 랜덤 문제 조회" },
    { command: "!오늘의 문제 [(쉬움|중간|어려움)]", description: "오늘의 문제 고정 조회" },
    { command: "!오늘의 문제 리셋", description: "당일 문제 캐시 리셋(관리자)" },
    { command: "!추첨 [N]", description: "온라인 멤버 추첨" },
    { command: "!가위바위보 <가위|바위|보>", description: "가위바위보 게임" },
    { command: "!가위바위보 전적", description: "나의 전적 조회" },
    { command: "!가위바위보 랭킹 [N]", description: "전적 랭킹 조회" },
    { command: "!봇 업데이트", description: "watchtower 1회 실행으로 업데이트" },
  ];

  return formatAvailableCommands(commands);
}

function formatBootVersionMessage() {
  return (
    "ℹ️ 봇이 재시작되었습니다.\n\n" +
    `${getAvailableCommandsMessage()}`
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on("ready", async () => {
  console.log("문제 출제 봇 준비 완료");
  await ensureLeetTodayLoaded();
  if (!ALLOWED_CHANNEL_ID) {
    return;
  }

  try {
    const statusChannel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
    if (!statusChannel || !statusChannel.isTextBased()) {
      console.log("[status] allowed channel is not a text channel.");
      return;
    }
    await statusChannel.send(formatBootVersionMessage());
  } catch (err) {
    console.log("[status] failed to send restart message:", err.message);
  }
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (ALLOWED_CHANNEL_ID && msg.channelId !== ALLOWED_CHANNEL_ID) return;

  const content = msg.content.trim();

  if (content === "!도움") {
    msg.reply(getAvailableCommandsMessage());
    return;
  }

  if (content === "!봇 업데이트" || content === "!봇업데이트") {
    if (updateInProgress) {
      return msg.reply("⏳ 이미 업데이트 작업이 진행 중입니다.");
    }

    const auth = isAuthorizedUpdater(msg.author.id);
    if (!auth.ok) {
      return msg.reply(auth.message);
    }

    updateInProgress = true;
    await msg.reply("🔄 봇 이미지 업데이트 확인을 시작하고 봇을 재시작합니다.");

    try {
      const runOnceCommand = getWatchtowerRunOnceCommand();
      await docker(runOnceCommand);
      await msg.channel.send(
        `업데이트 확인이 완료되었습니다.\n- scope: ${WATCHTOWER_SCOPE}\n- 명령어: \`${runOnceCommand}\``
      );
    } catch (err) {
      console.log("[command] !봇 업데이트 failed:", err.message);
      await msg.channel.send(
        "⚠️ 봇 업데이트 실행에 실패했습니다. Docker 접근 권한, WATCHTOWER_IMAGE, 라벨 설정을 확인해주세요."
      );
    } finally {
      updateInProgress = false;
    }
    return;
  }

  const raffleMatch = content.match(/^!추첨(?:\s+(\d+))?$/);
  if (raffleMatch) {
    const requestedCount = raffleMatch[1] ? parseInt(raffleMatch[1], 10) : 1;
    if (!Number.isInteger(requestedCount) || requestedCount <= 0) {
      return msg.reply("⚠️ 사용법: `!추첨` 또는 `!추첨 N` (N은 1 이상의 정수)");
    }

    const onlineResult = await getOnlineHumanMembers(msg.guild);
    if (!onlineResult.ok) {
      return msg.reply(onlineResult.message);
    }

    const onlineMembers = onlineResult.members;
    if (requestedCount > onlineMembers.length) {
      return msg.reply(
        `⚠️ 온라인 유저는 ${onlineMembers.length}명입니다. \`!추첨 ${onlineMembers.length}\` 이하로 입력해주세요.`
      );
    }

    const winners = pickRandomMembers(onlineMembers, requestedCount);
    const mentions = winners.map((member) => `<@${member.id}>`).join(", ");

    if (requestedCount === 1) {
      return msg.reply(`🎉 추첨 결과: ${mentions}`);
    }

    return msg.reply(
      `🎉 추첨 결과 (${requestedCount}명 / 온라인 ${onlineMembers.length}명)\n${mentions}`
    );
  }

  const rpsMatch = content.match(/^!가위바위보(?:\s+(.+))?$/);
  if (rpsMatch) {
    await ensureRpsStatsLoaded();

    const rpsArg = String(rpsMatch[1] || "").trim();
    if (!rpsArg) {
      return msg.reply(
        "⚠️ 사용법: `!가위바위보 가위|바위|보`, `!가위바위보 전적`, `!가위바위보 랭킹 [N]`"
      );
    }

    if (rpsArg === "전적") {
      const record = getOrCreateRpsRecord(rpsStats, msg.author.id);
      return msg.reply(`📊 <@${msg.author.id}> 기록\n${formatRpsRecord(record)}`);
    }

    const rankingMatch = rpsArg.match(/^랭킹(?:\s+(\d+))?$/);
    if (rankingMatch) {
      const limit = rankingMatch[1] ? parseInt(rankingMatch[1], 10) : 10;
      if (!Number.isInteger(limit) || limit <= 0) {
        return msg.reply("⚠️ 사용법: `!가위바위보 랭킹` 또는 `!가위바위보 랭킹 N`");
      }

      const ranking = getRpsRanking(Math.min(limit, 30));
      if (ranking.length === 0) {
        return msg.reply("📊 아직 가위바위보 전적이 없습니다.");
      }

      const lines = ranking.map((row, index) => (
        `${index + 1}. <@${row.userId}> - ${formatRpsRecord(row.record)} | 승률 ${formatRankingWinRate(row.record)}`
      ));
      return msg.reply(`🏆 가위바위보 랭킹 TOP ${ranking.length}\n${lines.join("\n")}`);
    }

    const userChoice = normalizeRpsChoice(rpsArg);
    if (!userChoice) {
      return msg.reply(
        "⚠️ 사용법: `!가위바위보 가위|바위|보`, `!가위바위보 전적`, `!가위바위보 랭킹 [N]`"
      );
    }

    const botChoice = ["가위", "바위", "보"][Math.floor(Math.random() * 3)];
    const result = evaluateRps(userChoice, botChoice);
    const record = await updateRpsStatsForUser(msg.author.id, result);
    const requesterName = (
      msg.member?.displayName ||
      msg.author.globalName ||
      msg.author.username ||
      "플레이어"
    ).trim();
    return msg.reply(
      `${requesterName}${rpsChoiceEmoji(userChoice)} vs ${rpsChoiceEmoji(botChoice)} = ${rpsResultEmoji(result)} ${result}\n📈 ${formatRpsRecord(record)}`
    );
  }

  const randomQuestionMatch = content.match(/^!(?:랜덤문제|랜덤\s+문제)(?:\s+(.+))?$/);
  if (randomQuestionMatch) {
    const difficultyArg = String(randomQuestionMatch[1] || "").trim();
    const difficulty = normalizeLeetDifficulty(difficultyArg);
    if (!difficulty) {
      return msg.reply("⚠️ 사용법: `!랜덤 문제 [쉬움|중간|어려움]`");
    }

    try {
      const question = await pickLeetRandomQuestion(difficulty);
      return msg.reply(formatLeetQuestionLine("🎲 랜덤문제", difficulty, question));
    } catch (err) {
      console.log("[boj][WARN] !랜덤 문제 실패:", err.message);
      return msg.reply(`⚠️ 랜덤문제 조회 실패: ${err.message}`);
    }
  }

  const todayQuestionMatch = content.match(/^!(?:오늘의문제|오늘의\s+문제)(?:\s+\(([^)]+)\)|\s+(.+))?$/);
  if (todayQuestionMatch) {
    const rawArg = String(todayQuestionMatch[1] || todayQuestionMatch[2] || "").trim();
    const normalizedArg = rawArg.replace(/\s+/g, "").toLowerCase();
    if (["리셋", "reset"].includes(normalizedArg)) {
      const adminAuth = requireAdminAuthorization(msg.author.id);
      if (!adminAuth.ok) {
        return msg.reply(adminAuth.message);
      }

      const timezone = resolveLeetTodayTimeZone();
      const dateKey = getDateKeyInTimeZone(new Date(), timezone);
      try {
        await enqueueLeetTodayTask(async () => {
          await ensureLeetTodayLoaded();
          ensureLeetTodayCacheShape();
          const dayBucket = leetTodayCache.byDate[dateKey];
          if (dayBucket && typeof dayBucket === "object") {
            for (const [difficulty, row] of Object.entries(dayBucket)) {
              if (row && typeof row === "object" && Number.isInteger(row.problemId)) {
                rememberTodayProblem(difficulty, row.problemId);
              }
            }
          }
          delete leetTodayCache.byDate[dateKey];
          await persistLeetTodayCache();
        });
        console.log(`[boj][INFO] 오늘의문제 리셋 완료: date=${dateKey} by=${msg.author.id}`);
        return msg.reply(`🧹 오늘의문제를 리셋했습니다. (${dateKey}, ${timezone})`);
      } catch (err) {
        console.log("[boj][WARN] !오늘의 문제 리셋 실패:", err.message);
        return msg.reply(`⚠️ 오늘의문제 리셋 실패: ${err.message}`);
      }
    }

    const difficulty = normalizeLeetDifficulty(rawArg);
    if (!difficulty) {
      return msg.reply("⚠️ 사용법: `!오늘의 문제`, `!오늘의 문제 (중간)`, `!오늘의 문제 리셋`");
    }

    const timezone = resolveLeetTodayTimeZone();
    const dateKey = getDateKeyInTimeZone(new Date(), timezone);
    try {
      const selected = await enqueueLeetTodayTask(async () => {
        await ensureLeetTodayLoaded();
        ensureLeetTodayCacheShape();
        if (!leetTodayCache.byDate[dateKey] || typeof leetTodayCache.byDate[dateKey] !== "object") {
          leetTodayCache.byDate[dateKey] = {};
        }

        const cached = leetTodayCache.byDate[dateKey][difficulty];
        if (cached && cached.problemId) {
          return { question: cached, reused: true };
        }

        const excludedProblemIds = collectExcludedTodayProblemIds(difficulty);
        const question = await pickLeetRandomQuestion(difficulty, { excludedProblemIds });
        leetTodayCache.byDate[dateKey][difficulty] = {
          title: question.title,
          problemId: question.problemId,
          level: question.level,
          difficulty,
          selectedAt: new Date().toISOString(),
        };
        rememberTodayProblem(difficulty, question.problemId);
        await persistLeetTodayCache();
        return { question: leetTodayCache.byDate[dateKey][difficulty], reused: false };
      });

      const header = selected.reused
        ? `📌 오늘의문제 고정 (${dateKey}, ${timezone})`
        : `📌 오늘의문제 확정 (${dateKey}, ${timezone})`;
      return msg.reply(formatLeetQuestionLine(header, difficulty, selected.question));
    } catch (err) {
      console.log("[boj][WARN] !오늘의 문제 실패:", err.message);
      return msg.reply(`⚠️ 오늘의문제 조회 실패: ${err.message}`);
    }
  }
});

client.login(BOT_TOKEN);
