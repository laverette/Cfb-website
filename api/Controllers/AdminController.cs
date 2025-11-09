using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using MyApp.Namespace.Services;
using System.Security.Claims;

namespace MyApp.Namespace.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Policy = "AdminOnly")]
    public class AdminController : ControllerBase
    {
        private readonly DatabaseService _databaseService;
        private readonly CollegeFootballDataService _cfbService;

        public AdminController(DatabaseService databaseService, CollegeFootballDataService cfbService)
        {
            _databaseService = databaseService;
            _cfbService = cfbService;
        }

        [HttpGet("current-week")]
        public async Task<ActionResult> GetCurrentWeek()
        {
            try
            {
                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    SELECT id, week_number, season_year, start_date, end_date, is_completed
                    FROM Weeks
                    WHERE id = (SELECT value FROM Settings WHERE key = 'current_week_id')
                    LIMIT 1";

                using var command = new MySqlCommand(query, connection);
                using var reader = await command.ExecuteReaderAsync();

                if (await reader.ReadAsync())
                {
                    return Ok(new
                    {
                        id = Convert.ToInt32(reader["id"]),
                        weekNumber = Convert.ToInt32(reader["week_number"]),
                        seasonYear = Convert.ToInt32(reader["season_year"]),
                        startDate = reader["start_date"] as DateTime?,
                        endDate = reader["end_date"] as DateTime?,
                        isCompleted = Convert.ToBoolean(reader["is_completed"])
                    });
                }

                return NotFound(new { message = "Current week not set" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        [HttpPost("set-current-week")]
        public async Task<ActionResult> SetCurrentWeek([FromBody] SetCurrentWeekRequest request)
        {
            try
            {
                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                // Find or create week
                var weekQuery = @"
                    SELECT id FROM Weeks 
                    WHERE week_number = @WeekNumber AND season_year = @SeasonYear
                    LIMIT 1";

                using var weekCommand = new MySqlCommand(weekQuery, connection);
                weekCommand.Parameters.AddWithValue("@WeekNumber", request.WeekNumber);
                weekCommand.Parameters.AddWithValue("@SeasonYear", request.SeasonYear);

                var weekId = await weekCommand.ExecuteScalarAsync();

                if (weekId == null)
                {
                    // Create week
                    var insertWeekQuery = @"
                        INSERT INTO Weeks (week_number, season_year, start_date, end_date, is_completed)
                        VALUES (@WeekNumber, @SeasonYear, @StartDate, @EndDate, FALSE);
                        SELECT LAST_INSERT_ID();";

                    using var insertCommand = new MySqlCommand(insertWeekQuery, connection);
                    insertCommand.Parameters.AddWithValue("@WeekNumber", request.WeekNumber);
                    insertCommand.Parameters.AddWithValue("@SeasonYear", request.SeasonYear);
                    insertCommand.Parameters.AddWithValue("@StartDate", request.StartDate ?? (object)DBNull.Value);
                    insertCommand.Parameters.AddWithValue("@EndDate", request.EndDate ?? (object)DBNull.Value);

                    weekId = await insertCommand.ExecuteScalarAsync();
                }

                // Update or insert setting (create table if needed)
                try
                {
                    var createTableQuery = @"
                        CREATE TABLE IF NOT EXISTS Settings (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            `key` VARCHAR(100) UNIQUE NOT NULL,
                            value TEXT,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                            INDEX idx_key (`key`)
                        )";
                    using var createCommand = new MySqlCommand(createTableQuery, connection);
                    await createCommand.ExecuteNonQueryAsync();
                }
                catch { /* Table might already exist */ }

                var settingsQuery = @"
                    INSERT INTO Settings (`key`, value, updated_at)
                    VALUES ('current_week_id', @WeekId, NOW())
                    ON DUPLICATE KEY UPDATE value = @WeekId, updated_at = NOW()";

                using var settingsCommand = new MySqlCommand(settingsQuery, connection);
                settingsCommand.Parameters.AddWithValue("@WeekId", weekId);
                await settingsCommand.ExecuteNonQueryAsync();

                return Ok(new { message = "Current week set successfully", weekId });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        [HttpPost("fetch-week-schedule")]
        public async Task<ActionResult> FetchWeekSchedule([FromBody] FetchWeekScheduleRequest request)
        {
            try
            {
                // Fetch games from College Football Data API
                var games = await _cfbService.GetGamesForWeek(request.Year, request.Week);

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                // Find or create week
                var weekQuery = @"
                    SELECT id FROM Weeks 
                    WHERE week_number = @WeekNumber AND season_year = @SeasonYear
                    LIMIT 1";

                using var weekCommand = new MySqlCommand(weekQuery, connection);
                weekCommand.Parameters.AddWithValue("@WeekNumber", request.Week);
                weekCommand.Parameters.AddWithValue("@SeasonYear", request.Year);

                var weekIdObj = await weekCommand.ExecuteScalarAsync();
                int weekId;

                if (weekIdObj == null)
                {
                    // Create week
                    var insertWeekQuery = @"
                        INSERT INTO Weeks (week_number, season_year, is_completed)
                        VALUES (@WeekNumber, @SeasonYear, FALSE);
                        SELECT LAST_INSERT_ID();";

                    using var insertCommand = new MySqlCommand(insertWeekQuery, connection);
                    insertCommand.Parameters.AddWithValue("@WeekNumber", request.Week);
                    insertCommand.Parameters.AddWithValue("@SeasonYear", request.Year);

                    weekId = Convert.ToInt32(await insertCommand.ExecuteScalarAsync());
                }
                else
                {
                    weekId = Convert.ToInt32(weekIdObj);
                }

                // Get ESPN team ID mapping (we'll need to map from CFB Data API IDs to ESPN IDs)
                // For now, we'll use the CFB Data API team IDs directly
                var insertedGames = new List<object>();
                int gameNumber = 1;

                foreach (var game in games.Where(g => g.HomeId.HasValue && g.AwayId.HasValue))
                {
                    // Get team logos from ESPN (we'll use a placeholder for now)
                    var homeLogoUrl = $"https://a.espncdn.com/i/teamlogos/ncaa/500/{game.HomeId}.png";
                    var awayLogoUrl = $"https://a.espncdn.com/i/teamlogos/ncaa/500/{game.AwayId}.png";

                    var insertGameQuery = @"
                        INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                                         home_team_name, away_team_name, home_team_logo_url, away_team_logo_url,
                                         game_date, betting_line, is_completed)
                        VALUES (@WeekId, @GameNumber, @HomeTeamEspnId, @AwayTeamEspnId,
                                @HomeTeamName, @AwayTeamName, @HomeTeamLogoUrl, @AwayTeamLogoUrl,
                                @GameDate, @BettingLine, FALSE)
                        ON DUPLICATE KEY UPDATE
                            home_team_espn_id = @HomeTeamEspnId,
                            away_team_espn_id = @AwayTeamEspnId,
                            home_team_name = @HomeTeamName,
                            away_team_name = @AwayTeamName,
                            home_team_logo_url = @HomeTeamLogoUrl,
                            away_team_logo_url = @AwayTeamLogoUrl,
                            game_date = @GameDate,
                            betting_line = @BettingLine";

                    using var insertGameCommand = new MySqlCommand(insertGameQuery, connection);
                    insertGameCommand.Parameters.AddWithValue("@WeekId", weekId);
                    insertGameCommand.Parameters.AddWithValue("@GameNumber", gameNumber);
                    insertGameCommand.Parameters.AddWithValue("@HomeTeamEspnId", game.HomeId);
                    insertGameCommand.Parameters.AddWithValue("@AwayTeamEspnId", game.AwayId);
                    insertGameCommand.Parameters.AddWithValue("@HomeTeamName", game.HomeTeam ?? "");
                    insertGameCommand.Parameters.AddWithValue("@AwayTeamName", game.AwayTeam ?? "");
                    insertGameCommand.Parameters.AddWithValue("@HomeTeamLogoUrl", homeLogoUrl);
                    insertGameCommand.Parameters.AddWithValue("@AwayTeamLogoUrl", awayLogoUrl);
                    insertGameCommand.Parameters.AddWithValue("@GameDate", 
                        !string.IsNullOrEmpty(game.StartDate) ? DateTime.Parse(game.StartDate) : (object)DBNull.Value);
                    insertGameCommand.Parameters.AddWithValue("@BettingLine", 
                        game.Spread.HasValue ? (object)game.Spread.Value : DBNull.Value);

                    await insertGameCommand.ExecuteNonQueryAsync();

                    insertedGames.Add(new
                    {
                        gameNumber,
                        homeTeam = game.HomeTeam,
                        awayTeam = game.AwayTeam,
                        homeId = game.HomeId,
                        awayId = game.AwayId
                    });

                    gameNumber++;
                }

                return Ok(new
                {
                    message = "Week schedule fetched and saved successfully",
                    weekId,
                    gamesInserted = insertedGames.Count,
                    games = insertedGames
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        [HttpGet("games/{year}/{week}")]
        public async Task<ActionResult> GetGamesForWeek(int year, int week)
        {
            try
            {
                var games = await _cfbService.GetGamesForWeek(year, week);
                return Ok(new { games });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        [HttpPut("games/{weekId}/game/{gameNumber}")]
        public async Task<ActionResult> UpdateGame(int weekId, int gameNumber, [FromBody] UpdateGameRequest request)
        {
            try
            {
                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var updateQuery = @"
                    UPDATE Games
                    SET home_team_espn_id = @HomeTeamEspnId,
                        away_team_espn_id = @AwayTeamEspnId,
                        home_team_name = @HomeTeamName,
                        away_team_name = @AwayTeamName,
                        home_team_logo_url = @HomeTeamLogoUrl,
                        away_team_logo_url = @AwayTeamLogoUrl,
                        game_date = @GameDate,
                        betting_line = @BettingLine
                    WHERE week_id = @WeekId AND game_number = @GameNumber";

                using var command = new MySqlCommand(updateQuery, connection);
                command.Parameters.AddWithValue("@WeekId", weekId);
                command.Parameters.AddWithValue("@GameNumber", gameNumber);
                command.Parameters.AddWithValue("@HomeTeamEspnId", request.HomeTeamEspnId);
                command.Parameters.AddWithValue("@AwayTeamEspnId", request.AwayTeamEspnId);
                command.Parameters.AddWithValue("@HomeTeamName", request.HomeTeamName);
                command.Parameters.AddWithValue("@AwayTeamName", request.AwayTeamName);
                command.Parameters.AddWithValue("@HomeTeamLogoUrl", request.HomeTeamLogoUrl ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@AwayTeamLogoUrl", request.AwayTeamLogoUrl ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@GameDate", request.GameDate ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@BettingLine", request.BettingLine ?? (object)DBNull.Value);

                var rowsAffected = await command.ExecuteNonQueryAsync();

                if (rowsAffected == 0)
                {
                    return NotFound(new { message = "Game not found" });
                }

                return Ok(new { message = "Game updated successfully" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        [HttpGet("check-admin")]
        public ActionResult CheckAdmin()
        {
            return Ok(new { isAdmin = true });
        }
    }

    public class SetCurrentWeekRequest
    {
        public int WeekNumber { get; set; }
        public int SeasonYear { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
    }

    public class FetchWeekScheduleRequest
    {
        public int Year { get; set; }
        public int Week { get; set; }
    }

    public class UpdateGameRequest
    {
        public int HomeTeamEspnId { get; set; }
        public int AwayTeamEspnId { get; set; }
        public string HomeTeamName { get; set; } = "";
        public string AwayTeamName { get; set; } = "";
        public string? HomeTeamLogoUrl { get; set; }
        public string? AwayTeamLogoUrl { get; set; }
        public DateTime? GameDate { get; set; }
        public decimal? BettingLine { get; set; }
    }
}

