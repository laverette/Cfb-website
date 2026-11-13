/**
 * Pre-kickoff availability from ESPN team news plus the player's own game log.
 *
 * ESPN's college injury endpoint is years out of date, and a language model
 * "feel" for the game is not a measurable input. This module only acts on a
 * sentence that names the player and states a status, or on a regular who
 * disappeared from the box score. Adjustments are fixed multipliers so the
 * grading loop can tell whether they helped.
 */
const { normalizePlayerName } = require("./data/game-key");

const NEWS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SEASON_ENDING_MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000;

const OUT_PATTERNS = [
  /done for (the )?(rest of the )?season/,
  /out for the season/,
  /(miss|missing) the rest of the season/,
  /season-ending/,
  /ruled out/,
  /will not play/,
  /won'?t play/,
  /not expected to play/,
  /will miss (the )?(game|week|saturday|friday|this week|the rest)/,
  /listed (as )?out/,
  /is out (for|against|vs|this)/,
  /torn (acl|mcl|pcl|achilles|labrum)/,
  /shut down for the season/,
  /out indefinitely/,
];

const DOUBTFUL_PATTERNS = [/\bdoubtful\b/, /unlikely to play/];

const QUESTIONABLE_PATTERNS = [/\bquestionable\b/, /game-time decision/, /game time decision/];

const RETURNING_PATTERNS = [
  /expected to play/,
  /cleared to (play|return)/,
  /will return/,
  /will be available/,
  /is available (this week|saturday|friday|against|vs)/,
  /will play/,
];

const NEW_STARTER_PATTERNS = [
  /first (career )?start/,
  /named (the )?(starter|starting)/,
  /gets the start/,
  /will start (at|against|vs|this)/,
  /taking over as/,
];

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordBoundary(token) {
  return new RegExp(`\\b${escapeRegExp(token)}\\b`);
}

function playerTokens(playerName) {
  const parts = normalizePlayerName(playerName).split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return { full: parts.join(" "), first: parts[0], last: parts[parts.length - 1] };
}

function textMentionsPlayer(text, tokens) {
  if (!text || !tokens) return false;
  const norm = normalizePlayerName(text);
  return wordBoundary(tokens.first).test(norm) && wordBoundary(tokens.last).test(norm);
}

function articleMentionsPlayer(article, tokens) {
  if (!tokens) return false;
  const cats = article?.categories || [];
  if (cats.some((c) => normalizePlayerName(c) === tokens.full || textMentionsPlayer(c, tokens))) {
    return true;
  }
  return textMentionsPlayer(`${article?.headline || ""} ${article?.description || ""}`, tokens);
}

function relevantText(article, tokens) {
  const chunks = [];
  const headline = article?.headline || "";
  const description = String(article?.description || "");
  const sentences = description.split(/(?<=[.!?])\s+/);
  if (textMentionsPlayer(headline, tokens)) chunks.push(headline);
  for (const sentence of sentences) {
    if (textMentionsPlayer(sentence, tokens)) chunks.push(sentence);
  }
  if (chunks.length) return chunks.join(". ").toLowerCase();

  const tagged = (article?.categories || []).some(
    (c) => normalizePlayerName(c) === tokens.full || textMentionsPlayer(c, tokens)
  );
  if (!tagged) return "";
  const last = wordBoundary(tokens.last);
  if (last.test(normalizePlayerName(headline))) chunks.push(headline);
  for (const sentence of sentences) {
    if (last.test(normalizePlayerName(sentence))) chunks.push(sentence);
  }
  return chunks.join(". ").toLowerCase();
}

function matchPattern(text, patterns) {
  return patterns.find((re) => re.test(text)) || null;
}

/**
 * Status of one article, using only the sentences that name the player.
 * Season-ending language is kept longer than a weekly report.
 */
function classifyArticle(article, tokens) {
  const text = relevantText(article, tokens);
  if (!text) return null;
  const out = matchPattern(text, OUT_PATTERNS);
  if (out) {
    const seasonEnding = /season|torn |indefinitely|shut down/.test(text);
    return { status: "out", phrase: out.source, seasonEnding };
  }
  const doubtful = matchPattern(text, DOUBTFUL_PATTERNS);
  if (doubtful) return { status: "doubtful", phrase: doubtful.source, seasonEnding: false };
  const questionable = matchPattern(text, QUESTIONABLE_PATTERNS);
  if (questionable) return { status: "questionable", phrase: questionable.source, seasonEnding: false };
  const returning = matchPattern(text, RETURNING_PATTERNS);
  if (returning) return { status: "returning", phrase: returning.source, seasonEnding: false };
  const starter = matchPattern(text, NEW_STARTER_PATTERNS);
  if (starter) return { status: "new_starter", phrase: starter.source, seasonEnding: false };
  return null;
}

