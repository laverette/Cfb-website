/**
 * Shared ESPN HTTP helpers: timeout, limited retries, dedupe, concurrency.
 */

const { recordApiUsage } = require("../../../api-usage");
const { dataLog } = require("../log");
const { cached } = require("../../cache");

const FETCH_HEADERS = {
  accept: "application/json, text/plain, */*",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;
const inflight = globalThis.__cfb_espn_inflight || new Map();
globalThis.__cfb_espn_inflight = inflight;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(signal, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

async function rawFetchJson(url, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const gate = withTimeout(signal, timeoutMs);
  try {
    const resp = await fetch(url, { headers: FETCH_HEADERS, signal: gate.signal });
    recordApiUsage({ feature: "prop-lab", source: "espn", calls: 1 });
    const text = await resp.text().catch(() => "");
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!resp.ok) {
      const err = new Error(`ESPN HTTP ${resp.status} for ${url.slice(0, 120)}`);
      err.status = resp.status;
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    gate.cleanup();
  }
}

async function fetchJsonRetry(url, opts = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await rawFetchJson(url, opts);
    } catch (err) {
      lastErr = err;
      if (err?.name === "AbortError") throw err;
      const status = Number(err.status);
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt === MAX_RETRIES) throw err;
      const backoff = 300 * 2 ** attempt + Math.floor(Math.random() * 120);
      dataLog("ESPN", `Retry ${attempt + 1} after ${backoff}ms`, status || err.message);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

async function dedupedFetch(url, opts = {}) {
  const key = `espn:http:${url}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchJsonRetry(url, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function cachedEspnGet(cacheKey, ttlMs, url, opts = {}) {
  const hit = await cached(cacheKey, ttlMs, () => dedupedFetch(url, opts), {
    persist: opts.persist !== false,
  });
  return { value: hit.value, cacheSource: hit.source };
}

async function mapPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(5, Number(concurrency) || 3));
  const out = new Array(list.length);
  let idx = 0;
  async function run() {
    while (idx < list.length) {
      const i = idx;
      idx += 1;
      out[i] = await worker(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => run()));
  return out;
}

module.exports = {
  SITE,
  WEB,
  CORE,
  FETCH_HEADERS,
  dedupedFetch,
  cachedEspnGet,
  mapPool,
  fetchJsonRetry,
};
