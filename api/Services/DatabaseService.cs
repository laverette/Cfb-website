using Microsoft.Data.Sqlite;
using MyApp.Namespace.Models;

namespace MyApp.Namespace.Services
{
    public class DatabaseService
    {
        private readonly string _connectionString;

        public DatabaseService(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") ?? "Data Source=./database.db";
            InitializeDatabase();
        }

        private void InitializeDatabase()
        {
            using var connection = new SqliteConnection(_connectionString);
            connection.Open();

            // Create Users table
            var createUsersTable = @"
                CREATE TABLE IF NOT EXISTS Users (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    Username TEXT UNIQUE NOT NULL,
                    Email TEXT UNIQUE NOT NULL,
                    PasswordHash TEXT NOT NULL,
                    CreatedAt DATETIME NOT NULL,
                    LastLoginAt DATETIME
                )";

            // Create Predictions table
            var createPredictionsTable = @"
                CREATE TABLE IF NOT EXISTS Predictions (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    UserId INTEGER NOT NULL,
                    Week INTEGER NOT NULL,
                    Game1 TEXT,
                    Score1 TEXT,
                    Game2 TEXT,
                    Score2 TEXT,
                    Game3 TEXT,
                    Score3 TEXT,
                    Game4 TEXT,
                    Score4 TEXT,
                    Game5 TEXT,
                    Score5 TEXT,
                    Game6 TEXT,
                    Score6 TEXT,
                    Game7 TEXT,
                    Score7 TEXT,
                    Game8 TEXT,
                    Score8 TEXT,
                    Game9 TEXT,
                    Score9 TEXT,
                    Game10 TEXT,
                    Score10 TEXT,
                    Game11 TEXT,
                    Score11 TEXT,
                    Game12 TEXT,
                    Score12 TEXT,
                    SubmittedAt DATETIME NOT NULL,
                    FOREIGN KEY (UserId) REFERENCES Users (Id)
                )";

            using var command1 = new SqliteCommand(createUsersTable, connection);
            command1.ExecuteNonQuery();

            using var command2 = new SqliteCommand(createPredictionsTable, connection);
            command2.ExecuteNonQuery();
        }

        public async Task<User?> GetUserByIdAsync(int id)
        {
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync();

            var command = new SqliteCommand("SELECT * FROM Users WHERE Id = @id", connection);
            command.Parameters.AddWithValue("@id", id);

            using var reader = await command.ExecuteReaderAsync();
            if (await reader.ReadAsync())
            {
                return new User
                {
                    Id = reader.GetInt32(reader.GetOrdinal("Id")),
                    Username = reader.GetString(reader.GetOrdinal("Username")),
                    Email = reader.GetString(reader.GetOrdinal("Email")),
                    PasswordHash = reader.GetString(reader.GetOrdinal("PasswordHash")),
                    CreatedAt = reader.GetDateTime(reader.GetOrdinal("CreatedAt")),
                    LastLoginAt = reader.IsDBNull(reader.GetOrdinal("LastLoginAt")) ? null : reader.GetDateTime(reader.GetOrdinal("LastLoginAt"))
                };
            }
            return null;
        }

        public async Task<User?> GetUserByEmailAsync(string email)
        {
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync();

            var command = new SqliteCommand("SELECT * FROM Users WHERE Email = @email", connection);
            command.Parameters.AddWithValue("@email", email);

            using var reader = await command.ExecuteReaderAsync();
            if (await reader.ReadAsync())
            {
                return new User
                {
                    Id = reader.GetInt32(reader.GetOrdinal("Id")),
                    Username = reader.GetString(reader.GetOrdinal("Username")),
                    Email = reader.GetString(reader.GetOrdinal("Email")),
                    PasswordHash = reader.GetString(reader.GetOrdinal("PasswordHash")),
                    CreatedAt = reader.GetDateTime(reader.GetOrdinal("CreatedAt")),
                    LastLoginAt = reader.IsDBNull(reader.GetOrdinal("LastLoginAt")) ? null : reader.GetDateTime(reader.GetOrdinal("LastLoginAt"))
                };
            }
            return null;
        }

        public async Task<User?> GetUserByUsernameOrEmailAsync(string usernameOrEmail)
        {
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync();

            var command = new SqliteCommand("SELECT * FROM Users WHERE Username = @usernameOrEmail OR Email = @usernameOrEmail", connection);
            command.Parameters.AddWithValue("@usernameOrEmail", usernameOrEmail);

            using var reader = await command.ExecuteReaderAsync();
            if (await reader.ReadAsync())
            {
                return new User
                {
                    Id = reader.GetInt32(reader.GetOrdinal("Id")),
                    Username = reader.GetString(reader.GetOrdinal("Username")),
                    Email = reader.GetString(reader.GetOrdinal("Email")),
                    PasswordHash = reader.GetString(reader.GetOrdinal("PasswordHash")),
                    CreatedAt = reader.GetDateTime(reader.GetOrdinal("CreatedAt")),
                    LastLoginAt = reader.IsDBNull(reader.GetOrdinal("LastLoginAt")) ? null : reader.GetDateTime(reader.GetOrdinal("LastLoginAt"))
                };
            }
            return null;
        }

