/**
 * Private leagues: create, join, list, detail, leaderboard.
 */
const {
  getSupabase,
  dbError,
  selectAllPages,
  loadCurrentWeek,
  findUserById,
  getLeaderboard,
} = require("../db");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function mapLeague(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    ownerUserId: Number(row.owner_user_id),
    inviteCode: row.invite_code,
    seasonYear: Number(row.season_year),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

function mapMember(row) {
  const u = row.users || {};
  return {
    userId: Number(row.user_id),
    username: u.username || null,
    displayName: u.display_name != null ? u.display_name : u.username,
    avatarUrl: u.avatar_url ?? null,
    joinedAt:
      row.joined_at instanceof Date
        ? row.joined_at.toISOString()
        : row.joined_at,
    isOwner: false,
  };
}

function randomInviteCode(len = 7) {
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

async function createLeague({ userId, name }) {
  const trimmed = String(name || "").trim().slice(0, 60);
  if (trimmed.length < 2) {
    const err = new Error("League name must be at least 2 characters");
    err.code = "INVALID_NAME";
    throw err;
  }

  const current = await loadCurrentWeek();
  const seasonYear =
    current?.season_year != null
      ? Number(current.season_year)
      : new Date().getFullYear();

  const supabase = getSupabase();
  let league = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const inviteCode = randomInviteCode();
    const { data, error } = await supabase
      .from("leagues")
      .insert({
        name: trimmed,
        owner_user_id: userId,
        invite_code: inviteCode,
        season_year: seasonYear,
      })
      .select("id, name, owner_user_id, invite_code, season_year, created_at")
      .single();
    if (!error && data) {
      league = data;
      break;
    }
    if (error && error.code !== "23505") {
      dbError(error);
    }
  }
  if (!league) {
    const err = new Error("Could not generate invite code");
    err.code = "CODE_FAILED";
    throw err;
  }

  const { error: memErr } = await supabase.from("league_members").insert({
    league_id: league.id,
    user_id: userId,
  });
  dbError(memErr);

  return mapLeague(league);
}

async function joinLeagueByCode({ userId, code }) {
  const inviteCode = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (inviteCode.length < 4) {
    const err = new Error("Enter a valid invite code");
    err.code = "INVALID_CODE";
    throw err;
  }

  const supabase = getSupabase();
  const { data: league, error } = await supabase
    .from("leagues")
    .select("id, name, owner_user_id, invite_code, season_year, created_at")
    .eq("invite_code", inviteCode)
    .maybeSingle();
  dbError(error);
  if (!league) {
    const err = new Error("Invite code not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const { error: memErr } = await supabase.from("league_members").upsert(
    {
      league_id: league.id,
      user_id: userId,
    },
    { onConflict: "league_id,user_id", ignoreDuplicates: true }
  );
  dbError(memErr);

  return mapLeague(league);
}

async function listLeaguesForUser(userId) {
  const supabase = getSupabase();
  const memberships = await selectAllPages(() =>
    supabase
      .from("league_members")
      .select(
        "league_id, joined_at, leagues ( id, name, owner_user_id, invite_code, season_year, created_at )"
      )
      .eq("user_id", userId)
  );

  const leagues = [];
  for (const row of memberships) {
    const league = mapLeague(row.leagues);
    if (!league) continue;
    const memberCount = await countLeagueMembers(league.id);
    leagues.push({
      ...league,
      memberCount,
      isOwner: league.ownerUserId === Number(userId),
      joinedAt:
        row.joined_at instanceof Date
          ? row.joined_at.toISOString()
          : row.joined_at,
    });
  }
  leagues.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return leagues;
}

async function countLeagueMembers(leagueId) {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("league_members")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId);
  dbError(error);
  return Number(count) || 0;
}

async function assertLeagueMember(leagueId, userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  dbError(error);
  return Boolean(data);
}

async function getLeagueDetail(leagueId, viewerUserId) {
  const supabase = getSupabase();
  const { data: league, error } = await supabase
    .from("leagues")
    .select("id, name, owner_user_id, invite_code, season_year, created_at")
    .eq("id", leagueId)
    .maybeSingle();
  dbError(error);
  if (!league) {
    const err = new Error("League not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const isMember = await assertLeagueMember(leagueId, viewerUserId);
  if (!isMember) {
    const err = new Error("You are not a member of this league");
    err.code = "FORBIDDEN";
    throw err;
  }

  const members = await selectAllPages(() =>
    supabase
      .from("league_members")
      .select(
        "user_id, joined_at, users ( id, username, display_name, avatar_url )"
      )
      .eq("league_id", leagueId)
      .order("joined_at", { ascending: true })
  );

  const ownerId = Number(league.owner_user_id);
  const mapped = members.map((m) => {
    const row = mapMember(m);
    row.isOwner = row.userId === ownerId;
    return row;
  });

  const owner = await findUserById(ownerId);
  return {
    league: {
      ...mapLeague(league),
      // Only members see invite code (already gated).
      inviteCode: league.invite_code,
    },
    members: mapped,
    owner: owner
      ? {
          userId: Number(owner.id),
          username: owner.username,
          displayName:
            owner.display_name != null ? owner.display_name : owner.username,
          avatarUrl: owner.avatar_url ?? null,
        }
      : null,
    isOwner: ownerId === Number(viewerUserId),
  };
}

async function getLeagueMemberUserIds(leagueId) {
  const rows = await selectAllPages(() =>
    getSupabase()
      .from("league_members")
      .select("user_id")
      .eq("league_id", leagueId)
  );
  return rows.map((r) => Number(r.user_id)).filter((n) => Number.isFinite(n));
}

async function getLeagueLeaderboard(leagueId, viewerUserId, opts = {}) {
  const isMember = await assertLeagueMember(leagueId, viewerUserId);
  if (!isMember) {
    const err = new Error("You are not a member of this league");
    err.code = "FORBIDDEN";
    throw err;
  }
  const userIds = await getLeagueMemberUserIds(leagueId);
  const board = await getLeaderboard({
    scope: opts.scope || "week",
    year: opts.year ?? null,
    weekId: opts.weekId ?? null,
    userIds,
  });
  return { ...board, leagueId: Number(leagueId) };
}

module.exports = {
  createLeague,
  joinLeagueByCode,
  listLeaguesForUser,
  getLeagueDetail,
  getLeagueLeaderboard,
  mapLeague,
};
