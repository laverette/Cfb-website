/**
 * Central prop catalog. Adding a new PrizePicks category should start here.
 */
const PROP_DEFINITIONS = [
  {
    id: "pass_yds",
    label: "Passing yards",
    short: "PASS YDS",
    category: "passing",
    family: "passing",
    dist: "normal",
    sources: ["player_game.passing.yds", "overview.passing.YDS"],
    methodology: "opportunity_efficiency",
    opportunity: "pass_attempts",
    efficiency: "yards_per_attempt",
    minGames: 3,
    priorSd: 72,
    floor: 0,
    ceil: 650,
    combo: false,
    matchupKeys: ["passYdsAllowed", "ypaAllowed", "compPctAllowed", "passPpa", "passExplosiveness"],
  },
  {
    id: "pass_att",
    label: "Passing attempts",
    short: "PASS ATT",
    category: "passing",
    family: "passing",
    dist: "normal",
    sources: ["player_game.passing.att"],
    methodology: "opportunity",
    opportunity: "pass_attempts",
    efficiency: null,
    minGames: 3,
    priorSd: 8,
    floor: 0,
    ceil: 80,
    combo: false,
    matchupKeys: ["passYdsAllowed", "pace", "passRate"],
  },
  {
    id: "pass_comp",
    label: "Completions",
    short: "COMP",
    category: "passing",
    family: "passing",
    dist: "normal",
    sources: ["player_game.passing.comp"],
    methodology: "opportunity_efficiency",
    opportunity: "pass_attempts",
    efficiency: "completion_pct",
    minGames: 3,
    priorSd: 6,
    floor: 0,
    ceil: 55,
    combo: false,
    matchupKeys: ["compPctAllowed", "passYdsAllowed"],
  },
  {
    id: "pass_td",
    label: "Passing TDs",
    short: "PASS TD",
    category: "passing",
    family: "passing",
    dist: "poisson",
    sources: ["player_game.passing.td"],
    methodology: "rate",
    opportunity: "pass_attempts",
    efficiency: "td_rate",
    minGames: 4,
    priorSd: 1.1,
    floor: 0,
    ceil: 8,
    combo: false,
    matchupKeys: ["passTdAllowed", "passPpa"],
  },
  {
    id: "pass_int",
    label: "Interceptions",
    short: "INT",
    category: "passing",
    family: "passing",
    dist: "poisson",
    sources: ["player_game.passing.int"],
    methodology: "rate",
    opportunity: "pass_attempts",
    efficiency: "int_rate",
    minGames: 4,
    priorSd: 0.7,
    floor: 0,
    ceil: 6,
    combo: false,
    invertMatchup: true,
    matchupKeys: ["intRateForced", "havoc"],
  },
  {
    id: "rush_yds",
    label: "Rushing yards",
    short: "RUSH YDS",
    category: "rushing",
    family: "rushing",
    dist: "normal",
    sources: ["player_game.rushing.yds"],
    methodology: "opportunity_efficiency",
    opportunity: "rush_attempts",
    efficiency: "yards_per_carry",
    minGames: 3,
    priorSd: 42,
    floor: 0,
    ceil: 350,
    combo: false,
    matchupKeys: ["rushYdsAllowed", "ypcAllowed", "rushPpa", "stuffRate"],
  },
  {
    id: "rush_att",
    label: "Rushing attempts",
    short: "RUSH ATT",
    category: "rushing",
    family: "rushing",
    dist: "normal",
    sources: ["player_game.rushing.att"],
    methodology: "opportunity",
    opportunity: "rush_attempts",
    efficiency: null,
    minGames: 3,
    priorSd: 5.5,
    floor: 0,
    ceil: 45,
    combo: false,
    matchupKeys: ["rushYdsAllowed", "pace"],
  },
  {
    id: "rush_td",
    label: "Rushing TDs",
    short: "RUSH TD",
    category: "rushing",
    family: "rushing",
    dist: "poisson",
    sources: ["player_game.rushing.td"],
    methodology: "rate",
    opportunity: "rush_attempts",
    efficiency: "td_share",
    minGames: 4,
    priorSd: 0.7,
    floor: 0,
    ceil: 6,
    combo: false,
    matchupKeys: ["rushTdAllowed", "rushPpa"],
  },
  {
    // Longest rush is the max over a game's carries, not a sum, so it is
    // strongly right-skewed and gets a lognormal rather than a normal.
    id: "rush_long",
    label: "Longest rush",
    short: "LONG RUSH",
    category: "rushing",
    family: "rushing",
    dist: "lognormal",
    sources: ["player_game.rushing.long"],
    // Season LONG is a max, not a total, so the season-overview average path
    // must not divide it by games. Everything else aggregates as a sum.
    aggregate: "max",
    methodology: "opportunity_efficiency",
    opportunity: "rush_attempts",
    efficiency: "explosiveness",
    minGames: 3,
    priorSd: 9,
    floor: 0,
    ceil: 99,
    combo: false,
    matchupKeys: ["rushYdsAllowed", "ypcAllowed", "rushExplosiveness", "stuffRate"],
  },
  {
    id: "rec_yds",
    label: "Receiving yards",
    short: "REC YDS",
    category: "receiving",
    family: "receiving",
    dist: "normal",
    sources: ["player_game.receiving.yds"],
    methodology: "opportunity_efficiency",
    opportunity: "receptions",
    efficiency: "yards_per_reception",
    minGames: 3,
    priorSd: 38,
    floor: 0,
    ceil: 300,
    combo: false,
    matchupKeys: ["passYdsAllowed", "passExplosiveness", "compPctAllowed"],
  },
  {
    id: "rec",
    label: "Receptions",
    short: "REC",
    category: "receiving",
    family: "receiving",
    dist: "normal",
    sources: ["player_game.receiving.rec"],
    methodology: "opportunity",
    opportunity: "receptions",
    efficiency: null,
    minGames: 3,
    priorSd: 2.4,
    floor: 0,
    ceil: 20,
    combo: false,
    matchupKeys: ["compPctAllowed", "passYdsAllowed"],
  },
  {
    id: "rec_td",
    label: "Receiving TDs",
    short: "REC TD",
    category: "receiving",
    family: "receiving",
    dist: "poisson",
    sources: ["player_game.receiving.td"],
    methodology: "rate",
    opportunity: "receptions",
    efficiency: "td_share",
    minGames: 4,
    priorSd: 0.55,
    floor: 0,
    ceil: 5,
    combo: false,
    matchupKeys: ["passTdAllowed", "passPpa"],
  },
  {
    id: "rush_rec_yds",
    label: "Rush + receiving yards",
    short: "RUSH+REC",
    category: "combination",
    family: "skill",
    dist: "normal",
    sources: ["player_game.rushing.yds", "player_game.receiving.yds"],
    methodology: "opportunity_efficiency",
    opportunity: "touches",
    efficiency: "yards_per_touch",
    minGames: 3,
    priorSd: 48,
    floor: 0,
    ceil: 400,
    combo: true,
    parts: ["rush_yds", "rec_yds"],
    matchupKeys: ["rushYdsAllowed", "passYdsAllowed"],
  },
  {
    id: "pass_rush_yds",
    label: "Pass + rush yards",
    short: "PASS+RUSH",
    category: "combination",
    family: "qb",
    dist: "normal",
    sources: ["player_game.passing.yds", "player_game.rushing.yds"],
    methodology: "opportunity_efficiency",
    opportunity: "plays",
    efficiency: "yards_per_play",
    minGames: 3,
    priorSd: 78,
    floor: 0,
    ceil: 700,
    combo: true,
    parts: ["pass_yds", "rush_yds"],
    matchupKeys: ["passYdsAllowed", "rushYdsAllowed"],
  },
  {
    id: "total_td",
    label: "Total touchdowns",
    short: "TOT TD",
    category: "combination",
    family: "scoring",
    dist: "poisson",
    sources: ["player_game.passing.td", "player_game.rushing.td", "player_game.receiving.td"],
    methodology: "rate",
    opportunity: "scoring_chances",
    efficiency: "td_rate",
    minGames: 4,
    priorSd: 0.9,
    floor: 0,
    ceil: 8,
    combo: true,
    parts: ["pass_td", "rush_td", "rec_td"],
    matchupKeys: ["passTdAllowed", "rushTdAllowed"],
  },
  {
    id: "fg_made",
    label: "Field goals",
    short: "FG",
    category: "kicking",
    family: "kicking",
    dist: "poisson",
    sources: ["player_game.kicking.fgm", "overview.kicking.FGM"],
    methodology: "opportunity_efficiency",
    opportunity: "fg_attempts",
    efficiency: "fg_pct",
    minGames: 3,
    priorSd: 0.9,
    floor: 0,
    ceil: 8,
    combo: false,
    matchupKeys: ["pointsAllowed", "defenseRating"],
  },
  {
    id: "kicking_pts",
    label: "Kicking points",
    short: "K PTS",
    category: "kicking",
    family: "kicking",
    dist: "normal",
    sources: ["player_game.kicking.pts", "overview.kicking.PTS"],
    methodology: "rate",
    opportunity: "scoring_chances",
    efficiency: null,
    minGames: 3,
    priorSd: 3.4,
    floor: 0,
    ceil: 24,
    combo: false,
    matchupKeys: ["pointsAllowed", "defenseRating"],
  },
];

