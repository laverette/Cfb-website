using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using Microsoft.IdentityModel.Tokens;
using MyApp.Namespace.Models;
using MyApp.Namespace.Services;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Linq;
using BCrypt.Net;

namespace MyApp.Namespace.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly DatabaseService _databaseService;
        private readonly IConfiguration _configuration;

        public AuthController(DatabaseService databaseService, IConfiguration configuration)
        {
            _databaseService = databaseService;
            _configuration = configuration;
        }

        [HttpPost("register")]
        public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request)
        {
            try
            {
                // Validate model state
                if (!ModelState.IsValid)
                {
                    var errors = ModelState
                        .Where(x => x.Value?.Errors.Count > 0)
                        .SelectMany(x => x.Value!.Errors.Select(e => $"{x.Key}: {e.ErrorMessage}"))
                        .ToList();
                    
                    return BadRequest(new { 
                        message = "Validation failed", 
                        errors = errors 
                    });
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                // Check if username already exists
                var checkUsernameQuery = "SELECT COUNT(*) FROM Users WHERE username = @Username";
                using var checkUsernameCommand = new MySqlCommand(checkUsernameQuery, connection);
                checkUsernameCommand.Parameters.AddWithValue("@Username", request.Username);
                
                var usernameExists = Convert.ToInt32(await checkUsernameCommand.ExecuteScalarAsync()) > 0;
                if (usernameExists)
                {
                    return BadRequest(new { message = "Username already exists" });
                }

                // Check if email already exists
                var checkEmailQuery = "SELECT COUNT(*) FROM Users WHERE email = @Email";
                using var checkEmailCommand = new MySqlCommand(checkEmailQuery, connection);
                checkEmailCommand.Parameters.AddWithValue("@Email", request.Email);
                
                var emailExists = Convert.ToInt32(await checkEmailCommand.ExecuteScalarAsync()) > 0;
                if (emailExists)
                {
                    return BadRequest(new { message = "Email already exists" });
                }

                // Hash password
                var passwordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);

                // Insert user
                var insertUserQuery = @"
                    INSERT INTO Users (username, email, password_hash, display_name, created_at, updated_at)
                    VALUES (@Username, @Email, @PasswordHash, @DisplayName, @CreatedAt, @UpdatedAt);
                    SELECT LAST_INSERT_ID();";

                using var insertCommand = new MySqlCommand(insertUserQuery, connection);
                insertCommand.Parameters.AddWithValue("@Username", request.Username);
                insertCommand.Parameters.AddWithValue("@Email", request.Email);
                insertCommand.Parameters.AddWithValue("@PasswordHash", passwordHash);
                insertCommand.Parameters.AddWithValue("@DisplayName", request.DisplayName ?? request.Username);
                insertCommand.Parameters.AddWithValue("@CreatedAt", DateTime.UtcNow);
                insertCommand.Parameters.AddWithValue("@UpdatedAt", DateTime.UtcNow);

                var userId = Convert.ToInt32(await insertCommand.ExecuteScalarAsync());

                // Create user profile
                var insertProfileQuery = @"
                    INSERT INTO UserProfiles (user_id, total_picks, correct_picks, accuracy)
                    VALUES (@UserId, 0, 0, 0.00)";
                
                using var profileCommand = new MySqlCommand(insertProfileQuery, connection);
                profileCommand.Parameters.AddWithValue("@UserId", userId);
                await profileCommand.ExecuteNonQueryAsync();

                // Create user settings
                var insertSettingsQuery = @"
                    INSERT INTO UserSettings (user_id, email_notifications, theme, notifications_enabled)
                    VALUES (@UserId, TRUE, 'dark', TRUE)";
                
                using var settingsCommand = new MySqlCommand(insertSettingsQuery, connection);
                settingsCommand.Parameters.AddWithValue("@UserId", userId);
                await settingsCommand.ExecuteNonQueryAsync();

                // Get the created user
                var getUserQuery = "SELECT * FROM Users WHERE id = @Id";
                using var getUserCommand = new MySqlCommand(getUserQuery, connection);
                getUserCommand.Parameters.AddWithValue("@Id", userId);
                
                using var reader = await getUserCommand.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    var user = new UserResponse
                    {
                        Id = Convert.ToInt32(reader["id"]),
                        Username = reader["username"].ToString() ?? "",
                        Email = reader["email"].ToString() ?? "",
                        DisplayName = reader["display_name"]?.ToString(),
                        AvatarUrl = reader["avatar_url"]?.ToString(),
                        Bio = reader["bio"]?.ToString(),
                        CreatedAt = Convert.ToDateTime(reader["created_at"])
                    };

                    // Get user role (default to "user" for new registrations)
                    var roleQuery = "SELECT COALESCE(role, 'user') FROM Users WHERE id = @UserId";
                    using var roleCommand = new MySqlCommand(roleQuery, connection);
                    roleCommand.Parameters.AddWithValue("@UserId", userId);
                    var role = (await roleCommand.ExecuteScalarAsync())?.ToString() ?? "user";

                    var token = GenerateJwtToken(userId, user.Username, user.Email, role);
                    return Ok(new AuthResponse { Token = token, User = user });
                }

                return BadRequest(new { message = "Failed to create user" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        [HttpPost("login")]
        public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
        {
            try
            {
                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = "SELECT * FROM Users WHERE username = @Username OR email = @Username";
                using var command = new MySqlCommand(query, connection);
                command.Parameters.AddWithValue("@Username", request.Username);

                using var reader = await command.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    var userId = Convert.ToInt32(reader["id"]);
                    var username = reader["username"].ToString() ?? "";
                    var email = reader["email"].ToString() ?? "";
                    var passwordHash = reader["password_hash"].ToString() ?? "";
                    var displayName = reader["display_name"]?.ToString();
                    var avatarUrl = reader["avatar_url"]?.ToString();
                    var bio = reader["bio"]?.ToString();
                    var createdAt = Convert.ToDateTime(reader["created_at"]);

                    // Verify password
                    if (BCrypt.Net.BCrypt.Verify(request.Password, passwordHash))
                    {
                        var user = new UserResponse
                        {
                            Id = userId,
                            Username = username,
                            Email = email,
                            DisplayName = displayName,
                            AvatarUrl = avatarUrl,
                            Bio = bio,
                            CreatedAt = createdAt
                        };

                        // Update last login activity
                        await reader.CloseAsync();
                        await UpdateLastLogin(connection, userId);

                        // Get user role
                        var roleQuery = "SELECT COALESCE(role, 'user') FROM Users WHERE id = @UserId";
                        using var roleCommand = new MySqlCommand(roleQuery, connection);
                        roleCommand.Parameters.AddWithValue("@UserId", userId);
                        var role = (await roleCommand.ExecuteScalarAsync())?.ToString() ?? "user";

                        var token = GenerateJwtToken(userId, username, email, role);
                        return Ok(new AuthResponse { Token = token, User = user });
                    }
                }

                return Unauthorized(new { message = "Invalid username or password" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        [HttpGet("profile")]
        [Microsoft.AspNetCore.Authorization.Authorize]
        public async Task<ActionResult<ProfileResponse>> GetProfile()
        {
            try
            {
                var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out var userId))
                {
                    return Unauthorized(new { message = "Invalid token" });
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                // Get user
                var userQuery = "SELECT * FROM Users WHERE id = @Id";
                using var userCommand = new MySqlCommand(userQuery, connection);
                userCommand.Parameters.AddWithValue("@Id", userId);

                using var userReader = await userCommand.ExecuteReaderAsync();
                if (!await userReader.ReadAsync())
                {
                    return NotFound(new { message = "User not found" });
                }

                var user = new UserResponse
                {
                    Id = Convert.ToInt32(userReader["id"]),
                    Username = userReader["username"].ToString() ?? "",
                    Email = userReader["email"].ToString() ?? "",
                    DisplayName = userReader["display_name"]?.ToString(),
                    AvatarUrl = userReader["avatar_url"]?.ToString(),
                    Bio = userReader["bio"]?.ToString(),
                    CreatedAt = Convert.ToDateTime(userReader["created_at"])
                };

                await userReader.CloseAsync();

                // Get profile
                var profileQuery = "SELECT * FROM UserProfiles WHERE user_id = @UserId";
                using var profileCommand = new MySqlCommand(profileQuery, connection);
                profileCommand.Parameters.AddWithValue("@UserId", userId);

                using var profileReader = await profileCommand.ExecuteReaderAsync();
                UserProfile? profile = null;

                if (await profileReader.ReadAsync())
                {
                    profile = new UserProfile
                    {
                        Id = Convert.ToInt32(profileReader["id"]),
                        UserId = Convert.ToInt32(profileReader["user_id"]),
                        FavoriteTeamEspnId = profileReader["favorite_team_espn_id"] as int?,
                        FavoriteConference = profileReader["favorite_conference"]?.ToString(),
                        Location = profileReader["location"]?.ToString(),
                        TotalPicks = Convert.ToInt32(profileReader["total_picks"]),
                        CorrectPicks = Convert.ToInt32(profileReader["correct_picks"]),
                        Accuracy = Convert.ToDecimal(profileReader["accuracy"]),
                        CurrentStreak = Convert.ToInt32(profileReader["current_streak"]),
                        BestStreak = Convert.ToInt32(profileReader["best_streak"]),
                        Ranking = profileReader["ranking"] as int?,
                        LastPickDate = profileReader["last_pick_date"] as DateTime?
                    };
                }

                return Ok(new ProfileResponse { User = user, Profile = profile });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Internal server error: {ex.Message}" });
            }
        }

        private async Task UpdateLastLogin(MySqlConnection connection, int userId)
        {
            var activityQuery = @"
                INSERT INTO UserActivity (user_id, activity_type, activity_data, created_at)
                VALUES (@UserId, 'login', JSON_OBJECT('login_time', NOW()), NOW())";
            
            using var activityCommand = new MySqlCommand(activityQuery, connection);
            activityCommand.Parameters.AddWithValue("@UserId", userId);
            await activityCommand.ExecuteNonQueryAsync();
        }

        private string GenerateJwtToken(int userId, string username, string email, string role = "user")
        {
            var jwtKey = _configuration["Jwt:Key"];
            var jwtIssuer = _configuration["Jwt:Issuer"];
            var jwtAudience = _configuration["Jwt:Audience"];
            var expiryMinutes = int.Parse(_configuration["Jwt:ExpiryMinutes"] ?? "60");

            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey ?? ""));
            var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim(ClaimTypes.Name, username),
                new Claim(ClaimTypes.Email, email),
                new Claim("Role", role)
            };

            var token = new JwtSecurityToken(
                issuer: jwtIssuer,
                audience: jwtAudience,
                claims: claims,
                expires: DateTime.UtcNow.AddMinutes(expiryMinutes),
                signingCredentials: credentials
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }
    }
}

