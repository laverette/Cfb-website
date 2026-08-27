-- Existing DBs: add team_school so users can predict any team's schedule.
-- Safe to re-run.

alter table public.bama_schedule_predictions
  add column if not exists team_school text not null default 'Alabama';

alter table public.bama_schedule_predictions
  drop constraint if exists bama_schedule_predictions_user_id_cfbd_game_id_season_year_key;

create unique index if not exists bama_schedule_predictions_user_team_game_season_uidx
  on public.bama_schedule_predictions (user_id, team_school, cfbd_game_id, season_year);

create index if not exists idx_bama_preds_team_season
  on public.bama_schedule_predictions (team_school, season_year);