const PROP_BY_ID = Object.fromEntries(PROP_DEFINITIONS.map((d) => [d.id, d]));

const POSITIONS_BY_STAT = {
  pass_yds: ["QB", "ATH"],
  pass_att: ["QB", "ATH"],
  pass_comp: ["QB", "ATH"],
  pass_td: ["QB", "ATH"],
  pass_int: ["QB", "ATH"],
  pass_rush_yds: ["QB", "ATH"],
  rush_yds: ["QB", "RB", "WR", "ATH"],
  rush_att: ["QB", "RB", "WR", "ATH"],
  rush_td: ["QB", "RB", "WR", "ATH"],
  rush_long: ["QB", "RB", "WR", "ATH"],
  rec_yds: ["WR", "TE", "RB", "ATH"],
  rec: ["WR", "TE", "RB", "ATH"],
  rec_td: ["WR", "TE", "RB", "ATH"],
  rush_rec_yds: ["RB", "WR", "TE", "ATH"],
  total_td: ["QB", "RB", "WR", "TE", "ATH"],
  fg_made: ["K"],
  kicking_pts: ["K"],
};

for (const d of PROP_DEFINITIONS) {
  d.positions = POSITIONS_BY_STAT[d.id] || ["QB", "RB", "WR", "TE", "ATH"];
}

