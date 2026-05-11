-- Migration: extend PlayerHometowns for CFBD GET /recruiting/players (run once on existing DBs)
-- After this, sync uses cfbd_recruit_id + season_year as the upsert key.

-- 1) Widen / relax columns used for recruits
ALTER TABLE PlayerHometowns
  MODIFY COLUMN cfbd_player_id INT NULL,
  MODIFY COLUMN team VARCHAR(255) NULL;

-- 2) Add recruiting-specific columns (ignore errors if a column already exists)
ALTER TABLE PlayerHometowns
  ADD COLUMN cfbd_recruit_id VARCHAR(64) NULL AFTER cfbd_player_id;

ALTER TABLE PlayerHometowns
  ADD COLUMN athlete_id VARCHAR(64) NULL AFTER cfbd_recruit_id;

ALTER TABLE PlayerHometowns
  ADD COLUMN recruit_type VARCHAR(50) NULL AFTER athlete_id;

ALTER TABLE PlayerHometowns
  ADD COLUMN committed_to VARCHAR(255) NULL AFTER player_name;

ALTER TABLE PlayerHometowns
  ADD COLUMN school VARCHAR(255) NULL AFTER committed_to;

ALTER TABLE PlayerHometowns
  ADD COLUMN hometown_country VARCHAR(128) NULL AFTER hometown_state;

ALTER TABLE PlayerHometowns
  ADD COLUMN stars INT NULL AFTER longitude;

ALTER TABLE PlayerHometowns
  ADD COLUMN rating DECIMAL(10,4) NULL AFTER stars;

ALTER TABLE PlayerHometowns
  ADD COLUMN ranking INT NULL AFTER rating;

-- 3) Backfill cfbd_recruit_id for legacy roster rows so a new UNIQUE index can be added
UPDATE PlayerHometowns
SET cfbd_recruit_id = CONCAT('legacy-roster-', id)
WHERE cfbd_recruit_id IS NULL OR TRIM(cfbd_recruit_id) = '';

-- 4) Replace old unique key (roster) with recruit-year uniqueness
ALTER TABLE PlayerHometowns DROP INDEX uq_cfbd_player_season_team;

ALTER TABLE PlayerHometowns
  ADD UNIQUE KEY uq_recruit_season (season_year, cfbd_recruit_id);

-- 5) Optional: enforce NOT NULL on cfbd_recruit_id after backfill (may fail if any row still NULL)
-- ALTER TABLE PlayerHometowns MODIFY COLUMN cfbd_recruit_id VARCHAR(64) NOT NULL;
