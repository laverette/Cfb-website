using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.IdentityModel.Tokens;
using MyApp.Namespace.Models;
using MyApp.Namespace.Services;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
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
                // Validate user type
                if (request.UserType != "Applicant" && request.UserType != "Employer")
                {
                    return BadRequest("UserType must be either 'Applicant' or 'Employer'");
                }

                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                // Check if email already exists
                var checkEmailQuery = "SELECT COUNT(*) FROM Users WHERE Email = @Email";
                using var checkCommand = new SqliteCommand(checkEmailQuery, connection);
                checkCommand.Parameters.AddWithValue("@Email", request.Email);
                
                var emailExists = Convert.ToInt32(await checkCommand.ExecuteScalarAsync()) > 0;
                if (emailExists)
                {
                    return BadRequest("Email already exists");
                }

                // Hash password
                var passwordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);

                // Insert user
                var insertUserQuery = @"
                    INSERT INTO Users (Email, PasswordHash, FirstName, LastName, UserType, CreatedAt, UpdatedAt)
                    VALUES (@Email, @PasswordHash, @FirstName, @LastName, @UserType, @CreatedAt, @UpdatedAt);
                    SELECT last_insert_rowid();";

                using var insertCommand = new SqliteCommand(insertUserQuery, connection);
                insertCommand.Parameters.AddWithValue("@Email", request.Email);
                insertCommand.Parameters.AddWithValue("@PasswordHash", passwordHash);
                insertCommand.Parameters.AddWithValue("@FirstName", request.FirstName);
                insertCommand.Parameters.AddWithValue("@LastName", request.LastName);
                insertCommand.Parameters.AddWithValue("@UserType", request.UserType);
                insertCommand.Parameters.AddWithValue("@CreatedAt", DateTime.UtcNow);
                insertCommand.Parameters.AddWithValue("@UpdatedAt", DateTime.UtcNow);

                var userId = Convert.ToInt32(await insertCommand.ExecuteScalarAsync());

                // Create user profile based on type
                if (request.UserType == "Applicant")
                {
                    var insertApplicantQuery = @"
                        INSERT INTO Applicants (UserId)
                        VALUES (@UserId)";
                    
                    using var applicantCommand = new SqliteCommand(insertApplicantQuery, connection);
                    applicantCommand.Parameters.AddWithValue("@UserId", userId);
                    await applicantCommand.ExecuteNonQueryAsync();
                }
                else if (request.UserType == "Employer")
                {
                    var insertEmployerQuery = @"
                        INSERT INTO Employers (UserId, CompanyName)
                        VALUES (@UserId, @CompanyName)";
                    
                    using var employerCommand = new SqliteCommand(insertEmployerQuery, connection);
                    employerCommand.Parameters.AddWithValue("@UserId", userId);
                    employerCommand.Parameters.AddWithValue("@CompanyName", "Your Company"); // Default value
                    await employerCommand.ExecuteNonQueryAsync();
                }

                // Get the created user
                var getUserQuery = "SELECT * FROM Users WHERE Id = @Id";
                using var getUserCommand = new SqliteCommand(getUserQuery, connection);
                getUserCommand.Parameters.AddWithValue("@Id", userId);
                
                using var reader = await getUserCommand.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    var user = new User
                    {
                        Id = Convert.ToInt32(reader["Id"]),
                        Email = reader["Email"].ToString() ?? "",
                        FirstName = reader["FirstName"].ToString() ?? "",
                        LastName = reader["LastName"].ToString() ?? "",
                        UserType = reader["UserType"].ToString() ?? "",
                        CreatedAt = Convert.ToDateTime(reader["CreatedAt"]),
                        UpdatedAt = Convert.ToDateTime(reader["UpdatedAt"])
                    };

                    var token = GenerateJwtToken(user);
                    return Ok(new AuthResponse { Token = token, User = user });
                }

                return BadRequest("Failed to create user");
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        [HttpPost("login")]
        public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
        {
            try
            {
                using var connection = _databaseService.GetConnection();
                await connection.OpenAsync();

                var query = "SELECT * FROM Users WHERE Email = @Email";
                using var command = new SqliteCommand(query, connection);
                command.Parameters.AddWithValue("@Email", request.Email);

                using var reader = await command.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    var user = new User
                    {
                        Id = Convert.ToInt32(reader["Id"]),
                        Email = reader["Email"].ToString() ?? "",
                        PasswordHash = reader["PasswordHash"].ToString() ?? "",
                        FirstName = reader["FirstName"].ToString() ?? "",
                        LastName = reader["LastName"].ToString() ?? "",
                        UserType = reader["UserType"].ToString() ?? "",
                        CreatedAt = Convert.ToDateTime(reader["CreatedAt"]),
                        UpdatedAt = Convert.ToDateTime(reader["UpdatedAt"])
                    };

                    // Verify password
                    if (BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
                    {
                        var token = GenerateJwtToken(user);
                        return Ok(new AuthResponse { Token = token, User = user });
                    }
                }

                return Unauthorized("Invalid email or password");
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        private string GenerateJwtToken(User user)
        {
            var jwtKey = _configuration["Jwt:Key"];
            var jwtIssuer = _configuration["Jwt:Issuer"];
            var jwtAudience = _configuration["Jwt:Audience"];
            var expiryMinutes = int.Parse(_configuration["Jwt:ExpiryMinutes"] ?? "60");

            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey ?? ""));
            var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Email, user.Email),
                new Claim(ClaimTypes.Name, $"{user.FirstName} {user.LastName}"),
                new Claim("UserType", user.UserType)
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
