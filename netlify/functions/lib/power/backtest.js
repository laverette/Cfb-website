/**
 * Backtesting foundation — predict week W using only data through week W-1.
 */

const { calculateRatings } = require("./ratings");
const { predictMatchup } = require("./predict");

function brierScore(prob, outcome) {
  const p = Number(prob);
  const o = outcome ? 1 : 0;
  return (p - o) ** 2;
}

/**
 * @param {object} args
 * @param {Array} args.teams
 * @param {Array} args.games all season games (completed + maybe upcoming with scores)
 * @param {number} args.season
 * @param {number[]} args.weeksToTest e.g. [4,5,6,...]
 * @param {object} [args.paramOverrides]
 */
function runBacktest({ teams, games, season, weeksToTest, paramOverrides = {} }) {
  const allGames = Array.isArray(games) ? games : [];
  const weeks = Array.isArray(weeksToTest) ? weeksToTest : [];
  const results = [];

  let suCorrect = 0;
  let suTotal = 0;
  let absErr = 0;
  let sqErr = 0;
  let brier = 0;
  let nMargin = 0;

  for (const week of weeks) {
    const asOfWeek = week - 1;
    if (asOfWeek < 0) continue;

    // Ratings use ONLY completed games through asOfWeek (no leakage)
    const ratingGames = allGames.filter(
      (g) => g.completed && Number(g.week) <= asOfWeek
    );
    const ratings = calculateRatings({
      teams,
      games: ratingGames,
      season,
      asOfWeek,
      paramOverrides,
    });
    const byId = new Map(ratings.teams.map((t) => [String(t.teamId), t]));

    const weekGames = allGames.filter(
      (g) => Number(g.week) === week && g.completed && g.homeScore != null && g.awayScore != null
    );

    for (const g of weekGames) {
      const teamA = byId.get(String(g.awayId));
      const teamB = byId.get(String(g.homeId));
      if (!teamA || !teamB) continue;

      // Predict from away perspective as teamA, home as teamB home venue
      const pred = predictMatchup({
        teamA,
        teamB,
        venue: g.neutralSite ? "neutral" : "b_home",
        paramOverrides,
      });

      // projectedMargin > 0 => teamA (away) favored
      const actualMarginAway = (Number(g.awayScore) || 0) - (Number(g.homeScore) || 0);
      const projectedAway = pred.projectedMargin;
      const err = projectedAway - actualMarginAway;
      absErr += Math.abs(err);
      sqErr += err * err;
      nMargin += 1;

      const predictedAwayWins = projectedAway > 0;
      const actualAwayWins = actualMarginAway > 0;
      if (actualMarginAway !== 0) {
        suTotal += 1;
        if (predictedAwayWins === actualAwayWins) suCorrect += 1;
      }

      const pAway = pred.winProbabilityA / 100;
      brier += brierScore(pAway, actualAwayWins);

      results.push({
        week,
        gameId: g.gameId,
        away: teamA.name,
        home: teamB.name,
        projectedMarginAway: projectedAway,
        actualMarginAway,
        absError: Math.abs(err),
        correct: actualMarginAway === 0 ? null : predictedAwayWins === actualAwayWins,
      });
    }
  }

  return {
    season,
    gamesPredicted: results.length,
    straightUpAccuracy: suTotal ? suCorrect / suTotal : null,
    meanAbsoluteSpreadError: nMargin ? absErr / nMargin : null,
    rmse: nMargin ? Math.sqrt(sqErr / nMargin) : null,
    brierScore: results.length ? brier / results.length : null,
    results,
  };
}

module.exports = {
  runBacktest,
  brierScore,
};
