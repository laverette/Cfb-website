/**
 * Netlify Function: CFBD API proxy
 *
 * Frontend calls:
 *   /.netlify/functions/cfbd?path=/games&year=2026&week=1&seasonType=regular
 *
 * The `path` param chooses the CFBD endpoint path; all other query params are forwarded.
 * API key is ONLY read from process.env.CFBD_API_KEY and is never returned to the browser.
 */
const CFBD_BASE_URL = "https://api.collegefootballdata.com";

const ALLOWED_PREFIXES = [
  "/games",
  "/game",
  "/calendar",
  "/records",
  "/scoreboard",
  "/drives",
  "/plays",
  "/play",
  "/live",
  "/teams",
  "/roster",
  "/talent",
  "/coaches",
  "/conferences",
  "/venues",
  "/rankings",
  "/lines",
  "/recruiting",
  "/ratings",
  "/metrics",
  "/ppa",
  "/stats",
  "/player",
  "/draft",
  "/wepa",
  "/info",
];

const DEFAULT_TIMEOUT_MS = 12_000;

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function normalizePath(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isSafeCfbdPath(path) {
  // Reject absolute URLs or protocol-relative URLs
  if (/^https?:\/\//i.test(path) || /^\/\//.test(path)) return false;

  // Reject traversal / backslashes / embedded querystring/fragment
  if (path.includes("..")) return false;
  if (path.includes("\\")) return false;
  if (path.includes("?") || path.includes("#")) return false;

  // Reject any percent-encoded trickery; callers should not need encoding in the path.
  if (/%[0-9a-f]{2}/i.test(path)) return false;

  // Allow only URL-safe path chars (no spaces, quotes, etc.)
  if (!/^\/[A-Za-z0-9/_\.-]*$/.test(path)) return false;

  // Must begin with a known CFBD category/prefix
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function buildUpstreamUrl(cfbdPath, query) {
  const url = new URL(CFBD_BASE_URL + cfbdPath);
  for (const [key, value] of query.entries()) {
    if (key === "path") continue;
    if (value == null) continue;
    url.searchParams.append(key, value);
  }
  return url;
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed. Only GET is supported right now." }, { allow: "GET" });
  }

  const apiKey = process.env.CFBD_API_KEY;
  if (!apiKey) {
    return json(500, {
      error: "Missing server configuration: CFBD_API_KEY is not set.",
      hint: "Set CFBD_API_KEY in Netlify environment variables and in local dev env when using netlify dev.",
    });
  }

  const rawPath = event.queryStringParameters?.path;
  const cfbdPath = normalizePath(rawPath);
  if (!cfbdPath) {
    return json(400, {
      error: "Missing required query param: path",
      example: "/.netlify/functions/cfbd?path=/teams/fbs&year=2026",
    });
  }

  if (!isSafeCfbdPath(cfbdPath)) {
    return json(400, {
      error: "Invalid CFBD path.",
      details:
        "Path must be a safe CFBD API path beginning with an allowed category (e.g. /games, /teams, /rankings) and must not include absolute URLs, '..', backslashes, or a query string inside the path.",
      received: cfbdPath,
    });
  }

  const query = new URLSearchParams(event.queryStringParameters || {});
  const upstreamUrl = buildUpstreamUrl(cfbdPath, query);

  const controller = new AbortController();
  const timeoutMs = Number(event.queryStringParameters?.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1_000), 30_000));

  try {
    const resp = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      signal: controller.signal,
    });

    const contentType = resp.headers.get("content-type") || "";
    const isJson = contentType.toLowerCase().includes("application/json");
    const payload = isJson ? await resp.json().catch(() => null) : await resp.text();

    if (!resp.ok) {
      // Preserve useful upstream errors (401/403/404/429/etc)
      return json(resp.status, {
        error: "CFBD upstream error.",
        status: resp.status,
        statusText: resp.statusText,
        path: cfbdPath,
        upstream: isJson ? payload : { message: String(payload || "").slice(0, 2_000) },
      });
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
      body: isJson ? JSON.stringify(payload) : String(payload),
    };
  } catch (err) {
    if (err?.name === "AbortError") {
      return json(504, {
        error: "CFBD upstream request timed out.",
        timeoutMs,
        path: cfbdPath,
      });
    }

    return json(502, {
      error: "Failed to reach CFBD upstream.",
      message: err?.message || String(err),
      path: cfbdPath,
    });
  } finally {
    clearTimeout(timeout);
  }
};