        public async Task<User> CreateUserAsync(User user)
        {
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync();

            var command = new SqliteCommand(@"
                INSERT INTO Users (Username, Email, PasswordHash, CreatedAt)
                VALUES (@username, @email, @passwordHash, @createdAt);
                SELECT last_insert_rowid();", connection);

            command.Parameters.AddWithValue("@username", user.Username);
            command.Parameters.AddWithValue("@email", user.Email);
            command.Parameters.AddWithValue("@passwordHash", user.PasswordHash);
            command.Parameters.AddWithValue("@createdAt", user.CreatedAt);

            var id = await command.ExecuteScalarAsync();
            user.Id = Convert.ToInt32(id);
            return user;
        }

        public async Task<List<User>> GetAllUsersAsync()
        {
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync();

            var command = new SqliteCommand("SELECT * FROM Users ORDER BY Username", connection);
            var users = new List<User>();

            using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                users.Add(new User
                {
                    Id = reader.GetInt32(reader.GetOrdinal("Id")),
                    Username = reader.GetString(reader.GetOrdinal("Username")),
                    Email = reader.GetString(reader.GetOrdinal("Email")),
                    PasswordHash = reader.GetString(reader.GetOrdinal("PasswordHash")),
                    CreatedAt = reader.GetDateTime(reader.GetOrdinal("CreatedAt")),
                    LastLoginAt = reader.IsDBNull(reader.GetOrdinal("LastLoginAt")) ? null : reader.GetDateTime(reader.GetOrdinal("LastLoginAt"))
                });
            }
            return users;
        }

        public async Task<Prediction> CreatePredictionAsync(Prediction prediction)
        {
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync();

            var command = new SqliteCommand(@"
                INSERT INTO Predictions (UserId, Week, Game1, Score1, Game2, Score2, Game3, Score3, Game4, Score4, 
                                       Game5, Score5, Game6, Score6, Game7, Score7, Game8, Score8, Game9, Score9, 
                                       Game10, Score10, Game11, Score11, Game12, Score12, SubmittedAt)
                VALUES (@userId, @week, @game1, @score1, @game2, @score2, @game3, @score3, @game4, @score4,
                        @game5, @score5, @game6, @score6, @game7, @score7, @game8, @score8, @game9, @score9,
                        @game10, @score10, @game11, @score11, @game12, @score12, @submittedAt);
                SELECT last_insert_rowid();", connection);

            command.Parameters.AddWithValue("@userId", prediction.UserId);
            command.Parameters.AddWithValue("@week", prediction.Week);
            command.Parameters.AddWithValue("@game1", prediction.Game1);
            command.Parameters.AddWithValue("@score1", prediction.Score1);
            command.Parameters.AddWithValue("@game2", prediction.Game2);
            command.Parameters.AddWithValue("@score2", prediction.Score2);
            command.Parameters.AddWithValue("@game3", prediction.Game3);
            command.Parameters.AddWithValue("@score3", prediction.Score3);
            command.Parameters.AddWithValue("@game4", prediction.Game4);
            command.Parameters.AddWithValue("@score4", prediction.Score4);
            command.Parameters.AddWithValue("@game5", prediction.Game5);
            command.Parameters.AddWithValue("@score5", prediction.Score5);
            command.Parameters.AddWithValue("@game6", prediction.Game6);
            command.Parameters.AddWithValue("@score6", prediction.Score6);
            command.Parameters.AddWithValue("@game7", prediction.Game7);
            command.Parameters.AddWithValue("@score7", prediction.Score7);
            command.Parameters.AddWithValue("@game8", prediction.Game8);
            command.Parameters.AddWithValue("@score8", prediction.Score8);
            command.Parameters.AddWithValue("@game9", prediction.Game9);
            command.Parameters.AddWithValue("@score9", prediction.Score9);
            command.Parameters.AddWithValue("@game10", prediction.Game10);
            command.Parameters.AddWithValue("@score10", prediction.Score10);
            command.Parameters.AddWithValue("@game11", prediction.Game11);
            command.Parameters.AddWithValue("@score11", prediction.Score11);
            command.Parameters.AddWithValue("@game12", prediction.Game12);
            command.Parameters.AddWithValue("@score12", prediction.Score12);
            command.Parameters.AddWithValue("@submittedAt", prediction.SubmittedAt);

            var id = await command.ExecuteScalarAsync();
            prediction.Id = Convert.ToInt32(id);
            return prediction;
        }

        public async Task<List<Prediction>> GetPredictionsByUserIdAsync(int userId)
        {
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync();

            var command = new SqliteCommand("SELECT * FROM Predictions WHERE UserId = @userId ORDER BY Week DESC, SubmittedAt DESC", connection);
            command.Parameters.AddWithValue("@userId", userId);

            var predictions = new List<Prediction>();
            using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                predictions.Add(new Prediction
                {
                    Id = reader.GetInt32(reader.GetOrdinal("Id")),
                    UserId = reader.GetInt32(reader.GetOrdinal("UserId")),
                    Week = reader.GetInt32(reader.GetOrdinal("Week")),
                    Game1 = reader.GetString(reader.GetOrdinal("Game1")),
                    Score1 = reader.GetString(reader.GetOrdinal("Score1")),
                    Game2 = reader.GetString(reader.GetOrdinal("Game2")),
                    Score2 = reader.GetString(reader.GetOrdinal("Score2")),
                    Game3 = reader.GetString(reader.GetOrdinal("Game3")),
                    Score3 = reader.GetString(reader.GetOrdinal("Score3")),
                    Game4 = reader.GetString(reader.GetOrdinal("Game4")),
                    Score4 = reader.GetString(reader.GetOrdinal("Score4")),
                    Game5 = reader.GetString(reader.GetOrdinal("Game5")),
                    Score5 = reader.GetString(reader.GetOrdinal("Score5")),
                    Game6 = reader.GetString(reader.GetOrdinal("Game6")),
                    Score6 = reader.GetString(reader.GetOrdinal("Score6")),
                    Game7 = reader.GetString(reader.GetOrdinal("Game7")),
                    Score7 = reader.GetString(reader.GetOrdinal("Score7")),
                    Game8 = reader.GetString(reader.GetOrdinal("Game8")),
                    Score8 = reader.GetString(reader.GetOrdinal("Score8")),
                    Game9 = reader.GetString(reader.GetOrdinal("Game9")),
                    Score9 = reader.GetString(reader.GetOrdinal("Score9")),
                    Game10 = reader.GetString(reader.GetOrdinal("Game10")),
                    Score10 = reader.GetString(reader.GetOrdinal("Score10")),
                    Game11 = reader.GetString(reader.GetOrdinal("Game11")),
                    Score11 = reader.GetString(reader.GetOrdinal("Score11")),
                    Game12 = reader.GetString(reader.GetOrdinal("Game12")),
                    Score12 = reader.GetString(reader.GetOrdinal("Score12")),
                    SubmittedAt = reader.GetDateTime(reader.GetOrdinal("SubmittedAt"))
                });
            }
            return predictions;
        }

