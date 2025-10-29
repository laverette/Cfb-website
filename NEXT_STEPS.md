# CFB Picks API - Next Steps

## ✅ What's Been Done

1. **Database Schema Created** (`database_schema.sql`)
   - Users table with profile system
   - Weekly picks tracking
   - Game results tracking
   - User statistics

2. **API Updated for MySQL**
   - Updated `DatabaseService.cs` to use MySQL
   - Updated `AuthController.cs` with registration/login
   - Updated `User.cs` models for CFB picks site
   - Added profile endpoint

3. **Deployment Guide Created** (`RAILWAY_DEPLOYMENT.md`)

## 📋 What You Need to Do Next

### Step 1: Create Database Tables
1. Open MySQL Workbench
2. Connect to your Heroku database (`c86v9vfflniegysr`)
3. Open `database_schema.sql` file
4. Copy ALL the SQL code
5. Paste into MySQL Workbench query editor
6. Click "Execute" (lightning bolt icon) or press `Ctrl+Enter`
7. Verify tables were created (check Navigator panel)

### Step 2: Test Database Connection Locally
1. Open terminal in `Client/api` folder
2. Run: `dotnet restore`
3. Run: `dotnet build`
4. Run: `dotnet run`
5. API should start on `http://localhost:5000` or `https://localhost:5001`
6. Test endpoints:
   - Try registering: `POST http://localhost:5000/api/auth/register`
   - Body: `{ "username": "testuser", "email": "test@test.com", "password": "password123" }`

### Step 3: Deploy to Railway
1. **Push code to GitHub** (if not already)
   ```bash
   git add .
   git commit -m "Add MySQL support and auth endpoints"
   git push
   ```

2. **Create Railway Account**
   - Go to https://railway.app
   - Sign up with GitHub
   - Create new project from GitHub repo

3. **Configure Railway**
   - Follow instructions in `RAILWAY_DEPLOYMENT.md`
   - Set environment variables (connection string, JWT secret)
   - Deploy

4. **Get Railway URL**
   - Copy your Railway app URL (e.g., `https://yourapp.up.railway.app`)

### Step 4: Update Frontend
1. Create a JavaScript file for API calls (e.g., `api.js`)
2. Update API calls to use Railway URL
3. Test registration/login from your Netlify site

## 🔧 API Endpoints Available

### POST /api/auth/register
Register a new user
```json
{
  "username": "blake",
  "email": "blake@example.com",
  "password": "password123",
  "displayName": "Blake" // optional
}
```

### POST /api/auth/login
Login with username/email and password
```json
{
  "username": "blake",
  "password": "password123"
}
```

### GET /api/auth/profile
Get user profile (requires JWT token in header)
```
Authorization: Bearer <your-jwt-token>
```

## 🐛 Troubleshooting

### Database Connection Issues
- Verify MySQL connection string in `appsettings.json`
- Check that tables exist in MySQL Workbench
- Test connection in MySQL Workbench first

### Build Errors
- Run `dotnet restore` first
- Check that `MySqlConnector` package is installed
- Verify .NET 8.0 SDK is installed

### Railway Deployment Issues
- Check Railway logs for errors
- Verify environment variables are set correctly
- Ensure PORT variable is configured

## 📝 Next Features to Add

1. Profile update endpoint
2. Weekly picks submission endpoint
3. Game results update endpoint
4. Leaderboard endpoint
5. User statistics endpoint

## 🔐 Security Notes

- JWT tokens are used for authentication
- Passwords are hashed with BCrypt
- Database credentials should be in environment variables (not committed to git)
- For production, use Railway's environment variables instead of `appsettings.json`

