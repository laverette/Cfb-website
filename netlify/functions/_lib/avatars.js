/**
 * Shared avatar ids: A1.png … A12.png under Resources/Images/avatars/
 */
const AVATAR_COUNT = 12;
const AVATAR_DIR = "Resources/Images/avatars/";

function parseAvatarId(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  const asNum = Number(s);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= AVATAR_COUNT) {
    return asNum;
  }
  const m =
    s.match(/(?:^|[\\/])A(\d{1,2})(?:\.(?:png|jpe?g|webp|svg))?$/i) ||
    s.match(/^A(\d{1,2})$/i) ||
    s.match(/Avatar\s*(\d{1,2})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= AVATAR_COUNT ? n : null;
}

function avatarPathForId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || n > AVATAR_COUNT) return null;
  return `${AVATAR_DIR}A${n}.png`;
}

function resolveAvatarUrl(raw) {
  const id = parseAvatarId(raw);
  return id ? avatarPathForId(id) : null;
}

module.exports = {
  AVATAR_COUNT,
  AVATAR_DIR,
  parseAvatarId,
  avatarPathForId,
  resolveAvatarUrl,
};
