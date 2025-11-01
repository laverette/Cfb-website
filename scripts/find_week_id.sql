-- Find the week_id for Week 10, Season 2024
-- Run this query and use the 'id' value (NOT week_number) in weeklypicks.html

SELECT 
    id,
    week_number,
    season_year,
    start_date,
    end_date,
    (SELECT COUNT(*) FROM Games WHERE week_id = Weeks.id) as game_count
FROM Weeks
WHERE week_number = 10 AND season_year = 2024;

-- If you see a result, use the 'id' value (first column) in weeklypicks.html
-- Example: If id = 1, then weekId = 1 is correct
-- Example: If id = 5, then change weekId to 5 in weeklypicks.html

