/**
 * Admin feedback management.
 * PATCH /api/admin/feedback  { type: 'feedback'|'name', id, pinned?: boolean, status?: string }
 * DELETE /api/admin/feedback?type=feedback&id=123
 */
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");
const { getSupabase, hasSupabase } = require("./db");

function tableForType(type) {
  const t = String(type || "feedback").toLowerCase();
  if (t === "name" || t === "name_suggestion" || t === "site_name") {
    return "site_name_suggestions";
  }
  return "beta_feedback";
}

function parseId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  if (!hasSupabase()) {
    return json(503, { error: "Database unavailable" });
  }

  const method = event.httpMethod || "GET";
  const qs = event.queryStringParameters || {};
  const body = method === "DELETE" ? {} : parseJsonBody(event) || {};
  const type = body.type || qs.type || "feedback";
  const table = tableForType(type);
  const id = parseId(body.id != null ? body.id : qs.id);

  if (!id) {
    return json(400, { error: "Valid id is required" });
  }

  const supabase = getSupabase();

  try {
    if (method === "DELETE") {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) {
        console.error("admin-feedback delete:", error);
        return json(500, { error: error.message || "Delete failed" });
      }
      return json(200, { ok: true, deleted: id, type: table === "beta_feedback" ? "feedback" : "name" });
    }

    if (method === "PATCH" || method === "POST") {
      const patch = {};
      if (body.pinned != null) {
        patch.pinned = Boolean(body.pinned);
      }
      if (body.status != null) {
        const status = String(body.status).trim().toLowerCase();
        const allowed =
          table === "beta_feedback"
            ? ["new", "reviewed", "done"]
            : ["new", "reviewed", "shortlisted", "rejected"];
        if (!allowed.includes(status)) {
          return json(400, { error: "Invalid status" });
        }
        patch.status = status;
      }
      if (!Object.keys(patch).length) {
        return json(400, { error: "Nothing to update (pinned or status)" });
      }

      const { data, error } = await supabase
        .from(table)
        .update(patch)
        .eq("id", id)
        .select("*")
        .maybeSingle();

      if (error) {
        console.error("admin-feedback update:", error);
        return json(500, { error: error.message || "Update failed" });
      }
      if (!data) {
        return json(404, { error: "Not found" });
      }
      return json(200, {
        ok: true,
        type: table === "beta_feedback" ? "feedback" : "name",
        row: data,
      });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("admin-feedback:", err);
    return json(500, { error: err.message || "Server error" });
  }
};
