using Microsoft.AspNetCore.Mvc;
using MyApp.Namespace.Models;
using MyApp.Namespace.Services;

namespace MyApp.Namespace.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class PredictionController : ControllerBase
    {
        private readonly SupabaseDatabaseService _databaseService;

        public PredictionController(SupabaseDatabaseService databaseService)
        {
            _databaseService = databaseService;
        }

        // GET: api/Prediction
        [HttpGet]
        public async Task<ActionResult<IEnumerable<Prediction>>> GetPredictions()
        {
            try
            {
                var predictions = await _databaseService.GetAllPredictionsAsync();
                return Ok(predictions);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        // GET: api/Prediction/user/5
        [HttpGet("user/{userId}")]
        public async Task<ActionResult<IEnumerable<Prediction>>> GetPredictionsByUser(Guid userId)
        {
            try
            {
                var predictions = await _databaseService.GetPredictionsByUserIdAsync(userId);
                return Ok(predictions);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        // POST: api/Prediction
        [HttpPost]
        public async Task<ActionResult<Prediction>> CreatePrediction([FromBody] CreatePredictionRequest request)
        {
            try
            {
                if (request.UserId == Guid.Empty)
                {
                    return BadRequest("Valid UserId is required");
                }

                // Verify user exists
                var user = await _databaseService.GetUserByIdAsync(request.UserId);
                if (user == null)
                {
                    return NotFound("User not found");
                }

                var prediction = new Prediction
                {
                    UserId = request.UserId,
                    Week = request.Week,
                    Game1 = request.Game1 ?? string.Empty,
                    Score1 = request.Score1 ?? string.Empty,
                    Game2 = request.Game2 ?? string.Empty,
                    Score2 = request.Score2 ?? string.Empty,
                    Game3 = request.Game3 ?? string.Empty,
                    Score3 = request.Score3 ?? string.Empty,
                    Game4 = request.Game4 ?? string.Empty,
                    Score4 = request.Score4 ?? string.Empty,
                    Game5 = request.Game5 ?? string.Empty,
                    Score5 = request.Score5 ?? string.Empty,
                    Game6 = request.Game6 ?? string.Empty,
                    Score6 = request.Score6 ?? string.Empty,
                    Game7 = request.Game7 ?? string.Empty,
                    Score7 = request.Score7 ?? string.Empty,
                    Game8 = request.Game8 ?? string.Empty,
                    Score8 = request.Score8 ?? string.Empty,
                    Game9 = request.Game9 ?? string.Empty,
                    Score9 = request.Score9 ?? string.Empty,
                    Game10 = request.Game10 ?? string.Empty,
                    Score10 = request.Score10 ?? string.Empty,
                    Game11 = request.Game11 ?? string.Empty,
                    Score11 = request.Score11 ?? string.Empty,
                    Game12 = request.Game12 ?? string.Empty,
                    Score12 = request.Score12 ?? string.Empty,
                    SubmittedAt = DateTime.UtcNow
                };

                var createdPrediction = await _databaseService.CreatePredictionAsync(prediction);
                return CreatedAtAction(nameof(GetPredictions), new { id = createdPrediction.Id }, createdPrediction);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        // POST: api/Prediction/submit (for backward compatibility with existing form)
        [HttpPost("submit")]
        public async Task<ActionResult> SubmitPrediction([FromForm] SubmitPredictionFormRequest request)
        {
            try
            {
                if (string.IsNullOrEmpty(request.User))
                {
                    return BadRequest("User name is required");
                }

                // For now, we'll create a simple user lookup by username
                // In a real app, you'd want proper authentication
                var users = await _databaseService.GetAllUsersAsync();
                var user = users.FirstOrDefault(u => u.Username.Equals(request.User, StringComparison.OrdinalIgnoreCase));
                
                if (user == null)
                {
                    return NotFound($"User '{request.User}' not found. Please register first.");
                }

                var prediction = new Prediction
                {
                    UserId = user.Id,
                    Week = 4, // Default to week 4 for now
                    Game1 = request.Game1 ?? string.Empty,
                    Score1 = string.Empty,
                    Game2 = request.Game2 ?? string.Empty,
                    Score2 = string.Empty,
                    Game3 = request.Game3 ?? string.Empty,
                    Score3 = string.Empty,
                    Game4 = request.Game4 ?? string.Empty,
                    Score4 = string.Empty,
                    Game5 = request.Game5 ?? string.Empty,
                    Score5 = string.Empty,
                    Game6 = request.Game6 ?? string.Empty,
                    Score6 = string.Empty,
                    Game7 = request.Game7 ?? string.Empty,
                    Score7 = string.Empty,
                    Game8 = request.Game8 ?? string.Empty,
                    Score8 = string.Empty,
                    Game9 = request.Game9 ?? string.Empty,
                    Score9 = string.Empty,
                    Game10 = request.Game10 ?? string.Empty,
                    Score10 = string.Empty,
                    Game11 = request.Game11 ?? string.Empty,
                    Score11 = string.Empty,
                    Game12 = request.Game12 ?? string.Empty,
                    Score12 = string.Empty,
                    SubmittedAt = DateTime.UtcNow
                };

                await _databaseService.CreatePredictionAsync(prediction);
                return Ok(new { message = "Prediction saved successfully!" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }
    }

    public class CreatePredictionRequest
    {
        public Guid UserId { get; set; }
        public int Week { get; set; }
        public string? Game1 { get; set; }
        public string? Score1 { get; set; }
        public string? Game2 { get; set; }
        public string? Score2 { get; set; }
        public string? Game3 { get; set; }
        public string? Score3 { get; set; }
        public string? Game4 { get; set; }
        public string? Score4 { get; set; }
        public string? Game5 { get; set; }
        public string? Score5 { get; set; }
        public string? Game6 { get; set; }
        public string? Score6 { get; set; }
        public string? Game7 { get; set; }
        public string? Score7 { get; set; }
        public string? Game8 { get; set; }
        public string? Score8 { get; set; }
        public string? Game9 { get; set; }
        public string? Score9 { get; set; }
        public string? Game10 { get; set; }
        public string? Score10 { get; set; }
        public string? Game11 { get; set; }
        public string? Score11 { get; set; }
        public string? Game12 { get; set; }
        public string? Score12 { get; set; }
    }

    public class SubmitPredictionFormRequest
    {
        public string User { get; set; } = string.Empty;
        public string? Game1 { get; set; }
        public string? Game2 { get; set; }
        public string? Game3 { get; set; }
        public string? Game4 { get; set; }
        public string? Game5 { get; set; }
        public string? Game6 { get; set; }
        public string? Game7 { get; set; }
        public string? Game8 { get; set; }
        public string? Game9 { get; set; }
        public string? Game10 { get; set; }
        public string? Game11 { get; set; }
        public string? Game12 { get; set; }
    }
}
