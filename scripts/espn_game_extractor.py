#!/usr/bin/env python3
"""
ESPN Game Data Extractor
Extracts game information from ESPN for college football games
and formats it for insertion into the Games table.

Usage:
    python espn_game_extractor.py
    
    Or provide specific matchups:
    python espn_game_extractor.py "Georgia vs Florida" "Alabama at South Carolina"
"""

import requests
from bs4 import BeautifulSoup
import re
import json
from datetime import datetime
from typing import List, Dict, Optional
import sys

class ESPNGameExtractor:
    def __init__(self):
        self.base_url = "https://www.espn.com"
        self.schedule_url = "https://www.espn.com/college-football/schedule"
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
    def get_team_espn_id_from_url(self, team_url: str) -> Optional[int]:
        """Extract ESPN team ID from team URL"""
        match = re.search(r'/team/(?:college-football/)?([^/]+)/(\d+)', team_url)
        if match:
            return int(match.group(2))
        return None
    
    def get_logo_url(self, espn_id: int) -> str:
        """Generate ESPN logo URL from team ID"""
        return f"https://a.espncdn.com/i/teamlogos/ncaa/500/{espn_id}.png"
    
    def extract_team_rank(self, team_text: str) -> tuple:
        """Extract team rank and clean team name"""
        # Look for rank pattern like "#1", "1", "(1)", etc.
        rank_match = re.search(r'#?(\d+)|\((\d+)\)', team_text)
        rank = None
        if rank_match:
            rank = int(rank_match.group(1) or rank_match.group(2))
        
        # Clean team name (remove rank indicators)
        clean_name = re.sub(r'#\d+\s*', '', team_text)  # Remove "#1 "
        clean_name = re.sub(r'\(\d+\)\s*', '', clean_name)  # Remove "(1) "
        clean_name = clean_name.strip()
        
        return clean_name, rank
    
    def search_game_by_matchup(self, matchup: str, schedule_date: Optional[str] = None) -> Optional[Dict]:
        """
        Search for a game by matchup string (e.g., "Georgia vs Florida", "Alabama at South Carolina")
        
        Args:
            matchup: String describing the game (e.g., "Georgia vs Florida", "Alabama at South Carolina")
            schedule_date: Optional date to filter schedule (format: YYYYMMDD, e.g., "20241102")
        
        Returns:
            Dictionary with game data matching Games table schema (home team first)
        """
        # Parse matchup to extract team names
        matchup_lower = matchup.lower()
        
        # Determine if it's home/away or neutral site
        is_at = " at " in matchup_lower or " @ " in matchup_lower
        is_vs = " vs " in matchup_lower or " vs. " in matchup_lower
        
        if is_at:
            parts = re.split(r'\s+at\s+|\s+@\s+', matchup, flags=re.IGNORECASE)
            away_team_input = parts[0].strip()
            home_team_input = parts[1].strip()
            away_team_name, away_rank = self.extract_team_rank(away_team_input)
            home_team_name, home_rank = self.extract_team_rank(home_team_input)
        elif is_vs:
            parts = re.split(r'\s+vs\.?\s+', matchup, flags=re.IGNORECASE)
            # For "vs", assume first team is away, second is home (or neutral)
            away_team_input = parts[0].strip()
            home_team_input = parts[1].strip()
            away_team_name, away_rank = self.extract_team_rank(away_team_input)
            home_team_name, home_rank = self.extract_team_rank(home_team_input)
        else:
            print(f"[WARN] Could not parse matchup format: {matchup}")
            print("   Expected format: 'TeamA at TeamB' or 'TeamA vs TeamB'")
            return None
        
        # Fetch schedule page
        try:
            if schedule_date:
                url = f"{self.schedule_url}?date={schedule_date}"
            else:
                url = self.schedule_url
                
            response = requests.get(url, headers=self.headers, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Find all game rows in the schedule table
            game_rows = soup.find_all('tr', class_=lambda x: x and 'Table__TR' in x)
            
            for row in game_rows:
                # Extract team links
                team_links = row.find_all('a', href=re.compile(r'/team/|/college-football/team/'))
                
                if len(team_links) >= 2:
                    # Get team names and IDs
                    away_link = team_links[0]
                    home_link = team_links[1]
                    
                    away_name = away_link.text.strip()
                    home_name = home_link.text.strip()
                    
                    # Check if this matches our search
                    away_match = away_team_name.lower() in away_name.lower() or away_name.lower() in away_team_name.lower()
                    home_match = home_team_name.lower() in home_name.lower() or home_name.lower() in home_team_name.lower()
                    
                    if away_match and home_match:
                        # Found the game!
                        away_id = self.get_team_espn_id_from_url(away_link.get('href', ''))
                        home_id = self.get_team_espn_id_from_url(home_link.get('href', ''))
                        
                        # Try to find game link to get game ID
                        game_link = row.find('a', href=re.compile(r'/game/'))
                        game_id = None
                        if game_link:
                            match = re.search(r'/game/_/gameId/(\d+)', game_link.get('href', ''))
                            if match:
                                game_id = match.group(1)
                        
                        # Extract game date/time
                        game_date = None
                        date_cells = row.find_all('td')
                        for cell in date_cells:
                            text = cell.get_text(strip=True)
                            # Look for date/time patterns
                            if re.search(r'\d{1,2}:\d{2}', text) or re.search(r'\d{1,2}/\d{1,2}', text):
                                game_date = text
                        
                        # Extract betting line (if available)
                        betting_line = None
                        line_text = row.get_text()
                        line_match = re.search(r'([+-]?\d+\.?\d*)', line_text)
                        if line_match:
                            try:
                                betting_line = float(line_match.group(1))
                            except:
                                pass
                        
                        # Extract ranks from team names/links if available
                        away_rank_from_page = None
                        home_rank_from_page = None
                        
                        # Look for rank in row text or links
                        row_text_lower = line_text.lower()
                        rank_pattern = r'#(\d+)\s+' + re.escape(away_name.split()[0].lower())
                        rank_match = re.search(rank_pattern, row_text_lower, re.IGNORECASE)
                        if rank_match:
                            away_rank_from_page = int(rank_match.group(1))
                        
                        rank_pattern = r'#(\d+)\s+' + re.escape(home_name.split()[0].lower())
                        rank_match = re.search(rank_pattern, row_text_lower, re.IGNORECASE)
                        if rank_match:
                            home_rank_from_page = int(rank_match.group(1))
                        
                        # Use ranks from input or page
                        final_away_rank = away_rank if away_rank else away_rank_from_page
                        final_home_rank = home_rank if home_rank else home_rank_from_page
                        
                        # Format team names with ranks
                        away_display = f"#{final_away_rank} {away_name}" if final_away_rank else away_name
                        home_display = f"#{final_home_rank} {home_name}" if final_home_rank else home_name
                        
                        game_data = {
                            'away_team_name': away_name,
                            'home_team_name': home_name,
                            'away_team_display': away_display,  # Name with rank for display
                            'home_team_display': home_display,  # Name with rank for display
                            'away_team_rank': final_away_rank,
                            'home_team_rank': final_home_rank,
                            'away_team_espn_id': away_id,
                            'home_team_espn_id': home_id,
                            'away_team_logo_url': self.get_logo_url(away_id) if away_id else None,
                            'home_team_logo_url': self.get_logo_url(home_id) if home_id else None,
                            'game_date': game_date,
                            'betting_line': betting_line,
                            'espn_game_id': game_id,
                            'matchup_string': matchup,
                            'matchup_display': f"{home_display} vs {away_display}"  # Home team first
                        }
                        
                        # If we found the game link, get more detailed info
                        if game_link and game_id:
                            detailed_info = self.get_game_details(game_id)
                            if detailed_info:
                                game_data.update(detailed_info)
                        
                        return game_data
            
            print(f"[ERROR] Game not found: {matchup}")
            return None
            
        except Exception as e:
            print(f"[ERROR] Error searching for game: {e}")
            return None
    
    def get_game_details(self, game_id: str) -> Optional[Dict]:
        """Get detailed game information from game page"""
        try:
            game_url = f"{self.base_url}/college-football/game/_/gameId/{game_id}"
            response = requests.get(game_url, headers=self.headers, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            details = {}
            
            # Try to extract more detailed game info
            # Look for script tags with game data
            scripts = soup.find_all('script', type='application/json')
            for script in scripts:
                try:
                    data = json.loads(script.string)
                    if 'gamepackage' in str(data) or 'gameInfo' in str(data):
                        # Found game data
                        details['found_json_data'] = True
                except:
                    pass
            
            # Try to get betting line from game page
            odds_section = soup.find(string=re.compile(r'Spread|Line|Favorite'))
            if odds_section:
                line_match = re.search(r'([+-]?\d+\.?\d*)', str(odds_section))
                if line_match:
                    try:
                        details['betting_line'] = float(line_match.group(1))
                    except:
                        pass
            
            return details if details else None
            
        except Exception as e:
            print(f"[WARN] Could not get detailed game info: {e}")
            return None
    
    def format_for_database(self, game_data: Dict, week_id: int, game_number: int) -> Dict:
        """
        Format game data for database insertion
        
        Args:
            game_data: Raw game data from ESPN
            week_id: Week ID from Weeks table
            game_number: Game number within the week
        
        Returns:
            Dictionary formatted for Games table insertion
        """
        return {
            'week_id': week_id,
            'game_number': game_number,
            'home_team_espn_id': game_data.get('home_team_espn_id'),
            'away_team_espn_id': game_data.get('away_team_espn_id'),
            'home_team_name': game_data.get('home_team_name'),
            'away_team_name': game_data.get('away_team_name'),
            'home_team_logo_url': game_data.get('home_team_logo_url'),
            'away_team_logo_url': game_data.get('away_team_logo_url'),
            'game_date': game_data.get('game_date'),
            'betting_line': game_data.get('betting_line'),
            'is_completed': False
        }
    
    def generate_sql_insert(self, games: List[Dict], week_id: int) -> str:
        """Generate SQL INSERT statements for games"""
        sql_statements = []
        
        for idx, game in enumerate(games, start=1):
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
        {f"'{game['game_date']}'" if game.get('game_date') else 'NULL'}, 
        {game['betting_line'] if game.get('betting_line') is not None else 'NULL'}, 
        FALSE);"""
            sql_statements.append(sql)
        
        return "\n".join(sql_statements)


def main():
    """Main function to run the extractor"""
    extractor = ESPNGameExtractor()
    
    # Check if matchups provided as command line arguments
    if len(sys.argv) > 1:
        matchups = sys.argv[1:]
    else:
        print("ESPN Game Data Extractor")
        print("=" * 50)
        print("\nPlease provide game matchups:")
        print("Examples:")
        print("  'Georgia vs Florida'")
        print("  'Alabama at South Carolina'")
        print("  'Texas A&M at LSU'")
        print("\nEnter matchups (one per line, empty line to finish):")
        
        matchups = []
        while True:
            matchup = input().strip()
            if not matchup:
                break
            matchups.append(matchup)
    
    if not matchups:
        print("[ERROR] No matchups provided. Exiting.")
        return
    
        print(f"\nSearching for {len(matchups)} game(s)...\n")
    
    games = []
    for matchup in matchups:
        print(f"Searching: {matchup}...")
        game_data = extractor.search_game_by_matchup(matchup)
        
        if game_data:
            print(f"[OK] Found: {game_data['matchup_display']}")
            if game_data.get('home_team_espn_id'):
                print(f"   Home Team ID: {game_data['home_team_espn_id']}")
            if game_data.get('away_team_espn_id'):
                print(f"   Away Team ID: {game_data['away_team_espn_id']}")
            if game_data.get('betting_line'):
                print(f"   Betting Line: {game_data['betting_line']}")
            games.append(game_data)
        else:
            print(f"[ERROR] Could not find game: {matchup}")
        print()
    
    if games:
        print("\n" + "=" * 50)
        print("📊 GAME DATA (JSON Format):")
        print("=" * 50)
        print(json.dumps(games, indent=2))
        
        print("\n" + "=" * 50)
        print("💡 Next Steps:")
        print("=" * 50)
        print("1. Review the game data above")
        print("2. Determine the week_id from your Weeks table")
        print("3. Use the generate_sql_insert() method or manually create INSERT statements")
        print("4. Run the SQL INSERT statements in your database")
        print("\nExample SQL generation (requires week_id):")
        print("  extractor.generate_sql_insert(games, week_id=1)")
    else:
        print("\n[ERROR] No games found. Please check the matchup strings and try again.")


if __name__ == "__main__":
    main()
