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
    public class EmployerController : ControllerBase
    {
        private readonly DatabaseService _databaseService;

        public EmployerController(DatabaseService databaseService)
        {
            _databaseService = databaseService;
        }

        [HttpGet("profile")]
        public async Task<ActionResult<object>> GetProfile()
        {
            try
            {
                var employerId = GetCurrentEmployerId();
                if (employerId == null)
                {
                    return Unauthorized("Must be an employer to view profile");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    SELECT 
                        e.Id as EmployerId,
                        u.FirstName,
                        u.LastName,
                        u.Email,
                        e.CompanyName,
                        e.CompanySize,
                        e.Industry,
                        e.Location,
                        e.Website,
                        e.Description
                    FROM Employers e
                    INNER JOIN Users u ON e.UserId = u.Id
                    WHERE e.Id = @EmployerId";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@EmployerId", employerId);

                using var reader = await command.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    return Ok(new
                    {
                        EmployerId = Convert.ToInt32(reader["EmployerId"]),
                        FirstName = reader["FirstName"].ToString(),
                        LastName = reader["LastName"].ToString(),
                        Email = reader["Email"].ToString(),
                        CompanyName = reader["CompanyName"].ToString(),
                        CompanySize = reader["CompanySize"]?.ToString(),
                        Industry = reader["Industry"]?.ToString(),
                        Location = reader["Location"]?.ToString(),
                        Website = reader["Website"]?.ToString(),
                        Description = reader["Description"]?.ToString()
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
        public async Task<ActionResult> UpdateProfile([FromBody] UpdateEmployerProfileRequest request)
        {
            try
            {
                var employerId = GetCurrentEmployerId();
                if (employerId == null)
                {
                    return Unauthorized("Must be an employer to update profile");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    UPDATE Employers 
                    SET CompanyName = @CompanyName,
                        CompanySize = @CompanySize,
                        Industry = @Industry,
                        Location = @Location,
                        Website = @Website,
                        Description = @Description
                    WHERE Id = @EmployerId";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@CompanyName", request.CompanyName);
                command.Parameters.AddWithValue("@CompanySize", request.CompanySize ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Industry", request.Industry ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Location", request.Location ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Website", request.Website ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Description", request.Description ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@EmployerId", employerId);

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

        [HttpPost("job-postings")]
        public async Task<ActionResult> CreateJobPosting([FromBody] CreateJobPostingRequest request)
        {
            try
            {
                var employerId = GetCurrentEmployerId();
                if (employerId == null)
                {
                    return Unauthorized("Must be an employer to create job postings");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    INSERT INTO JobPostings (
                        EmployerId, Title, Description, Industry, Location, WorkType,
                        SalaryMin, SalaryMax, RequiredSkills, PreferredSkills, ExperienceLevel, CreatedAt
                    )
                    VALUES (
                        @EmployerId, @Title, @Description, @Industry, @Location, @WorkType,
                        @SalaryMin, @SalaryMax, @RequiredSkills, @PreferredSkills, @ExperienceLevel, @CreatedAt
                    )";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@EmployerId", employerId);
                command.Parameters.AddWithValue("@Title", request.Title);
                command.Parameters.AddWithValue("@Description", request.Description ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Industry", request.Industry ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@Location", request.Location ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@WorkType", request.WorkType ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@SalaryMin", request.SalaryMin ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@SalaryMax", request.SalaryMax ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@RequiredSkills", request.RequiredSkills ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@PreferredSkills", request.PreferredSkills ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@ExperienceLevel", request.ExperienceLevel ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("@CreatedAt", DateTime.UtcNow);

                await command.ExecuteNonQueryAsync();
                return Ok(new { message = "Job posting created successfully" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        [HttpGet("job-postings")]
        public async Task<ActionResult<IEnumerable<object>>> GetJobPostings()
        {
            try
            {
                var employerId = GetCurrentEmployerId();
                if (employerId == null)
                {
                    return Unauthorized("Must be an employer to view job postings");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = @"
                    SELECT 
                        Id, Title, Description, Industry, Location, WorkType,
                        SalaryMin, SalaryMax, RequiredSkills, PreferredSkills, ExperienceLevel,
                        IsActive, CreatedAt
                    FROM JobPostings 
                    WHERE EmployerId = @EmployerId
                    ORDER BY CreatedAt DESC";

                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@EmployerId", employerId);

                var jobPostings = new List<object>();
                using var reader = await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    jobPostings.Add(new
                    {
                        Id = Convert.ToInt32(reader["Id"]),
                        Title = reader["Title"].ToString(),
                        Description = reader["Description"]?.ToString(),
                        Industry = reader["Industry"]?.ToString(),
                        Location = reader["Location"]?.ToString(),
                        WorkType = reader["WorkType"]?.ToString(),
                        SalaryMin = reader["SalaryMin"]?.ToString(),
                        SalaryMax = reader["SalaryMax"]?.ToString(),
                        RequiredSkills = reader["RequiredSkills"]?.ToString(),
                        PreferredSkills = reader["PreferredSkills"]?.ToString(),
                        ExperienceLevel = reader["ExperienceLevel"]?.ToString(),
                        IsActive = Convert.ToBoolean(reader["IsActive"]),
                        CreatedAt = Convert.ToDateTime(reader["CreatedAt"])
                    });
                }

                return Ok(jobPostings);
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

    public class UpdateEmployerProfileRequest
    {
        public string CompanyName { get; set; } = string.Empty;
        public string? CompanySize { get; set; }
        public string? Industry { get; set; }
        public string? Location { get; set; }
        public string? Website { get; set; }
        public string? Description { get; set; }
    }

    public class CreateJobPostingRequest
    {
        public string Title { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string? Industry { get; set; }
        public string? Location { get; set; }
        public string? WorkType { get; set; }
        public int? SalaryMin { get; set; }
        public int? SalaryMax { get; set; }
        public string? RequiredSkills { get; set; }
        public string? PreferredSkills { get; set; }
        public string? ExperienceLevel { get; set; }
    }
}
