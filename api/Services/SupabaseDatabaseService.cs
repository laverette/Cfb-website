using Supabase;
using MyApp.Namespace.Models;

namespace MyApp.Namespace.Services
{
    public class SupabaseDatabaseService
    {
        private readonly Supabase.Client _supabase;

        public SupabaseDatabaseService(IConfiguration configuration)
        {
            var supabaseUrl = configuration["Supabase:Url"];
            var supabaseKey = configuration["Supabase:AnonKey"];

            if (string.IsNullOrEmpty(supabaseUrl) || string.IsNullOrEmpty(supabaseKey))
            {
                throw new InvalidOperationException("Supabase configuration is missing. Please check your appsettings.json file.");
            }

            var options = new SupabaseOptions
            {
                AutoConnectRealtime = true
            };

            _supabase = new Supabase.Client(supabaseUrl, supabaseKey, options);
        }

        public async Task<User?> GetUserByIdAsync(Guid id)
        {
            var response = await _supabase
                .From<User>()
                .Where(x => x.Id == id)
                .Single();

            return response;
        }

        public async Task<User?> GetUserByEmailAsync(string email)
        {
            var response = await _supabase
                .From<User>()
                .Where(x => x.Email == email)
                .Single();

            return response;
        }

        public async Task<User?> GetUserByUsernameOrEmailAsync(string usernameOrEmail)
        {
            var response = await _supabase
                .From<User>()
                .Where(x => x.Username == usernameOrEmail || x.Email == usernameOrEmail)
                .Single();

            return response;
        }

        public async Task<User> CreateUserAsync(User user)
        {
            user.Id = Guid.NewGuid();
            user.CreatedAt = DateTime.UtcNow;

            var response = await _supabase
                .From<User>()
                .Insert(user);

            return response.Models.FirstOrDefault() ?? user;
        }

        public async Task<List<User>> GetAllUsersAsync()
        {
            var response = await _supabase
                .From<User>()
                .Get();

            return response.Models.OrderBy(x => x.Username).ToList();
        }

        public async Task<Prediction> CreatePredictionAsync(Prediction prediction)
        {
            prediction.Id = Guid.NewGuid();
            prediction.SubmittedAt = DateTime.UtcNow;

            var response = await _supabase
                .From<Prediction>()
                .Insert(prediction);

            return response.Models.FirstOrDefault() ?? prediction;
        }

        public async Task<List<Prediction>> GetPredictionsByUserIdAsync(Guid userId)
        {
            var response = await _supabase
                .From<Prediction>()
                .Where(x => x.UserId == userId)
                .Get();

            return response.Models.OrderByDescending(x => x.Week).ThenByDescending(x => x.SubmittedAt).ToList();
        }

        public async Task<List<Prediction>> GetAllPredictionsAsync()
        {
            var response = await _supabase
                .From<Prediction>()
                .Get();

            return response.Models.OrderByDescending(x => x.Week).ThenByDescending(x => x.SubmittedAt).ToList();
        }

        public async Task<Prediction?> GetPredictionByIdAsync(Guid id)
        {
            var response = await _supabase
                .From<Prediction>()
                .Where(x => x.Id == id)
                .Single();

            return response;
        }

        public async Task<Prediction?> GetPredictionByUserAndWeekAsync(Guid userId, int week)
        {
            var response = await _supabase
                .From<Prediction>()
                .Where(x => x.UserId == userId && x.Week == week)
                .Single();

            return response;
        }

        public async Task<Prediction> UpdatePredictionAsync(Prediction prediction)
        {
            prediction.SubmittedAt = DateTime.UtcNow;
            
            var response = await _supabase
                .From<Prediction>()
                .Where(x => x.Id == prediction.Id)
                .Set(x => x.Game1, prediction.Game1)
                .Set(x => x.Score1, prediction.Score1)
                .Set(x => x.Game2, prediction.Game2)
                .Set(x => x.Score2, prediction.Score2)
                .Set(x => x.Game3, prediction.Game3)
                .Set(x => x.Score3, prediction.Score3)
                .Set(x => x.Game4, prediction.Game4)
                .Set(x => x.Score4, prediction.Score4)
                .Set(x => x.Game5, prediction.Game5)
                .Set(x => x.Score5, prediction.Score5)
                .Set(x => x.Game6, prediction.Game6)
                .Set(x => x.Score6, prediction.Score6)
                .Set(x => x.Game7, prediction.Game7)
                .Set(x => x.Score7, prediction.Score7)
                .Set(x => x.Game8, prediction.Game8)
                .Set(x => x.Score8, prediction.Score8)
                .Set(x => x.Game9, prediction.Game9)
                .Set(x => x.Score9, prediction.Score9)
                .Set(x => x.Game10, prediction.Game10)
                .Set(x => x.Score10, prediction.Score10)
                .Set(x => x.Game11, prediction.Game11)
                .Set(x => x.Score11, prediction.Score11)
                .Set(x => x.Game12, prediction.Game12)
                .Set(x => x.Score12, prediction.Score12)
                .Set(x => x.SubmittedAt, prediction.SubmittedAt)
                .Update();

            return response.Models.FirstOrDefault() ?? prediction;
        }

        public async Task<bool> DeletePredictionAsync(Guid id)
        {
            await _supabase
                .From<Prediction>()
                .Where(x => x.Id == id)
                .Delete();

            return true; // Supabase delete doesn't return the deleted items
        }
    }
}
