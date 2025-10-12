using Microsoft.Data.Sqlite;
using System.Data;

namespace MyApp.Namespace.Services
{
    public class DatabaseService
    {
        private readonly string _connectionString;

        public DatabaseService(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") ?? 
                throw new ArgumentNullException("Connection string not found");
            
            InitializeDatabase();
        }

        private void InitializeDatabase()
        {
            using var connection = new SqliteConnection(_connectionString);
            connection.Open();

            // Create tables if they don't exist
            var createTablesScript = @"
                CREATE TABLE IF NOT EXISTS Users (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    Email TEXT UNIQUE NOT NULL,
                    PasswordHash TEXT NOT NULL,
                    FirstName TEXT NOT NULL,
                    LastName TEXT NOT NULL,
                    UserType TEXT NOT NULL CHECK (UserType IN ('Applicant', 'Employer')),
                    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS Applicants (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    UserId INTEGER NOT NULL,
                    Phone TEXT,
                    Location TEXT,
                    Industry TEXT,
                    WorkType TEXT CHECK (WorkType IN ('Remote', 'Hybrid', 'OnSite', 'WillingToMove')),
                    ResumePath TEXT,
                    Bio TEXT,
                    Skills TEXT, -- JSON array of skills
                    Experience TEXT, -- JSON array of experience
                    Education TEXT, -- JSON array of education
                    FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS Employers (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    UserId INTEGER NOT NULL,
                    CompanyName TEXT NOT NULL,
                    CompanySize TEXT,
                    Industry TEXT,
                    Location TEXT,
                    Website TEXT,
                    Description TEXT,
                    FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS JobPostings (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    EmployerId INTEGER NOT NULL,
                    Title TEXT NOT NULL,
                    Description TEXT,
                    Industry TEXT,
                    Location TEXT,
                    WorkType TEXT CHECK (WorkType IN ('Remote', 'Hybrid', 'OnSite')),
                    SalaryMin INTEGER,
                    SalaryMax INTEGER,
                    RequiredSkills TEXT, -- JSON array
                    PreferredSkills TEXT, -- JSON array
                    ExperienceLevel TEXT,
                    IsActive BOOLEAN DEFAULT 1,
                    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (EmployerId) REFERENCES Employers(Id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS Swipes (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    EmployerId INTEGER NOT NULL,
                    ApplicantId INTEGER NOT NULL,
                    JobPostingId INTEGER,
                    SwipeType TEXT NOT NULL CHECK (SwipeType IN ('Like', 'Pass')),
                    SwipedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    HideUntil DATETIME, -- For temporary hiding of passed candidates
                    FOREIGN KEY (EmployerId) REFERENCES Employers(Id) ON DELETE CASCADE,
                    FOREIGN KEY (ApplicantId) REFERENCES Applicants(Id) ON DELETE CASCADE,
                    FOREIGN KEY (JobPostingId) REFERENCES JobPostings(Id) ON DELETE SET NULL,
                    UNIQUE(EmployerId, ApplicantId, JobPostingId)
                );

                CREATE TABLE IF NOT EXISTS Matches (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    EmployerId INTEGER NOT NULL,
                    ApplicantId INTEGER NOT NULL,
                    JobPostingId INTEGER,
                    MatchedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    IsActive BOOLEAN DEFAULT 1,
                    FOREIGN KEY (EmployerId) REFERENCES Employers(Id) ON DELETE CASCADE,
                    FOREIGN KEY (ApplicantId) REFERENCES Applicants(Id) ON DELETE CASCADE,
                    FOREIGN KEY (JobPostingId) REFERENCES JobPostings(Id) ON DELETE SET NULL,
                    UNIQUE(EmployerId, ApplicantId, JobPostingId)
                );

                -- Create indexes for better performance
                CREATE INDEX IF NOT EXISTS idx_users_email ON Users(Email);
                CREATE INDEX IF NOT EXISTS idx_applicants_userid ON Applicants(UserId);
                CREATE INDEX IF NOT EXISTS idx_employers_userid ON Employers(UserId);
                CREATE INDEX IF NOT EXISTS idx_swipes_employer ON Swipes(EmployerId);
                CREATE INDEX IF NOT EXISTS idx_swipes_applicant ON Swipes(ApplicantId);
                CREATE INDEX IF NOT EXISTS idx_matches_employer ON Matches(EmployerId);
                CREATE INDEX IF NOT EXISTS idx_matches_applicant ON Matches(ApplicantId);
            ";

            using var command = new SqliteCommand(createTablesScript, connection);
            command.ExecuteNonQuery();
        }

        public SqliteConnection GetConnection()
        {
            return new SqliteConnection(_connectionString);
        }

        public async Task<SqliteConnection> GetConnectionAsync()
        {
            var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync();
            return connection;
        }
    }
}
