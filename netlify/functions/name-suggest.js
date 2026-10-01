/**
 * POST /api/name-suggest
 * Body: { suggestedName, note?, page? }
 * Auth optional. Stores in site_name_suggestions.
 */
const { json, parseJsonBody } = require("./_http");
const { optionalAuth } = require("./_auth");
const { getSupabase, hasSupabase } = require("./db");
const { recordProductEvent, sanitizeAnonId } = require("./_lib/product-analytics");

function cleanName(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (!hasSupabase()) {
    return json(503, { error: "Suggestions are temporarily unavailable." });
  }

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { error: "Invalid JSON body" });
  }

  const suggestedName = cleanName(body.suggestedName || body.name || body.suggestion);
  if (suggestedName.length < 2) {
    return json(400, { error: "Please enter a name (at least 2 characters)." });
  }
  if (suggestedName.length > 80) {
    return json(400, { error: "Keep the name under 80 characters." });
  }

  const note = String(body.note || body.message || "")
    .trim()
    .slice(0, 500);
  const page = String(body.page || "").trim().slice(0, 300);
  const auth = optionalAuth(event);
  const userId =
    auth && auth.payload && auth.payload.userId != null ? auth.payload.userId : null;
  const anon = sanitizeAnonId(body.anonymousSessionId || body.sessionId);

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("site_name_suggestions")
      .insert({
        user_id: userId,
        suggested_name: suggestedName,
        note: note || null,
        page: page || null,
        status: "new",
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("name-suggest:", error);
      return json(500, { error: "Could not save that suggestion. Try again." });
    }

    recordProductEvent({
      eventName: "feedback_submitted",
      userId,
      anonymousSessionId: anon,
      properties: { category: "name_suggestion", page: page || undefined },
    });

    return json(200, {
      ok: true,
      message: "Thanks — name suggestion saved.",
      id: data ? data.id : undefined,
    });
  } catch (err) {
    console.error("name-suggest:", err);
    return json(500, { error: "Could not save that suggestion. Try again." });
  }
};
