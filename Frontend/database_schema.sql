-- User Profile System for CFB Picks Site
-- Run this SQL on your Heroku MySQL database

-- Users table - Main user accounts
CREATE TABLE IF NOT EXISTS Users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    avatar_url VARCHAR(500),
    bio TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email)
);

-- User profiles table - Extended profile information
CREATE TABLE IF NOT EXISTS UserProfiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    favorite_team_espn_id INT,
    favorite_conference VARCHAR(50),
    location VARCHAR(100),
    total_picks INT DEFAULT 0,
    correct_picks INT DEFAULT 0,
    accuracy DECIMAL(5,2) DEFAULT 0.00,
    current_streak INT DEFAULT 0,
    best_streak INT DEFAULT 0,
    ranking INT DEFAULT NULL,
    last_pick_date DATE,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_profile (user_id),
    INDEX idx_user_id (user_id),
    INDEX idx_ranking (ranking)
);

-- User preferences/settings
CREATE TABLE IF NOT EXISTS UserSettings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    email_notifications BOOLEAN DEFAULT TRUE,
    theme VARCHAR(20) DEFAULT 'dark',
    notifications_enabled BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_settings (user_id)
);

-- Optional: User activity log (for tracking picks, logins, etc.)
CREATE TABLE IF NOT EXISTS UserActivity (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    activity_type VARCHAR(50) NOT NULL, -- 'pick_submitted', 'profile_updated', 'login', etc.
    activity_data JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
);

-- Weeks table - Track weeks 1-12 of the season
CREATE TABLE IF NOT EXISTS Weeks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    week_number INT NOT NULL CHECK (week_number BETWEEN 1 AND 12),
    season_year INT NOT NULL, -- e.g., 2024
    start_date DATE,
    end_date DATE,
    is_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_week_season (week_number, season_year),
    INDEX idx_week_number (week_number),
    INDEX idx_season_year (season_year)
);

-- Games table - All games played each week
CREATE TABLE IF NOT EXISTS Games (
    id INT AUTO_INCREMENT PRIMARY KEY,
    week_id INT NOT NULL,
    game_number INT NOT NULL, -- Game 1, 2, 3, etc. within the week
    home_team_espn_id INT NOT NULL,
    away_team_espn_id INT NOT NULL,
    home_team_name VARCHAR(100) NOT NULL,
    away_team_name VARCHAR(100) NOT NULL,
    home_team_logo_url VARCHAR(500),
    away_team_logo_url VARCHAR(500),
    game_date DATETIME,
    betting_line DECIMAL(5,1), -- e.g., -8.5, +3.5
    is_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (week_id) REFERENCES Weeks(id) ON DELETE CASCADE,
    INDEX idx_week_id (week_id),
    INDEX idx_game_date (game_date),
    INDEX idx_home_team (home_team_espn_id),
    INDEX idx_away_team (away_team_espn_id)
);

-- GameResults table - Final scores and results of completed games
CREATE TABLE IF NOT EXISTS GameResults (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_id INT NOT NULL,
    home_team_score INT,
    away_team_score INT,
    winning_team_espn_id INT NOT NULL,
    winning_team_name VARCHAR(100) NOT NULL,
    game_finalized_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES Games(id) ON DELETE CASCADE,
    UNIQUE KEY unique_game_result (game_id),
    INDEX idx_game_id (game_id),
    INDEX idx_winning_team (winning_team_espn_id)
);

-- UserPicks table - What each user picked for each game
CREATE TABLE IF NOT EXISTS UserPicks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    game_id INT NOT NULL,
    week_id INT NOT NULL,
    picked_team_espn_id INT NOT NULL, -- Which team they picked to win
    picked_team_name VARCHAR(100) NOT NULL,
    is_correct BOOLEAN DEFAULT NULL, -- NULL if game not finished, TRUE/FALSE after result
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES Games(id) ON DELETE CASCADE,
    FOREIGN KEY (week_id) REFERENCES Weeks(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_game_pick (user_id, game_id), -- One pick per user per game
    INDEX idx_user_id (user_id),
    INDEX idx_game_id (game_id),
    INDEX idx_week_id (week_id),
    INDEX idx_is_correct (is_correct)
);

-- WeeklyUserStats table - Aggregate stats per user per week
CREATE TABLE IF NOT EXISTS WeeklyUserStats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    week_id INT NOT NULL,
    total_picks INT DEFAULT 0,
    correct_picks INT DEFAULT 0,
    incorrect_picks INT DEFAULT 0,
    accuracy DECIMAL(5,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (week_id) REFERENCES Weeks(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_week_stats (user_id, week_id),
    INDEX idx_user_id (user_id),
    INDEX idx_week_id (week_id)
);

