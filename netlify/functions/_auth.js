/**
 * JWT helpers for Netlify Functions. Requires process.env.JWT_SECRET.
 * Payload: userId, username, email, role (from Users.role; admin === 'admin').
 */
const jwt = require("jsonwebtoken");
const { json } = require("./_http");

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  return s && String(s).trim() ? String(s).trim() : null;
}

function getExpiresIn() {
  const raw = process.env.JWT_EXPIRES_IN;
  if (raw && String(raw).trim()) return String(raw).trim();
  return "60m";
}

function getBearerToken(event) {
  const h = event.headers || {};
  const single = h.authorization || h.Authorization || h["x-authorization"] || "";
  if (single) {
    const m = /^Bearer\s+(\S+)/i.exec(String(single).trim());
    if (m) return m[1];
  }
  const mv = event.multiValueHeaders || {};
  const list =
    mv.Authorization ||
    mv.authorization ||
    mv["X-Authorization"] ||
    mv["x-authorization"];
  if (Array.isArray(list) && list.length) {
    const m = /^Bearer\s+(\S+)/i.exec(String(list[0]).trim());
    if (m) return m[1];
  }
  return null;
}

function signUserToken(userRow) {
  const secret = getJwtSecret();
  if (!secret) {
    const err = new Error("NO_JWT_SECRET");
    err.code = "NO_JWT_SECRET";
    throw err;
  }
  const role =
    userRow.role != null && String(userRow.role).trim() !== ""
      ? String(userRow.role)
      : "user";
  const payload = {
    userId: userRow.id,
    username: userRow.username,
    email: userRow.email,
    role,
  };
  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    expiresIn: getExpiresIn(),
  });
}

function verifyUserToken(token) {
  const secret = getJwtSecret();
  if (!secret) return null;
  try {
    return jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    return null;
  }
}

/**
 * @returns {null|{ payload: object }} null if OK to proceed; otherwise a json response
 */
function jwtSecretOr500() {
  if (!getJwtSecret()) {
    return json(500, { error: "Server misconfiguration" });
  }
  return null;
}

/**
 * @returns {import('./_http').json|{ payload: object }}
 * If return has statusCode, it's an error response. Otherwise `payload` is the JWT payload.
 */
function requireAuth(event) {
  const mis = jwtSecretOr500();
  if (mis) return mis;
  const token = getBearerToken(event);
  if (!token) {
    return json(401, { error: "Authentication required" });
  }
  const payload = verifyUserToken(token);
  if (!payload || payload.userId == null) {
    return json(401, { error: "Authentication required" });
  }
  return { payload };
}

/**
 * @returns {null|object} null if admin OK; otherwise json error response
 */
function requireAdmin(event) {
  const r = requireAuth(event);
  if (r.statusCode) return r;
  const role = String(r.payload.role || "").toLowerCase();
  if (role !== "admin") {
    return json(403, { error: "Admin access required" });
  }
  return null;
}

module.exports = {
  getBearerToken,
  signUserToken,
  verifyUserToken,
  requireAuth,
  requireAdmin,
  jwtSecretOr500,
};
