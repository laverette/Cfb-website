const PROXY_BASE = "/.netlify/functions/cfbd";

class CfbdApiError extends Error {
  constructor(message, { status, details, path, params } = {}) {
    super(message);
    this.name = "CfbdApiError";
    this.status = status;
    this.details = details;
    this.path = path;
    this.params = params;
  }
}

function toSearchParams(params = {}) {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v) => sp.append(key, String(v)));
      return;
    }
    sp.append(key, String(value));
  });
  return sp;
}

/**
 * Generic CFBD request. This NEVER calls the CFBD API directly.
 *
 * @param {string} path - CFBD API path like "/games" or "/teams/fbs"
 * @param {Record<string, any>} params - forwarded as query params
 * @param {RequestInit & { signal?: AbortSignal }} options
 */
export async function cfbdRequest(path, params = {}, options = {}) {
  if (typeof path !== "string" || !path.trim()) {
    throw new CfbdApiError("cfbdRequest requires a non-empty path string.", { path });
  }

  const sp = toSearchParams({ path, ...(params || {}) });
  const url = `${PROXY_BASE}?${sp.toString()}`;

  const resp = await fetch(url, {
    method: "GET",
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers || {}),
    },
  });

  const contentType = resp.headers.get("content-type") || "";
  const isJson = contentType.toLowerCase().includes("application/json");
  const body = isJson ? await resp.json().catch(() => null) : await resp.text().catch(() => "");

  if (!resp.ok) {
    const message =
      (body && typeof body === "object" && (body.error || body.message)) ||
      `CFBD request failed with status ${resp.status}`;

    throw new CfbdApiError(String(message), {
      status: resp.status,
      details: body,
      path,
      params,
    });
  }

  return body;
}

// ---------------------------------------------------------------------------
// Convenience wrappers (generic cfbdRequest is the primary interface)
// ---------------------------------------------------------------------------

export const getGames = (params, options) => cfbdRequest("/games", params, options);
export const getCalendar = (params, options) => cfbdRequest("/calendar", params, options);
export const getRecords = (params, options) => cfbdRequest("/records", params, options);
export const getTeams = (params, options) => cfbdRequest("/teams", params, options);
export const getTeamInfo = (params, options) => cfbdRequest("/info", params, options);
export const getRoster = (params, options) => cfbdRequest("/roster", params, options);
export const getConferences = (options) => cfbdRequest("/conferences", {}, options);
export const getVenues = (options) => cfbdRequest("/venues", {}, options);
export const getRankings = (params, options) => cfbdRequest("/rankings", params, options);
export const getLines = (params, options) => cfbdRequest("/lines", params, options);
export const getSpRatings = (params, options) => cfbdRequest("/ratings/sp", params, options);
export const getSrsRatings = (params, options) => cfbdRequest("/ratings/srs", params, options);
export const getPregameWinProbability = (params, options) =>
  cfbdRequest("/metrics/wp/pregame", params, options);
export const getTeamPpa = (params, options) => cfbdRequest("/ppa/teams", params, options);
export const getTeamSeasonStats = (params, options) => cfbdRequest("/stats/season", params, options);
export const getPlayerSeasonStats = (params, options) => cfbdRequest("/stats/player/season", params, options);
export const getRecruitingTeams = (params, options) => cfbdRequest("/recruiting/teams", params, options);
export const getRecruitingPlayers = (params, options) => cfbdRequest("/recruiting/players", params, options);

export { CfbdApiError };

