using System.ComponentModel.DataAnnotations;

namespace MyApp.Namespace.Models
{
    // User model for CFB Picks Site
    public class User
    {
        public int Id { get; set; }
        
        [Required]
        public string Username { get; set; } = string.Empty;
        
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;
        
        [Required]
        public string PasswordHash { get; set; } = string.Empty;
        
        public string? DisplayName { get; set; }
        
        public string? AvatarUrl { get; set; }
        
        public string? Bio { get; set; }
        
        public string Role { get; set; } = "user"; // "user" or "admin"
        
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    public class UserProfile
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        public int? FavoriteTeamEspnId { get; set; }
        public string? FavoriteConference { get; set; }
        public string? Location { get; set; }
        public int TotalPicks { get; set; } = 0;
        public int CorrectPicks { get; set; } = 0;
        public decimal Accuracy { get; set; } = 0.00m;
        public int CurrentStreak { get; set; } = 0;
        public int BestStreak { get; set; } = 0;
        public int? Ranking { get; set; }
        public DateTime? LastPickDate { get; set; }
        
        public User? User { get; set; }
    }

    // DTOs for API requests/responses
    public class RegisterRequest
    {
        [Required]
        [MinLength(3)]
        [MaxLength(50)]
        public string Username { get; set; } = string.Empty;
        
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;
        
        [Required]
        [MinLength(8)]
        public string Password { get; set; } = string.Empty;
        
        public string? DisplayName { get; set; }
    }

    public class LoginRequest
    {
        [Required]
        public string Username { get; set; } = string.Empty;
        
        [Required]
        public string Password { get; set; } = string.Empty;
    }

    public class AuthResponse
    {
        public string Token { get; set; } = string.Empty;
        public UserResponse User { get; set; } = new();
    }

    public class UserResponse
    {
        public int Id { get; set; }
        public string Username { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string? DisplayName { get; set; }
        public string? AvatarUrl { get; set; }
        public string? Bio { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class ProfileResponse
    {
        public UserResponse User { get; set; } = new();
        public UserProfile? Profile { get; set; }
    }
}
