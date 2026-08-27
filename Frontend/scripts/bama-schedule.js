(function () {
  "use strict";

  var STORAGE_TOKEN = "authToken";
  var STORAGE_USER = "currentUser";
  var STORAGE_TEAM = "schedulePredictTeam";
  var DEFAULT_TEAM = "Alabama";

  var state = {
    season: new Date().getFullYear(),
    team: DEFAULT_TEAM,
    games: [],
    submittedCount: 0,
    activeTab: "predict",
    lbGameId: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function authHeaders() {
    var token = localStorage.getItem(STORAGE_TOKEN);
    if (!token) return {};
    return { Authorization: "Bearer " + token };
  }

  function isLoggedIn() {
    return !!(localStorage.getItem(STORAGE_TOKEN) && localStorage.getItem(STORAGE_USER));
  }

  function parseUser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_USER) || "null");
    } catch (_) {
      return null;
    }
  }

  function teamName() {
    return state.team || DEFAULT_TEAM;
  }

  function predWin(pred) {
    if (!pred) return null;
    if (pred.predictedTeamWin != null) return Boolean(pred.predictedTeamWin);
    if (pred.predictedAlabamaWin != null) return Boolean(pred.predictedAlabamaWin);
    return null;
  }

  function predTeamScore(pred) {
    if (!pred) return "";
    if (pred.predictedTeamScore != null) return pred.predictedTeamScore;
    if (pred.predictedAlabamaScore != null) return pred.predictedAlabamaScore;
    return "";
  }

  function gameWin(game) {
    if (game.teamWin != null) return game.teamWin;
    return game.alabamaWin;
  }

  function gameTeamScore(game) {
    if (game.teamScore != null) return game.teamScore;
    return game.alabamaScore;
  }

  function formatDate(iso) {
    if (!iso) return "TBD";
    var d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "TBD";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function locationLabel(game) {
    if (game.neutralSite) return "Neutral";
    return game.isHome ? "Home" : "Away";
  }

  function resultBadge(game) {
    var won = gameWin(game);
    if (!game.completed || won == null) return "";
    var cls = won ? "bama-badge-win" : "bama-badge-loss";
    var txt = won ? "W" : "L";
    var ts = gameTeamScore(game);
    var score = ts != null && game.opponentScore != null ? ts + "-" + game.opponentScore : "";
    return (
      '<span class="bama-result ' +
      cls +
      '">' +
      txt +
      (score ? " " + score : "") +
      "</span>"
    );
  }

  function gradeChip(grades) {
    if (!grades || grades.isWinnerCorrect == null) return "";
    if (grades.isWinnerCorrect) {
      var err = grades.scoreError != null ? " · " + grades.scoreError + " pt off" : "";
      return '<span class="bama-grade bama-grade-correct">✓ Winner' + err + "</span>";
    }
    return '<span class="bama-grade bama-grade-wrong">✗ Wrong winner</span>';
  }

  function populateSeasonSelect() {
    var sel = $("seasonSelect");
    if (!sel) return;
    var y = new Date().getFullYear();
    sel.innerHTML = "";
    for (var i = 0; i < 3; i += 1) {
      var year = y + 1 - i;
      var opt = document.createElement("option");
      opt.value = String(year);
      opt.textContent = String(year);
      if (year === state.season) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function readTeamFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var t = params.get("team");
    return t && t.trim() ? t.trim() : null;
  }

  function persistTeam(name) {
    try {
      localStorage.setItem(STORAGE_TEAM, name);
    } catch (_) {}
    var url = new URL(window.location.href);
    url.searchParams.set("team", name);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  async function loadTeams() {
    var sel = $("teamSelect");
    if (!sel) return;
    var saved = readTeamFromUrl();
    if (!saved) {
      try {
        saved = localStorage.getItem(STORAGE_TEAM);
      } catch (_) {}
    }
    state.team = saved && saved.trim() ? saved.trim() : DEFAULT_TEAM;

    var names = [DEFAULT_TEAM];
    try {
      var res = await fetch("/api/power/teams?season=" + encodeURIComponent(state.season));
      if (res.ok) {
        var data = await res.json();
        names = (data.teams || [])
          .map(function (t) {
            return t.name;
          })
          .filter(Boolean);
      }
    } catch (_) {}

    if (names.indexOf(state.team) === -1) names.unshift(state.team);
    names.sort(function (a, b) {
      return a.localeCompare(b);
    });

    sel.innerHTML = "";
    names.forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === state.team) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderGames() {
    var form = $("predictForm");
    if (!form) return;
    if (!state.games.length) {
      form.innerHTML =
        '<p class="bama-loading">Loading ' + escapeHtml(teamName()) + " schedule…</p>";
      return;
    }

    form.innerHTML = state.games
      .map(function (game, idx) {
        var pred = game.prediction;
        var locked = game.locked;
        var winVal = predWin(pred) === false ? "loss" : predWin(pred) === true ? "win" : "";
        var aScore = predTeamScore(pred);
        var oScore = pred && pred.predictedOpponentScore != null ? pred.predictedOpponentScore : "";
        var hasScores = aScore !== "" && oScore !== "";
        var filled = Boolean(pred) || (winVal && hasScores);
        var rowClass = "bama-game-card";
        if (locked) rowClass += " bama-game-locked";
        if (filled) rowClass += " is-filled";
        if (winVal === "win") rowClass += " is-win-pick";
        if (winVal === "loss") rowClass += " is-loss-pick";
        var disabled = locked ? "disabled" : "";
        var lockNote = locked ? (game.completed ? "Final" : "Locked") : "Open";
        var lockClass = locked ? "" : " is-open";
        var loc = game.neutralSite ? "vs" : game.isHome ? "vs" : "at";
        var delay = Math.min(idx, 8) * 0.03;

        return (
          '<article class="' +
          rowClass +
          '" data-game-id="' +
          game.cfbdGameId +
          '" style="animation-delay:' +
          delay +
          's">' +
          '<div class="bama-game-head">' +
          '<div class="bama-game-meta">' +
          '<span class="bama-week">Week ' +
          (game.week || "?") +
          "</span>" +
          "<span>" +
          locationLabel(game) +
          "</span>" +
          "<span>" +
          formatDate(game.startDate) +
          "</span>" +
          '<span class="bama-lock' +
          lockClass +
          '">' +
          lockNote +
          "</span>" +
          resultBadge(game) +
          gradeChip(game.grades) +
          "</div>" +
          '<h3 class="bama-matchup">' +
          loc +
          " " +
          escapeHtml(game.opponent) +
          "</h3>" +
          "</div>" +
          '<div class="bama-pick-row">' +
          '<div class="bama-wl" role="group" aria-label="Result">' +
          '<button type="button" class="bama-wl-btn' +
          (winVal === "win" ? " is-active" : "") +
          '" data-result="win" data-game="' +
          game.cfbdGameId +
          '" ' +
          disabled +
          ">W</button>" +
          '<button type="button" class="bama-wl-btn' +
          (winVal === "loss" ? " is-active" : "") +
          '" data-result="loss" data-game="' +
          game.cfbdGameId +
          '" ' +
          disabled +
          ">L</button>" +
          "</div>" +
          '<input type="hidden" name="win-' +
          game.cfbdGameId +
          '" value="' +
          (winVal || "win") +
          '">' +
          '<div class="bama-score-pair">' +
          '<input type="number" min="0" max="99" inputmode="numeric" class="bama-score-a" name="ascore-' +
          game.cfbdGameId +
          '" value="' +
          aScore +
          '" placeholder="—" aria-label="' +
          escapeHtml(teamName()) +
          ' score" ' +
          disabled +
          ">" +
          '<span class="bama-score-sep">–</span>' +
          '<input type="number" min="0" max="99" inputmode="numeric" class="bama-score-o" name="oscore-' +
          game.cfbdGameId +
          '" value="' +
          oScore +
          '" placeholder="—" aria-label="Opponent score" ' +
          disabled +
          ">" +
          "</div>" +
          "</div></article>"
        );
      })
      .join("");

    bindGameInteractions();
    updateProgress();
    $("saveBtn").disabled = !isLoggedIn();
  }

  function bindGameInteractions() {
    document.querySelectorAll(".bama-wl-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        var gameId = btn.getAttribute("data-game");
        var result = btn.getAttribute("data-result");
        var hidden = document.querySelector('[name="win-' + gameId + '"]');
        if (hidden) hidden.value = result;
        var group = btn.parentElement;
        group.querySelectorAll(".bama-wl-btn").forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
        });
        var card = btn.closest(".bama-game-card");
        if (card) {
          card.classList.add("is-filled");
          card.classList.toggle("is-win-pick", result === "win");
          card.classList.toggle("is-loss-pick", result === "loss");
        }
        syncCardFromScores(gameId);
      });
    });

    document.querySelectorAll(".bama-score-a, .bama-score-o").forEach(function (input) {
      input.addEventListener("input", function () {
        var name = input.getAttribute("name") || "";
        var gameId = name.replace(/^ascore-|^oscore-/, "");
        syncCardFromScores(gameId);
      });
    });
  }

  function syncCardFromScores(gameId) {
    var aIn = document.querySelector('[name="ascore-' + gameId + '"]');
    var oIn = document.querySelector('[name="oscore-' + gameId + '"]');
    var winHidden = document.querySelector('[name="win-' + gameId + '"]');
    var card = document.querySelector('.bama-game-card[data-game-id="' + gameId + '"]');
    if (!aIn || !oIn || !card) return;
    var a = aIn.value === "" ? null : Number(aIn.value);
    var o = oIn.value === "" ? null : Number(oIn.value);
    if (Number.isFinite(a) && Number.isFinite(o) && a !== o && winHidden) {
      var auto = a > o ? "win" : "loss";
      winHidden.value = auto;
      card.querySelectorAll(".bama-wl-btn").forEach(function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-result") === auto);
      });
      card.classList.toggle("is-win-pick", auto === "win");
      card.classList.toggle("is-loss-pick", auto === "loss");
    }
    var filled = aIn.value !== "" && oIn.value !== "";
    card.classList.toggle("is-filled", filled || Boolean(winHidden && winHidden.value));
    updateProgressLive();
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateProgress() {
    var card = $("progressCard");
    var text = $("progressText");
    var teamEl = $("progressTeam");
    var fill = $("progressFill");
    if (!card || !text) return;

    var filled = countFilledGames();
    state.submittedCount = filled;
    if (teamEl) teamEl.textContent = teamName();
    text.textContent =
      filled +
      " / " +
      state.games.length +
      " predicted · " +
      state.games.filter(function (g) {
        return g.locked;
      }).length +
      " locked";
    if (fill) {
      var pct = state.games.length ? Math.round((filled / state.games.length) * 100) : 0;
      fill.style.width = pct + "%";
    }
    card.hidden = !state.games.length;

    var user = parseUser();
    var link = $("myProfileQuickLink");
    if (link && user && user.username) {
      link.href = "user-profile.html?username=" + encodeURIComponent(user.username);
    }
  }

  function countFilledGames() {
    var n = 0;
    state.games.forEach(function (g) {
      if (g.locked && g.prediction) {
        n += 1;
        return;
      }
      var aIn = document.querySelector('[name="ascore-' + g.cfbdGameId + '"]');
      var oIn = document.querySelector('[name="oscore-' + g.cfbdGameId + '"]');
      if (aIn && oIn && aIn.value !== "" && oIn.value !== "") n += 1;
      else if (g.prediction) n += 1;
    });
    return n;
  }

  function updateProgressLive() {
    var text = $("progressText");
    var fill = $("progressFill");
    if (!text || !state.games.length) return;
    var filled = countFilledGames();
    text.textContent =
      filled +
      " / " +
      state.games.length +
      " predicted · " +
      state.games.filter(function (g) {
        return g.locked;
      }).length +
      " locked";
    if (fill) {
      fill.style.width = Math.round((filled / state.games.length) * 100) + "%";
    }
  }

  function collectPicks() {
    var picks = [];
    state.games.forEach(function (game) {
      if (game.locked) return;
      var winSel = document.querySelector('[name="win-' + game.cfbdGameId + '"]');
      var aIn = document.querySelector('[name="ascore-' + game.cfbdGameId + '"]');
      var oIn = document.querySelector('[name="oscore-' + game.cfbdGameId + '"]');
      if (!winSel || !aIn || !oIn) return;
      if (aIn.value === "" || oIn.value === "") return;
      picks.push({
        cfbdGameId: game.cfbdGameId,
        predictedTeamWin: winSel.value === "win",
        predictedTeamScore: Number(aIn.value),
        predictedOpponentScore: Number(oIn.value),
      });
    });
    return picks;
  }

  function teamQuery() {
    return (
      "season=" +
      encodeURIComponent(state.season) +
      "&team=" +
      encodeURIComponent(teamName())
    );
  }

  async function loadSchedule() {
    var form = $("predictForm");
    if (form) {
      form.innerHTML =
        '<p class="bama-loading">Loading ' + escapeHtml(teamName()) + " schedule…</p>";
    }

    var res = await fetch("/api/bama/schedule?" + teamQuery(), {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load schedule");
    var data = await res.json();
    if (data.team) state.team = data.team;
    state.games = data.games || [];
    renderGames();
    populateLbGameOptions();
  }

  function populateLbGameOptions() {
    var sel = $("lbViewSelect");
    if (!sel) return;
    sel.innerHTML = '<option value="season">Season standings</option>';
    state.games.forEach(function (g) {
      var opt = document.createElement("option");
      opt.value = String(g.cfbdGameId);
      var label = "Week " + (g.week || "?") + " vs " + g.opponent;
      var ts = gameTeamScore(g);
      if (g.completed && ts != null) {
        label += " (" + ts + "-" + g.opponentScore + ")";
      }
      opt.textContent = label;
      sel.appendChild(opt);
    });
  }

  async function savePredictions() {
    if (!isLoggedIn()) {
      window.location.href = "login.html?redirect=" + encodeURIComponent("bama.html?team=" + teamName());
      return;
    }
    var picks = collectPicks();
    if (!picks.length) {
      $("saveStatus").textContent = "Fill in scores for at least one unlocked game.";
      return;
    }
    $("saveBtn").disabled = true;
    $("saveStatus").textContent = "Saving…";
    try {
      var res = await fetch("/api/bama/submit", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
        body: JSON.stringify({ season: state.season, team: teamName(), picks: picks }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.message || data.error || "Save failed");
      $("saveStatus").textContent =
        "Saved " +
        (data.saved || picks.length) +
        " " +
        teamName() +
        " game(s)." +
        (data.skippedLocked ? " (" + data.skippedLocked + " locked skipped)" : "");
      await loadSchedule();
      if (state.activeTab === "leaderboard") await loadLeaderboard();
    } catch (err) {
      $("saveStatus").textContent = err.message || "Could not save predictions.";
    } finally {
      $("saveBtn").disabled = !isLoggedIn();
    }
  }

  function profileLink(username) {
    return (
      '<a class="lb-player-link" href="user-profile.html?username=' +
      encodeURIComponent(username) +
      '">' +
      escapeHtml(username) +
      "</a>"
    );
  }

  function renderSeasonLeaderboard(board) {
    $("lbTitle").textContent = teamName() + " · " + state.season + " Leaderboard";
    $("lbHint").textContent = board.viewerHint || "";
    var head = $("lbHead");
    head.innerHTML =
      "<tr><th>#</th><th>Player</th><th>Record</th><th>Accuracy</th><th>Avg score err</th><th>Streak</th></tr>";

    var body = $("lbBody");
    var entries = board.entries || [];
    $("lbEmpty").hidden = entries.length > 0;
    body.innerHTML = entries
      .map(function (e) {
        var streak =
          e.currentStreak > 0
            ? "🔥 " + e.currentStreak + "W"
            : e.currentStreak < 0
              ? "❄️ " + Math.abs(e.currentStreak) + "L"
              : "—";
        return (
          "<tr>" +
          "<td>" +
          e.rank +
          "</td>" +
          "<td>" +
          profileLink(e.username) +
          "</td>" +
          "<td>" +
          e.correctPicks +
          "-" +
          e.incorrectPicks +
          " (" +
          e.pendingPicks +
          " pending)</td>" +
          "<td>" +
          (e.gradedPicks ? e.accuracy + "%" : "—") +
          "</td>" +
          "<td>" +
          (e.avgScoreError != null ? e.avgScoreError : "—") +
          "</td>" +
          "<td>" +
          streak +
          "</td></tr>"
        );
      })
      .join("");

    renderPodium(entries.slice(0, 3));
  }

  function renderGameLeaderboard(board) {
    var game = board.game;
    $("lbTitle").textContent = game
      ? teamName() + " · Week " + game.week + " vs " + game.opponent
      : "Game leaderboard";
    $("lbHint").textContent = board.viewerHint || "";
    $("lbHead").innerHTML =
      "<tr><th>#</th><th>Player</th><th>Pick</th><th>Score</th><th>Result</th></tr>";

    var entries = board.entries || [];
    $("lbEmpty").hidden = entries.length > 0;
    $("lbBody").innerHTML = entries
      .map(function (e) {
        var won = e.predictedTeamWin != null ? e.predictedTeamWin : e.predictedAlabamaWin;
        var tScore = e.predictedTeamScore != null ? e.predictedTeamScore : e.predictedAlabamaScore;
        var pick = won ? teamName() + " W" : teamName() + " L";
        var score = tScore + "-" + e.predictedOpponentScore;
        var result =
          e.isWinnerCorrect == null
            ? "Pending"
            : e.isWinnerCorrect
              ? "✓" + (e.scoreError != null ? " (" + e.scoreError + " off)" : "")
              : "✗";
        return (
          "<tr><td>" +
          e.rank +
          "</td><td>" +
          profileLink(e.username) +
          "</td><td>" +
          escapeHtml(pick) +
          "</td><td>" +
          score +
          "</td><td>" +
          result +
          "</td></tr>"
        );
      })
      .join("");
    $("bamaPodium").hidden = true;
  }

  function renderPodium(top3) {
    var pod = $("bamaPodium");
    if (!pod || !top3 || !top3.length) {
      if (pod) pod.hidden = true;
      return;
    }
    pod.hidden = false;
    pod.innerHTML =
      '<div class="lb-podium-grid">' +
      top3
        .map(function (e, i) {
          var medal = ["🥇", "🥈", "🥉"][i] || "";
          return (
            '<div class="lb-podium-slot lb-podium-' +
            (i + 1) +
            '">' +
            '<div class="lb-podium-medal">' +
            medal +
            "</div>" +
            '<div class="lb-podium-name">' +
            profileLink(e.username) +
            "</div>" +
            '<div class="lb-podium-stat">' +
            e.correctPicks +
            " correct · " +
            (e.gradedPicks ? e.accuracy + "%" : "—") +
            "</div></div>"
          );
        })
        .join("") +
      "</div>";
  }

  async function loadLeaderboard() {
    var gameId = state.lbGameId;
    var url =
      "/api/bama/leaderboard?" +
      teamQuery() +
      (gameId ? "&gameId=" + encodeURIComponent(gameId) : "");
    var res = await fetch(url);
    if (!res.ok) throw new Error("Failed to load leaderboard");
    var board = await res.json();
    if (board.scope === "game") renderGameLeaderboard(board);
    else renderSeasonLeaderboard(board);
  }

  function setTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll(".bama-tab").forEach(function (btn) {
      var on = btn.getAttribute("data-tab") === tab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("predictPanel").hidden = tab !== "predict";
    $("leaderboardPanel").hidden = tab !== "leaderboard";
    document.body.classList.toggle("sp-leaderboard-view", tab === "leaderboard");
    if (tab === "leaderboard") loadLeaderboard().catch(showError);
  }

  function showError(err) {
    $("saveStatus").textContent = (err && err.message) || "Something went wrong.";
  }

  function onTeamOrSeasonChange() {
    persistTeam(teamName());
    loadSchedule().catch(showError);
    if (state.activeTab === "leaderboard") loadLeaderboard().catch(showError);
  }

  function bindEvents() {
    $("seasonSelect").addEventListener("change", function (e) {
      state.season = Number(e.target.value) || new Date().getFullYear();
      onTeamOrSeasonChange();
    });

    $("teamSelect").addEventListener("change", function (e) {
      state.team = e.target.value || DEFAULT_TEAM;
      onTeamOrSeasonChange();
    });

    document.querySelectorAll(".bama-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTab(btn.getAttribute("data-tab"));
      });
    });

    $("saveBtn").addEventListener("click", savePredictions);

    $("lbViewSelect").addEventListener("change", function (e) {
      var v = e.target.value;
      state.lbGameId = v === "season" ? null : Number(v);
      loadLeaderboard().catch(showError);
    });

    if (window.location.hash === "#leaderboard") setTab("leaderboard");
  }

  function refreshAuthUi() {
    $("loginGate").hidden = isLoggedIn();
    $("saveBtn").disabled = !isLoggedIn();
  }

  document.addEventListener("DOMContentLoaded", async function () {
    populateSeasonSelect();
    bindEvents();
    refreshAuthUi();
    await loadTeams();
    persistTeam(teamName());
    loadSchedule().catch(showError);
    document.addEventListener("auth:changed", refreshAuthUi);
  });
})();
