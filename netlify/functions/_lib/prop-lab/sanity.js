/**
 * PrizePicks sometimes posts unusual / goblin lines. Warn, don't block.
 */
const RANGES = {
  pass_yds: { typicalMin: 120, typicalMax: 380, unit: "passing yards" },
  pass_att: { typicalMin: 18, typicalMax: 52, unit: "pass attempts" },
  pass_comp: { typicalMin: 10, typicalMax: 38, unit: "completions" },
  pass_td: { typicalMin: 0.5, typicalMax: 4.5, unit: "passing TDs" },
  pass_int: { typicalMin: 0.5, typicalMax: 2.5, unit: "interceptions" },
  rush_yds: { typicalMin: 25, typicalMax: 180, unit: "rushing yards" },
  rush_att: { typicalMin: 6, typicalMax: 28, unit: "rush attempts" },
  rush_td: { typicalMin: 0.5, typicalMax: 2.5, unit: "rushing TDs" },
  rush_long: { typicalMin: 8.5, typicalMax: 35.5, unit: "longest rush yards" },
  rec_yds: { typicalMin: 20, typicalMax: 140, unit: "receiving yards" },
  rec: { typicalMin: 2.5, typicalMax: 10.5, unit: "receptions" },
  rec_td: { typicalMin: 0.5, typicalMax: 1.5, unit: "receiving TDs" },
  rush_rec_yds: { typicalMin: 40, typicalMax: 200, unit: "rush + receiving yards" },
  pass_rush_yds: { typicalMin: 140, typicalMax: 400, unit: "pass + rush yards" },
  total_td: { typicalMin: 0.5, typicalMax: 4.5, unit: "total TDs" },
  fg_made: { typicalMin: 0.5, typicalMax: 3.5, unit: "field goals" },
  kicking_pts: { typicalMin: 3.5, typicalMax: 14.5, unit: "kicking points" },
};

function lineSanity({ statId, line, projection, position }) {
  const range = RANGES[statId];
  if (!range || !Number.isFinite(line)) return { unusual: false, flags: [], message: null };
  const flags = [];
  const pos = String(position || "").toUpperCase();
  const qbVolume =
    (statId === "pass_comp" || statId === "pass_att" || statId === "pass_yds") &&
    (pos === "QB" || !pos);

  if (qbVolume && line <= 1.5 && Number.isFinite(projection) && projection >= 10) {
    flags.push("Unusual Line");
    return {
      unusual: true,
      flags,
      message: `This ${range.unit} line (${line}) is far outside the normal range for a QB. Confirm it is correct.`,
    };
  }

  if (Number.isFinite(projection) && projection > 8 && line <= projection * 0.12 && line <= 2.5) {
    flags.push("Unusual Line");
    return {
      unusual: true,
      flags,
      message: `This line (${line}) is far below the model (${projection.toFixed(1)} ${range.unit}). Confirm it is correct.`,
    };
  }

  if (line < range.typicalMin * 0.2 && statId !== "pass_td" && statId !== "rec_td" && statId !== "rush_td" && statId !== "pass_int" && statId !== "total_td" && statId !== "fg_made") {
    flags.push("Unusual Line");
    return {
      unusual: true,
      flags,
      message: `This ${range.unit} line (${line}) is far outside the typical ${range.typicalMin}–${range.typicalMax} range. Confirm it is correct.`,
    };
  }

  if (line > range.typicalMax * 1.8 || ((statId === "rec_td" || statId === "rush_td") && line >= 4) || (statId === "pass_td" && line >= 7)) {
    flags.push("Unusual Line");
    return {
      unusual: true,
      flags,
      message: `This ${range.unit} line (${line}) is far above a realistic range. Confirm it is correct.`,
    };
  }

  return { unusual: false, flags: [], message: null };
}

module.exports = { lineSanity, RANGES };
