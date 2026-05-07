-- Run once on JawsDB / MySQL (required for admin save-week-games upsert by CFBD game id).
-- Safe additive migration: no drops, no table recreate.

ALTER TABLE Games
  ADD COLUMN cfbd_game_id BIGINT UNSIGNED NULL COMMENT 'CollegeFootballData game id' AFTER week_id;

ALTER TABLE Games
  ADD COLUMN venue VARCHAR(255) NULL AFTER game_date;

-- One row per (week, CFBD game) for INSERT ... ON DUPLICATE KEY UPDATE in admin-save-week-games.
CREATE UNIQUE INDEX idx_games_week_cfbd ON Games (week_id, cfbd_game_id);
