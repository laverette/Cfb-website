#!/usr/bin/env python3
"""
ESPN API Game Data Extractor
Uses ESPN's internal API endpoints to extract game data
Much cleaner and more reliable than web scraping!

Usage:
    python espn_api_extractor.py
"""

import requests
import json
from typing import List, Dict, Optional
from datetime import datetime
import sys
import mysql.connector
from mysql.connector import Error
import os

class ESPNAPIExtractor:
    def __init__(self):
        self.base_url = "https://site.api.espn.com"
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        }
        
    def get_logo_url(self, espn_id: int) -> str:
        """Generate ESPN logo URL from team ID"""
        return f"https://a.espncdn.com/i/teamlogos/ncaa/500/{espn_id}.png"
    
    def search_team_by_name(self, team_name: str) -> Optional[Dict]:
        """Search for team by name using ESPN API"""
        try:
            # ESPN has a teams endpoint, but searching can be tricky
            # We'll use a known team ID mapping for common teams
            # Or search through the schedule
            url = f"{self.base_url}/apis/site/v2/sports/football/college-football/teams"
            response = requests.get(url, headers=self.headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                teams = data.get('sports', [{}])[0].get('leagues', [{}])[0].get('teams', [])
                
                for team in teams:
                    team_info = team.get('team', {})
                    display_name = team_info.get('displayName', '')
                    if team_name.lower() in display_name.lower() or display_name.lower() in team_name.lower():
                        return {
                            'id': team_info.get('id'),
                            'name': display_name,
                            'abbreviation': team_info.get('abbreviation'),
                            'logo': team_info.get('logo')
                        }
            
            return None
        except Exception as e:
            print(f"[ERROR] Error searching for team {team_name}: {e}")
            return None
    
    def get_game_by_matchup(self, away_team_name: str, home_team_name: str, date: Optional[str] = None) -> Optional[Dict]:
        """
        Get game data from ESPN API
        
        Args:
            away_team_name: Name of away team
            home_team_name: Name of home team  
            date: Optional date filter (YYYYMMDD format)
        
        Returns:
            Dictionary with game data
        """
        try:
            # Get current week's schedule
            if date:
                url = f"{self.base_url}/apis/site/v2/sports/football/college-football/scoreboard?dates={date}"
            else:
                # Get current week
                url = f"{self.base_url}/apis/site/v2/sports/football/college-football/scoreboard"
            
            response = requests.get(url, headers=self.headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                events = data.get('events', [])
                
                for event in events:
                    competitions = event.get('competitions', [])
                    if competitions:
                        comp = competitions[0]
                        competitors = comp.get('competitors', [])
                        
                        if len(competitors) == 2:
                            # Determine home/away
                            home = next((c for c in competitors if c.get('homeAway') == 'home'), None)
                            away = next((c for c in competitors if c.get('homeAway') == 'away'), None)
                            
                            if home and away:
                                home_team = home.get('team', {})
                                away_team = away.get('team', {})
                                
                                home_name = home_team.get('displayName', '')
                                away_name = away_team.get('displayName', '')
                                
                                # Check if this matches our search
                                home_match = (home_team_name.lower() in home_name.lower() or 
                                            home_name.lower() in home_team_name.lower())
                                away_match = (away_team_name.lower() in away_name.lower() or 
                                             away_name.lower() in away_team_name.lower())
                                
                                if home_match and away_match:
                                    # Get ranks
                                    home_rank = home.get('curatedRank', {}).get('current')
                                    away_rank = away.get('curatedRank', {}).get('current')
                                    
                                    # Get betting line (odds)
                                    odds = comp.get('odds', [])
                                    betting_line = None
                                    if odds:
                                        spread = odds[0].get('spread')
                                        if spread:
                                            betting_line = float(spread)
                                    
                                    # Get game date
                                    date_str = comp.get('date', '')
                                    game_date = None
                                    if date_str:
                                        try:
                                            game_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                                        except:
                                            game_date = date_str
                                    
                                    return {
                                        'espn_game_id': event.get('id'),
                                        'away_team_name': away_name,
                                        'home_team_name': home_name,
                                        'away_team_espn_id': int(away_team.get('id', 0)),
                                        'home_team_espn_id': int(home_team.get('id', 0)),
                                        'away_team_rank': away_rank,
                                        'home_team_rank': home_rank,
                                        'away_team_logo_url': self.get_logo_url(int(away_team.get('id', 0))),
                                        'home_team_logo_url': self.get_logo_url(int(home_team.get('id', 0))),
                                        'game_date': game_date.isoformat() if isinstance(game_date, datetime) else game_date,
                                        'betting_line': betting_line,
                                        'matchup_display': f"{'#' + str(home_rank) + ' ' if home_rank else ''}{home_name} vs {'#' + str(away_rank) + ' ' if away_rank else ''}{away_name}"
                                    }
            
            return None
            
        except Exception as e:
            print(f"[ERROR] Error getting game: {e}")
            return None
    
    def insert_games_to_database(self, games: List[Dict], week_id: int, db_config: Dict) -> bool:
        """
        Insert games directly into MySQL database
        
        Args:
            games: List of game dictionaries
            week_id: Week ID from Weeks table
            db_config: Dictionary with database connection info
                {'host': '...', 'port': 3306, 'database': '...', 'user': '...', 'password': '...'}
        
        Returns:
            True if successful, False otherwise
        """
        try:
            connection = mysql.connector.connect(**db_config)
            cursor = connection.cursor()
            
            inserted_count = 0
            for idx, game in enumerate(games, start=1):
                sql = """INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                        home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                        game_date, betting_line, is_completed)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""
                
                values = (
                    week_id,
                    idx,
                    game['home_team_espn_id'],
                    game['away_team_espn_id'],
                    game['home_team_name'],
                    game['away_team_name'],
                    game['home_team_logo_url'],
                    game['away_team_logo_url'],
                    game.get('game_date'),  # May be None
                    game.get('betting_line'),  # May be None
                    False  # is_completed
                )
                
                cursor.execute(sql, values)
                inserted_count += 1
            
            connection.commit()
            cursor.close()
            connection.close()
            
            print(f"\n[SUCCESS] Inserted {inserted_count} games into database!")
            return True
            
        except Error as e:
            print(f"\n[ERROR] Database insertion failed: {e}")
            return False
    
    def generate_sql_inserts(self, games: List[Dict], week_id: int) -> str:
        """Generate SQL INSERT statements for manual execution"""
        sql_statements = []
        
        for idx, game in enumerate(games, start=1):
            # Handle None values
            game_date = f"'{game.get('game_date')}'" if game.get('game_date') else 'NULL'
            betting_line = str(game.get('betting_line')) if game.get('betting_line') is not None else 'NULL'
            
            sql = f"""INSERT INTO Games (week_id, game_number, home_team_espn_id, away_team_espn_id, 
                    home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, 
                    game_date, betting_line, is_completed)
VALUES ({week_id}, {idx}, 
        {game['home_team_espn_id']}, 
        {game['away_team_espn_id']}, 
        '{game['home_team_name'].replace("'", "''")}', 
        '{game['away_team_name'].replace("'", "''")}', 
        '{game['home_team_logo_url']}', 
        '{game['away_team_logo_url']}', 
        {game_date}, 
        {betting_line}, 
        FALSE);"""
            sql_statements.append(sql)
        
        return "\n".join(sql_statements)
    
    def search_all_games_this_week(self) -> List[Dict]:
        """Get all games for the current week"""
        try:
            url = f"{self.base_url}/apis/site/v2/sports/football/college-football/scoreboard"
            response = requests.get(url, headers=self.headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                events = data.get('events', [])
                games = []
                
                for event in events:
                    competitions = event.get('competitions', [])
                    if competitions:
                        comp = competitions[0]
                        competitors = comp.get('competitors', [])
                        
                        if len(competitors) == 2:
                            home = next((c for c in competitors if c.get('homeAway') == 'home'), None)
                            away = next((c for c in competitors if c.get('homeAway') == 'away'), None)
                            
                            if home and away:
                                home_team = home.get('team', {})
                                away_team = away.get('team', {})
                                
                                home_rank = home.get('curatedRank', {}).get('current')
                                away_rank = away.get('curatedRank', {}).get('current')
                                
                                odds = comp.get('odds', [])
                                betting_line = None
                                if odds:
                                    spread = odds[0].get('spread')
                                    if spread:
                                        betting_line = float(spread)
                                
                                games.append({
                                    'espn_game_id': event.get('id'),
                                    'away_team_name': away_team.get('displayName', ''),
                                    'home_team_name': home_team.get('displayName', ''),
                                    'away_team_espn_id': int(away_team.get('id', 0)),
                                    'home_team_espn_id': int(home_team.get('id', 0)),
                                    'away_team_rank': away_rank,
                                    'home_team_rank': home_rank,
                                    'away_team_logo_url': self.get_logo_url(int(away_team.get('id', 0))),
                                    'home_team_logo_url': self.get_logo_url(int(home_team.get('id', 0))),
                                    'betting_line': betting_line,
                                    'matchup_display': f"{'#' + str(home_rank) + ' ' if home_rank else ''}{home_team.get('displayName', '')} vs {'#' + str(away_rank) + ' ' if away_rank else ''}{away_team.get('displayName', '')}"
                                })
                
                return games
            
            return []
            
        except Exception as e:
            print(f"[ERROR] Error getting games: {e}")
            return []


def main():
    """Main function"""
    extractor = ESPNAPIExtractor()
    
    # Get games from command line or use default list
    if len(sys.argv) > 1:
        matchups = sys.argv[1:]
    else:
        # Default: user's specified games
        matchups = [
            "Georgia vs Florida",
            "Vanderbilt at Texas",
            "Miami at SMU",
            "South Carolina at Ole Miss",
            "Georgia Tech at NC State",
            "Oklahoma at Tennessee",
            "USC at Nebraska",
            "Cincinnati at Utah",
            "Virginia at California",
            "Texas Tech at Kansas State",
            "Louisville at Virginia Tech",
            "Indiana at Maryland"
        ]
    
    print("ESPN API Game Data Extractor")
    print("=" * 60)
    print("\nFetching games from ESPN API...\n")
    
    # First, get all games this week to search through
    all_games = extractor.search_all_games_this_week()
    print(f"Found {len(all_games)} games this week from ESPN API\n")
    
    # Now search for specific matchups
    found_games = []
    
    for matchup in matchups:
        print(f"Searching: {matchup}...")
        
        # Parse matchup
        if " at " in matchup or " @ " in matchup:
            parts = matchup.split(" at ") if " at " in matchup else matchup.split(" @ ")
            away_name = parts[0].strip()
            home_name = parts[1].strip()
        elif " vs " in matchup or " vs. " in matchup:
            parts = matchup.split(" vs ") if " vs " in matchup else matchup.split(" vs. ")
            # For vs, we'll search both orders
            away_name = parts[0].strip()
            home_name = parts[1].strip()
        else:
            print(f"[ERROR] Could not parse: {matchup}")
            continue
        
        # Search in the games we found
        game_found = False
        for game in all_games:
            home_match = (home_name.lower() in game['home_team_name'].lower() or 
                         game['home_team_name'].lower() in home_name.lower())
            away_match = (away_name.lower() in game['away_team_name'].lower() or 
                         game['away_team_name'].lower() in away_name.lower())
            
            if home_match and away_match:
                print(f"[OK] Found: {game['matchup_display']}")
                print(f"    Home: {game['home_team_name']} (ID: {game['home_team_espn_id']}, Rank: {game['home_team_rank'] or 'N/A'})")
                print(f"    Away: {game['away_team_name']} (ID: {game['away_team_espn_id']}, Rank: {game['away_team_rank'] or 'N/A'})")
                if game['betting_line']:
                    print(f"    Line: {game['betting_line']}")
                found_games.append(game)
                game_found = True
                break
        
        if not game_found:
            print(f"[WARN] Not found in this week's games")
        print()
    
    if found_games:
        print("\n" + "=" * 60)
        print("GAME DATA (JSON Format):")
        print("=" * 60)
        print(json.dumps(found_games, indent=2))
        
        print("\n" + "=" * 60)
        print("DATABASE OPTIONS:")
        print("=" * 60)
        print("\nOption 1: Auto-insert into database")
        print("  Provide database config and week_id:")
        print("  extractor.insert_games_to_database(found_games, week_id=1, db_config={...})")
        
        print("\nOption 2: Generate SQL for manual insertion")
        print("  The script will generate SQL INSERT statements you can run manually")
        
        # Ask user what they want to do
        print("\n" + "=" * 60)
        response = input("\nAuto-insert to database? (y/n): ").strip().lower()
        
        if response == 'y':
            # Get database config from environment or prompt
            db_config = {}
            print("\nEnter database connection info:")
            db_config['host'] = input("Host (or press Enter for default from env): ").strip() or os.getenv('DB_HOST', 'etdq12exrvdjisg6.cbetxkdyhwsb.us-east-1.rds.amazonaws.com')
            db_config['port'] = int(input("Port (or press Enter for 3306): ").strip() or '3306')
            db_config['database'] = input("Database (or press Enter for default from env): ").strip() or os.getenv('DB_NAME', 'c86v9vfflniegysr')
            db_config['user'] = input("User (or press Enter for default from env): ").strip() or os.getenv('DB_USER', 'x8kicio7cckzkrin')
            db_config['password'] = input("Password (or press Enter for default from env): ").strip() or os.getenv('DB_PASSWORD', 'jv3nfhqf64jj44m4')
            
            week_id = input("Week ID (from Weeks table): ").strip()
            
            if week_id:
                extractor.insert_games_to_database(found_games, int(week_id), db_config)
            else:
                print("[ERROR] Week ID required")
        else:
            # Generate SQL
            print("\n" + "=" * 60)
            print("SQL INSERT STATEMENTS:")
            print("=" * 60)
            print("\nFirst, you need to know your week_id from the Weeks table.")
            print("If you don't have a week yet, create one first:")
            print("\n  INSERT INTO Weeks (week_number, season_year, start_date, end_date)")
            print("  VALUES (10, 2024, '2024-11-01', '2024-11-03');")
            print("\nThen use the week_id in the statements below:\n")
            
            week_id = input("Enter week_id (or press Enter to skip): ").strip()
            if week_id:
                sql = extractor.generate_sql_inserts(found_games, int(week_id))
                print("\n" + "=" * 60)
                print("SQL INSERT STATEMENTS:")
                print("=" * 60)
                print(sql)
                
                # Save to file
                filename = f"game_inserts_week_{week_id}.sql"
                with open(filename, 'w') as f:
                    f.write(sql)
                print(f"\n[SUCCESS] SQL saved to {filename}")
            else:
                print("\n[INFO] Skipping SQL generation. Run script again with week_id when ready.")
    else:
        print("\n[ERROR] No games found. They might not be scheduled for this week.")


if __name__ == "__main__":
    main()

