-- View all games for Week 10
SELECT 
    g.id,
    g.game_number,
    g.home_team_name AS 'Home Team',
    g.away_team_name AS 'Away Team',
    g.home_team_espn_id AS 'Home ESPN ID',
    g.away_team_espn_id AS 'Away ESPN ID',
    g.betting_line AS 'Line',
    g.is_completed AS 'Completed?',
    w.week_number,
    w.season_year
FROM Games g
JOIN Weeks w ON g.week_id = w.id
WHERE w.week_number = 10 AND w.season_year = 2024
ORDER BY g.game_number;

-- Simple view - just game numbers and matchups
SELECT 
    game_number AS 'Game #',
    CONCAT(away_team_name, ' @ ', home_team_name) AS 'Matchup',
    betting_line AS 'Line'
FROM Games
WHERE week_id = (SELECT id FROM Weeks WHERE week_number = 10 AND season_year = 2024)
ORDER BY game_number;

-- View all games with more details (including week info)
SELECT 
    w.week_number,
    w.season_year,
    g.game_number,
    g.home_team_name,
    g.away_team_name,
    g.betting_line,
    g.game_date,
    g.is_completed,
    g.home_team_logo_url,
    g.away_team_logo_url
FROM Games g
JOIN Weeks w ON g.week_id = w.id
ORDER BY w.week_number DESC, g.game_number;

-- Count games per week
SELECT 
    w.week_number,
    w.season_year,
    COUNT(g.id) AS 'Number of Games'
FROM Weeks w
LEFT JOIN Games g ON w.id = g.week_id
GROUP BY w.id, w.week_number, w.season_year
ORDER BY w.week_number DESC;

