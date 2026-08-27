/**
 * CFP Bracket Picker — official 12-team layout with searchable seed comboboxes.
 * First Round: 8/9, 5/12 (left) · 7/10, 6/11 (right)
 * Quarters: 1 & 4 (left byes) · 2 & 3 (right byes)
 */
(function () {
  "use strict";

  var STORAGE_KEY = "cfpBracket2026";

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
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function setStatus(msg) {
    var el = $("statusLine");
    if (el) el.textContent = msg || "";
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

  function renderSeedSlot(el) {
    var seed = Number(el.getAttribute("data-seed"));
    var value = state.teams[seed] || "";
    el.innerHTML =
      '<span class="cfp-seed-badge">' +
      seed +
      '.</span><div class="cfp-slot-body"><div class="cfp-combo" data-seed="' +
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
      '</span><div class="cfp-slot-body"><span class="cfp-team-label' +
      (name ? "" : " is-empty") +
      '">' +
      (name ? escapeHtml(name) : "TBD") +
      "</span></div>";
  }

  function setSeedTeam(seed, teamName, opts) {
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
      refreshChampion();
      // Refresh other seed slots so duplicate teams disappear from their lists,
      // but keep the active field intact.
      $$(".cfp-slot[data-seed]").forEach(function (el) {
        var s = Number(el.getAttribute("data-seed"));
        if (s === seed && opts.keepFocus) return;
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
    }
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
    setStatus("");
  }

  function bindCombo(combo, seed) {
    var input = $(".cfp-combo-input", combo);
    var list = $(".cfp-combo-list", combo);
    if (!input || !list) return;
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
        if (e.target.closest(".cfp-combo")) return;
        var slotEl = e.target.closest(".cfp-slot");
        if (!slotEl || !pair.contains(slotEl)) return;
        var slotId = slotEl.getAttribute("data-slot");
        if (!slotId) return;
        // Seed slots in a pair: clicking picks that seed as winner of the pair
        pickWinner(gameId, slotId);
      });
    });
  }

  function save() {
    var payload = {
      teams: state.teams,
      slots: state.slots,
      picks: state.picks,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    setStatus("Bracket saved.");
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      state.teams = data.teams || {};
      state.slots = data.slots || {};
      state.picks = data.picks || {};
      // Ensure seed slots mirror teams
      Object.keys(state.teams).forEach(function (k) {
        state.slots["seed" + k] = { name: state.teams[k], seed: Number(k) };
      });
    } catch (_) {}
  }

  function resetAll() {
    if (!confirm("Reset the entire bracket?")) return;
    state.teams = {};
    state.slots = {};
    state.picks = {};
    localStorage.removeItem(STORAGE_KEY);
    refreshAllSlots();
    setStatus("Bracket reset.");
  }

  document.addEventListener("DOMContentLoaded", async function () {
    await loadTeamList();
    load();
    refreshAllSlots();
    bindAdvanceClicks();
    $("saveBtn").addEventListener("click", save);
    $("resetBtn").addEventListener("click", resetAll);

    document.addEventListener("click", function (e) {
      if (!e.target.closest(".cfp-combo")) {
        $$(".cfp-combo-list").forEach(function (list) {
          list.hidden = true;
        });
      }
    });
  });
})();