/**
 * CFBD position strings are inconsistent, so the aliases live in one table that
 * is also shipped to the browser in the catalog response. The client applies
 * the same rules instead of keeping its own copy that can drift.
 */
const POSITION_ALIASES = {
  QB: ["QB", "QUARTERBACK"],
  RB: ["RB", "FB", "HB", "TB", "RUNNINGBACK", "TAILBACK", "FULLBACK"],
  WR: ["WR", "SLOT", "SE", "FL", "WIDERECEIVER", "RECEIVER"],
  TE: ["TE", "TIGHTEND"],
  ATH: ["ATH", "UT", "ATHLETE"],
  K: ["K", "PK", "FG", "KICKER", "PLACEKICKER"],
};

const ALIAS_LOOKUP = new Map();
for (const [canon, aliases] of Object.entries(POSITION_ALIASES)) {
  for (const a of aliases) ALIAS_LOOKUP.set(a, canon);
}

/** Positions that never take an offensive skill prop. */
const NON_OFFENSIVE = [
  "DB", "CB", "S", "FS", "SS", "LB", "ILB", "OLB", "MLB", "EDGE",
  "DL", "DE", "DT", "NT", "OL", "OT", "OG", "C", "G", "T",
  "P", "PUNTER", "LS", "SNAPPER",
];
const NON_OFFENSIVE_SET = new Set(NON_OFFENSIVE);

function normalizePositionToken(pos) {
  return String(pos || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function canonicalPosition(pos) {
  const p = normalizePositionToken(pos);
  if (!p) return null;
  return ALIAS_LOOKUP.get(p) || p;
}

const SKILL_POSITIONS = ["QB", "RB", "WR", "TE", "ATH"];

/**
 * Stats a position can actually be bet on.
 *
 * Three cases, because CFBD position strings are unreliable:
 *   - known offensive position  -> exactly that position's props
 *   - known non-offensive       -> nothing, there is no prop to bet
 *   - missing or unrecognized   -> every offensive prop, but never kicking
 *
 * The last case is the one that caused the bug: it used to return the entire
 * catalog, so a player whose position CFBD omitted was offered receiving
 * touchdowns and field goals alike.
 */
function statsForPosition(position, catalog = PROP_DEFINITIONS) {
  const pos = canonicalPosition(position);
  const list = catalog || PROP_DEFINITIONS;

  if (pos && NON_OFFENSIVE_SET.has(pos)) return [];

  if (pos) {
    const hit = list.filter((d) => (d.positions || []).includes(pos));
    if (hit.length) return hit;
  }

  return list.filter((d) => (d.positions || []).some((p) => SKILL_POSITIONS.includes(p)));
}

function getPropDef(id) {
  return PROP_BY_ID[String(id || "")] || null;
}

function catalogPublic() {
  return PROP_DEFINITIONS.map((d) => ({
    id: d.id,
    label: d.label,
    short: d.short,
    category: d.category,
    family: d.family,
    combo: Boolean(d.combo),
    positions: d.positions || [],
  }));
}

/** Position rules shipped to the browser so the UI filters exactly as the API does. */
function positionRulesPublic() {
  return { aliases: POSITION_ALIASES, nonOffensive: NON_OFFENSIVE, skill: SKILL_POSITIONS };
}

module.exports = {
  PROP_DEFINITIONS,
  PROP_BY_ID,
  getPropDef,
  catalogPublic,
  positionRulesPublic,
  canonicalPosition,
  statsForPosition,
  POSITIONS_BY_STAT,
  POSITION_ALIASES,
  NON_OFFENSIVE,
};
