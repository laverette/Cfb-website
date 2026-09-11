/**
 * POST /api/feedback
 * Body: { message, email?, page? }
 * Emails site owner via Resend. Auth optional (adds username if logged in).
 */
const { json, parseJsonBody } = require("./_http");
const { optionalAuth } = require("./_auth");
const { sendEmail, isEmailConfigured, readFromEmail } = require("./_lib/email");

function readFeedbackTo() {
  const explicit =
    (process.env.FEEDBACK_TO_EMAIL && String(process.env.FEEDBACK_TO_EMAIL).trim()) ||
    (process.env.ADMIN_EMAIL && String(process.env.ADMIN_EMAIL).trim()) ||
    "";
  if (explicit && explicit.includes("@")) return explicit;
  // Fall back to From address only when it looks like a real inbox (not Resend onboarding).
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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (!isEmailConfigured()) {
    return json(503, {
      error: "Feedback is temporarily unavailable.",
      code: "EMAIL_NOT_CONFIGURED",
    });
  }

  const to = readFeedbackTo();
  if (!to) {
    return json(503, {
      error: "Feedback is temporarily unavailable.",
      code: "FEEDBACK_TO_NOT_CONFIGURED",
    });
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

  const page = String(body.page || "").trim().slice(0, 300);
  const auth = optionalAuth(event);
  const user = auth && auth.payload ? auth.payload : null;
  const who = user
    ? `${user.username || "user"} (id ${user.userId})${user.email ? ` · ${user.email}` : ""}`
    : replyEmail || "anonymous visitor";

  const subject = `[Site feedback] ${page || "unknown page"}`;
  const text = [
    `From: ${who}`,
    replyEmail && !user ? `Reply-to: ${replyEmail}` : null,
    page ? `Page: ${page}` : null,
    "",
    message,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#1a1410;">
      <p><strong>From:</strong> ${escapeHtml(who)}</p>
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
    return json(200, { ok: true, message: "Thanks — feedback sent." });
  } catch (err) {
    console.error("feedback:", err);
    return json(500, { error: "Could not send feedback. Try again later." });
  }
};
