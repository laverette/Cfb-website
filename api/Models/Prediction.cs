namespace MyApp.Namespace.Models
{
    public class Prediction
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        public int Week { get; set; }
        public string Game1 { get; set; } = string.Empty;
        public string Score1 { get; set; } = string.Empty;
        public string Game2 { get; set; } = string.Empty;
        public string Score2 { get; set; } = string.Empty;
        public string Game3 { get; set; } = string.Empty;
        public string Score3 { get; set; } = string.Empty;
        public string Game4 { get; set; } = string.Empty;
        public string Score4 { get; set; } = string.Empty;
        public string Game5 { get; set; } = string.Empty;
        public string Score5 { get; set; } = string.Empty;
        public string Game6 { get; set; } = string.Empty;
        public string Score6 { get; set; } = string.Empty;
        public string Game7 { get; set; } = string.Empty;
        public string Score7 { get; set; } = string.Empty;
        public string Game8 { get; set; } = string.Empty;
        public string Score8 { get; set; } = string.Empty;
        public string Game9 { get; set; } = string.Empty;
        public string Score9 { get; set; } = string.Empty;
        public string Game10 { get; set; } = string.Empty;
        public string Score10 { get; set; } = string.Empty;
        public string Game11 { get; set; } = string.Empty;
        public string Score11 { get; set; } = string.Empty;
        public string Game12 { get; set; } = string.Empty;
        public string Score12 { get; set; } = string.Empty;
        public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;
    }
}
