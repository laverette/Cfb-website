using System.Net.Http.Headers;
using System.Text.Json;

namespace MyApp.Namespace.Services
{
    public class CollegeFootballDataService
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly ILogger<CollegeFootballDataService> _logger;

        public CollegeFootballDataService(IConfiguration configuration, ILogger<CollegeFootballDataService> logger)
        {
            _httpClient = new HttpClient();
            _apiKey = configuration["CollegeFootballData:ApiKey"] ?? throw new ArgumentNullException("CollegeFootballData:ApiKey not found");
            _logger = logger;
            
            _httpClient.BaseAddress = new Uri("https://api.collegefootballdata.com/");
            // College Football Data API uses username/password or token in Authorization header
            _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);
        }

        public async Task<List<GameDto>> GetGamesForWeek(int year, int week)
        {
            try
            {
                var response = await _httpClient.GetAsync($"games?year={year}&week={week}&seasonType=regular");
                response.EnsureSuccessStatusCode();
                
                var json = await response.Content.ReadAsStringAsync();
                var games = JsonSerializer.Deserialize<List<GameDto>>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
                
                return games ?? new List<GameDto>();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching games for year {Year}, week {Week}", year, week);
                throw;
            }
        }

        public async Task<List<TeamDto>> GetTeams()
        {
            try
            {
                var response = await _httpClient.GetAsync("teams");
                response.EnsureSuccessStatusCode();
                
                var json = await response.Content.ReadAsStringAsync();
                var teams = JsonSerializer.Deserialize<List<TeamDto>>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
                
                return teams ?? new List<TeamDto>();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching teams");
                throw;
            }
        }

        public async Task<List<GameDto>> GetGamesForWeekAndTeam(int year, int week, string? team = null)
        {
            try
            {
                var url = $"games?year={year}&week={week}&seasonType=regular";
                if (!string.IsNullOrEmpty(team))
                {
                    url += $"&team={Uri.EscapeDataString(team)}";
                }
                
                var response = await _httpClient.GetAsync(url);
                response.EnsureSuccessStatusCode();
                
                var json = await response.Content.ReadAsStringAsync();
                var games = JsonSerializer.Deserialize<List<GameDto>>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
                
                return games ?? new List<GameDto>();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching games for year {Year}, week {Week}, team {Team}", year, week, team);
                throw;
            }
        }
    }

    public class GameDto
    {
        public int Id { get; set; }
        public int Season { get; set; }
        public int Week { get; set; }
        public string? SeasonType { get; set; }
        public string? StartDate { get; set; }
        public bool? StartTimeTbd { get; set; }
        public bool? NeutralSite { get; set; }
        public bool? ConferenceGame { get; set; }
        public int? Attendance { get; set; }
        public int? VenueId { get; set; }
        public string? Venue { get; set; }
        public int? HomeId { get; set; }
        public string? HomeTeam { get; set; }
        public string? HomeConference { get; set; }
        public int? HomePoints { get; set; }
        public int? AwayId { get; set; }
        public string? AwayTeam { get; set; }
        public string? AwayConference { get; set; }
        public int? AwayPoints { get; set; }
        public double? Spread { get; set; }
        public double? HomeSpread { get; set; }
    }

    public class TeamDto
    {
        public int Id { get; set; }
        public string? School { get; set; }
        public string? Mascot { get; set; }
        public string? Abbreviation { get; set; }
        public string? AltName1 { get; set; }
        public string? AltName2 { get; set; }
        public string? AltName3 { get; set; }
        public string? Conference { get; set; }
        public string? Division { get; set; }
        public string? Color { get; set; }
        public string? AltColor { get; set; }
        public List<string>? Logos { get; set; }
    }
}

