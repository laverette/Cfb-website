(function () {
  "use strict";

  var STORAGE_TOKEN = "authToken";
  var STORAGE_USER = "currentUser";
  var STORAGE_TEAM = "schedulePredictTeam";
  var DEFAULT_TEAM = "Alabama";

  var state = {
    season: new Date().getFullYear(),
    team: "",
    teamList: [],
    games: [],
    submittedCount: 0,
    activeTab: "predict",
    lbScope: "season",
    lbGameId: null,
    brandIndex: {},
  };

  var ABBR_OVERRIDES = {
    alabama: "ALA",
    "app state": "APP",
    auburn: "AUB",
    "east carolina": "ECU",
    "florida state": "FSU",
    georgia: "UGA",
    kentucky: "UK",
    "louisiana tech": "LT",
    lsu: "LSU",
    "miami (oh)": "M-OH",
    "mississippi state": "MSST",
    "nc state": "NCST",
    "north carolina": "UNC",
    "ole miss": "MISS",
    "south carolina": "SCAR",
    "southern miss": "USM",
    "texas a&m": "TAMU",
    "ul monroe": "ULM",
    utsa: "UTSA",
    uab: "UAB",
    ucf: "UCF",
    usc: "USC",
    ucla: "UCLA",
    byu: "BYU",
    smu: "SMU",
    tcu: "TCU",
    chattanooga: "UTC",
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

  function normSchoolKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  async function loadTeamBrandIndex() {
    state.brandIndex = {};
    try {
      var res = await fetch("/api/power/teams?season=" + encodeURIComponent(state.season));
      if (!res.ok) return;
      var data = await res.json();
      (data.teams || []).forEach(function (t) {
        if (!t || !t.name) return;
        state.brandIndex[normSchoolKey(t.name)] = {
          logoUrl: t.logoUrl || "",
          abbreviation: t.abbreviation || null,
        };
      });
    } catch (_) {}
  }

  function schoolAbbreviation(school) {
    var key = normSchoolKey(school);
    if (state.brandIndex[key] && state.brandIndex[key].abbreviation) {
      return state.brandIndex[key].abbreviation;
    }
    if (ABBR_OVERRIDES[key]) return ABBR_OVERRIDES[key];
    var words = String(school || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return "—";
    if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
    return words
      .map(function (w) {
        return w[0];
      })
      .join("")
      .toUpperCase()
      .slice(0, 4);
  }

  function schoolLogoUrl(school) {
    var key = normSchoolKey(school);
    if (state.brandIndex[key] && state.brandIndex[key].logoUrl) {
      return state.brandIndex[key].logoUrl;
    }
    if (window.RecruitTeamBranding) {
      var brand = RecruitTeamBranding.lookup(school);
      if (brand && brand.logo) return brand.logo;
    }
    return "";
  }

  function logoMarkup(school, className) {
    var cls = className || "bama-team-logo";
    var url = schoolLogoUrl(school);
    var fb = escapeHtml(schoolAbbreviation(school).slice(0, 3));
    if (!url) {
      return '<span class="' + cls + ' bama-logo-fallback" aria-hidden="true">' + fb + "</span>";
    }
    return (
      '<img class="' +
      cls +
      '" src="' +
      escapeHtml(url) +
      '" alt="" loading="lazy" width="32" height="32" onerror="this.style.display=\'none\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'flex\';">' +
      '<span class="' +
      cls +
      ' bama-logo-fallback" style="display:none" aria-hidden="true">' +
      fb +
      "</span>"
    );
  }

  function updateProgressLogo() {
    var logoEl = $("progressTeamLogo");
    if (!logoEl) return;
    var url = schoolLogoUrl(teamName());
    if (url) {
      logoEl.src = url;
      logoEl.alt = teamName();
      logoEl.hidden = false;
      logoEl.onerror = function () {
        logoEl.hidden = true;
      };
    } else {
      logoEl.removeAttribute("src");
      logoEl.hidden = true;
    }
  }

  function teamName() {
    return String(state.team || "").trim();
  }

  function hasTeam() {
    return Boolean(teamName());
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
    var team = String(name || "").trim();
    var url = new URL(window.location.href);
    if (team) {
      try {
        localStorage.setItem(STORAGE_TEAM, team);
      } catch (_) {}
      url.searchParams.set("team", team);
    } else {
      try {
        localStorage.removeItem(STORAGE_TEAM);
      } catch (_) {}
      url.searchParams.delete("team");
    }
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function showEmptyTeamState() {
    state.games = [];
    var form = $("predictForm");
    if (form) {
      form.innerHTML =
        '<p class="bama-empty-prompt">Search and pick a team above to load their schedule.</p>';
    }
    var card = $("progressCard");
    if (card) card.hidden = true;
    var lbEmpty = $("lbEmpty");
    if (lbEmpty && state.activeTab === "leaderboard") {
      lbEmpty.hidden = false;
      lbEmpty.textContent = "Pick a team first to view that schedule leaderboard.";
    }
  }

  async function loadTeams() {
    var hidden = $("teamSelect");
    var input = $("teamSearch");
    if (!hidden || !input) return;

    // Only honor an explicit ?team= deep link — never auto-fill Alabama/localStorage.
    var fromUrl = readTeamFromUrl();
    state.team = fromUrl && fromUrl.trim() ? fromUrl.trim() : "";

    var names = [];
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

    if (!names.length) names = [DEFAULT_TEAM];
    if (state.team && names.indexOf(state.team) === -1) names.unshift(state.team);
    names.sort(function (a, b) {
      return a.localeCompare(b);
    });
    state.teamList = names;

    hidden.value = state.team;
    input.value = state.team;
    input.placeholder = "Search team…";
  }

  function filterTeamNames(query) {
    var q = String(query || "").trim().toLowerCase();
    return state.teamList
      .filter(function (name) {
        if (!q) return true;
        return String(name).toLowerCase().indexOf(q) !== -1;
      })
      .slice(0, 40);
  }

  function setTeamFromCombo(name, opts) {
    opts = opts || {};
    var next = name && String(name).trim() ? String(name).trim() : "";
    var changed = next !== state.team;
    state.team = next;
    var hidden = $("teamSelect");
    var input = $("teamSearch");
    if (hidden) hidden.value = next;
    if (input && !opts.keepTyped) input.value = next;
    if (changed && !opts.skipReload) onTeamOrSeasonChange();
  }

  function bindTeamCombo() {
    var combo = $("teamCombo");
    var input = $("teamSearch");
    var list = $("teamList");
    if (!combo || !input || !list) return;
    var activeIndex = -1;

    function close() {
      list.hidden = true;
      list.innerHTML = "";
      activeIndex = -1;
    }

    function open(items) {
      if (!items.length) {
        list.innerHTML = '<li class="bama-combo-empty">No matching teams</li>';
        list.hidden = false;
        return;
      }
      list.innerHTML = items
        .map(function (name, i) {
          return (
            '<li class="bama-combo-option" role="option" data-i="' +
            i +
            '">' +
            escapeHtml(name) +
            "</li>"
          );
        })
        .join("");
      list.hidden = false;
      activeIndex = 0;
      highlight();
    }

    function highlight() {
      Array.prototype.forEach.call(list.querySelectorAll(".bama-combo-option"), function (opt, i) {
        opt.classList.toggle("is-active", i === activeIndex);
      });
    }

    function currentItems() {
      return filterTeamNames(input.value);
    }

    function commit(name) {
      if (!name) return;
      setTeamFromCombo(name);
      close();
    }

    input.addEventListener("focus", function () {
      open(currentItems());
      if (input.value) {
        try {
          input.select();
        } catch (_) {}
      }
    });

    input.addEventListener("input", function () {
      open(currentItems());
    });

    input.addEventListener("keydown", function (e) {
      var items = currentItems();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.hidden) open(items);
        activeIndex = Math.min(activeIndex + 1, Math.max(items.length - 1, 0));
        highlight();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        highlight();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!list.hidden && items[activeIndex]) commit(items[activeIndex]);
        else {
          var exact = state.teamList.find(function (t) {
            return t.toLowerCase() === input.value.trim().toLowerCase();
          });
          if (exact) commit(exact);
        }
      } else if (e.key === "Escape") {
        close();
      }
    });

    list.addEventListener("mousedown", function (e) {
      var opt = e.target.closest(".bama-combo-option");
      if (!opt) return;
      e.preventDefault();
      var items = currentItems();
      commit(items[Number(opt.getAttribute("data-i"))]);
    });

    input.addEventListener("blur", function () {
      setTimeout(function () {
        var exact = state.teamList.find(function (t) {
          return t.toLowerCase() === input.value.trim().toLowerCase();
        });
        if (exact) {
          commit(exact);
        } else {
          input.value = state.team || "";
        }
        close();
      }, 120);
    });

    document.addEventListener("click", function (e) {
      if (!e.target.closest(".bama-combo")) close();
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
        var teamAb = schoolAbbreviation(teamName());
        var oppAb = schoolAbbreviation(game.opponent);

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
          '<div class="bama-matchup-wrap">' +
          logoMarkup(teamName(), "bama-team-logo bama-match-logo") +
          '<h3 class="bama-matchup"><span class="bama-matchup-loc">' +
          loc +
          "</span> " +
          escapeHtml(game.opponent) +
          "</h3>" +
          logoMarkup(game.opponent, "bama-team-logo bama-match-logo bama-match-logo-opp") +
          "</div>" +
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
          '<label class="bama-score-field">' +
          '<span class="bama-score-label">' +
          escapeHtml(teamAb) +
          "</span>" +
          '<input type="number" min="0" max="99" inputmode="numeric" class="bama-score-a" name="ascore-' +
          game.cfbdGameId +
          '" value="' +
          aScore +
          '" placeholder="—" aria-label="' +
          escapeHtml(teamName()) +
          ' score" ' +
          disabled +
          ">" +
          "</label>" +
          '<span class="bama-score-sep" aria-hidden="true">–</span>' +
          '<label class="bama-score-field">' +
          '<span class="bama-score-label">' +
          escapeHtml(oppAb) +
          "</span>" +
          '<input type="number" min="0" max="99" inputmode="numeric" class="bama-score-o" name="oscore-' +
          game.cfbdGameId +
          '" value="' +
          oScore +
          '" placeholder="—" aria-label="' +
          escapeHtml(game.opponent) +
          ' score" ' +
          disabled +
          ">" +
          "</label>" +
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
    updateProgressLogo();
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
    if (!hasTeam()) {
      showEmptyTeamState();
      return;
    }

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
    if (data.team) {
      state.team = data.team;
      var hidden = $("teamSelect");
      var input = $("teamSearch");
      if (hidden) hidden.value = data.team;
      if (input && document.activeElement !== input) input.value = data.team;
    }
    state.games = data.games || [];
    renderGames();
    populateLbGameOptions();
  }

  function populateLbGameOptions() {
    var sel = $("lbGameSelect");
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '<option value="">Select a game…</option>';
    state.games.forEach(function (g) {
      var opt = document.createElement("option");
      opt.value = String(g.cfbdGameId);
      var loc = g.neutralSite ? "vs" : g.isHome ? "vs" : "at";
      var label = "Week " + (g.week || "?") + " " + loc + " " + g.opponent;
      var ts = gameTeamScore(g);
      if (g.completed && ts != null) {
        label += " (" + ts + "-" + g.opponentScore + ")";
      }
      opt.textContent = label;
      sel.appendChild(opt);
    });
    if (prev && sel.querySelector('option[value="' + prev + '"]')) {
      sel.value = prev;
    } else if (state.lbScope === "game" && state.games.length) {
      sel.value = String(state.games[0].cfbdGameId);
      state.lbGameId = state.games[0].cfbdGameId;
    }
  }

  function setLbScope(scope) {
    state.lbScope = scope === "game" ? "game" : "season";
    state.lbGameId = state.lbScope === "game" ? state.lbGameId : null;

    document.querySelectorAll(".bama-lb-scope-btn").forEach(function (btn) {
      var on = btn.getAttribute("data-lb-scope") === state.lbScope;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });

    var gameField = $("lbGameField");
    if (gameField) gameField.hidden = state.lbScope !== "game";

    if (state.lbScope === "game" && !state.lbGameId && state.games.length) {
      state.lbGameId = state.games[0].cfbdGameId;
      var sel = $("lbGameSelect");
      if (sel) sel.value = String(state.lbGameId);
    }

    if (state.activeTab === "leaderboard") loadLeaderboard().catch(showError);
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
    if (!entries.length) {
      $("lbEmpty").textContent =
        "No one has submitted picks for this team yet. Switch to My Predictions and be the first on the board.";
    }
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
    if (!entries.length) {
      $("lbEmpty").textContent = "No picks submitted for this game yet.";
    }
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
    if (!hasTeam()) {
      $("lbBody").innerHTML = "";
      $("lbHead").innerHTML = "";
      $("lbTitle").textContent = "Schedule Leaderboard";
      $("lbHint").textContent = "Search for a team above to open their board.";
      $("lbEmpty").hidden = false;
      $("lbEmpty").textContent = "Pick a team first to view that schedule leaderboard.";
      $("bamaPodium").hidden = true;
      return;
    }
    if (state.lbScope === "game" && !state.lbGameId) {
      $("lbBody").innerHTML = "";
      $("lbHead").innerHTML = "";
      $("lbTitle").textContent = teamName() + " · Pick a game";
      $("lbHint").textContent = "Choose a game above to see how everyone called that matchup.";
      $("lbEmpty").hidden = false;
      $("lbEmpty").textContent = "Select a game from the dropdown to view picks for that week.";
      $("bamaPodium").hidden = true;
      return;
    }
    var gameId = state.lbScope === "game" ? state.lbGameId : null;
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
    if (tab === "leaderboard") setLbScope(state.lbScope || "season");
  }

  function showError(err) {
    $("saveStatus").textContent = (err && err.message) || "Something went wrong.";
  }

  function onTeamOrSeasonChange() {
    if (!hasTeam()) {
      persistTeam("");
      showEmptyTeamState();
      return;
    }
    persistTeam(teamName());
    loadTeamBrandIndex()
      .then(function () {
        return loadSchedule();
      })
      .catch(showError);
    if (state.activeTab === "leaderboard") loadLeaderboard().catch(showError);
  }

  function bindEvents() {
    $("seasonSelect").addEventListener("change", function (e) {
      state.season = Number(e.target.value) || new Date().getFullYear();
      onTeamOrSeasonChange();
    });

    bindTeamCombo();

    document.querySelectorAll(".bama-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTab(btn.getAttribute("data-tab"));
      });
    });

    $("saveBtn").addEventListener("click", savePredictions);

    document.querySelectorAll(".bama-lb-scope-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setLbScope(btn.getAttribute("data-lb-scope"));
      });
    });

    $("lbGameSelect").addEventListener("change", function (e) {
      var v = e.target.value;
      state.lbGameId = v ? Number(v) : null;
      if (state.lbScope === "game" && state.lbGameId) loadLeaderboard().catch(showError);
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
    var brandingLoad = window.RecruitTeamBranding ? RecruitTeamBranding.load() : Promise.resolve();
    await Promise.all([loadTeams(), brandingLoad, loadTeamBrandIndex()]);
    if (hasTeam()) {
      persistTeam(teamName());
      loadSchedule().catch(showError);
    } else {
      persistTeam("");
      showEmptyTeamState();
    }
    document.addEventListener("auth:changed", refreshAuthUi);
  });
})();
