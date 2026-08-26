(function () {
  "use strict";

  var STORAGE_TOKEN = "authToken";
  var STORAGE_USER = "currentUser";
  var state = {
    season: new Date().getFullYear(),
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
    if (!game.completed || game.alabamaWin == null) return "";
    var cls = game.alabamaWin ? "bama-badge-win" : "bama-badge-loss";
    var txt = game.alabamaWin ? "W" : "L";
    var score =
      game.alabamaScore != null && game.opponentScore != null
        ? game.alabamaScore + "-" + game.opponentScore
        : "";
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
      var err =
        grades.scoreError != null ? " · " + grades.scoreError + " pt off" : "";
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

  function renderGames() {
    var form = $("predictForm");
    if (!form) return;
    if (!state.games.length) {
      form.innerHTML = '<p class="bama-loading">Loading Alabama schedule…</p>';
      return;
    }

    form.innerHTML = state.games
      .map(function (game) {
        var pred = game.prediction;
        var locked = game.locked;
        var winVal = pred ? (pred.predictedAlabamaWin ? "win" : "loss") : "win";
        var aScore = pred && pred.predictedAlabamaScore != null ? pred.predictedAlabamaScore : "";
        var oScore = pred && pred.predictedOpponentScore != null ? pred.predictedOpponentScore : "";
        var disabled = locked ? "disabled" : "";
        var lockNote = locked
          ? game.completed
            ? "Final"
            : "Locked"
          : "Open";

        return (
          '<article class="section-card bama-game-card' +
          (locked ? " bama-game-locked" : "") +
          '" data-game-id="' +
          game.cfbdGameId +
          '">' +
          '<div class="bama-game-head">' +
          '<div class="bama-game-meta">' +
          '<span class="bama-week">Week ' +
          (game.week || "?") +
          "</span>" +
          '<span class="bama-loc">' +
          locationLabel(game) +
          "</span>" +
          '<span class="bama-date">' +
          formatDate(game.startDate) +
          "</span>" +
          '<span class="bama-lock">' +
          lockNote +
          "</span>" +
          resultBadge(game) +
          gradeChip(game.grades) +
          "</div>" +
          '<h3 class="bama-matchup">vs ' +
          escapeHtml(game.opponent) +
          "</h3>" +
          "</div>" +
          '<div class="bama-pick-row">' +
          '<label class="bama-pick-label">Result' +
          '<select class="site-select bama-win-select" name="win-' +
          game.cfbdGameId +
          '" ' +
          disabled +
          ">" +
          '<option value="win"' +
          (winVal === "win" ? " selected" : "") +
          ">Alabama Win</option>" +
          '<option value="loss"' +
          (winVal === "loss" ? " selected" : "") +
          ">Alabama Loss</option>" +
          "</select></label>" +
          '<label class="bama-pick-label">Bama score' +
          '<input type="number" min="0" max="99" class="site-input bama-score-a" name="ascore-' +
          game.cfbdGameId +
          '" value="' +
          aScore +
          '" placeholder="28" ' +
          disabled +
          "></label>" +
          '<label class="bama-pick-label">Opp score' +
          '<input type="number" min="0" max="99" class="site-input bama-score-o" name="oscore-' +
          game.cfbdGameId +
          '" value="' +
          oScore +
          '" placeholder="14" ' +
          disabled +
          "></label>" +
          "</div></article>"
        );
      })
      .join("");

    updateProgress();
    $("saveBtn").disabled = !isLoggedIn();
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
    if (!card || !text) return;
    var filled = 0;
    state.games.forEach(function (g) {
      if (g.prediction) filled += 1;
    });
    state.submittedCount = filled;
    text.textContent =
      filled +
      " / " +
      state.games.length +
      " games predicted · " +
      state.games.filter(function (g) {
        return g.locked;
      }).length +
      " locked";
    card.hidden = !state.games.length;

    var user = parseUser();
    var link = $("myProfileQuickLink");
    if (link && user && user.username) {
      link.href = "user-profile.html?username=" + encodeURIComponent(user.username);
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
        predictedAlabamaWin: winSel.value === "win",
        predictedAlabamaScore: Number(aIn.value),
        predictedOpponentScore: Number(oIn.value),
      });
    });
    return picks;
  }

  async function loadSchedule() {
    var form = $("predictForm");
    if (form) form.innerHTML = '<p class="bama-loading">Loading Alabama schedule…</p>';

    var res = await fetch("/api/bama/schedule?season=" + encodeURIComponent(state.season), {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load schedule");
    var data = await res.json();
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
      if (g.completed && g.alabamaScore != null) {
        label += " (" + g.alabamaScore + "-" + g.opponentScore + ")";
      }
      opt.textContent = label;
      sel.appendChild(opt);
    });
  }

  async function savePredictions() {
    if (!isLoggedIn()) {
      window.location.href = "login.html?redirect=bama.html";
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
        body: JSON.stringify({ season: state.season, picks: picks }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.message || data.error || "Save failed");
      $("saveStatus").textContent =
        "Saved " + (data.saved || picks.length) + " game(s)." +
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
    $("lbTitle").textContent = state.season + " Bama Schedule Leaderboard";
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
      ? "Week " + game.week + " vs " + game.opponent
      : "Game leaderboard";
    $("lbHint").textContent = board.viewerHint || "";
    $("lbHead").innerHTML =
      "<tr><th>#</th><th>Player</th><th>Pick</th><th>Score</th><th>Result</th></tr>";

    var entries = board.entries || [];
    $("lbEmpty").hidden = entries.length > 0;
    $("lbBody").innerHTML = entries
      .map(function (e) {
        var pick = e.predictedAlabamaWin ? "Bama W" : "Bama L";
        var score = e.predictedAlabamaScore + "-" + e.predictedOpponentScore;
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
          pick +
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
      "/api/bama/leaderboard?season=" +
      encodeURIComponent(state.season) +
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
    if (tab === "leaderboard") loadLeaderboard().catch(showError);
  }

  function showError(err) {
    $("saveStatus").textContent = (err && err.message) || "Something went wrong.";
  }

  function bindEvents() {
    $("seasonSelect").addEventListener("change", function (e) {
      state.season = Number(e.target.value) || new Date().getFullYear();
      loadSchedule().catch(showError);
      if (state.activeTab === "leaderboard") loadLeaderboard().catch(showError);
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

  document.addEventListener("DOMContentLoaded", function () {
    populateSeasonSelect();
    bindEvents();
    refreshAuthUi();
    loadSchedule().catch(showError);

    document.addEventListener("auth:changed", refreshAuthUi);
  });
})();
