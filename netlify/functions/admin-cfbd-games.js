/**
 * GET /api/admin/cfbd-games?season_year=&week_number=&season_type=regular&classification=fbs
 * Server-side CFBD fetch (never exposes CFBD_API_KEY).
 * Includes betting spread from /lines when available (prefers consensus).
 * Attaches AP Top 25 (fallback Coaches) ranks when CFBD rankings exist for the week.
 * classification: fbs | fcs | ii | iii | all (default fbs — keeps the picker usable).
 */
const CFBD_BASE = "https://api.collegefootballdata.com";
const { json } = require("./_http");
const { requireAdmin } = require("./_auth");

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Prefer consensus, then any provider with a spread. Spread is home-team oriented. */
function pickSpreadFromLinesEntry(entry) {
  const lines = Array.isArray(entry?.lines) ? entry.lines : [];
  if (!lines.length) return null;
  const preferred =
    lines.find((l) => String(l.provider || "").toLowerCase() === "consensus") ||
    lines.find((l) => numOrNull(l.spread) != null) ||
    lines[0];
  return numOrNull(preferred?.spread);
}

function buildSpreadByGameId(linesPayload) {
  const map = new Map();
  for (const entry of Array.isArray(linesPayload) ? linesPayload : []) {
    const id = entry?.id != null ? Number(entry.id) : NaN;
    if (!Number.isFinite(id)) continue;
    const spread = pickSpreadFromLinesEntry(entry);
    if (spread != null) map.set(id, spread);
  }
  return map;
}

function normalizeClassification(raw) {
  const v = String(raw || "fbs").trim().toLowerCase();
  if (v === "all" || v === "") return null;
  if (["fbs", "fcs", "ii", "iii"].includes(v)) return v;
  return "fbs";
}

function pickPreferredPoll(polls) {
  const list = Array.isArray(polls) ? polls : [];
  return (
    list.find((p) => /ap\s*top\s*25/i.test(String(p.poll || ""))) ||
    list.find((p) => /coaches/i.test(String(p.poll || ""))) ||
    list.find((p) => /playoff/i.test(String(p.poll || ""))) ||
    list[0] ||
    null
  );
}

/** school name (lower) → rank number */
function ranksFromPollWeek(weekEntry) {
  const poll = pickPreferredPoll(weekEntry?.polls);
  const map = new Map();
  if (!poll) return { map, pollName: null, week: weekEntry?.week ?? null };
  for (const r of Array.isArray(poll.ranks) ? poll.ranks : []) {
    const school = String(r.school || "").trim();
    const rank = numOrNull(r.rank);
    if (!school || rank == null) continue;
    map.set(school.toLowerCase(), rank);
  }
  return {
    map,
    pollName: poll.poll || null,
    week: weekEntry?.week ?? null,
  };
}

/**
 * Resolve ranks for a season week. Tries requested week, then week-1, week 1, then any.
 */
async function fetchRankBySchool({ headers, year, week, seasonType }) {
  const attempts = [];
  const seen = new Set();
  const pushWeek = (w) => {
    if (!Number.isFinite(w) || w < 1 || seen.has(w)) return;
    seen.add(w);
    attempts.push(w);
  };
  pushWeek(week);
  pushWeek(week - 1);
  pushWeek(1);

  for (const w of attempts) {
    const url = `${CFBD_BASE}/rankings?year=${year}&week=${w}&seasonType=${encodeURIComponent(
      seasonType
    )}`;
    const res = await fetch(url, { headers });
    if (!res.ok) continue;
    const payload = await res.json();
    const weeks = Array.isArray(payload) ? payload : [];
    if (!weeks.length) continue;
    const parsed = ranksFromPollWeek(weeks[0]);
    if (parsed.map.size) return parsed;
  }

  // Last resort: year-only (returns multiple weeks; use latest with ranks)
  const yearUrl = `${CFBD_BASE}/rankings?year=${year}&seasonType=${encodeURIComponent(
    seasonType
  )}`;
  const yearRes = await fetch(yearUrl, { headers });
  if (yearRes.ok) {
    const payload = await yearRes.json();
    const weeks = Array.isArray(payload) ? payload : [];
    for (let i = weeks.length - 1; i >= 0; i--) {
      const parsed = ranksFromPollWeek(weeks[i]);
      if (parsed.map.size) return parsed;
    }
  }

  return { map: new Map(), pollName: null, week: null };
}

/**
 * Match poll school → game team name.
 * Exact only (case-insensitive). Prefix soft-match is unsafe:
 * "Miami" must not hit "Miami (OH)", "Oregon" must not hit "Oregon State".
 */
