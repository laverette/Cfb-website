/**
 * CFP Bracket Picker - Interactive 12-team College Football Playoff bracket
 */

// Bracket state
let bracketData = {
  teams: {},
  picks: {},
  champion: null
};

// Load saved bracket on page load
document.addEventListener('DOMContentLoaded', () => {
  loadSavedBracket();
});

// Navigate to bracket step
function goToBracket() {
  // Validate all 12 teams are entered
  const teams = {};
  let allFilled = true;
  
  for (let i = 1; i <= 12; i++) {
    const input = document.getElementById(`seed${i}`);
    const teamName = input.value.trim();
    if (!teamName) {
      allFilled = false;
      input.style.borderColor = '#ff4444';
    } else {
      input.style.borderColor = '';
      teams[i] = teamName;
    }
  }
  
  if (!allFilled) {
    alert('Please enter all 12 teams before continuing!');
    return;
  }
  
  // Save teams to bracket data
  bracketData.teams = teams;
  bracketData.picks = {};
  bracketData.champion = null;
  
  // Populate bracket with teams
  populateBracket();
  
  // Show bracket step
  document.getElementById('teamSelectionStep').classList.remove('active');
  document.getElementById('bracketStep').classList.add('active');
  
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Go back to team selection
function backToTeams() {
  document.getElementById('bracketStep').classList.remove('active');
  document.getElementById('teamSelectionStep').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Populate bracket with selected teams
function populateBracket() {
  const teams = bracketData.teams;
  
  // Set initial seeded teams
  for (let i = 1; i <= 12; i++) {
    const teamEl = document.getElementById(`team${i}`);
    if (teamEl) {
      teamEl.textContent = teams[i];
    }
  }
  
  // Reset all winner displays
  document.querySelectorAll('[id^="winner"]').forEach(el => {
    el.textContent = 'TBD';
  });
  
  // Reset winner indicators
  document.querySelectorAll('.team[data-winner]').forEach(el => {
    el.setAttribute('data-winner', 'false');
  });
  
  // Hide champion display
  document.getElementById('championDisplay').style.display = 'none';
}

// Pick winner of a matchup
function pickWinner(gameId) {
  const matchup = document.querySelector(`[data-game="${gameId}"]`);
  if (!matchup) return;
  
  const teams = matchup.querySelectorAll('.team');
  if (teams.length !== 2) return;
  
  const team1 = teams[0];
  const team2 = teams[1];
  
  // Check if both teams are available
  const team1Name = team1.querySelector('.team-name').textContent;
  const team2Name = team2.querySelector('.team-name').textContent;
  
  if (team1Name === 'TBD' || team2Name === 'TBD') {
    alert('Please complete previous rounds first!');
    return;
  }
  
  // Toggle winner selection
  const isTeam1Winner = team1.getAttribute('data-winner') === 'true';
  const isTeam2Winner = team2.getAttribute('data-winner') === 'true';
  
  if (!isTeam1Winner && !isTeam2Winner) {
    // No winner selected, select team 1
    selectTeamAsWinner(team1, team2, gameId);
  } else if (isTeam1Winner) {
    // Team 1 is winner, switch to team 2
    selectTeamAsWinner(team2, team1, gameId);
  } else {
    // Team 2 is winner, switch to team 1
    selectTeamAsWinner(team1, team2, gameId);
  }
}

// Mark team as winner and update next round
function selectTeamAsWinner(winner, loser, gameId) {
  // Update visual indicators
  winner.setAttribute('data-winner', 'true');
  loser.setAttribute('data-winner', 'false');
  
  const winnerName = winner.querySelector('.team-name').textContent;
  const winnerSeed = winner.querySelector('.seed-num')?.textContent || '?';
  
  // Save pick
  bracketData.picks[gameId] = {
    winner: winnerName,
    seed: winnerSeed
  };
  
  // Update next round based on game
  updateNextRound(gameId, winnerName, winnerSeed);
}

// Update the next round with the winner
function updateNextRound(gameId, winnerName, winnerSeed) {
  let nextGameId, winnerSlot;
  
  // First Round -> Quarterfinals
  if (gameId === 'fr1') {
    nextGameId = 'qf2';
    winnerSlot = 'winnerFR1';
  } else if (gameId === 'fr2') {
    nextGameId = 'qf1';
    winnerSlot = 'winnerFR2';
  } else if (gameId === 'fr3') {
    nextGameId = 'qf3';
    winnerSlot = 'winnerFR3';
  } else if (gameId === 'fr4') {
    nextGameId = 'qf4';
    winnerSlot = 'winnerFR4';
  }
  // Quarterfinals -> Semifinals
  else if (gameId === 'qf1') {
    nextGameId = 'sf1';
    winnerSlot = 'winnerQF1';
  } else if (gameId === 'qf2') {
    nextGameId = 'sf1';
    winnerSlot = 'winnerQF2';
  } else if (gameId === 'qf3') {
    nextGameId = 'sf2';
    winnerSlot = 'winnerQF3';
  } else if (gameId === 'qf4') {
    nextGameId = 'sf2';
    winnerSlot = 'winnerQF4';
  }
  // Semifinals -> Championship
  else if (gameId === 'sf1') {
    nextGameId = 'championship';
    winnerSlot = 'winnerSF1';
  } else if (gameId === 'sf2') {
    nextGameId = 'championship';
    winnerSlot = 'winnerSF2';
  }
  // Championship -> Champion display
  else if (gameId === 'championship') {
    bracketData.champion = winnerName;
    document.getElementById('championName').textContent = winnerName;
    document.getElementById('championDisplay').style.display = 'flex';
    return;
  }
  
  if (winnerSlot) {
    const winnerEl = document.getElementById(winnerSlot);
    if (winnerEl) {
      winnerEl.textContent = winnerName;
    }
    
    // Update seed number if it exists
    const nextMatchup = document.querySelector(`[data-game="${nextGameId}"]`);
    if (nextMatchup) {
      const targetTeam = nextMatchup.querySelector(`.winner-${gameId.replace('_', '-')}`);
      if (targetTeam) {
        const seedEl = targetTeam.querySelector('.seed-num');
        if (seedEl) {
          seedEl.textContent = winnerSeed;
        }
      }
    }
    
    // Reset next round's winner selection
    resetGameWinner(nextGameId);
  }
}

// Reset a game's winner selection
function resetGameWinner(gameId) {
  const matchup = document.querySelector(`[data-game="${gameId}"]`);
  if (!matchup) return;
  
  const teams = matchup.querySelectorAll('.team');
  teams.forEach(team => {
    team.setAttribute('data-winner', 'false');
  });
  
  // Clear picks from this round forward
  delete bracketData.picks[gameId];
  
  // If this was a quarterfinal or semifinal, cascade reset
  if (gameId.startsWith('qf')) {
    const sfGame = gameId === 'qf1' || gameId === 'qf2' ? 'sf1' : 'sf2';
    resetGameWinner(sfGame);
  } else if (gameId.startsWith('sf')) {
    resetGameWinner('championship');
    document.getElementById('championDisplay').style.display = 'none';
    bracketData.champion = null;
  }
}

// Save bracket to localStorage
function saveBracket() {
  localStorage.setItem('cfpBracket2026', JSON.stringify(bracketData));
  
  // Show success message
  const btn = document.querySelector('.btn-save-bracket');
  const originalText = btn.textContent;
  btn.textContent = '✅ Bracket Saved!';
  btn.style.background = 'linear-gradient(135deg, #4CAF50, #2E7D32)';
  
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.background = '';
  }, 2000);
}

// Load saved bracket
function loadSavedBracket() {
  const saved = localStorage.getItem('cfpBracket2026');
  if (!saved) return;
  
  try {
    const data = JSON.parse(saved);
    bracketData = data;
    
    // Populate team inputs
    if (data.teams) {
      for (let i = 1; i <= 12; i++) {
        const input = document.getElementById(`seed${i}`);
        if (input && data.teams[i]) {
          input.value = data.teams[i];
        }
      }
    }
  } catch (e) {
    console.error('Failed to load saved bracket:', e);
  }
}

// Reset entire bracket
function resetBracket() {
  if (!confirm('Are you sure you want to reset your entire bracket? This cannot be undone.')) {
    return;
  }
  
  bracketData.picks = {};
  bracketData.champion = null;
  
  // Reset all visual indicators
  populateBracket();
  
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
