# Admin Panel Setup Guide

## Overview
The admin panel allows you to manage weekly picks by:
1. Setting the current active week
2. Fetching games from the College Football Data API
3. Replacing individual matchups with other games from the same week

## Database Setup

### 1. Add Role Column to Users Table
Run the SQL migration to add the `role` column:

The live site uses Supabase. Run `Client/sql/supabase_schema.sql` in the Supabase SQL editor if the tables are not already there. The `users.role` and `settings` tables are included in that schema.

### Point Weekly Picks at a week

```sql
insert into settings (setting_key, setting_value)
values ('current_week_id', '3')
on conflict (setting_key)
do update set setting_value = excluded.setting_value;
```

## Making a User an Admin

To make a user an admin, update their role in the database:

```sql
update users set role = 'admin' where username = 'your_username';
```

Or for a specific user ID:

```sql
update users set role = 'admin' where id = 1;
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