        public async Task<List<Prediction>> GetAllPredictionsAsync()
        {
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync();

            var command = new SqliteCommand("SELECT * FROM Predictions ORDER BY Week DESC, SubmittedAt DESC", connection);
            var predictions = new List<Prediction>();

            using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                predictions.Add(new Prediction
                {
                    Id = reader.GetInt32(reader.GetOrdinal("Id")),
                    UserId = reader.GetInt32(reader.GetOrdinal("UserId")),
                    Week = reader.GetInt32(reader.GetOrdinal("Week")),
                    Game1 = reader.GetString(reader.GetOrdinal("Game1")),
                    Score1 = reader.GetString(reader.GetOrdinal("Score1")),
                    Game2 = reader.GetString(reader.GetOrdinal("Game2")),
                    Score2 = reader.GetString(reader.GetOrdinal("Score2")),
                    Game3 = reader.GetString(reader.GetOrdinal("Game3")),
                    Score3 = reader.GetString(reader.GetOrdinal("Score3")),
                    Game4 = reader.GetString(reader.GetOrdinal("Game4")),
                    Score4 = reader.GetString(reader.GetOrdinal("Score4")),
                    Game5 = reader.GetString(reader.GetOrdinal("Game5")),
                    Score5 = reader.GetString(reader.GetOrdinal("Score5")),
                    Game6 = reader.GetString(reader.GetOrdinal("Game6")),
                    Score6 = reader.GetString(reader.GetOrdinal("Score6")),
                    Game7 = reader.GetString(reader.GetOrdinal("Game7")),
                    Score7 = reader.GetString(reader.GetOrdinal("Score7")),
                    Game8 = reader.GetString(reader.GetOrdinal("Game8")),
                    Score8 = reader.GetString(reader.GetOrdinal("Score8")),
                    Game9 = reader.GetString(reader.GetOrdinal("Game9")),
                    Score9 = reader.GetString(reader.GetOrdinal("Score9")),
                    Game10 = reader.GetString(reader.GetOrdinal("Game10")),
                    Score10 = reader.GetString(reader.GetOrdinal("Score10")),
                    Game11 = reader.GetString(reader.GetOrdinal("Game11")),
                    Score11 = reader.GetString(reader.GetOrdinal("Score11")),
                    Game12 = reader.GetString(reader.GetOrdinal("Game12")),
                    Score12 = reader.GetString(reader.GetOrdinal("Score12")),
                    SubmittedAt = reader.GetDateTime(reader.GetOrdinal("SubmittedAt"))
                });
            }
            return predictions;
        }
    }
}
