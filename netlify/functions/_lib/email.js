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

function buildPickReminderEmail({ displayName, weekLabel, locksAt, picksUrl, settingsUrl }) {
  const name = displayName || "there";
  const lockLabel = formatLockTimeEt(locksAt);
  const subject = `${weekLabel} picks lock soon — submit yours`;
  const text = [
    `Hi ${name},`,
    "",
    `You haven't submitted your ${weekLabel} weekly picks yet.`,
    `Picks lock at ${lockLabel}.`,
    "",
    `Submit picks: ${picksUrl}`,
    "",
    `Manage email reminders: ${settingsUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1a1410;">
      <p style="color:#8b6914;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 8px;">Weekly Picks</p>
      <h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(weekLabel)} picks lock soon</h1>
      <p style="line-height:1.5;">Hi ${escapeHtml(name)}, you haven't submitted your picks for <strong>${escapeHtml(weekLabel)}</strong> yet.</p>
      <p style="line-height:1.5;">Picks lock at <strong>${escapeHtml(lockLabel)}</strong>.</p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(picksUrl)}" style="display:inline-block;background:linear-gradient(135deg,#FFD700,#FFA000);color:#1a1410;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px;">Submit picks</a>
      </p>
      <p style="font-size:13px;color:#666;line-height:1.5;">
        You're receiving this because you opted in to pick reminders.
        <a href="${escapeHtml(settingsUrl)}" style="color:#8b6914;">Manage notification settings</a>
      </p>
    </div>
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

module.exports = {
  sendEmail,
  isEmailConfigured,
  siteBaseUrl,
  buildPickReminderEmail,
  readFromEmail,
};
