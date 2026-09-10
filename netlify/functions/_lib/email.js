/**
 * Transactional email via Resend (https://resend.com).
 * Set RESEND_API_KEY and PICK_REMINDER_FROM_EMAIL in Netlify env.
 */

function readResendKey() {
  return (process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim()) || "";
}

function readFromEmail() {
  const from =
    (process.env.PICK_REMINDER_FROM_EMAIL &&
      String(process.env.PICK_REMINDER_FROM_EMAIL).trim()) ||
    (process.env.EMAIL_FROM && String(process.env.EMAIL_FROM).trim()) ||
    "";
  return from;
}

function siteBaseUrl() {
  const raw =
    (process.env.SITE_URL && String(process.env.SITE_URL).trim()) ||
    (process.env.URL && String(process.env.URL).trim()) ||
    "";
  return raw.replace(/\/+$/, "");
}

function isEmailConfigured() {
  return Boolean(readResendKey() && readFromEmail());
}

async function sendEmail({ to, subject, html, text }) {
  const apiKey = readResendKey();
  const from = readFromEmail();
  if (!apiKey || !from) {
    const err = new Error("Email is not configured (RESEND_API_KEY / PICK_REMINDER_FROM_EMAIL)");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  if (!to || !String(to).includes("@")) {
    const err = new Error("Invalid recipient email");
    err.code = "INVALID_EMAIL";
    throw err;
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [String(to).trim()],
      subject: String(subject || "").trim(),
      html: html || undefined,
      text: text || undefined,
    }),
  });

  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(body.message || `Resend HTTP ${resp.status}`);
    err.code = "EMAIL_SEND_FAILED";
    err.status = resp.status;
    err.details = body;
    throw err;
  }
  return body;
}

function formatLockTimeEt(iso) {
  if (!iso) return "soon";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function buildPickReminderEmail({
  displayName,
  weekLabel,
  locksAt,
  picksUrl,
  settingsUrl,
  isTest = false,
}) {
  const name = displayName || "there";
  const week = String(weekLabel || "This week").trim();
  const lockLabel = formatLockTimeEt(locksAt);
  const subjectBase = `${week} picks lock soon — submit yours`;
  const subject = isTest ? `[TEST] ${subjectBase}` : subjectBase;
  const preheader = `Picks lock at ${lockLabel}. Submit before the deadline.`;

  const text = [
    isTest ? "[TEST REMINDER]" : null,
    `Hi ${name},`,
    "",
    `You haven't submitted your ${week} weekly picks yet.`,
    `Picks lock at ${lockLabel}.`,
    "",
    `Submit picks: ${picksUrl}`,
    "",
    `Manage email reminders: ${settingsUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const siteHost = (() => {
    try {
      return new URL(picksUrl).host || "cfbapp.netlify.app";
    } catch {
      return "cfbapp.netlify.app";
    }
  })();
  const siteHome = (() => {
    try {
      const u = new URL(picksUrl);
      return `${u.origin}/`;
    } catch {
      return picksUrl;
    }
  })();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subjectBase)}</title>
</head>
<body style="margin:0;padding:0;background:#1a1410;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1410;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:linear-gradient(165deg,#3e2723 0%,#2a1c16 55%,#1e1510 100%);border:1px solid #8d6e63;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#ffd700,#ffa000,#ffd700);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;font-family:Georgia,'Times New Roman',serif;color:#f5deb3;">
              ${
                isTest
                  ? `<p style="margin:0 0 12px;display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(255,215,0,0.12);border:1px solid rgba(255,215,0,0.35);color:#ffd700;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">Test email</p>`
                  : ""
              }
              <p style="margin:0 0 8px;color:#ffd700;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;font-weight:700;">College Football Predictions</p>
              <h1 style="margin:0 0 14px;font-size:26px;line-height:1.25;color:#ffd700;font-weight:700;">${escapeHtml(week)} picks lock soon</h1>
              <p style="margin:0 0 18px;font-size:16px;line-height:1.55;color:#f5deb3;">
                Hi ${escapeHtml(name)} — you still haven’t locked in your board for <strong style="color:#ffe566;">${escapeHtml(week)}</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,0,0,0.28);border:1px solid rgba(255,215,0,0.28);border-radius:12px;">
                <tr>
                  <td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;">
                    <p style="margin:0 0 4px;color:#bfa88a;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Deadline</p>
                    <p style="margin:0;color:#ffd700;font-size:18px;font-weight:800;line-height:1.3;">${escapeHtml(lockLabel)}</p>
                    <p style="margin:8px 0 0;color:#d4b896;font-size:13px;line-height:1.4;">Picks lock 30 minutes after Saturday’s first kickoff.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 28px 8px;">
              <a href="${escapeHtml(picksUrl)}" style="display:inline-block;background:linear-gradient(135deg,#ffd700,#ffa000);color:#1a1410;text-decoration:none;font-weight:800;font-family:Arial,Helvetica,sans-serif;font-size:15px;padding:14px 28px;border-radius:999px;border:1px solid #e6ac00;">Submit your picks →</a>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0;font-size:12px;line-height:1.55;color:#bfa88a;">
                You’re getting this because reminders are on for your account.
                <a href="${escapeHtml(settingsUrl)}" style="color:#ffd700;text-decoration:underline;">Manage notification settings</a>
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6d5a4a;max-width:560px;">
          Sent by College Football Predictions · <a href="${escapeHtml(siteHome)}" style="color:#8d6e63;">${escapeHtml(siteHost)}</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, html, text };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPasswordResetEmail({ displayName, resetUrl, expiresMinutes = 60 }) {
  const name = displayName || "there";
  const mins = Number(expiresMinutes) || 60;
  const subject = "Reset your CFB Predictions password";
  const text = [
    `Hi ${name},`,
    "",
    "We received a request to reset your password.",
    `This link expires in ${mins} minutes:`,
    resetUrl,
    "",
    "If you didn't ask for this, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1a1410;">
      <p style="color:#8b6914;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 8px;">Account</p>
      <h1 style="font-size:22px;margin:0 0 12px;">Reset your password</h1>
      <p style="line-height:1.5;">Hi ${escapeHtml(name)}, we received a request to reset your CFB Predictions password.</p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:linear-gradient(135deg,#FFD700,#FFA000);color:#1a1410;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px;">Choose a new password</a>
      </p>
      <p style="font-size:13px;color:#666;line-height:1.5;">This link expires in ${mins} minutes. If you didn't request a reset, you can ignore this email.</p>
    </div>
  `.trim();

  return { subject, html, text };
}

module.exports = {
  sendEmail,
  isEmailConfigured,
  siteBaseUrl,
  buildPickReminderEmail,
  buildPasswordResetEmail,
  readFromEmail,
};
