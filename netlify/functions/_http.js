function jsonBigIntReplacer(_key, value) {
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : String(value);
  }
  return value;
}

function json(statusCode, body, extraHeaders = {}) {
  let serialized;
  try {
    serialized = JSON.stringify(body, jsonBigIntReplacer);
  } catch (e) {
    serialized = JSON.stringify({
      error: "JSON serialization failed",
      details: e && e.message ? String(e.message).slice(0, 200) : "unknown",
    });
  }
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
    body: serialized,
  };
}

function parseJsonBody(event) {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

module.exports = { json, parseJsonBody };
