using System.ComponentModel.DataAnnotations;

namespace MyApp.Namespace.Models
{
    public class User
    {
        public int Id { get; set; }
        
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;
        
        [Required]
        public string PasswordHash { get; set; } = string.Empty;
        
        [Required]
        public string FirstName { get; set; } = string.Empty;
        
        [Required]
        public string LastName { get; set; } = string.Empty;
        
        [Required]
        public string UserType { get; set; } = string.Empty; // "Applicant" or "Employer"
        
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    public class Applicant
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        public string? Phone { get; set; }
        public string? Location { get; set; }
        public string? Industry { get; set; }
        public string? WorkType { get; set; } // "Remote", "Hybrid", "OnSite", "WillingToMove"
        public string? ResumePath { get; set; }
        public string? Bio { get; set; }
        public string? Skills { get; set; } // JSON array
        public string? Experience { get; set; } // JSON array
        public string? Education { get; set; } // JSON array
        
        // Navigation property
        public User? User { get; set; }
    }

    public class Employer
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        
        [Required]
        public string CompanyName { get; set; } = string.Empty;
        public string? CompanySize { get; set; }
        public string? Industry { get; set; }
        public string? Location { get; set; }
        public string? Website { get; set; }
        public string? Description { get; set; }
        
        // Navigation property
        public User? User { get; set; }
    }

    public class JobPosting
    {
        public int Id { get; set; }
        public int EmployerId { get; set; }
        
        [Required]
        public string Title { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string? Industry { get; set; }
        public string? Location { get; set; }
        public string? WorkType { get; set; } // "Remote", "Hybrid", "OnSite"
        public int? SalaryMin { get; set; }
        public int? SalaryMax { get; set; }
        public string? RequiredSkills { get; set; } // JSON array
        public string? PreferredSkills { get; set; } // JSON array
        public string? ExperienceLevel { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        
        // Navigation property
        public Employer? Employer { get; set; }
    }

    public class Swipe
    {
        public int Id { get; set; }
        public int EmployerId { get; set; }
        public int ApplicantId { get; set; }
        public int? JobPostingId { get; set; }
        
        [Required]
        public string SwipeType { get; set; } = string.Empty; // "Like" or "Pass"
        
        public DateTime SwipedAt { get; set; } = DateTime.UtcNow;
        public DateTime? HideUntil { get; set; } // For temporary hiding
        
        // Navigation properties
        public Employer? Employer { get; set; }
        public Applicant? Applicant { get; set; }
        public JobPosting? JobPosting { get; set; }
    }

    public class Match
    {
        public int Id { get; set; }
        public int EmployerId { get; set; }
        public int ApplicantId { get; set; }
        public int? JobPostingId { get; set; }
        public DateTime MatchedAt { get; set; } = DateTime.UtcNow;
        public bool IsActive { get; set; } = true;
        
        // Navigation properties
        public Employer? Employer { get; set; }
        public Applicant? Applicant { get; set; }
        public JobPosting? JobPosting { get; set; }
    }

    // DTOs for API requests/responses
    public class LoginRequest
    {
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;
        
        [Required]
        public string Password { get; set; } = string.Empty;
    }

    public class RegisterRequest
    {
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;
        
        [Required]
        [MinLength(8)]
        public string Password { get; set; } = string.Empty;
        
        [Required]
        public string FirstName { get; set; } = string.Empty;
        
        [Required]
        public string LastName { get; set; } = string.Empty;
        
        [Required]
        public string UserType { get; set; } = string.Empty;
    }

    public class AuthResponse
    {
        public string Token { get; set; } = string.Empty;
        public User User { get; set; } = new();
    }
}