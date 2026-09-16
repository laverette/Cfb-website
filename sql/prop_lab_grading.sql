-- Prop Lab real-outcome grading loop.
--
-- prop_lab_backtests previously only held rows produced by an offline backtest.
-- This migration turns it into a live prediction ledger: a row is written when a
-- projection is made (actual/hit null), then filled in once the game is final.
-- Refitting the calibrator against these rows is what moves the model off
-- synthetic evidence.

alter table public.prop_lab_backtests
  add column if not exists side text not null default 'more',
  add column if not exists player_name text,
  add column if not exists team text,
  add column if not exists opponent text,
  add column if not exists p_hit_uncalibrated numeric,
  add column if not exists calibrator_method text,
  add column if not exists confidence text,
  add column if not exists prop_score numeric,
  add column if not exists sample_games integer,
  add column if not exists spread numeric,
  add column if not exists source text not null default 'backtest',
  add column if not exists graded_at timestamptz;

-- One prediction per player/stat/line/side/week/model. Re-running the recorder
-- refreshes the projection instead of piling up duplicates.
create unique index if not exists uq_prop_lab_backtests_prediction
  on public.prop_lab_backtests (
    model_version, season_year, week_number, player_id, stat_id, line, side
  );

-- The grader repeatedly asks "what is still pending for this week".
create index if not exists idx_prop_lab_backtests_pending
  on public.prop_lab_backtests (season_year, week_number, team)
  where hit is null;

-- The calibrator fit reads every graded row for a model version.
create index if not exists idx_prop_lab_backtests_graded
  on public.prop_lab_backtests (model_version, source)
  where hit is not null;
