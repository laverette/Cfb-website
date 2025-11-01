# ESPN Game Data Extractor

This script extracts college football game data from ESPN's schedule page and formats it for insertion into your `Games` database table.

## Setup

1. **Install Python 3.7+** (if not already installed)

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

## Usage

### Method 1: Interactive Mode

Run the script and enter matchups when prompted:

```bash
python espn_game_extractor.py
```

Then enter matchups like:
```
Georgia vs Florida
Alabama at South Carolina
Texas A&M at LSU
```
(Press Enter twice when done)

### Method 2: Command Line Arguments

Provide matchups as arguments:

```bash
python espn_game_extractor.py "Georgia vs Florida" "Alabama at South Carolina" "Texas A&M at LSU"
```

## Output

The script will:
1. Search ESPN's schedule for each matchup
2. Extract:
   - Team names (home and away)
   - ESPN team IDs
   - Team logo URLs
   - Game date/time (if available)
   - Betting line/spread (if available)
   - ESPN game ID (if available)
3. Display the results in JSON format

## Database Integration

After extracting the data:

1. **Create/Find the Week record** in your `Weeks` table
   ```sql
   INSERT INTO Weeks (week_number, season_year, start_date, end_date)
   VALUES (10, 2024, '2024-11-01', '2024-11-03');
   -- Note the week_id from this insert
   ```

2. **Use the extracted data** to create INSERT statements for the `Games` table

3. **Fields required for Games table:**
   - `week_id` - ID from Weeks table
   - `game_number` - Sequential number (1, 2, 3, etc.)
   - `home_team_espn_id` - ✅ Extracted
   - `away_team_espn_id` - ✅ Extracted
   - `home_team_name` - ✅ Extracted
   - `away_team_name` - ✅ Extracted
   - `home_team_logo_url` - ✅ Generated from ESPN ID
   - `away_team_logo_url` - ✅ Generated from ESPN ID
   - `game_date` - ✅ Extracted (may need formatting)
   - `betting_line` - ✅ Extracted (if available)
   - `is_completed` - Default to FALSE

## Example Output

```json
{
  "away_team_name": "Georgia",
  "home_team_name": "Florida",
  "away_team_espn_id": 61,
  "home_team_espn_id": 57,
  "away_team_logo_url": "https://a.espncdn.com/i/teamlogos/ncaa/500/61.png",
  "home_team_logo_url": "https://a.espncdn.com/i/teamlogos/ncaa/500/57.png",
  "game_date": "Nov 2, 3:30 PM",
  "betting_line": -8.5,
  "espn_game_id": "401520310"
}
```

## Troubleshooting

- **Game not found**: Make sure the matchup string matches ESPN's format exactly. Try using team names as they appear on ESPN.
- **Missing betting line**: Betting lines may not always be available on ESPN's schedule page. You may need to enter this manually or use another source.
- **Connection errors**: Check your internet connection and ESPN's status.

## Notes

- The script searches ESPN's current schedule page
- Betting lines may not always be available
- Game dates may need to be converted to proper DATETIME format for your database
- Team IDs are extracted from ESPN's team profile URLs

