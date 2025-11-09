# Admin Panel Setup Guide

## Overview
The admin panel allows you to manage weekly picks by:
1. Setting the current active week
2. Fetching games from the College Football Data API
3. Replacing individual matchups with other games from the same week

## Database Setup

### 1. Add Role Column to Users Table
Run the SQL migration to add the `role` column:

```sql
ALTER TABLE Users 
ADD COLUMN role VARCHAR(20) DEFAULT 'user' AFTER bio;
```

**Note:** If you get an error saying the column already exists, that's fine - it means the column is already there. You can safely ignore that error.

### 2. Create Settings Table
The Settings table stores the current active week:

```sql
CREATE TABLE IF NOT EXISTS Settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    `key` VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_key (`key`)
);
```

**Note:** `key` is a reserved word in MySQL, so we use backticks around it.

### 3. Add Unique Constraint to Games Table (optional)
Ensure games have a unique constraint on week_id and game_number:

```sql
ALTER TABLE Games 
ADD UNIQUE KEY unique_week_game (week_id, game_number);
```

**Note:** If you get an error saying the key already exists, that's fine - it means the constraint is already there.

## Making a User an Admin

To make a user an admin, update their role in the database:

```sql
UPDATE Users SET role = 'admin' WHERE username = 'your_username';
```

Or for a specific user ID:

```sql
UPDATE Users SET role = 'admin' WHERE id = 1;
```

## Using the Admin Panel

### Access
1. Log in with an admin account
2. Navigate to the Admin Panel from the dropdown menu (⚙️ Admin Panel)
3. Or go directly to `admin.html`

### Setting Current Week
1. Enter the Season Year (e.g., 2025)
2. Enter the Week Number (e.g., 12)
3. Click "Set Current Week"
4. This sets which week users will see when they visit the Weekly Picks page

### Fetching Week Schedule
1. Enter the Year and Week you want to fetch
2. Click "Fetch Week Schedule"
3. This will:
   - Fetch all games for that week from the College Football Data API
   - Save them to the database
   - Assign game numbers (1, 2, 3, etc.)

### Replacing a Game
1. In the "Manage Games for Current Week" section, click on any game card
2. A popup will appear showing all available games for that week
3. Use the search box to filter games by team name
4. Click on a game to replace the current matchup
5. The game will be updated immediately

## API Configuration

The College Football Data API key is stored in `appsettings.json`:

```json
{
  "CollegeFootballData": {
    "ApiKey": "your-api-key-here"
  }
}
```

## Notes

- The API uses team IDs from the College Football Data API, which may differ from ESPN IDs
- Team logos are fetched from ESPN using the team IDs
- Betting lines are included when available from the API
- Only games with both home and away teams will be saved

