-- Support tied games as pushes (W-L-T) for weekly picks.
-- Applied to production via Supabase migration add_pick_ties_support.

alter table user_picks add column if not exists is_tie boolean not null default false;
alter table weekly_user_stats add column if not exists tied_picks integer not null default 0;
alter table game_results alter column winning_team_espn_id drop not null;
alter table game_results alter column winning_team_name drop not null;

comment on column user_picks.is_tie is
  'True when the game finalized as a tie (push); is_correct stays null.';
