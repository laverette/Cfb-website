const { getSupabase, hasSupabase } = require("../../db");

const mem = globalThis.__cfb_prop_lab_mem || { store: new Map(), inflight: new Map() };
globalThis.__cfb_prop_lab_mem = mem;

function now() {
  return Date.now();
}

function readMemory(key) {
  const hit = mem.store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now()) {
    mem.store.delete(key);
    return null;
  }
  return hit.value;
}

function writeMemory(key, value, ttlMs) {
  const ttl = Math.max(5_000, Number(ttlMs) || 120_000);
  mem.store.set(key, { value, expiresAt: now() + ttl });
  if (mem.store.size > 400) {
    const first = mem.store.keys().next().value;
    mem.store.delete(first);
  }
}

async function readDb(key) {
  if (!hasSupabase()) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("prop_lab_cfbd_cache")
      .select("payload, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (error || !data) return null;
    if (data.expires_at && Date.parse(data.expires_at) <= now()) return null;
    return data.payload;
  } catch {
    return null;
  }
}

async function writeDb(key, value, ttlMs) {
  if (!hasSupabase()) return;
  try {
    const supabase = getSupabase();
    const expires = new Date(now() + Math.max(5_000, Number(ttlMs) || 120_000)).toISOString();
    await supabase.from("prop_lab_cfbd_cache").upsert(
      {
        cache_key: key,
        payload: value,
        expires_at: expires,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" }
    );
  } catch {
    // Table may not exist until the SQL migration is applied.
  }
}

async function cached(key, ttlMs, loader, { persist = true } = {}) {
  const memHit = readMemory(key);
  if (memHit != null) return { value: memHit, source: "memory" };
  const dbHit = persist ? await readDb(key) : null;
  if (dbHit != null) {
    writeMemory(key, dbHit, ttlMs);
    return { value: dbHit, source: "db" };
  }
  if (mem.inflight.has(key)) {
    const value = await mem.inflight.get(key);
    return { value, source: "inflight" };
  }
  const p = Promise.resolve()
    .then(loader)
    .then(async (value) => {
      writeMemory(key, value, ttlMs);
      if (persist && value != null) await writeDb(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      mem.inflight.delete(key);
    });
  mem.inflight.set(key, p);
  const value = await p;
  return { value, source: "network" };
}

module.exports = { cached, readMemory, writeMemory };
