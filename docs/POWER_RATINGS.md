# CFB Power Ratings & Matchup Predictor

## What this model measures

**Raw power** is the core rating: expected point differential versus an average FBS team on a neutral field *right now*.

Examples:
- Georgia `+19.4` → about 19.4 points better than average FBS on a neutral field
- Average FBS → `0.0`
- Weak FBS → negative

**Matchup spreads** use raw power + home field, plus a residual **talent** boost (`matchupTalentWeight`) so large roster gaps still move the line early in the season. The power-only line is always retained as `powerSpreadLabel`.

```
power_margin = TeamA.raw_power - TeamB.raw_power + venue_HFA + personnel
talent_adj = ((talentA-50) - (talentB-50)) / powerScoreScale * matchupTalentWeight
projected_margin = power_margin + talent_adj
```

Positive projected margin → Team A favored. Display spread is always `Favorite -X.X`.

**Power Score (0–100)** is display-only:

```
power_score = clamp(50 + raw_power * powerScoreScale, 0, 100)
```

## Architecture

```
CFBD API → ingest-cfbd.js → normalized teams/games
                         → calculateRatings()
                         → weekly snapshots (Supabase)
                         → predictMatchup()
```

Code lives under:

- `netlify/functions/_lib/power/` — pure engine (config, OA solver, ratings, predict, explain, backtest, ingest)
- `netlify/functions/power-*.js` — HTTP handlers
- `sql/power_ratings_schema.sql` — persistence
- `Frontend/power-rankings.html`, `Frontend/predictor.html` — UI
- `tests/power-model.test.js` — unit tests

## Components (V1)

| Component | Role |
|-----------|------|
| Opponent-adjusted offense/defense | Iterative network solve; performance vs opponent quality; **prior-anchored** so one game can't create Off +25 |
| Soft margin / result blend | `sign(m)*log(1+|m|)` so blowouts don't dominate |
| Recency | `exp(-λ * weeks_ago)` |
| Preseason prior | Prev season + talent/recruiting/returning |
| Early-season shrink | Prior counts as `priorPseudoGames` virtual games (default **5**) — Week 1 ≈ 17% observed |
| Special teams | Small configurable contribution |
| FCS handling | Positive FBS-over-FCS info down-weighted; bad FCS results still hurt |
| Personnel adj | Manual point impacts (QB out, etc.) |
| HFA | Configurable flat home advantage (default **2.5** — placeholder) |

All weights live in `_lib/power/config.js` via `getModelParams()`. **Defaults are not statistically proven** — calibrate with backtests.

## APIs

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/power/rankings?season=&week=&live=1` | Public | Rankings snapshot or live CFBD compute |
| GET | `/api/power/teams` | Public | Dropdown team list |
| POST | `/api/power/matchup` | Public | Predict matchup |
| POST | `/api/power/run` | Admin JWT | Ingest + calculate + **persist** weekly snapshot |

### Matchup body

```json
{
  "teamAId": 333,
  "teamBId": 61,
  "venue": "a_home",
  "personnelA": 0,
  "personnelB": -3.5
}
```

`venue`: `neutral` | `a_home` | `b_home`

## Setup

1. Run `Client/sql/power_ratings_schema.sql` in the Supabase SQL editor.
2. Ensure Netlify env: `CFBD_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`.
3. As admin, compute a week:

```http
POST /api/power/run
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{ "season": 2026, "week": 3 }
```

4. Open `power-rankings.html` and `predictor.html`.

Without snapshots, rankings/matchup can still run **live** from CFBD when `CFBD_API_KEY` is set (slower; not persisted).

## Win probability

```
P(A) = 1 / (1 + exp(-projected_margin / tau))
```

`tau` default `8.5` is a **placeholder** for historical calibration (Brier / log-loss).

## Backtesting

```js
const { runBacktest } = require("./netlify/functions/_lib/power");
runBacktest({ teams, games, season, weeksToTest: [4,5,6,7] });
```

For each week W, ratings use only completed games through W−1 (no future leakage). Metrics: straight-up accuracy, MAE, RMSE, Brier.

## Tests

```bash
cd Client
npm test
```

## Intentional behaviors

- Close road loss to an elite team can **raise** power
- Ugly home win over a weak team can **lower** power
- Elite efficiency + tough schedule can outrank an undefeated soft schedule

This is a **power** model, not a résumé/AP model. No Top-25 win bonuses. No conference static bonuses. SOS is displayed but not double-counted into power (opponent adjustment already encodes schedule strength).

## Limitations / future calibration

- Per-game EPA is approximated from season PPA when play-level EPA is unavailable
- HFA, τ, recency λ, blend weights need historical optimization
- Team-specific HFA, travel, altitude not in V1
- Special teams / turnover luck are thin until richer CFBD metrics are wired into `power_game_stats`
