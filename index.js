const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs/promises");
const path = require("path");

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
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

let leetTodayLoaded = false;
let leetTodayCache = { byDate: {}, recentByDifficulty: {} };
let leetTodayQueue = Promise.resolve();

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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on("clientReady", async () => {
  console.log("문제 출제 봇 준비 완료");
  await ensureLeetTodayLoaded();
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();

  console.log(
    "[command] received message:",
    content,
    "| from:",
    `${msg.author.username}#${msg.author.discriminator}`
  );

  if (content === "!도움") {
    msg.reply(
      "📌 사용 가능한 명령어\n" +
        "!도움\n" +
        "!랜덤 문제 [쉬움|중간|어려움]\n" +
        "!오늘의 문제 [(쉬움|중간|어려움)]\n" +
        "!오늘의 문제 리셋 (관리자)"
    );
    return;
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
