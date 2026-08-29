/**
 * CFP Bracket Picker — official 12-team layout with searchable seed comboboxes.
 * Persists to Supabase via /api/cfp/* (auth required to save).
 */
(function () {
  "use strict";

  var STORAGE_TOKEN = "authToken";
  var STORAGE_USER = "currentUser";
  var SEASON = new Date().getFullYear();

  var FALLBACK_TEAMS = [
    "Alabama", "Arizona", "Arizona State", "Arkansas", "Army", "Auburn", "Baylor",
    "Boise State", "Boston College", "BYU", "Buffalo", "California", "UCF", "Charlotte",
    "Cincinnati", "Clemson", "Coastal Carolina", "Colorado", "Colorado State", "Duke",
    "East Carolina", "Eastern Michigan", "FIU", "Florida", "Florida Atlantic",
    "Florida State", "Fresno State", "Georgia", "Georgia Southern", "Georgia State",
    "Georgia Tech", "Hawaii", "Houston", "Illinois", "Indiana", "Iowa", "Iowa State",
    "James Madison", "Kansas", "Kansas State", "Kent State", "Kentucky", "Liberty",
    "Louisiana", "Louisiana Tech", "Louisville", "LSU", "Marshall", "Maryland",
    "Memphis", "Miami", "Miami (OH)", "Michigan", "Michigan State", "Middle Tennessee",
    "Minnesota", "Mississippi State", "Missouri", "Navy", "NC State", "Nebraska",
    "Nevada", "New Mexico", "New Mexico State", "North Carolina", "North Texas",
    "Northern Illinois", "Northwestern", "Notre Dame", "Ohio", "Ohio State",
    "Oklahoma", "Oklahoma State", "Old Dominion", "Ole Miss", "Oregon", "Oregon State",
    "Penn State", "Pittsburgh", "Purdue", "Rice", "Rutgers", "San Diego State",
    "San José State", "SMU", "South Alabama", "South Carolina", "South Florida",
    "Southern Mississippi", "Stanford", "Syracuse", "TCU", "Temple", "Tennessee",
    "Texas", "Texas A&M", "Texas State", "Texas Tech", "Toledo", "Troy", "Tulane",
    "Tulsa", "UAB", "UCLA", "UConn", "UMass", "UNLV", "USC", "Utah", "Utah State",
    "UTEP", "UTSA", "Vanderbilt", "Virginia", "Virginia Tech", "Wake Forest",
    "Washington", "Washington State", "West Virginia", "Western Kentucky",
    "Western Michigan", "Wisconsin", "Wyoming",
  ];

  /** gameId -> [slotA, slotB] and where winner goes */
  var GAMES = {
    frL1: { slots: ["seed9", "seed8"], advancesTo: "wFrL1", clears: ["qfL1", "sfL", "champ"] },
    frL2: { slots: ["seed12", "seed5"], advancesTo: "wFrL2", clears: ["qfL2", "sfL", "champ"] },
    frR1: { slots: ["seed10", "seed7"], advancesTo: "wFrR1", clears: ["qfR1", "sfR", "champ"] },
    frR2: { slots: ["seed11", "seed6"], advancesTo: "wFrR2", clears: ["qfR2", "sfR", "champ"] },
    qfL1: { slots: ["seed1", "wFrL1"], advancesTo: "wQfL1", clears: ["sfL", "champ"] },
    qfL2: { slots: ["seed4", "wFrL2"], advancesTo: "wQfL2", clears: ["sfL", "champ"] },
    qfR1: { slots: ["seed2", "wFrR1"], advancesTo: "wQfR1", clears: ["sfR", "champ"] },
    qfR2: { slots: ["seed3", "wFrR2"], advancesTo: "wQfR2", clears: ["sfR", "champ"] },
    sfL: { slots: ["wQfL1", "wQfL2"], advancesTo: "wSfL", clears: ["champ"] },
    sfR: { slots: ["wQfR1", "wQfR2"], advancesTo: "wSfR", clears: ["champ"] },
    champ: { slots: ["wSfL", "wSfR"], advancesTo: null, clears: [] },
  };

  var SEED_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (n) {
    return "seed" + n;
  });

  var state = {
    teams: {}, // seed number -> team name
    slots: {}, // slot id -> { name, seed }
    picks: {}, // gameId -> winning slot id
    teamList: FALLBACK_TEAMS.slice(),
    readonly: false,
    viewUsername: null,
    activeTab: "bracket",
    lbLoaded: false,
    lastChampShown: null,
  };

  function $(sel, root) {
    if (typeof sel === "string" && sel.indexOf("#") !== 0 && !/[.\[:> ]/.test(sel)) {
      return document.getElementById(sel) || (root || document).querySelector("#" + sel);
    }
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function setStatus(msg) {
    var el = document.getElementById("statusLine");
    if (el) el.textContent = msg || "";
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

  function queryUsername() {
    try {
      return new URLSearchParams(window.location.search).get("username") || "";
    } catch (_) {
      return "";
    }
  }

  function applyBracketData(data) {
    state.teams = (data && data.teams) || {};
    state.slots = (data && data.slots) || {};
    state.picks = (data && data.picks) || {};
    Object.keys(state.teams).forEach(function (k) {
      state.slots["seed" + k] = { name: state.teams[k], seed: Number(k) };
    });
  }

  function setReadonly(on, label) {
    state.readonly = Boolean(on);
    document.body.classList.toggle("cfp-readonly", state.readonly);
    var banner = document.getElementById("viewBanner");
    if (banner) {
      if (state.readonly && label) {
        banner.hidden = false;
        banner.textContent = label;
      } else {
        banner.hidden = true;
        banner.textContent = "";
      }
    }
    var tabMine = document.querySelector('.cfp-tab[data-tab="bracket"]');
    if (tabMine) {
      tabMine.textContent = state.readonly ? "Bracket" : "My Bracket";
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadTeamList() {
    try {
      var res = await fetch("/api/power/teams?season=" + new Date().getFullYear());
      if (!res.ok) return;
      var data = await res.json();
      var names = (data.teams || [])
        .map(function (t) {
          return t.name;
        })
        .filter(Boolean);
      if (names.length) {
        names.sort(function (a, b) {
          return a.localeCompare(b);
        });
        state.teamList = names;
      }
    } catch (_) {}
  }

  function usedTeams(exceptSeed) {
    var used = new Set();
    Object.keys(state.teams).forEach(function (k) {
      if (Number(k) === Number(exceptSeed)) return;
      if (state.teams[k]) used.add(String(state.teams[k]).toLowerCase());
    });
    return used;
  }

  function filterTeams(query, exceptSeed) {
    var q = String(query || "").trim().toLowerCase();
    var used = usedTeams(exceptSeed);
    return state.teamList
      .filter(function (name) {
        if (used.has(name.toLowerCase())) return false;
        if (!q) return true;
        return name.toLowerCase().includes(q);
      })
      .slice(0, 40);
  }

  function lookupBrand(teamName) {
    if (!teamName) return null;
    if (window.RecruitTeamBranding && typeof window.RecruitTeamBranding.lookup === "function") {
      return window.RecruitTeamBranding.lookup(teamName);
    }
    return null;
  }

  function contrastText(hex) {
    if (window.RecruitTeamBranding && window.RecruitTeamBranding.contrastTextColor) {
      return window.RecruitTeamBranding.contrastTextColor(hex);
    }
    return "#ffffff";
  }

  function applySlotBrand(el, teamName) {
    if (!el) return;
    el.classList.remove("has-team", "is-light-text");
    el.style.removeProperty("--cfp-team-bg");
    el.style.removeProperty("--cfp-team-border");
    el.style.removeProperty("--cfp-team-text");
    el.style.removeProperty("--cfp-team-accent");
    if (!teamName) return;
    var brand = lookupBrand(teamName);
    if (!brand || !brand.primary) {
      el.classList.add("has-team");
      return;
    }
    var text = contrastText(brand.primary);
    el.classList.add("has-team");
    if (String(text).toLowerCase() !== "#1e1e1e") {
      el.classList.add("is-light-text");
    }
    el.style.setProperty("--cfp-team-bg", brand.primary);
    el.style.setProperty("--cfp-team-border", brand.secondary || brand.accent || brand.primary);
    el.style.setProperty("--cfp-team-text", text);
    el.style.setProperty("--cfp-team-accent", brand.accent || brand.secondary || brand.primary);
  }

  function logoHtml(teamName) {
    var brand = lookupBrand(teamName);
    if (!brand || !brand.logo) return "";
    return (
      '<img class="cfp-team-logo" src="' +
      escapeHtml(brand.logo) +
      '" alt="" width="22" height="22" loading="lazy">'
    );
  }

  function renderSeedSlot(el) {
    var seed = Number(el.getAttribute("data-seed"));
    var value = state.teams[seed] || "";
    el.innerHTML =
      '<span class="cfp-seed-badge">' +
      seed +
      ".</span>" +
      logoHtml(value) +
      '<div class="cfp-slot-body"><div class="cfp-combo" data-seed="' +
      seed +
      '">' +
      '<input class="cfp-combo-input" type="text" autocomplete="off" spellcheck="false" ' +
      'placeholder="Search team…" aria-label="Seed ' +
      seed +
      ' team" value="' +
      escapeHtml(value) +
      '">' +
      '<ul class="cfp-combo-list" hidden role="listbox"></ul>' +
      "</div></div>";
    applySlotBrand(el, value);
    bindCombo(el.querySelector(".cfp-combo"), seed);
  }

  function renderAdvanceSlot(el) {
    var id = el.getAttribute("data-slot");
    var entry = state.slots[id];
    var name = entry && entry.name ? entry.name : "";
    var seed = entry && entry.seed != null ? entry.seed : "";
    var badge = seed !== "" && seed != null ? seed + "." : "·";
    el.classList.toggle("is-clickable", Boolean(name));
    el.innerHTML =
      '<span class="cfp-seed-badge">' +
      escapeHtml(String(badge)) +
      "</span>" +
      logoHtml(name) +
      '<div class="cfp-slot-body"><span class="cfp-team-label' +
      (name ? "" : " is-empty") +
      '">' +
      (name ? escapeHtml(name) : "TBD") +
      "</span></div>";
    applySlotBrand(el, name);
  }

  function setSeedTeam(seed, teamName, opts) {
    if (state.readonly) return;
    opts = opts || {};
    var prev = state.teams[seed];
    if (teamName) state.teams[seed] = teamName;
    else delete state.teams[seed];

    var slotId = "seed" + seed;
    if (teamName) {
      state.slots[slotId] = { name: teamName, seed: seed };
    } else {
      delete state.slots[slotId];
    }

    if (prev !== teamName) {
      clearDownstreamFromSeed(seed);
      setStatus("");
    }

    if (!opts.skipRender) {
      refreshAdvanceSlots();
      refreshWinnerHighlights();
      refreshMatchupReady();
      refreshChampion();
      // Refresh other seed slots so duplicate teams disappear from their lists,
      // but keep the active field intact.
      $$(".cfp-slot[data-seed]").forEach(function (el) {
        var s = Number(el.getAttribute("data-seed"));
        if (s === seed && opts.keepFocus) {
          applySlotBrand(el, teamName);
          var logoHost = el.querySelector(".cfp-team-logo");
          var existingLogo = logoHtml(teamName);
          if (logoHost && existingLogo) {
            logoHost.outerHTML = existingLogo;
          } else if (!logoHost && existingLogo) {
            var badge = el.querySelector(".cfp-seed-badge");
            if (badge) badge.insertAdjacentHTML("afterend", existingLogo);
          } else if (logoHost && !existingLogo) {
            logoHost.remove();
          }
          refreshMatchupReady();
          return;
        }
        renderSeedSlot(el);
      });
    }
  }

  function refreshAdvanceSlots() {
    $$(".cfp-slot.cfp-advance").forEach(renderAdvanceSlot);
  }

  function refreshAllSlots() {
    $$(".cfp-slot[data-seed]").forEach(renderSeedSlot);
    refreshAdvanceSlots();
    refreshWinnerHighlights();
    refreshMatchupReady();
    refreshChampion();
  }

  function refreshWinnerHighlights() {
    $$(".cfp-slot").forEach(function (el) {
      el.classList.remove("is-winner");
    });
    Object.keys(state.picks).forEach(function (gameId) {
      var winSlot = state.picks[gameId];
      var el = $('.cfp-slot[data-slot="' + winSlot + '"]');
      if (el) el.classList.add("is-winner");
    });
  }

  function refreshMatchupReady() {
    $$(".cfp-pair[data-game]").forEach(function (pair) {
      var gameId = pair.getAttribute("data-game");
      var g = GAMES[gameId];
      if (!g) return;
      var ready = slotFilled(g.slots[0]) && slotFilled(g.slots[1]);
      pair.classList.toggle("is-ready", ready && !state.readonly);
      $$(".cfp-slot", pair).forEach(function (el) {
        var sid = el.getAttribute("data-slot");
        var canPick = ready && !state.readonly && sid && slotFilled(sid);
        el.classList.toggle("is-pickable", canPick);
        if (canPick) el.title = "Click to advance this team";
        else el.removeAttribute("title");
      });
    });
  }

  function refreshChampion() {
    var banner = $("championBanner");
    var nameEl = $("championName");
    var winSlot = state.picks.champ;
    if (!banner || !nameEl) return;
    if (winSlot && state.slots[winSlot] && state.slots[winSlot].name) {
      banner.hidden = false;
      nameEl.textContent = state.slots[winSlot].name;
    } else {
      banner.hidden = true;
      nameEl.textContent = "—";
      state.lastChampShown = null;
    }
  }

  function showChampCelebration(teamName) {
    if (!teamName || state.readonly) return;
    if (state.lastChampShown === teamName) return;
    state.lastChampShown = teamName;
    var modal = document.getElementById("champModal");
    var title = document.getElementById("champModalTitle");
    var logo = document.getElementById("champModalLogo");
    if (!modal || !title) return;
    title.textContent = teamName;
    var brand = lookupBrand(teamName);
    if (logo) {
      if (brand && brand.logo) {
        logo.src = brand.logo;
        logo.alt = teamName + " logo";
        logo.hidden = false;
      } else {
        logo.removeAttribute("src");
        logo.alt = "";
        logo.hidden = true;
      }
    }
    if (brand && brand.primary) {
      modal.style.setProperty("--champ-team-bg", brand.primary);
      modal.style.setProperty(
        "--champ-team-border",
        brand.secondary || brand.accent || brand.primary
      );
    } else {
      modal.style.removeProperty("--champ-team-bg");
      modal.style.removeProperty("--champ-team-border");
    }
    modal.hidden = false;
    document.body.classList.add("cfp-modal-open");
  }

  function hideChampCelebration() {
    var modal = document.getElementById("champModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("cfp-modal-open");
  }

  function bindChampModal() {
    var modal = document.getElementById("champModal");
    if (!modal) return;
    modal.addEventListener("click", function (e) {
      if (e.target.closest("[data-close-champ]")) hideChampCelebration();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) hideChampCelebration();
    });
  }

  function clearDownstreamFromSeed(seed) {
    var gamesToClear = [];
    if ([8, 9].indexOf(seed) !== -1) gamesToClear = ["frL1", "qfL1", "sfL", "champ"];
    else if ([5, 12].indexOf(seed) !== -1) gamesToClear = ["frL2", "qfL2", "sfL", "champ"];
    else if ([7, 10].indexOf(seed) !== -1) gamesToClear = ["frR1", "qfR1", "sfR", "champ"];
    else if ([6, 11].indexOf(seed) !== -1) gamesToClear = ["frR2", "qfR2", "sfR", "champ"];
    else if (seed === 1) gamesToClear = ["qfL1", "sfL", "champ"];
    else if (seed === 4) gamesToClear = ["qfL2", "sfL", "champ"];
    else if (seed === 2) gamesToClear = ["qfR1", "sfR", "champ"];
    else if (seed === 3) gamesToClear = ["qfR2", "sfR", "champ"];

    gamesToClear.forEach(function (g) {
      clearGameForward(g);
    });
  }

  function clearGameForward(gameId) {
    var g = GAMES[gameId];
    if (!g) return;
    delete state.picks[gameId];
    if (g.advancesTo) {
      delete state.slots[g.advancesTo];
    }
    (g.clears || []).forEach(function (next) {
      clearGameForward(next);
    });
  }

  function slotFilled(slotId) {
    return Boolean(state.slots[slotId] && state.slots[slotId].name);
  }

  function pickWinner(gameId, slotId) {
    if (state.readonly) return;
    var g = GAMES[gameId];
    if (!g) return;
    var a = g.slots[0];
    var b = g.slots[1];
    if (!slotFilled(a) || !slotFilled(b)) {
      setStatus("Fill both teams in this matchup first.");
      return;
    }
    if (slotId !== a && slotId !== b) return;

    state.picks[gameId] = slotId;
    var winner = state.slots[slotId];

    if (g.advancesTo) {
      state.slots[g.advancesTo] = {
        name: winner.name,
        seed: winner.seed,
      };
      // Changing this winner invalidates later rounds
      (g.clears || []).forEach(function (next) {
        clearGameForward(next);
      });
    }

    refreshAllSlots();
    if (gameId === "champ" && winner && winner.name) {
      showChampCelebration(winner.name);
      setStatus("National champion picked — save when you're ready.");
    } else {
      setStatus(g.advancesTo ? "Winner advanced. Keep picking through the bracket." : "");
    }
  }

  function bindCombo(combo, seed) {
    var input = $(".cfp-combo-input", combo);
    var list = $(".cfp-combo-list", combo);
    if (!input || !list) return;
    if (state.readonly) {
      input.readOnly = true;
      input.disabled = true;
      return;
    }
    var activeIndex = -1;

    function close() {
      list.hidden = true;
      list.innerHTML = "";
      activeIndex = -1;
    }

    function open(items) {
      if (!items.length) {
        list.innerHTML = '<li class="cfp-combo-empty">No matching teams</li>';
        list.hidden = false;
        return;
      }
      list.innerHTML = items
        .map(function (name, i) {
          return (
            '<li class="cfp-combo-option" role="option" data-i="' +
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
      $$(".cfp-combo-option", list).forEach(function (opt, i) {
        opt.classList.toggle("is-active", i === activeIndex);
      });
    }

    function currentItems() {
      return filterTeams(input.value, seed);
    }

    function commit(name) {
      input.value = name;
      setSeedTeam(seed, name, { keepFocus: true });
      close();
    }

    input.addEventListener("focus", function () {
      open(currentItems());
    });

    input.addEventListener("input", function () {
      // Keep typed letters visible; only clear committed seed if field emptied
      if (!input.value.trim()) {
        setSeedTeam(seed, "", { keepFocus: true });
      }
      open(currentItems());
    });

    input.addEventListener("keydown", function (e) {
      var items = currentItems();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.hidden) open(items);
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
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
          if (exact && !usedTeams(seed).has(exact.toLowerCase())) commit(exact);
        }
      } else if (e.key === "Escape") {
        close();
      }
    });

    list.addEventListener("mousedown", function (e) {
      var opt = e.target.closest(".cfp-combo-option");
      if (!opt) return;
      e.preventDefault();
      commit(opt.textContent);
    });

    input.addEventListener("blur", function () {
      setTimeout(function () {
        var exact = state.teamList.find(function (t) {
          return t.toLowerCase() === input.value.trim().toLowerCase();
        });
        if (exact && !usedTeams(seed).has(exact.toLowerCase())) {
          commit(exact);
        } else if (state.teams[seed]) {
          input.value = state.teams[seed];
        } else {
          input.value = "";
        }
        close();
      }, 120);
    });
  }

  function bindAdvanceClicks() {
    $$(".cfp-pair[data-game]").forEach(function (pair) {
      var gameId = pair.getAttribute("data-game");
      pair.addEventListener("click", function (e) {
        if (e.target.closest(".cfp-combo-list")) return;
        var slotEl = e.target.closest(".cfp-slot");
        if (!slotEl || !pair.contains(slotEl)) return;
        var slotId = slotEl.getAttribute("data-slot");
        if (!slotId) return;

        var g = GAMES[gameId];
        var ready = g && slotFilled(g.slots[0]) && slotFilled(g.slots[1]);
        var onInput = e.target.closest(".cfp-combo-input");

        // Matchup ready: single-click picks winner (including on the name field).
        // Double-click the seed input to edit the team instead.
        if (onInput) {
          if (!ready || state.readonly) return;
          if (e.detail >= 2) return;
          e.preventDefault();
          onInput.blur();
        }

        pickWinner(gameId, slotId);
      });
    });
  }

  async function save() {
    if (!isLoggedIn()) {
      window.location.href =
        "login.html?redirect=" + encodeURIComponent("CFPPredictions.html");
      return;
    }
    var missing = [];
    for (var i = 1; i <= 12; i += 1) {
      if (!state.teams[i] && !state.teams[String(i)]) missing.push(i);
    }
    if (missing.length) {
      setStatus("Pick all 12 seeds before saving (missing " + missing.join(", ") + ").");
      return;
    }
    setStatus("Saving…");
    var saveBtn = document.getElementById("saveBtn");
    if (saveBtn) saveBtn.disabled = true;
    try {
      var res = await fetch("/api/cfp/bracket/save", {
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json", Accept: "application/json" },
          authHeaders()
        ),
        body: JSON.stringify({
          season: SEASON,
          teams: state.teams,
          slots: state.slots,
          picks: state.picks,
        }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        setStatus(data.message || data.error || "Save failed.");
        return;
      }
      if (data.bracket) applyBracketData(data.bracket);
      refreshAllSlots();
      setStatus("Bracket saved to your account.");
      state.lbLoaded = false;
    } catch (_) {
      setStatus("Network error while saving.");
    } finally {
      if (saveBtn) saveBtn.disabled = !isLoggedIn() || state.readonly;
    }
  }

  async function loadMine() {
    if (!isLoggedIn()) {
      setStatus("Log in to save and load your bracket.");
      return;
    }
    try {
      var res = await fetch("/api/cfp/bracket?season=" + encodeURIComponent(SEASON), {
        headers: Object.assign({ Accept: "application/json" }, authHeaders()),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (res.status === 401) {
        setStatus("Log in to save and load your bracket.");
        return;
      }
      if (!res.ok) {
        setStatus(data.error || "Could not load bracket.");
        return;
      }
      if (data.bracket) {
        applyBracketData(data.bracket);
        setStatus("Loaded your saved bracket.");
      } else {
        setStatus("No saved bracket yet — pick teams and save.");
      }
    } catch (_) {
      setStatus("Network error loading bracket.");
    }
  }

  async function loadPublic(username) {
    setStatus("Loading…");
    try {
      var res = await fetch(
        "/api/cfp/bracket?season=" +
          encodeURIComponent(SEASON) +
          "&username=" +
          encodeURIComponent(username),
        { headers: { Accept: "application/json" } }
      );
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        setStatus(data.error || "Bracket not found.");
        return;
      }
      if (data.bracket) {
        applyBracketData(data.bracket);
        var label =
          (data.bracket.displayName || data.bracket.username || username) +
          "'s bracket";
        setReadonly(true, label);
        setStatus("");
      }
    } catch (_) {
      setStatus("Network error loading bracket.");
    }
  }

  async function resetAll() {
    if (state.readonly) return;
    if (!confirm("Reset the entire bracket?")) return;
    state.teams = {};
    state.slots = {};
    state.picks = {};
    state.lastChampShown = null;
    hideChampCelebration();
    refreshAllSlots();

    if (!isLoggedIn()) {
      setStatus("Bracket cleared. Log in to sync a save.");
      return;
    }
    setStatus("Deleting saved bracket…");
    try {
      var res = await fetch(
        "/api/cfp/bracket/save?season=" + encodeURIComponent(SEASON),
        {
          method: "DELETE",
          headers: Object.assign({ Accept: "application/json" }, authHeaders()),
        }
      );
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not delete saved bracket.");
        return;
      }
      setStatus("Bracket reset.");
      state.lbLoaded = false;
    } catch (_) {
      setStatus("Cleared locally; network error deleting save.");
    }
  }

  function switchTab(tab) {
    state.activeTab = tab === "leaderboard" ? "leaderboard" : "bracket";
    $$(".cfp-tab").forEach(function (btn) {
      var on = btn.getAttribute("data-tab") === state.activeTab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    var bracketPanel = document.getElementById("bracketPanel");
    var lbPanel = document.getElementById("leaderboardPanel");
    var actions = document.getElementById("bracketActions");
    if (bracketPanel) bracketPanel.hidden = state.activeTab !== "bracket";
    if (lbPanel) lbPanel.hidden = state.activeTab !== "leaderboard";
    if (actions) actions.hidden = state.activeTab !== "bracket" || state.readonly;
    if (state.activeTab === "leaderboard") loadLeaderboard();
  }

  async function loadLeaderboard() {
    var body = document.getElementById("lbBody");
    var empty = document.getElementById("lbEmpty");
    var hint = document.getElementById("lbHint");
    if (!body) return;
    if (state.lbLoaded && body.children.length) return;
    body.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
    if (empty) empty.hidden = true;
    try {
      var res = await fetch(
        "/api/cfp/leaderboard?season=" + encodeURIComponent(SEASON),
        { headers: { Accept: "application/json" } }
      );
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        body.innerHTML =
          '<tr><td colspan="6">' +
          escapeHtml(data.error || "Failed to load") +
          "</td></tr>";
        return;
      }
      if (hint && data.viewerHint) hint.textContent = data.viewerHint;
      var entries = data.entries || [];
      if (!entries.length) {
        body.innerHTML = "";
        if (empty) empty.hidden = false;
        state.lbLoaded = true;
        return;
      }
      if (empty) empty.hidden = true;
      body.innerHTML = entries
        .map(function (e) {
          var name = e.displayName || e.username || "Player";
          var acc =
            e.accuracy != null
              ? e.accuracy + "%"
              : e.gradedPicks
                ? "—"
                : "Ungraded";
          var score =
            e.gradedPicks > 0
              ? e.correctPicks + "/" + e.gradedPicks
              : e.isComplete
                ? "Complete"
                : "Saved";
          return (
            "<tr>" +
            "<td>" +
            escapeHtml(String(e.rank)) +
            "</td>" +
            "<td><a href=\"user-profile.html?username=" +
            encodeURIComponent(e.username) +
            '">' +
            escapeHtml(name) +
            "</a></td>" +
            "<td>" +
            escapeHtml(e.championName || "—") +
            "</td>" +
            "<td>" +
            escapeHtml(String(score)) +
            "</td>" +
            "<td>" +
            escapeHtml(String(acc)) +
            "</td>" +
            '<td><a href="CFPPredictions.html?username=' +
            encodeURIComponent(e.username) +
            '">View</a></td>' +
            "</tr>"
          );
        })
        .join("");
      state.lbLoaded = true;
    } catch (_) {
      body.innerHTML = '<tr><td colspan="6">Network error</td></tr>';
    }
  }

  function bindTabs() {
    $$(".cfp-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchTab(btn.getAttribute("data-tab"));
      });
    });
  }

  document.addEventListener("DOMContentLoaded", async function () {
    if (window.RecruitTeamBranding && window.RecruitTeamBranding.load) {
      await window.RecruitTeamBranding.load();
    }
    await loadTeamList();
    bindAdvanceClicks();
    bindChampModal();
    bindTabs();

    var saveBtn = document.getElementById("saveBtn");
    var resetBtn = document.getElementById("resetBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", save);
      saveBtn.disabled = !isLoggedIn();
    }
    if (resetBtn) resetBtn.addEventListener("click", resetAll);

    var viewUser = queryUsername();
    if (viewUser) {
      state.viewUsername = viewUser;
      var me = parseUser();
      if (me && String(me.username).toLowerCase() === String(viewUser).toLowerCase()) {
        setReadonly(false);
        await loadMine();
      } else {
        await loadPublic(viewUser);
      }
    } else {
      setReadonly(false);
      await loadMine();
    }

    refreshAllSlots();

    if (window.location.hash === "#leaderboard") {
      switchTab("leaderboard");
    }

    document.addEventListener("click", function (e) {
      if (!e.target.closest(".cfp-combo")) {
        $$(".cfp-combo-list").forEach(function (list) {
          list.hidden = true;
        });
      }
    });
  });
})();
