using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using MyApp.Namespace.Models;
using MyApp.Namespace.Services;
using System.Security.Claims;
using Microsoft.AspNetCore.Cors;

namespace MyApp.Namespace.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class PicksController : ControllerBase
    {
        private readonly DatabaseService _databaseService;

        public PicksController(DatabaseService databaseService)
        {
            _databaseService = databaseService;
        }

        [HttpGet("games/week/{weekId}")]
        [AllowAnonymous]
        public async Task<ActionResult> GetGamesForWeek(int weekId)
        {
            try
            {
                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    SELECT id, game_number, home_team_espn_id, away_team_espn_id, 
                           home_team_name, away_team_name, home_team_logo_url, away_team_logo_url,
                           betting_line, is_completed
                    FROM Games
                    WHERE week_id = @WeekId
                    ORDER BY game_number";

                using var command = new MySqlCommand(query, connection);
                command.Parameters.AddWithValue("@WeekId", weekId);

                var games = new List<object>();

                using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    games.Add(new
                    {
                        id = Convert.ToInt32(reader["id"]),
                        gameNumber = Convert.ToInt32(reader["game_number"]),
                        homeTeamEspnId = Convert.ToInt32(reader["home_team_espn_id"]),
                        awayTeamEspnId = Convert.ToInt32(reader["away_team_espn_id"]),
                        homeTeamName = reader["home_team_name"].ToString(),
                        awayTeamName = reader["away_team_name"].ToString(),
                        homeTeamLogoUrl = reader["home_team_logo_url"]?.ToString(),
                        awayTeamLogoUrl = reader["away_team_logo_url"]?.ToString(),
                        bettingLine = reader["betting_line"] as decimal?,
                        isCompleted = Convert.ToBoolean(reader["is_completed"])
                    });
                }

                return Ok(new { games });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        [HttpPost("submit")]
        [Authorize]
        public async Task<ActionResult> SubmitPicks([FromBody] SubmitPicksRequest request)
        {
            try
            {
                var userId = int.Parse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "0");
                
                if (userId == 0)
                {
                    return Unauthorized(new { message = "Invalid user" });
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                // Verify week exists
                var weekCheckQuery = "SELECT id FROM Weeks WHERE id = @WeekId";
                using var weekCheckCommand = new MySqlCommand(weekCheckQuery, connection);
                weekCheckCommand.Parameters.AddWithValue("@WeekId", request.WeekId);
                var weekExists = await weekCheckCommand.ExecuteScalarAsync();
                
                if (weekExists == null)
                {
                    return BadRequest(new { message = "Invalid week ID" });
                }

                // Check if user has already submitted picks for this week
                var checkExistingQuery = @"
                    SELECT COUNT(*) as pick_count 
                    FROM UserPicks 
                    WHERE user_id = @UserId AND week_id = @WeekId
                    LIMIT 1";
                
                using var checkExistingCommand = new MySqlCommand(checkExistingQuery, connection);
                checkExistingCommand.Parameters.AddWithValue("@UserId", userId);
                checkExistingCommand.Parameters.AddWithValue("@WeekId", request.WeekId);
                
                var existingPickCount = Convert.ToInt32(await checkExistingCommand.ExecuteScalarAsync());
                
                if (existingPickCount > 0)
                {
                    return BadRequest(new { 
                        message = "You have already submitted picks for this week. Only one submission per week is allowed.",
                        code = "ALREADY_SUBMITTED"
                    });
                }

                int successCount = 0;
                int errorCount = 0;

                foreach (var pick in request.Picks)
                {
                    try
                    {
                        // Get game info using game_number instead of game_id
                        var gameQuery = @"
                            SELECT id, week_id, home_team_espn_id, away_team_espn_id, 
                                   home_team_name, away_team_name
                            FROM Games 
                            WHERE game_number = @GameNumber AND week_id = @WeekId";
                        
                        using var gameCommand = new MySqlCommand(gameQuery, connection);
                        gameCommand.Parameters.AddWithValue("@GameNumber", pick.GameNumber);
                        gameCommand.Parameters.AddWithValue("@WeekId", request.WeekId);
                        
                        using var gameReader = await gameCommand.ExecuteReaderAsync();
                        if (!await gameReader.ReadAsync())
                        {
                            errorCount++;
                            continue;
                        }

                        var gameId = Convert.ToInt32(gameReader["id"]);
                        var homeTeamEspnId = Convert.ToInt32(gameReader["home_team_espn_id"]);
                        var awayTeamEspnId = Convert.ToInt32(gameReader["away_team_espn_id"]);
                        var homeTeamName = gameReader["home_team_name"].ToString() ?? "";
                        var awayTeamName = gameReader["away_team_name"].ToString() ?? "";

                        // Determine which team was picked based on ESPN ID
                        int pickedTeamEspnId;
                        string pickedTeamName;

                        if (pick.PickedTeamEspnId == homeTeamEspnId)
                        {
                            pickedTeamEspnId = homeTeamEspnId;
                            pickedTeamName = homeTeamName;
                        }
                        else if (pick.PickedTeamEspnId == awayTeamEspnId)
                        {
                            pickedTeamEspnId = awayTeamEspnId;
                            pickedTeamName = awayTeamName;
                        }
                        else
                        {
                            errorCount++;
                            continue;
                        }

                        // Insert or update pick (using INSERT ... ON DUPLICATE KEY UPDATE)
                        var insertPickQuery = @"
                            INSERT INTO UserPicks (user_id, game_id, week_id, picked_team_espn_id, picked_team_name, submitted_at)
                            VALUES (@UserId, @GameId, @WeekId, @PickedTeamEspnId, @PickedTeamName, NOW())
                            ON DUPLICATE KEY UPDATE
                                picked_team_espn_id = @PickedTeamEspnId,
                                picked_team_name = @PickedTeamName,
                                submitted_at = NOW()";

                        using var pickCommand = new MySqlCommand(insertPickQuery, connection);
                        pickCommand.Parameters.AddWithValue("@UserId", userId);
                        pickCommand.Parameters.AddWithValue("@GameId", gameId);
                        pickCommand.Parameters.AddWithValue("@WeekId", request.WeekId);
                        pickCommand.Parameters.AddWithValue("@PickedTeamEspnId", pickedTeamEspnId);
                        pickCommand.Parameters.AddWithValue("@PickedTeamName", pickedTeamName);
                        
                        await pickCommand.ExecuteNonQueryAsync();
                        successCount++;

                        // Record activity
                        var activityQuery = @"
                            INSERT INTO UserActivity (user_id, activity_type, activity_data, created_at)
                            VALUES (@UserId, 'pick_submitted', JSON_OBJECT('game_id', @GameId, 'week_id', @WeekId), NOW())";
                        
                        using var activityCommand = new MySqlCommand(activityQuery, connection);
                        activityCommand.Parameters.AddWithValue("@UserId", userId);
                        activityCommand.Parameters.AddWithValue("@GameId", gameId);
                        activityCommand.Parameters.AddWithValue("@WeekId", request.WeekId);
                        await activityCommand.ExecuteNonQueryAsync();
                    }
                    catch (Exception ex)
                    {
                        errorCount++;
                        // Log error but continue with other picks
                        Console.WriteLine($"Error saving pick for game {pick.GameNumber}: {ex.Message}");
                    }
                }

                // Update user profile stats
                await UpdateUserProfileStats(connection, userId);

                return Ok(new 
                { 
                    message = "Picks submitted successfully",
                    saved = successCount,
                    errors = errorCount
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        [HttpGet("check-submission/{weekId}")]
        [Authorize]
        public async Task<ActionResult> CheckSubmissionStatus(int weekId)
        {
            try
            {
                var userId = int.Parse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "0");
                
                if (userId == 0)
                {
                    return Unauthorized(new { message = "Invalid user" });
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    SELECT COUNT(*) as pick_count,
                           MAX(submitted_at) as last_submitted
                    FROM UserPicks 
                    WHERE user_id = @UserId AND week_id = @WeekId";

                using var command = new MySqlCommand(query, connection);
                command.Parameters.AddWithValue("@UserId", userId);
                command.Parameters.AddWithValue("@WeekId", weekId);

                using var reader = await command.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    var pickCount = Convert.ToInt32(reader["pick_count"]);
                    var lastSubmitted = reader["last_submitted"] as DateTime?;

                    return Ok(new 
                    { 
                        hasSubmitted = pickCount > 0,
                        pickCount = pickCount,
                        lastSubmitted = lastSubmitted
                    });
                }

                return Ok(new { hasSubmitted = false, pickCount = 0, lastSubmitted = (DateTime?)null });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        [HttpGet("week/{weekId}")]
        [Authorize]
        public async Task<ActionResult> GetUserPicksForWeek(int weekId)
        {
            try
            {
                var userId = int.Parse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "0");
                
                if (userId == 0)
                {
                    return Unauthorized(new { message = "Invalid user" });
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    SELECT up.id, up.game_id, up.week_id, up.picked_team_espn_id, up.picked_team_name, 
                           up.is_correct, up.submitted_at,
                           g.game_number, g.home_team_name, g.away_team_name,
                           g.home_team_espn_id, g.away_team_espn_id
                    FROM UserPicks up
                    JOIN Games g ON up.game_id = g.id
                    WHERE up.user_id = @UserId AND up.week_id = @WeekId
                    ORDER BY g.game_number";

                using var command = new MySqlCommand(query, connection);
                command.Parameters.AddWithValue("@UserId", userId);
                command.Parameters.AddWithValue("@WeekId", weekId);

                var picks = new List<object>();

                using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    picks.Add(new
                    {
                        id = Convert.ToInt32(reader["id"]),
                        gameId = Convert.ToInt32(reader["game_id"]),
                        gameNumber = Convert.ToInt32(reader["game_number"]),
                        weekId = Convert.ToInt32(reader["week_id"]),
                        pickedTeamEspnId = Convert.ToInt32(reader["picked_team_espn_id"]),
                        pickedTeamName = reader["picked_team_name"].ToString(),
                        isCorrect = reader["is_correct"] as bool?,
                        submittedAt = Convert.ToDateTime(reader["submitted_at"]),
                        homeTeamName = reader["home_team_name"].ToString(),
                        awayTeamName = reader["away_team_name"].ToString(),
                        homeTeamEspnId = Convert.ToInt32(reader["home_team_espn_id"]),
                        awayTeamEspnId = Convert.ToInt32(reader["away_team_espn_id"])
                    });
                }

                return Ok(new { picks });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        private async Task UpdateUserProfileStats(MySqlConnection connection, int userId)
        {
            // Update total picks count
            var updateQuery = @"
                UPDATE UserProfiles 
                SET total_picks = (SELECT COUNT(*) FROM UserPicks WHERE user_id = @UserId),
                    last_pick_date = NOW()
                WHERE user_id = @UserId";

            using var updateCommand = new MySqlCommand(updateQuery, connection);
            updateCommand.Parameters.AddWithValue("@UserId", userId);
            await updateCommand.ExecuteNonQueryAsync();
        }
    }

    public class SubmitPicksRequest
    {
        public int WeekId { get; set; }
        public List<GamePick> Picks { get; set; } = new();
    }

    public class GamePick
    {
        public int GameNumber { get; set; }  // 1-12 instead of database game_id
        public int PickedTeamEspnId { get; set; }
    }
}

