/**
 * GET /api/admin/cfbd-games?season_year=&week_number=&season_type=regular
 * Server-side CFBD fetch (never exposes CFBD_API_KEY).
 * Includes betting spread from /lines when available (prefers consensus).
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

  if (!Number.isFinite(year) || !Number.isFinite(week)) {
    return json(400, { error: "season_year and week_number are required" });
  }

  const headers = {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
  };

  try {
    const gamesUrl = `${CFBD_BASE}/games?year=${year}&week=${week}&seasonType=${encodeURIComponent(
      seasonType
    )}`;
    const teamsUrl = `${CFBD_BASE}/teams?year=${year}`;
    const linesUrl = `${CFBD_BASE}/lines?year=${year}&week=${week}&seasonType=${encodeURIComponent(
      seasonType
    )}`;

    const [gamesRes, teamsRes, linesRes] = await Promise.all([
      fetch(gamesUrl, { headers }),
      fetch(teamsUrl, { headers }),
      fetch(linesUrl, { headers }),
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

    const list = (Array.isArray(games) ? games : []).map((g) => {
      const homeId = g.homeId;
      const awayId = g.awayId;
      const cfbdId = g.id;
      return {
        cfbd_game_id: cfbdId,
        home_team_name: g.homeTeam || "",
        away_team_name: g.awayTeam || "",
        home_team_espn_id: homeId,
        away_team_espn_id: awayId,
        home_team_logo_url: logoByTeamId.get(homeId) || "",
        away_team_logo_url: logoByTeamId.get(awayId) || "",
        game_date: g.startDate || null,
        venue: g.venue != null ? String(g.venue) : null,
        betting_line: spreadByGameId.has(Number(cfbdId))
          ? spreadByGameId.get(Number(cfbdId))
          : null,
        is_completed: Boolean(g.completed),
      };
    });

    return json(200, {
      games: list,
      linesAttached: list.filter((g) => g.betting_line != null).length,
    });
  } catch (err) {
    console.error("admin-cfbd-games:", err);
    return json(500, { error: "Internal server error" });
  }
};
