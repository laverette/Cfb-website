/**
 * Product analytics unit tests — no CFBD/ESPN, no live DB required.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib");
const {
  sanitizeEventName,
  sanitizeAnonId,
  sanitizeUserId,
  sanitizeProperties,
  ALLOWED_EVENTS,
  uniqueActors,
  computeRetention,
  actorKey,
  parseRange,
} = require(path.join(root, "product-analytics"));
const { PRODUCT_EVENT_TYPES } = require(path.join(root, "product-analytics-events"));

describe("product analytics event allowlist", () => {
  it("accepts known product events", () => {
    assert.equal(sanitizeEventName("prop_evaluated"), "prop_evaluated");
    assert.equal(sanitizeEventName("CARD_SHARED"), "card_shared");
    assert.equal(sanitizeEventName("weekly_picks_submitted"), "weekly_picks_submitted");
  });

  it("rejects unknown / noisy events", () => {
    assert.equal(sanitizeEventName("mouse_move"), null);
    assert.equal(sanitizeEventName("scroll"), null);
    assert.equal(sanitizeEventName(""), null);
    assert.equal(sanitizeEventName("drop table;"), null);
  });

  it("eventTypes mirror allowlist", () => {
    for (const name of Object.values(PRODUCT_EVENT_TYPES)) {
      assert.ok(ALLOWED_EVENTS.has(name), `missing allowlist entry: ${name}`);
    }
  });
});

describe("product analytics sanitization", () => {
  it("sanitizes anonymous session ids", () => {
    assert.ok(sanitizeAnonId("abcdef12-3456"));
    assert.equal(sanitizeAnonId("short"), null);
    assert.equal(sanitizeAnonId("bad id with spaces!!!"), null);
  });

  it("sanitizes user ids", () => {
    assert.equal(sanitizeUserId(42), 42);
    assert.equal(sanitizeUserId("7"), 7);
    assert.equal(sanitizeUserId(0), null);
    assert.equal(sanitizeUserId("nope"), null);
  });

  it("strips sensitive properties", () => {
    const clean = sanitizeProperties({
      season: 2026,
      week: 6,
      password: "secret",
      token: "abc",
      email: "a@b.com",
      stack: "Error: boom",
      apiKey: "x",
      statType: "Rushing Yards",
      nested: { oops: true },
    });
    assert.equal(clean.season, 2026);
    assert.equal(clean.week, 6);
    assert.equal(clean.statType, "Rushing Yards");
    assert.equal(clean.password, undefined);
    assert.equal(clean.token, undefined);
    assert.equal(clean.email, undefined);
    assert.equal(clean.stack, undefined);
    assert.equal(clean.apiKey, undefined);
    assert.equal(clean.nested, undefined);
  });
});

describe("WAU / retention helpers", () => {
  it("uniqueActors treats user and anon separately", () => {
    const rows = [
      { event_name: "prop_evaluated", user_id: 1, anonymous_session_id: "aaaaaaaa" },
      { event_name: "prop_evaluated", user_id: 1, anonymous_session_id: "aaaaaaaa" },
      { event_name: "prop_lab_opened", user_id: null, anonymous_session_id: "bbbbbbbb" },
    ];
    const set = uniqueActors(rows);
    assert.equal(set.size, 2);
    assert.ok(set.has("u:1"));
    assert.ok(set.has("a:bbbbbbbb"));
  });

  it("computeRetention calculates week-to-week rate", () => {
    const prior = new Set(["u:1", "u:2", "a:x"]);
    const current = new Set(["u:1", "a:y"]);
    const ret = computeRetention(current, prior);
    assert.equal(ret.overlap, 1);
    assert.equal(ret.priorActive, 3);
    assert.equal(ret.rate, 33.3);
  });

  it("actorKey prefers authenticated user", () => {
    assert.equal(actorKey({ user_id: 9, anonymous_session_id: "zzzzzzzz" }), "u:9");
    assert.equal(actorKey({ user_id: null, anonymous_session_id: "zzzzzzzz" }), "a:zzzzzzzz");
  });
});

describe("admin range parsing", () => {
  it("parses presets without throwing", () => {
    const today = parseRange({ range: "today" });
    assert.equal(today.label, "Today");
    const week = parseRange({ range: "7d", week: "6" });
    assert.equal(week.week, 6);
    const season = parseRange({ range: "season" });
    assert.equal(season.label, "2026 Season");
  });
});

describe("analytics does not import sports clients", () => {
  it("product-analytics module has no CFBD/ESPN require graph", () => {
    const fs = require("fs");
    const src = fs.readFileSync(path.join(root, "product-analytics.js"), "utf8");
    assert.ok(!/cfbd/i.test(src) || /zero CFBD/i.test(src) || /Does NOT call CFBD/.test(src));
    assert.ok(!/require\(.*cfbd/.test(src));
    assert.ok(!/require\(.*espn/.test(src));
    assert.ok(!/collegefootballdata/i.test(src));
  });

  it("analytics-track handler never references sports APIs", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "analytics-track.js"),
      "utf8"
    );
    assert.ok(!/cfbd/i.test(src) || /Does NOT call CFBD/.test(src));
    assert.ok(!/require\(.*espn/.test(src));
    assert.ok(!/require\(.*cfbd/.test(src));
  });
});

describe("no paywall / stripe in analytics surface", () => {
  it("repo analytics files do not introduce Stripe or paywall gates", () => {
    const fs = require("fs");
    const files = [
      path.join(root, "product-analytics.js"),
      path.join(__dirname, "..", "netlify", "functions", "analytics-track.js"),
      path.join(__dirname, "..", "netlify", "functions", "admin-analytics.js"),
      path.join(__dirname, "..", "Frontend", "scripts", "analytics.js"),
    ];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      assert.ok(!/stripe/i.test(src), file);
      assert.ok(!/paywall/i.test(src), file);
      assert.ok(!/subscription/i.test(src) || /no subscription/i.test(src), file);
      assert.ok(!/freeUser|blockFeature|upgradeModal/i.test(src), file);
    }
  });
});

describe("insertProductEvent failure isolation", () => {
  it("insertProductEvent returns false without throwing when supabase unavailable", async () => {
    const mod = require(path.join(root, "product-analytics"));
    // hasSupabase() is false in unit test env without env vars — should return false safely.
    const ok = await mod.insertProductEvent({
      eventName: "prop_evaluated",
      anonymousSessionId: "test-session-abcdef",
      properties: { season: 2026 },
    });
    assert.equal(ok, false);
  });
});