function articleTime(article) {
  const t = Date.parse(article?.published || "");
  return Number.isFinite(t) ? t : null;
}

function isFresh(article, classified, now) {
  const t = articleTime(article);
  if (t == null) return true;
  const maxAge = classified.seasonEnding ? SEASON_ENDING_MAX_AGE_MS : NEWS_MAX_AGE_MS;
  return now - t <= maxAge;
}

function pickNews(articles, tokens, now) {
  const ranked = (articles || [])
    .map((article) => {
      const classified = classifyArticle(article, tokens);
      if (!classified || !isFresh(article, classified, now)) return null;
      return { article, classified, time: articleTime(article) || 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.time - a.time);
  return ranked[0] || null;
}

function logContext({ gameLogs, schedule, week }) {
  const target = Number(week);
  const playedWeeks = [
    ...new Set((gameLogs || []).map((g) => Number(g.week)).filter(Number.isFinite)),
  ].sort((a, b) => a - b);
  const teamWeeks = [
    ...new Set(
      (schedule || [])
        .filter((g) => {
          const w = Number(g.week);
          if (!Number.isFinite(w)) return false;
          if (Number.isFinite(target) && w >= target) return false;
          return Boolean(g.completed) || w < target;
        })
        .map((g) => Number(g.week))
        .filter(Number.isFinite)
    ),
  ].sort((a, b) => a - b);

  const played = new Set(playedWeeks);
  const lastPlayed =
    playedWeeks.filter((w) => !Number.isFinite(target) || w < target).pop() ?? null;
  const missed = teamWeeks.filter((w) => !played.has(w));
  const recentMissed = lastPlayed == null ? [] : missed.filter((w) => w > lastPlayed);
  const priorSlots = teamWeeks.filter((w) => lastPlayed != null && w <= lastPlayed);
  const priorPlayed = priorSlots.filter((w) => played.has(w)).length;
  const playRate = priorSlots.length ? priorPlayed / priorSlots.length : 0;
  const internalGap = missed.some((w) => lastPlayed != null && w < lastPlayed);
  return {
    recentMissed,
    internalGap,
    lastPlayed,
    playRate,
    priorSlots: priorSlots.length,
  };
}

function quote(headline) {
  const h = String(headline || "").trim();
  return h ? `"${h}"` : null;
}

function emptyAvailability() {
  return {
    status: "none",
    evidence: "none",
    headline: null,
    sourceUrl: null,
    published: null,
    phrase: null,
    note: null,
    recentMissed: 0,
  };
}

/**
 * Newest matching report wins. A fresh "will play" therefore clears an older
 * "out". Log gaps fill in only when no report names the player.
 */
function resolveAvailability({
  playerName,
  articles = [],
  gameLogs = [],
  schedule = [],
  week = null,
  now = Date.now(),
} = {}) {
  const tokens = playerTokens(playerName);
  const logs = logContext({ gameLogs, schedule, week });
  const news = tokens ? pickNews(articles, tokens, now) : null;

  if (news) {
    const headline = news.article.headline || null;
    const base = {
      status: news.classified.status,
      evidence: "news",
      headline,
      sourceUrl: news.article.sourceUrl || null,
      published: news.article.published || null,
      phrase: news.classified.phrase,
      recentMissed: logs.recentMissed.length,
      note: null,
    };
    if (base.status === "out") {
      base.note = quote(headline)
        ? `Reported out: ${quote(headline)}. Pass this prop. A player who doesn't take the field is usually voided, so the under is not a result.`
        : "Reported out. Pass this prop.";
    } else if (base.status === "doubtful") {
      base.note = quote(headline)
        ? `Doubtful: ${quote(headline)}. Projection cut 22% for a reduced or missed role.`
        : "Doubtful. Projection cut 22%.";
    } else if (base.status === "questionable") {
      base.note = quote(headline)
        ? `Questionable: ${quote(headline)}. Projection cut 8% and the range widened.`
        : "Questionable. Projection cut 8% and the range widened.";
    } else if (base.status === "returning") {
      base.note = quote(headline)
        ? `Expected back: ${quote(headline)}. The projection uses the games played.`
        : "Expected back. The projection uses the games played.";
    } else if (base.status === "new_starter") {
      base.note = quote(headline)
        ? `Named starter: ${quote(headline)}.`
        : "Named starter.";
    }
    return base;
  }

  const regular = logs.playRate >= 0.67 && logs.priorSlots >= 3;
  if (regular && logs.recentMissed.length >= 1) {
    const n = logs.recentMissed.length;
    const pct = n >= 2 ? 20 : 12;
    return {
      status: "possible_absence",
      evidence: "game_log",
      headline: null,
      sourceUrl: null,
      published: null,
      phrase: null,
      recentMissed: n,
      note: `No stat line in the last ${n} completed team game${n === 1 ? "" : "s"} after a regular role. Projection cut ${pct}% until a return is reported.`,
    };
  }
  if (regular && logs.internalGap && logs.recentMissed.length === 0) {
    return {
      status: "returning",
      evidence: "game_log",
      headline: null,
      sourceUrl: null,
      published: null,
      phrase: null,
      recentMissed: 0,
      note: "Back after a missed game. The projection uses the games played, which leave the absence out.",
    };
  }
  return { ...emptyAvailability(), recentMissed: logs.recentMissed.length };
}

function starterVolume(family, usage) {
  const u = usage || {};
  if (family === "passing") return Number(u.passAtt) || 0;
  if (family === "rushing") return Number(u.rushAtt) || 0;
  if (family === "receiving") return Number(u.rec) || 0;
  return null;
}

function belowStarterVolume(family, usage) {
  const volume = starterVolume(family, usage);
  if (volume == null) return false;
  if (family === "passing") return volume < 15;
  if (family === "rushing") return volume < 8;
  if (family === "receiving") return volume < 3;
  return false;
}

/**
 * Fixed, auditable moves. Out does not zero the mean: that would turn a void
 * into a fake under. The caller blocks the bet instead.
 */
function adjustmentFor(availability, { projection, family, usage } = {}) {
  const mean = Number(projection);
  const base = {
    projection: Number.isFinite(mean) ? mean : projection,
    delta: 0,
    sdScale: 1,
    flags: [],
    blockBet: false,
    status: availability?.status || "none",
    evidence: availability?.evidence || "none",
    headline: availability?.headline || null,
    sourceUrl: availability?.sourceUrl || null,
    note: availability?.note || null,
    recentMissed: availability?.recentMissed || 0,
  };
  if (!availability || !Number.isFinite(mean) || !availability.status || availability.status === "none") {
    return base;
  }

  if (availability.status === "out") {
    return { ...base, blockBet: true, flags: ["Unavailable"] };
  }
  if (availability.status === "doubtful") {
    const next = mean * 0.78;
    return { ...base, projection: next, delta: next - mean, sdScale: 1.25, flags: ["Doubtful"] };
  }
  if (availability.status === "questionable") {
    const next = mean * 0.92;
    return { ...base, projection: next, delta: next - mean, sdScale: 1.15, flags: ["Questionable"] };
  }
  if (availability.status === "possible_absence") {
    const cut = (availability.recentMissed || 1) >= 2 ? 0.8 : 0.88;
    const next = mean * cut;
    return { ...base, projection: next, delta: next - mean, sdScale: 1.2, flags: ["Possible Absence"] };
  }
  if (availability.status === "new_starter") {
    if (!belowStarterVolume(family, usage)) {
      return { ...base, status: "none", note: null };
    }
    const next = mean * 1.12;
    return {
      ...base,
      projection: next,
      delta: next - mean,
      flags: ["New Starter"],
      note: availability.headline
        ? `Named starter: "${availability.headline}". The season average is still a reserve role, so the projection is lifted 12%.`
        : "Named starter. The season average is still a reserve role, so the projection is lifted 12%.",
    };
  }
  if (availability.status === "returning") {
    return { ...base, flags: ["Returning"] };
  }
  return base;
}

module.exports = {
  resolveAvailability,
  adjustmentFor,
  classifyArticle,
  articleMentionsPlayer,
  playerTokens,
  emptyAvailability,
  OUT_PATTERNS,
};