function lookupRank(rankBySchool, teamName) {
  if (!teamName) return null;
  const key = String(teamName).trim().toLowerCase();
  if (!key) return null;
  if (rankBySchool.has(key)) return rankBySchool.get(key);
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const apiKey = process.env.CFBD_API_KEY;
  if (!apiKey) {
    return json(500, { error: "CFBD API not configured" });
  }

  const q = event.queryStringParameters || {};
  const year = parseInt(q.season_year ?? q.year ?? "", 10);
  const week = parseInt(q.week_number ?? q.week ?? "", 10);
  const seasonType = (q.season_type || "regular").toLowerCase();
  const classification = normalizeClassification(q.classification);

  if (!Number.isFinite(year) || !Number.isFinite(week)) {
    return json(400, { error: "season_year and week_number are required" });
  }

  const headers = {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
  };

  try {
    const classParam = classification
      ? `&classification=${encodeURIComponent(classification)}`
      : "";
    const gamesUrl = `${CFBD_BASE}/games?year=${year}&week=${week}&seasonType=${encodeURIComponent(
      seasonType
    )}${classParam}`;
    const teamsUrl = `${CFBD_BASE}/teams?year=${year}`;
    const linesUrl = `${CFBD_BASE}/lines?year=${year}&week=${week}&seasonType=${encodeURIComponent(
      seasonType
    )}`;

    const [gamesRes, teamsRes, linesRes, rankInfo] = await Promise.all([
      fetch(gamesUrl, { headers }),
      fetch(teamsUrl, { headers }),
      fetch(linesUrl, { headers }),
      fetchRankBySchool({ headers, year, week, seasonType }),
    ]);

    if (!gamesRes.ok) {
      const detail = await gamesRes.text();
      return json(502, {
        error: "CFBD games request failed",
        status: gamesRes.status,
        detail: detail.slice(0, 800),
      });
    }
    if (!teamsRes.ok) {
      const detail = await teamsRes.text();
      return json(502, {
        error: "CFBD teams request failed",
        status: teamsRes.status,
        detail: detail.slice(0, 800),
      });
    }

    const games = await gamesRes.json();
    const teams = await teamsRes.json();

    let spreadByGameId = new Map();
    if (linesRes.ok) {
      const linesPayload = await linesRes.json();
      spreadByGameId = buildSpreadByGameId(linesPayload);
    } else {
      console.warn("admin-cfbd-games: lines request failed", linesRes.status);
    }

    const logoByTeamId = new Map();
    for (const t of Array.isArray(teams) ? teams : []) {
      const logos = Array.isArray(t.logos) ? t.logos.filter(Boolean) : [];
      logoByTeamId.set(t.id, logos[0] || "");
    }

    const rankBySchool = rankInfo.map;

    const list = (Array.isArray(games) ? games : []).map((g) => {
      const homeId = g.homeId;
      const awayId = g.awayId;
      const cfbdId = g.id;
      const homeName = g.homeTeam || "";
      const awayName = g.awayTeam || "";
      const homeConf = g.homeConference || g.home_conference || null;
      const awayConf = g.awayConference || g.away_conference || null;
      const homeClass =
        g.homeClassification || g.home_classification || null;
      const awayClass =
        g.awayClassification || g.away_classification || null;
      const homeRank = lookupRank(rankBySchool, homeName);
      const awayRank = lookupRank(rankBySchool, awayName);
      return {
        cfbd_game_id: cfbdId,
        home_team_name: homeName,
        away_team_name: awayName,
        home_team_espn_id: homeId,
        away_team_espn_id: awayId,
        home_team_logo_url: logoByTeamId.get(homeId) || "",
        away_team_logo_url: logoByTeamId.get(awayId) || "",
        home_conference: homeConf,
        away_conference: awayConf,
        home_classification: homeClass,
        away_classification: awayClass,
        home_rank: homeRank,
        away_rank: awayRank,
        has_ranked_team: homeRank != null || awayRank != null,
        game_date: g.startDate || null,
        venue: g.venue != null ? String(g.venue) : null,
        betting_line: spreadByGameId.has(Number(cfbdId))
          ? spreadByGameId.get(Number(cfbdId))
          : null,
        is_completed: Boolean(g.completed),
      };
    });

    list.sort((a, b) => {
      const da = a.game_date ? Date.parse(a.game_date) : 0;
      const db = b.game_date ? Date.parse(b.game_date) : 0;
      return da - db;
    });

    const conferences = [
      ...new Set(
        list
          .flatMap((g) => [g.home_conference, g.away_conference])
          .filter(Boolean)
          .map((c) => String(c))
      ),
    ].sort((a, b) => a.localeCompare(b));

    return json(200, {
      games: list,
      conferences,
      classification: classification || "all",
      rankings: {
        poll: rankInfo.pollName,
        week: rankInfo.week,
        teamsRanked: rankBySchool.size,
        gamesWithRankedTeam: list.filter((g) => g.has_ranked_team).length,
      },
      linesAttached: list.filter((g) => g.betting_line != null).length,
    });
  } catch (err) {
    console.error("admin-cfbd-games:", err);
    return json(500, { error: "Internal server error" });
  }
};
