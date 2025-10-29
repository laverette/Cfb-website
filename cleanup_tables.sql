-- Cleanup script - Drop duplicate/empty tables
-- Run this FIRST to clean up, then re-run the main schema

-- Check which tables exist and drop duplicates
-- Drop tables in reverse order (due to foreign keys)

DROP TABLE IF EXISTS WeeklyUserStats;
DROP TABLE IF EXISTS UserPicks;
DROP TABLE IF EXISTS GameResults;
DROP TABLE IF EXISTS Games;
DROP TABLE IF EXISTS Weeks;
DROP TABLE IF EXISTS UserActivity;
DROP TABLE IF EXISTS UserSettings;
DROP TABLE IF EXISTS UserProfiles;
DROP TABLE IF EXISTS Users;

-- Now you can safely re-run the main database_schema.sql file

