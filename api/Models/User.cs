using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace MyApp.Namespace.Models
{
    [Table("users")]
    public class User : BaseModel
    {
        [PrimaryKey("id")]
        public Guid Id { get; set; } = Guid.NewGuid();
        
        [Column("username")]
        public string Username { get; set; } = string.Empty;
        
        [Column("email")]
        public string Email { get; set; } = string.Empty;
        
        [Column("password_hash")]
        public string PasswordHash { get; set; } = string.Empty;
        
        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        
        [Column("last_login_at")]
        public DateTime? LastLoginAt { get; set; }
    }
}
