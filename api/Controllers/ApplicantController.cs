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
    public class ApplicantController : ControllerBase
    {
        private readonly DatabaseService _databaseService;

        public ApplicantController(DatabaseService databaseService)
        {
            _databaseService = databaseService;
        }

        [HttpGet("profile")]
        public async Task<ActionResult<object>> GetProfile()
        {
            try
            {
                var applicantId = GetCurrentApplicantId();
                if (applicantId == null)
                {
                    return Unauthorized("Must be an applicant to view profile");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
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
                    WHERE a.Id = @ApplicantId";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@ApplicantId", applicantId);

                using var reader = await command.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    return Ok(new
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

                return NotFound("Profile not found");
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        [HttpPut("profile")]
        public async Task<ActionResult> UpdateProfile([FromBody] UpdateApplicantProfileRequest request)
        {
            try
            {
                var applicantId = GetCurrentApplicantId();
                if (applicantId == null)
                {
                    return Unauthorized("Must be an applicant to update profile");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    UPDATE Applicants 
                    SET Phone = @Phone,
                        Location = @Location,
                        Industry = @Industry,
                        WorkType = @WorkType,
                        Bio = @Bio,
                        Skills = @Skills,
                        Experience = @Experience,
                        Education = @Education
                    WHERE Id = @ApplicantId";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@Phone", request.Phone ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Location", request.Location ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Industry", request.Industry ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@WorkType", request.WorkType ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Bio", request.Bio ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Skills", request.Skills ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Experience", request.Experience ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Education", request.Education ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@ApplicantId", applicantId);

                var rowsAffected = await command.ExecuteNonQueryAsync();
                if (rowsAffected > 0)
                {
                    return Ok(new { message = "Profile updated successfully" });
                }

                return BadRequest("Failed to update profile");
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        [HttpGet("likes")]
        public async Task<ActionResult<IEnumerable<object>>> GetLikes()
        {
            try
            {
                var applicantId = GetCurrentApplicantId();
                if (applicantId == null)
                {
                    return Unauthorized("Must be an applicant to view likes");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    SELECT 
                        s.Id as SwipeId,
                        s.SwipedAt,
                        e.Id as EmployerId,
                        u.FirstName,
                        u.LastName,
                        u.Email,
                        emp.CompanyName,
                        emp.CompanySize,
                        emp.Industry,
                        emp.Location,
                        emp.Description
                    FROM Swipes s
                    INNER JOIN Employers e ON s.EmployerId = e.Id
                    INNER JOIN Users u ON e.UserId = u.Id
                    INNER JOIN Employers emp ON e.Id = emp.Id
                    WHERE s.ApplicantId = @ApplicantId 
                    AND s.SwipeType = 'Like'
                    ORDER BY s.SwipedAt DESC";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@ApplicantId", applicantId);

                var likes = new List<object>();
                using var reader = await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    likes.Add(new
                    {
                        SwipeId = Convert.ToInt32(reader["SwipeId"]),
                        SwipedAt = Convert.ToDateTime(reader["SwipedAt"]),
                        EmployerId = Convert.ToInt32(reader["EmployerId"]),
                        FirstName = reader["FirstName"].ToString(),
                        LastName = reader["LastName"].ToString(),
                        Email = reader["Email"].ToString(),
                        CompanyName = reader["CompanyName"].ToString(),
                        CompanySize = reader["CompanySize"]?.ToString(),
                        Industry = reader["Industry"]?.ToString(),
                        Location = reader["Location"]?.ToString(),
                        Description = reader["Description"]?.ToString()
                    });
                }

                return Ok(likes);
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
                var applicantId = GetCurrentApplicantId();
                if (applicantId == null)
                {
                    return Unauthorized("Must be an applicant to view matches");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    SELECT 
                        m.Id as MatchId,
                        m.MatchedAt,
                        e.Id as EmployerId,
                        u.FirstName,
                        u.LastName,
                        u.Email,
                        emp.CompanyName,
                        emp.CompanySize,
                        emp.Industry,
                        emp.Location,
                        emp.Description
                    FROM Matches m
                    INNER JOIN Employers e ON m.EmployerId = e.Id
                    INNER JOIN Users u ON e.UserId = u.Id
                    INNER JOIN Employers emp ON e.Id = emp.Id
                    WHERE m.ApplicantId = @ApplicantId 
                    AND m.IsActive = 1
                    ORDER BY m.MatchedAt DESC";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@ApplicantId", applicantId);

                var matches = new List<object>();
                using var reader = await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    matches.Add(new
                    {
                        MatchId = Convert.ToInt32(reader["MatchId"]),
                        MatchedAt = Convert.ToDateTime(reader["MatchedAt"]),
                        EmployerId = Convert.ToInt32(reader["EmployerId"]),
                        FirstName = reader["FirstName"].ToString(),
                        LastName = reader["LastName"].ToString(),
                        Email = reader["Email"].ToString(),
                        CompanyName = reader["CompanyName"].ToString(),
                        CompanySize = reader["CompanySize"]?.ToString(),
                        Industry = reader["Industry"]?.ToString(),
                        Location = reader["Location"]?.ToString(),
                        Description = reader["Description"]?.ToString()
                    });
                }

                return Ok(matches);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        private int? GetCurrentApplicantId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (userIdClaim == null || !int.TryParse(userIdClaim, out var userId))
            {
                return null;
            }

            // Get applicant ID from user ID
            using var connection = _databaseService.GetConnection();
            connection.Open();

            var query = "SELECT Id FROM Applicants WHERE UserId = @UserId";
            using var command = new SqliteCommand(query, connection);
            command.Parameters.AddWithValue("@UserId", userId);

            var result = command.ExecuteScalar();
            return result != null ? Convert.ToInt32(result) : null;
        }
    }

    public class UpdateApplicantProfileRequest
    {
        public string? Phone { get; set; }
        public string? Location { get; set; }
        public string? Industry { get; set; }
        public string? WorkType { get; set; }
        public string? Bio { get; set; }
        public string? Skills { get; set; }
        public string? Experience { get; set; }
        public string? Education { get; set; }
    }
}
