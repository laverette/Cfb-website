using MySqlConnector;
using System.Data;

namespace MyApp.Namespace.Services
{
    public class DatabaseService
    {
        private readonly string _connectionString;

        public DatabaseService(IConfiguration configuration)
        {
            // Prefer environment variables in production (Render), fall back to appsettings for local dev.
            // Supported env var options:
            // - ConnectionStrings__DefaultConnection (ASP.NET standard)
            // - DATABASE_URL (common platform convention)
            var envConnectionString =
                Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
                ?? Environment.GetEnvironmentVariable("DATABASE_URL");

            _connectionString =
                (!string.IsNullOrWhiteSpace(envConnectionString)
                    ? envConnectionString
                    : configuration.GetConnectionString("DefaultConnection"))
                ?? throw new ArgumentNullException("Connection string not found");
        }

        public MySqlConnection GetConnection()
        {
            return new MySqlConnection(_connectionString);
        }

        public async Task<MySqlConnection> GetConnectionAsync()
        {
            var connection = new MySqlConnection(_connectionString);
            await connection.OpenAsync();
            return connection;
        }
    }
}
