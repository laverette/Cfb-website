-- Player / recruit hometown cache for Recruit Map (run on JawsDB / MySQL)
-- Source: CFBD GET /roster (home_city, home_state, home_latitude, home_longitude)

CREATE TABLE IF NOT EXISTS PlayerHometowns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cfbd_player_id INT NOT NULL,
  player_name VARCHAR(255) NOT NULL,
  team VARCHAR(32) NOT NULL COMMENT 'CFBD team abbreviation',
  team_school VARCHAR(255) NULL,
  conference VARCHAR(128) NULL,
  season_year INT NOT NULL,
  position VARCHAR(64) NULL,
  hometown_city VARCHAR(128) NULL,
  hometown_state VARCHAR(64) NULL,
  hometown_full VARCHAR(512) NULL,
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(11, 7) NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'cfbd_roster',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cfbd_player_season_team (cfbd_player_id, season_year, team),
  KEY idx_season_team (season_year, team),
  KEY idx_conference (conference),
  KEY idx_state (hometown_state),
  KEY idx_position (position),
  KEY idx_latlng (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
