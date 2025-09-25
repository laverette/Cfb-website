# CFB Predictions - User Profile System

## Overview
This system now includes a comprehensive user profile system with SQLite database integration. Users can register, login, and have their predictions linked to their profiles.

## Database Schema

### Users Table
- `Id` (INTEGER, PRIMARY KEY, AUTOINCREMENT)
- `Name` (TEXT, NOT NULL)
- `Email` (TEXT, UNIQUE, NOT NULL)
- `PasswordHash` (TEXT, NOT NULL)
- `CreatedAt` (DATETIME, NOT NULL)
- `LastLoginAt` (DATETIME, NULLABLE)

### Predictions Table
- `Id` (INTEGER, PRIMARY KEY, AUTOINCREMENT)
- `UserId` (INTEGER, NOT NULL, FOREIGN KEY to Users.Id)
- `Week` (INTEGER, NOT NULL)
- `Game1` through `Game12` (TEXT)
- `Score1` through `Score12` (TEXT)
- `SubmittedAt` (DATETIME, NOT NULL)

## API Endpoints

### User Management
- `POST /api/User/register` - Register a new user
- `POST /api/User/login` - Login a user
- `GET /api/User` - Get all users
- `GET /api/User/{id}` - Get user by ID

### Predictions
- `POST /api/Prediction/submit` - Submit predictions (form data)
- `POST /api/Prediction` - Submit predictions (JSON)
- `GET /api/Prediction` - Get all predictions
- `GET /api/Prediction/user/{userId}` - Get predictions by user

## How to Use

### 1. Start the API
```bash
cd Client/api
dotnet run
```
The API will run on `http://localhost:5000`

### 2. Register Users
- Visit `http://localhost:5000/register.html` to register new users
- Or use the API directly with the test endpoints in `test-api.http`

### 3. Submit Predictions
- Users can submit predictions through the weekly picks form
- The system will automatically link predictions to the user's profile
- If a user doesn't exist, they'll need to register first

### 4. View Prediction History
- Visit `http://localhost:5000/prediction-history.html`
- Select a user from the dropdown to view their prediction history
- History is sorted by week (newest first)

## Features

### User Registration
- Simple registration form with name, email, and password
- Password hashing for security
- Email uniqueness validation

### Prediction Tracking
- All predictions are linked to user profiles
- Historical data is preserved
- Easy retrieval of user-specific prediction history

### Backward Compatibility
- The existing weekly picks form still works
- Predictions are automatically linked to users by name
- No breaking changes to existing functionality

## Security Notes
- Passwords are hashed using SHA256
- No password hashes are returned in API responses
- CORS is enabled for development

## Database Location
The SQLite database file (`database.db`) will be created in the `Client/api` folder when the application first runs.

## Testing
Use the `test-api.http` file in the `Client/api` folder to test the API endpoints. You can run these requests in VS Code with the REST Client extension or any HTTP client.
