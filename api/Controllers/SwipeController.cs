using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using MyApp.Namespace.Models;
using MyApp.Namespace.Services;
using System.Security.Claims;

namespace MyApp.Namespace.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class SwipeController : ControllerBase
    {
        private readonly DatabaseService _databaseService;

        public SwipeController(DatabaseService databaseService)
        {
            _databaseService = databaseService;
        }

        [HttpGet("candidates")]
        public async Task<ActionResult<IEnumerable<object>>> GetCandidates(
            [FromQuery] string? industry = null,
            [FromQuery] string? location = null,
            [FromQuery] string? workType = null,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 10)
        {
            try
            {
                var employerId = GetCurrentEmployerId();
                if (employerId == null)
                {
                    return Unauthorized("Must be an employer to view candidates");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                // Build the query with filters and exclude already swiped candidates
                var whereConditions = new List<string> { "a.UserId IS NOT NULL" };
                var parameters = new List<SqliteParameter>();

                // Add filters
                if (!string.IsNullOrEmpty(industry))
                {
                    whereConditions.Add("a.Industry = @Industry");
                    parameters.Add(new SqliteParameter("@Industry", industry));
                }

                if (!string.IsNullOrEmpty(location))
                {
                    whereConditions.Add("a.Location = @Location");
                    parameters.Add(new SqliteParameter("@Location", location));
                }

                if (!string.IsNullOrEmpty(workType))
                {
                    whereConditions.Add("a.WorkType = @WorkType");
                    parameters.Add(new SqliteParameter("@WorkType", workType));
                }

                // Exclude already swiped candidates (unless they were passed and hide time has expired)
                whereConditions.Add(@"
                    NOT EXISTS (
                        SELECT 1 FROM Swipes s 
                        WHERE s.EmployerId = @EmployerId 
                        AND s.ApplicantId = a.Id 
                        AND (s.SwipeType = 'Like' OR (s.SwipeType = 'Pass' AND (s.HideUntil IS NULL OR s.HideUntil > datetime('now'))))
                    )");

                parameters.Add(new SqliteParameter("@EmployerId", employerId));

                var whereClause = string.Join(" AND ", whereConditions);
                var offset = (page - 1) * pageSize;

                var query = $@"
                    SELECT 
                        a.Id as ApplicantId,
                        u.FirstName,
                        u.LastName,
                        u.Email,
                        a.Phone,
                        a.Location,
                        a.Industry,
                        a.WorkType,
                        a.Bio,
                        a.Skills,
                        a.Experience,
                        a.Education,
                        a.ResumePath
                    FROM Applicants a
                    INNER JOIN Users u ON a.UserId = u.Id
                    WHERE {whereClause}
                    ORDER BY u.CreatedAt DESC
                    LIMIT @PageSize OFFSET @Offset";

                parameters.Add(new SqliteParameter("@PageSize", pageSize));
                parameters.Add(new SqliteParameter("@Offset", offset));

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddRange(parameters.ToArray());

                var candidates = new List<object>();
                using var reader = await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    candidates.Add(new
                    {
                        ApplicantId = Convert.ToInt32(reader["ApplicantId"]),
                        FirstName = reader["FirstName"].ToString(),
                        LastName = reader["LastName"].ToString(),
                        Email = reader["Email"].ToString(),
                        Phone = reader["Phone"]?.ToString(),
                        Location = reader["Location"]?.ToString(),
                        Industry = reader["Industry"]?.ToString(),
                        WorkType = reader["WorkType"]?.ToString(),
                        Bio = reader["Bio"]?.ToString(),
                        Skills = reader["Skills"]?.ToString(),
                        Experience = reader["Experience"]?.ToString(),
                        Education = reader["Education"]?.ToString(),
                        ResumePath = reader["ResumePath"]?.ToString()
                    });
                }

                return Ok(candidates);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        [HttpPost("swipe")]
        public async Task<ActionResult> SwipeCandidate([FromBody] SwipeRequest request)
        {
            try
            {
                var employerId = GetCurrentEmployerId();
                if (employerId == null)
                {
                    return Unauthorized("Must be an employer to swipe on candidates");
                }

                if (request.SwipeType != "Like" && request.SwipeType != "Pass")
                {
                    return BadRequest("SwipeType must be 'Like' or 'Pass'");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                // Check if already swiped
                var checkQuery = @"
                    SELECT COUNT(*) FROM Swipes 
                    WHERE EmployerId = @EmployerId 
                    AND ApplicantId = @ApplicantId 
                    AND JobPostingId = @JobPostingId";

                using var checkCommand = new SqliteCommand(checkQuery, connection);
                checkCommand.Parameters.AddWithValue("@EmployerId", employerId);
                checkCommand.Parameters.AddWithValue("@ApplicantId", request.ApplicantId);
                checkCommand.Parameters.AddWithValue("@JobPostingId", request.JobPostingId ?? (object)DBNull.Value);

                var alreadySwiped = Convert.ToInt32(await checkCommand.ExecuteScalarAsync()) > 0;
                if (alreadySwiped)
                {
                    return BadRequest("Already swiped on this candidate");
                }

                // Calculate hide until time for passes (24 hours)
                DateTime? hideUntil = null;
                if (request.SwipeType == "Pass")
                {
                    hideUntil = DateTime.UtcNow.AddHours(24);
                }

                // Insert swipe
                var insertQuery = @"
                    INSERT INTO Swipes (EmployerId, ApplicantId, JobPostingId, SwipeType, SwipedAt, HideUntil)
                    VALUES (@EmployerId, @ApplicantId, @JobPostingId, @SwipeType, @SwipedAt, @HideUntil)";

                using var insertCommand = new SqliteCommand(insertQuery, connection);
                insertCommand.Parameters.AddWithValue("@EmployerId", employerId);
                insertCommand.Parameters.AddWithValue("@ApplicantId", request.ApplicantId);
                insertCommand.Parameters.AddWithValue("@JobPostingId", request.JobPostingId ?? (object)DBNull.Value);
                insertCommand.Parameters.AddWithValue("@SwipeType", request.SwipeType);
                insertCommand.Parameters.AddWithValue("@SwipedAt", DateTime.UtcNow);
                insertCommand.Parameters.AddWithValue("@HideUntil", hideUntil ?? (object)DBNull.Value);

                await insertCommand.ExecuteNonQueryAsync();

                // If it's a like, check if the applicant has also liked this employer
                if (request.SwipeType == "Like")
                {
                    var checkMutualLikeQuery = @"
                        SELECT COUNT(*) FROM Swipes 
                        WHERE EmployerId = @ApplicantId 
                        AND ApplicantId = @EmployerId 
                        AND SwipeType = 'Like'";

                    using var mutualCommand = new SqliteCommand(checkMutualLikeQuery, connection);
                    mutualCommand.Parameters.AddWithValue("@ApplicantId", request.ApplicantId);
                    mutualCommand.Parameters.AddWithValue("@EmployerId", employerId);

                    var mutualLike = Convert.ToInt32(await mutualCommand.ExecuteScalarAsync()) > 0;
                    if (mutualLike)
                    {
                        // Create a match
                        var matchQuery = @"
                            INSERT INTO Matches (EmployerId, ApplicantId, JobPostingId, MatchedAt)
                            VALUES (@EmployerId, @ApplicantId, @JobPostingId, @MatchedAt)";

                        using var matchCommand = new SqliteCommand(matchQuery, connection);
                        matchCommand.Parameters.AddWithValue("@EmployerId", employerId);
                        matchCommand.Parameters.AddWithValue("@ApplicantId", request.ApplicantId);
                        matchCommand.Parameters.AddWithValue("@JobPostingId", request.JobPostingId ?? (object)DBNull.Value);
                        matchCommand.Parameters.AddWithValue("@MatchedAt", DateTime.UtcNow);

                        await matchCommand.ExecuteNonQueryAsync();

                        return Ok(new { message = "It's a match!", isMatch = true });
                    }
                }

                return Ok(new { message = "Swipe recorded", isMatch = false });
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        [HttpGet("matches")]
        public async Task<ActionResult<IEnumerable<object>>> GetMatches()
        {
            try
            {
                var employerId = GetCurrentEmployerId();
                if (employerId == null)
                {
                    return Unauthorized("Must be an employer to view matches");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    SELECT 
                        m.Id as MatchId,
                        m.MatchedAt,
                        a.Id as ApplicantId,
                        u.FirstName,
                        u.LastName,
                        u.Email,
                        a.Phone,
                        a.Location,
                        a.Industry,
                        a.WorkType,
                        a.Bio,
                        a.Skills,
                        a.ResumePath
                    FROM Matches m
                    INNER JOIN Applicants a ON m.ApplicantId = a.Id
                    INNER JOIN Users u ON a.UserId = u.Id
                    WHERE m.EmployerId = @EmployerId 
                    AND m.IsActive = 1
                    ORDER BY m.MatchedAt DESC";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@EmployerId", employerId);

                var matches = new List<object>();
                using var reader = await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    matches.Add(new
                    {
                        MatchId = Convert.ToInt32(reader["MatchId"]),
                        MatchedAt = Convert.ToDateTime(reader["MatchedAt"]),
                        ApplicantId = Convert.ToInt32(reader["ApplicantId"]),
                        FirstName = reader["FirstName"].ToString(),
                        LastName = reader["LastName"].ToString(),
                        Email = reader["Email"].ToString(),
                        Phone = reader["Phone"]?.ToString(),
                        Location = reader["Location"]?.ToString(),
                        Industry = reader["Industry"]?.ToString(),
                        WorkType = reader["WorkType"]?.ToString(),
                        Bio = reader["Bio"]?.ToString(),
                        Skills = reader["Skills"]?.ToString(),
                        ResumePath = reader["ResumePath"]?.ToString()
                    });
                }

                return Ok(matches);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        [HttpGet("liked")]
        public async Task<ActionResult<IEnumerable<object>>> GetLikedCandidates()
        {
            try
            {
                var employerId = GetCurrentEmployerId();
                if (employerId == null)
                {
                    return Unauthorized("Must be an employer to view liked candidates");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    SELECT 
                        s.Id as SwipeId,
                        s.SwipedAt,
                        a.Id as ApplicantId,
                        u.FirstName,
                        u.LastName,
                        u.Email,
                        a.Phone,
                        a.Location,
                        a.Industry,
                        a.WorkType,
                        a.Bio,
                        a.Skills,
                        a.ResumePath
                    FROM Swipes s
                    INNER JOIN Applicants a ON s.ApplicantId = a.Id
                    INNER JOIN Users u ON a.UserId = u.Id
                    WHERE s.EmployerId = @EmployerId 
                    AND s.SwipeType = 'Like'
                    ORDER BY s.SwipedAt DESC";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@EmployerId", employerId);

                var likedCandidates = new List<object>();
                using var reader = await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    likedCandidates.Add(new
                    {
                        SwipeId = Convert.ToInt32(reader["SwipeId"]),
                        SwipedAt = Convert.ToDateTime(reader["SwipedAt"]),
                        ApplicantId = Convert.ToInt32(reader["ApplicantId"]),
                        FirstName = reader["FirstName"].ToString(),
                        LastName = reader["LastName"].ToString(),
                        Email = reader["Email"].ToString(),
                        Phone = reader["Phone"]?.ToString(),
                        Location = reader["Location"]?.ToString(),
                        Industry = reader["Industry"]?.ToString(),
                        WorkType = reader["WorkType"]?.ToString(),
                        Bio = reader["Bio"]?.ToString(),
                        Skills = reader["Skills"]?.ToString(),
                        ResumePath = reader["ResumePath"]?.ToString()
                    });
                }

                return Ok(likedCandidates);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        private int? GetCurrentEmployerId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (userIdClaim == null || !int.TryParse(userIdClaim, out var userId))
            {
                return null;
            }

            // Get employer ID from user ID
            using var connection = _databaseService.GetConnection();
            connection.Open();

            var query = "SELECT Id FROM Employers WHERE UserId = @UserId";
            using var command = new SqliteCommand(query, connection);
            command.Parameters.AddWithValue("@UserId", userId);

            var result = command.ExecuteScalar();
            return result != null ? Convert.ToInt32(result) : null;
        }
    }

    public class SwipeRequest
    {
        public int ApplicantId { get; set; }
        public int? JobPostingId { get; set; }
        public string SwipeType { get; set; } = string.Empty; // "Like" or "Pass"
    }
}
