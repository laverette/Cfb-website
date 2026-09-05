/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Always returns a generic success message (does not reveal whether email exists).
 */
const crypto = require("crypto");
const {
  findUserByUsernameOrEmail,
  createPasswordResetToken,
} = require("./db");
const { json, parseJsonBody } = require("./_http");
const {
  sendEmail,
  isEmailConfigured,
  siteBaseUrl,
  buildPasswordResetEmail,
} = require("./_lib/email");

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const GENERIC_OK =
  "If an account exists for that email, we sent a password reset link. Check your inbox (and spam).";

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { message: "Invalid JSON body" });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return json(400, { message: "A valid email is required" });
  }

  // Always respond the same way after processing attempts
  const respondOk = () => json(200, { message: GENERIC_OK });

  try {
    if (!isEmailConfigured()) {
      console.error("forgot-password: email not configured");
      return json(503, {
        message:
          "Password reset email is not configured on the server yet. Contact the site admin.",
      });
    }

    const row = await findUserByUsernameOrEmail(email);
    if (!row || !row.email) {
      return respondOk();
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await createPasswordResetToken(row.id, tokenHash, expiresAt);

    const base = siteBaseUrl() || "";
    const resetUrl = `${base}/reset-password.html?token=${encodeURIComponent(token)}`;
    const mail = buildPasswordResetEmail({
      displayName: row.display_name || row.username,
      resetUrl,
      expiresMinutes: 60,
    });

    await sendEmail({
      to: row.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    return respondOk();
  } catch (err) {
    console.error("auth-forgot-password:", err);
    if (err.code === "EMAIL_NOT_CONFIGURED") {
      return json(503, {
        message:
          "Password reset email is not configured on the server yet. Contact the site admin.",
      });
    }
    // Don't leak internals; still avoid confirming account existence on most failures
    return json(500, { message: "Could not process password reset. Try again later." });
  }
};
