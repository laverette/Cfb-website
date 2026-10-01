/**
 * POST /api/feedback
 * Body: { message, category?, email?, page? }
 * Stores in beta_feedback (Supabase) and emails site owner via Resend when configured.
 * Auth optional.
 */
const { json, parseJsonBody } = require("./_http");
const { optionalAuth } = require("./_auth");
const { sendEmail, isEmailConfigured, readFromEmail } = require("./_lib/email");
const {
  insertBetaFeedback,
  recordProductEvent,
  sanitizeAnonId,
} = require("./_lib/product-analytics");

function readFeedbackTo() {
  const explicit =
    (process.env.FEEDBACK_TO_EMAIL && String(process.env.FEEDBACK_TO_EMAIL).trim()) ||
    (process.env.ADMIN_EMAIL && String(process.env.ADMIN_EMAIL).trim()) ||
    "";
  if (explicit && explicit.includes("@")) return explicit;
  const from = readFromEmail();
  if (from && from.includes("@") && !/@resend\.dev$/i.test(from.split("<").pop() || from)) {
    const m = from.match(/<([^>]+)>/) || [null, from];
    return String(m[1] || from).trim();
  }
  return "loganaverette10@gmail.com";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeCategory(raw) {
  const c = String(raw || "general").trim().toLowerCase();
  if (c === "bug" || c === "feature" || c === "general") return c;
  if (c === "feature_request" || c === "feature-request") return "feature";
  return "general";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { error: "Invalid JSON body" });
  }

  const message = String(body.message || "").trim();
  if (message.length < 8) {
    return json(400, { error: "Please write a bit more (at least a short sentence)." });
  }
  if (message.length > 4000) {
    return json(400, { error: "Feedback is too long (max 4000 characters)." });
  }

  const replyEmail = String(body.email || "").trim();
  if (replyEmail && !replyEmail.includes("@")) {
    return json(400, { error: "That email doesn’t look valid." });
  }

  const category = normalizeCategory(body.category);
  const page = String(body.page || "").trim().slice(0, 300);
  const auth = optionalAuth(event);
  const user = auth && auth.payload ? auth.payload : null;
  const userId = user && user.userId != null ? user.userId : null;
  const anon = sanitizeAnonId(body.anonymousSessionId || body.sessionId);

  // Persist to Supabase first so feedback is never lost if email is down.
  let stored = null;
  try {
    stored = await insertBetaFeedback({
      userId,
      category,
      message,
      page,
    });
  } catch (err) {
    console.warn("feedback db:", err?.message || err);
  }

  try {
    await recordProductEvent({
      eventName: "feedback_submitted",
      userId,
      anonymousSessionId: anon,
      properties: { category, page: page || undefined },
    });
  } catch (err) {
    console.warn("feedback analytics:", err?.message || err);
  }

  const to = readFeedbackTo();
  const emailOk = isEmailConfigured() && !!to;
  if (emailOk) {
    const who = user
      ? `${user.username || "user"} (id ${user.userId})`
      : replyEmail || "anonymous visitor";

    const subject = `[Site feedback · ${category}] ${page || "unknown page"}`;
    const text = [
      `From: ${who}`,
      `Category: ${category}`,
      replyEmail && !user ? `Reply-to: ${replyEmail}` : null,
      page ? `Page: ${page}` : null,
      stored && stored.id ? `Feedback id: ${stored.id}` : null,
      "",
      message,
    ]
      .filter(Boolean)
      .join("\n");

    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#1a1410;">
      <p><strong>From:</strong> ${escapeHtml(who)}</p>
      <p><strong>Category:</strong> ${escapeHtml(category)}</p>
      ${replyEmail ? `<p><strong>Reply email:</strong> ${escapeHtml(replyEmail)}</p>` : ""}
      ${page ? `<p><strong>Page:</strong> ${escapeHtml(page)}</p>` : ""}
      <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
      <p style="white-space:pre-wrap;">${escapeHtml(message)}</p>
    </div>
  `.trim();

    try {
      await sendEmail({
        to,
        subject,
        text,
        html,
        ...(replyEmail ? { replyTo: replyEmail } : {}),
      });
    } catch (err) {
      console.error("feedback email:", err);
      // DB save still counts as success for the user.
      if (stored) {
        return json(200, {
          ok: true,
          message: "Thanks — feedback saved.",
          id: stored.id,
        });
      }
      return json(500, { error: "Could not send feedback. Try again later." });
    }
  } else if (!stored) {
    return json(503, {
      error: "Feedback is temporarily unavailable.",
      code: "FEEDBACK_UNAVAILABLE",
    });
  }

  return json(200, {
    ok: true,
    message: "Thanks — feedback sent.",
    id: stored ? stored.id : undefined,
  });
};
