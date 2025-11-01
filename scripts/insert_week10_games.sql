-- Step 1: Get or create Week 10 and set the week_id variable
-- First, try to get existing week
SET @week_id = (SELECT id FROM Weeks WHERE week_number = 10 AND season_year = 2024);

-- If it doesn't exist, create it and get the new id
INSERT INTO Weeks (week_number, season_year, start_date, end_date, is_completed)
VALUES (10, 2024, '2024-11-01', '2024-11-03', FALSE)
ON DUPLICATE KEY UPDATE id=id;

-- Make sure we have the week_id (either from existing or newly created)
SET @week_id = COALESCE(@week_id, LAST_INSERT_ID(), (SELECT id FROM Weeks WHERE week_number = 10 AND season_year = 2024));

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 1, 
        57, 
        61, 
        'Florida Gators', 
        'Georgia Bulldogs', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/57.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/61.png', 
        NULL, 
        7.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 2, 
        251, 
        238, 
        'Texas Longhorns', 
        'Vanderbilt Commodores', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/238.png', 
        NULL, 
        -3.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 3, 
        2567, 
        2390, 
        'SMU Mustangs', 
        'Miami Hurricanes', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/2567.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/2390.png', 
        NULL, 
        10.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 4, 
        145, 
        2579, 
        'Ole Miss Rebels', 
        'South Carolina Gamecocks', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/145.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/2579.png', 
        NULL, 
        -11.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 5, 
        152, 
        59, 
        'NC State Wolfpack', 
        'Georgia Tech Yellow Jackets', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/152.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/59.png', 
        NULL, 
        5.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 6, 
        2633, 
        201, 
        'Tennessee Volunteers', 
        'Oklahoma Sooners', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/2633.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/201.png', 
        NULL, 
        -2.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 7, 
        158, 
        30, 
        'Nebraska Cornhuskers', 
        'USC Trojans', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/158.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/30.png', 
        NULL, 
        4.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 8, 
        254, 
        2132, 
        'Utah Utes', 
        'Cincinnati Bearcats', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/254.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/2132.png', 
        NULL, 
        -10.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 9, 
        25, 
        258, 
        'California Golden Bears', 
        'Virginia Cavaliers', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/25.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/258.png', 
        NULL, 
        5.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 10, 
        2306, 
        2641, 
        'Kansas State Wildcats', 
        'Texas Tech Red Raiders', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/2306.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/2641.png', 
        NULL, 
        7.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 11, 
        259, 
        97, 
        'Virginia Tech Hokies', 
        'Louisville Cardinals', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/259.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/97.png', 
        NULL, 
        11.5, 
        FALSE);

INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES (@week_id, 12, 
        120, 
        84, 
        'Maryland Terrapins', 
        'Indiana Hoosiers', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/120.png', 
        'https://a.espncdn.com/i/teamlogos/ncaa/500/84.png', 
        NULL, 
        21.5, 
        FALSE);

