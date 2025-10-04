using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace MyApp.Namespace.Models
{
    [Table("predictions")]
    public class Prediction : BaseModel
    {
        [PrimaryKey("id")]
        public Guid Id { get; set; } = Guid.NewGuid();
        
        [Column("user_id")]
        public Guid UserId { get; set; }
        
        [Column("week")]
        public int Week { get; set; }
        
        [Column("game1")]
        public string Game1 { get; set; } = string.Empty;
        
        [Column("score1")]
        public string Score1 { get; set; } = string.Empty;
        
        [Column("game2")]
        public string Game2 { get; set; } = string.Empty;
        
        [Column("score2")]
        public string Score2 { get; set; } = string.Empty;
        
        [Column("game3")]
        public string Game3 { get; set; } = string.Empty;
        
        [Column("score3")]
        public string Score3 { get; set; } = string.Empty;
        
        [Column("game4")]
        public string Game4 { get; set; } = string.Empty;
        
        [Column("score4")]
        public string Score4 { get; set; } = string.Empty;
        
        [Column("game5")]
        public string Game5 { get; set; } = string.Empty;
        
        [Column("score5")]
        public string Score5 { get; set; } = string.Empty;
        
        [Column("game6")]
        public string Game6 { get; set; } = string.Empty;
        
        [Column("score6")]
        public string Score6 { get; set; } = string.Empty;
        
        [Column("game7")]
        public string Game7 { get; set; } = string.Empty;
        
        [Column("score7")]
        public string Score7 { get; set; } = string.Empty;
        
        [Column("game8")]
        public string Game8 { get; set; } = string.Empty;
        
        [Column("score8")]
        public string Score8 { get; set; } = string.Empty;
        
        [Column("game9")]
        public string Game9 { get; set; } = string.Empty;
        
        [Column("score9")]
        public string Score9 { get; set; } = string.Empty;
        
        [Column("game10")]
        public string Game10 { get; set; } = string.Empty;
        
        [Column("score10")]
        public string Score10 { get; set; } = string.Empty;
        
        [Column("game11")]
        public string Game11 { get; set; } = string.Empty;
        
        [Column("score11")]
        public string Score11 { get; set; } = string.Empty;
        
        [Column("game12")]
        public string Game12 { get; set; } = string.Empty;
        
        [Column("score12")]
        public string Score12 { get; set; } = string.Empty;
        
        [Column("submitted_at")]
        public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;
    }
}



