using Microsoft.AspNetCore.Mvc;
using MyApp.Namespace.Models;
using MyApp.Namespace.Services;
using System.Security.Cryptography;
using System.Text;

namespace MyApp.Namespace.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class UserController : ControllerBase
    {
        private readonly SupabaseDatabaseService _databaseService;

        public UserController(SupabaseDatabaseService databaseService)
        {
            _databaseService = databaseService;
        }

        // GET: api/User
        [HttpGet]
        public async Task<ActionResult<IEnumerable<User>>> GetUsers()
        {
            try
            {
                var users = await _databaseService.GetAllUsersAsync();
                // Remove password hashes from response
                var safeUsers = users.Select(u => new { u.Id, u.Username, u.Email, u.CreatedAt, u.LastLoginAt });
                return Ok(safeUsers);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        // GET: api/User/5
        [HttpGet("{id}")]
        public async Task<ActionResult<User>> GetUser(Guid id)
        {
            try
            {
                var user = await _databaseService.GetUserByIdAsync(id);
                if (user == null)
                {
                    return NotFound();
                }

                // Remove password hash from response
                var safeUser = new { user.Id, user.Username, user.Email, user.CreatedAt, user.LastLoginAt };
                return Ok(safeUser);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        // POST: api/User/register
        [HttpPost("register")]
        public async Task<ActionResult<User>> Register([FromBody] RegisterRequest request)
        {
            try
            {
            if (string.IsNullOrEmpty(request.Username) || string.IsNullOrEmpty(request.Email) || string.IsNullOrEmpty(request.Password))
            {
                return BadRequest("Username, email, and password are required");
            }

                // Check if user already exists
                var existingUser = await _databaseService.GetUserByEmailAsync(request.Email);
                if (existingUser != null)
                {
                    return Conflict("User with this email already exists");
                }

                // Hash password
                var passwordHash = HashPassword(request.Password);

                var user = new User
                {
                    Username = request.Username,
                    Email = request.Email,
                    PasswordHash = passwordHash,
                    CreatedAt = DateTime.UtcNow
                };

                var createdUser = await _databaseService.CreateUserAsync(user);
                
                // Return user without password hash
                var safeUser = new { createdUser.Id, createdUser.Username, createdUser.Email, createdUser.CreatedAt };
                return CreatedAtAction(nameof(GetUser), new { id = createdUser.Id }, safeUser);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        // POST: api/User/login
        [HttpPost("login")]
        public async Task<ActionResult<User>> Login([FromBody] LoginRequest request)
        {
            try
            {
                if (string.IsNullOrEmpty(request.UsernameOrEmail) || string.IsNullOrEmpty(request.Password))
                {
                    return BadRequest("Username/Email and password are required");
                }

                var user = await _databaseService.GetUserByUsernameOrEmailAsync(request.UsernameOrEmail);
                if (user == null || !VerifyPassword(request.Password, user.PasswordHash))
                {
                    return Unauthorized("Invalid username/email or password");
                }

                // Update last login time
                user.LastLoginAt = DateTime.UtcNow;
                // Note: You might want to add an UpdateUser method to DatabaseService for this

                // Return user without password hash
                var safeUser = new { user.Id, user.Username, user.Email, user.CreatedAt, user.LastLoginAt };
                return Ok(safeUser);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        private string HashPassword(string password)
        {
            using var sha256 = SHA256.Create();
            var hashedBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(password));
            return Convert.ToBase64String(hashedBytes);
        }

        private bool VerifyPassword(string password, string hash)
        {
            return HashPassword(password) == hash;
        }
    }

    public class RegisterRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }

    public class LoginRequest
    {
        public string UsernameOrEmail { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }
}
