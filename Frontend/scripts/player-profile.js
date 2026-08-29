/**
 * Player profile UI — loads once from /api/player (server cache + CFBD).
 * URL: player.html?id={playerId}&team={school}&name={optional}
 */
(function () {
  "use strict";

  var SEASON_YEAR = 2026;

  var state = {
    playerId: null,
    team: "",
    name: "",
    bio: null,
    seasonOverview: null,
    career: [],
    showAllStats: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function qs() {
    return new URLSearchParams(window.location.search);
  }

  function pick(obj) {
    var keys = Array.prototype.slice.call(arguments, 1);
    if (!obj) return null;
    for (var i = 0; i < keys.length; i += 1) {
      if (obj[keys[i]] != null && obj[keys[i]] !== "") return obj[keys[i]];
    }
    return null;
  }

  function formatHeight(inches) {
    var n = Number(inches);
    if (!Number.isFinite(n) || n <= 0) return "—";
    var ft = Math.floor(n / 12);
    var inch = Math.round(n % 12);
    return ft + "'" + inch + '"';
  }

  function playerDisplayName(p) {
    if (!p) return state.name || "Player";
    if (p.name) return p.name;
    var first = p.firstName || "";
    var last = p.lastName || "";
    var full = (first + " " + last).trim();
    return full || state.name || "Player";
  }

  function setStatus(msg, isError) {
    var el = $("playerStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", Boolean(isError));
  }

  function playerPosition() {
    var bio = state.bio || {};
    var fromOverview = state.seasonOverview
      ? pick(state.seasonOverview, "position")
      : null;
    return String(bio.position || fromOverview || "").trim().toUpperCase();
  }

  /** Map roster position → CFBD box-score category names (lowercase). */
  function allowedCategoriesForPosition(pos) {
    var p = String(pos || "").toUpperCase();
    if (!p) return null; // unknown → show all

    if (["QB"].indexOf(p) !== -1) {
      return ["passing", "rushing", "fumbles"];
    }
    if (["RB", "FB", "HB", "TB"].indexOf(p) !== -1) {
      return ["rushing", "receiving", "fumbles"];
    }
    if (["WR", "TE"].indexOf(p) !== -1) {
      return ["receiving", "rushing", "fumbles"];
    }
    if (["OL", "OT", "OG", "C", "G", "T", "LS"].indexOf(p) !== -1) {
      return []; // no meaningful CFBD box categories
    }
    if (["DL", "DE", "DT", "NT", "EDGE"].indexOf(p) !== -1) {
      return ["defensive", "fumbles", "interceptions"];
    }
    if (["LB", "ILB", "OLB", "MLB"].indexOf(p) !== -1) {
      return ["defensive", "fumbles", "interceptions"];
    }
    if (["DB", "CB", "S", "SS", "FS", "SAF", "NB"].indexOf(p) !== -1) {
      return ["defensive", "interceptions", "fumbles"];
    }
    if (["K", "PK", "FG"].indexOf(p) !== -1) {
      return ["kicking", "kickReturns", "kick returns"];
    }
    if (["P"].indexOf(p) !== -1) {
      return ["punting", "puntReturns", "punt returns"];
    }
    if (["ATH"].indexOf(p) !== -1) {
      return null; // multi-threat — show all non-empty
    }
    return null;
  }

  function categoryKey(cat) {
    return String((cat && cat.name) || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, " ");
  }

  function categoryHasSignal(cat) {
    var stats = Array.isArray(cat && cat.stats) ? cat.stats : [];
    return stats.some(function (s) {
      var v = s && s.value;
      if (v == null || v === "" || v === "—") return false;
      var n = Number(String(v).replace(/[%+,]/g, ""));
      if (Number.isFinite(n)) return n !== 0;
      return String(v).trim() !== "0" && String(v).trim() !== "0.0";
    });
  }

  function relevantCategories(overview, opts) {
    opts = opts || {};
    var cats = categoriesFrom(overview);
    var allowed = state.showAllStats
      ? null
      : allowedCategoriesForPosition(playerPosition());

    if (allowed && allowed.length === 0) {
      return [];
    }

    var filtered = cats.filter(function (cat) {
      var key = categoryKey(cat);
      if (allowed) {
        var ok = allowed.some(function (a) {
          return key === a || key.indexOf(a) !== -1 || a.indexOf(key) !== -1;
        });
        if (!ok) return false;
      }
      if (opts.requireSignal !== false && !categoryHasSignal(cat)) return false;
      return true;
    });

    // Prefer primary categories first
    var order = allowed || [
      "passing",
      "rushing",
      "receiving",
      "defensive",
      "interceptions",
      "kicking",
      "punting",
      "fumbles",
    ];
    filtered.sort(function (a, b) {
      var ka = categoryKey(a);
      var kb = categoryKey(b);
      var ia = order.findIndex(function (o) {
        return ka.indexOf(o) !== -1;
      });
      var ib = order.findIndex(function (o) {
        return kb.indexOf(o) !== -1;
      });
      if (ia === -1) ia = 99;
      if (ib === -1) ib = 99;
      return ia - ib || ka.localeCompare(kb);
    });

    return filtered;
  }

  function headlinePrefsForPosition(pos) {
    var p = String(pos || "").toUpperCase();
    if (["QB"].indexOf(p) !== -1) {
      return [
        { cat: "passing", stats: ["YDS", "TD", "COMP", "ATT", "INT", "PCT"] },
        { cat: "rushing", stats: ["YDS", "TD", "CAR"] },
      ];
    }
    if (["RB", "FB", "HB", "TB"].indexOf(p) !== -1) {
      return [
        { cat: "rushing", stats: ["YDS", "TD", "CAR", "YPC", "LONG"] },
        { cat: "receiving", stats: ["REC", "YDS", "TD"] },
      ];
    }
    if (["WR", "TE"].indexOf(p) !== -1) {
      return [
        { cat: "receiving", stats: ["REC", "YDS", "TD", "YPR", "LONG"] },
        { cat: "rushing", stats: ["CAR", "YDS", "TD"] },
      ];
    }
    if (
      ["DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "DB", "CB", "S", "SS", "FS", "SAF", "NB"].indexOf(
        p
      ) !== -1
    ) {
      return [
        { cat: "defensive", stats: ["TOT", "SOLO", "TFL", "SACKS", "PD", "TD"] },
        { cat: "interceptions", stats: ["INT", "YDS", "TD"] },
      ];
    }
    if (["K", "PK", "FG"].indexOf(p) !== -1) {
      return [{ cat: "kicking", stats: ["FGM", "FGA", "XPM", "XPA", "PTS", "LONG"] }];
    }
    if (["P"].indexOf(p) !== -1) {
      return [{ cat: "punting", stats: ["PUNTS", "YDS", "AVG", "LONG"] }];
    }
    return [
      { cat: "passing", stats: ["YDS", "TD"] },
      { cat: "rushing", stats: ["YDS", "TD", "CAR"] },
      { cat: "receiving", stats: ["REC", "YDS", "TD"] },
      { cat: "defensive", stats: ["TOT", "SACKS"] },
    ];
  }

  function categoriesFrom(overview) {
    if (!overview) return [];
    var box = pick(overview, "boxScoreStats", "box_score_stats") || {};
    var cats = pick(box, "categories") || [];
    return Array.isArray(cats) ? cats : [];
  }

  function hasUsefulStats(overview) {
    if (!overview) return false;
    if (relevantCategories(overview).length > 0) return true;
    if (overview.games != null && Number(overview.games) > 0) {
      // Has games but no relevant cats yet (e.g. OL) — still "useful" season marker
      var allowed = allowedCategoriesForPosition(playerPosition());
      return allowed === null || (allowed && allowed.length === 0);
    }
    return false;
  }

  function careerRowsToShow() {
    return (state.career || []).filter(function (row) {
      if (!row || !row.data) return false;
      if (row.data._usageOnly) return false;
      var cats = relevantCategories(row.data);
      if (cats.length) return true;
      var g = pick(row.data, "games");
      return g != null && Number(g) > 0 && relevantCategories(row.data, { requireSignal: false }).length > 0;
    });
  }

  function parseParams() {
    var p = qs();
    state.playerId = p.get("id") || p.get("playerId") || null;
    state.team = p.get("team") || "";
    state.name = p.get("name") || "";
  }

  async function loadProfile() {
    var url = new URL("/api/player", window.location.origin);
    url.searchParams.set("id", String(state.playerId));
    if (state.team) url.searchParams.set("team", state.team);
    if (state.name) url.searchParams.set("name", state.name);

    var resp = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    var body = await resp.json().catch(function () {
      return {};
    });
    if (!resp.ok) {
      var err = new Error(body.error || body.message || "Failed to load player");
      err.details = body.details;
      throw err;
    }
    return body;
  }

  function renderHeader() {
    var bio = state.bio || {};
    var name = playerDisplayName(bio);
    document.title = name + " · Player Profile";
    $("playerName").textContent = name;

    var pos = playerPosition();
    var metaEl = $("playerMeta");
    if (metaEl) {
      var parts = [];
      if (pos) {
        parts.push(
          '<span class="player-pos-badge">' + escapeHtml(pos) + "</span>"
        );
      }
      if (bio.jersey != null) parts.push("#" + escapeHtml(String(bio.jersey)));
      if (bio.team || state.team) {
        parts.push(escapeHtml(bio.team || state.team));
      }
      if (bio.year != null && bio.year !== "") {
        parts.push("Class " + escapeHtml(String(bio.year)));
      }
      metaEl.innerHTML = parts.join('<span class="player-meta-sep">·</span>');
    }

    var details = [];
    details.push(
      "<span><strong>Height</strong> " + escapeHtml(formatHeight(bio.height)) + "</span>"
    );
    details.push(
      "<span><strong>Weight</strong> " +
        escapeHtml(bio.weight != null ? bio.weight + " lbs" : "—") +
        "</span>"
    );
    var hometown = [bio.homeCity || bio.hometown, bio.homeState]
      .filter(Boolean)
      .join(", ");
    if (!hometown && bio.hometown) hometown = bio.hometown;
    details.push(
      "<span><strong>Hometown</strong> " + escapeHtml(hometown || "—") + "</span>"
    );
    $("playerDetails").innerHTML = details.join("");

    var back = $("backToTeam");
    if (back) {
      if (state.team) {
        back.href = "team.html?name=" + encodeURIComponent(state.team);
        back.hidden = false;
        back.textContent = "← " + state.team;
      } else {
        back.hidden = true;
      }
    }

    var seasonLabel = $("seasonYearLabel");
    if (seasonLabel) seasonLabel.textContent = String(SEASON_YEAR);

    var toggle = $("statsScopeToggle");
    if (toggle) {
      toggle.hidden = !playerPosition();
      toggle.textContent = state.showAllStats
        ? "Show position stats only"
        : "Show all stat categories";
    }
  }

  function renderStatCards(cats, emptyMsg) {
    if (!cats.length) {
      return '<p class="player-empty">' + escapeHtml(emptyMsg) + "</p>";
    }
    return cats
      .map(function (cat) {
        var stats = Array.isArray(cat.stats) ? cat.stats : [];
        var rows = stats
          .map(function (s) {
            return (
              "<tr><th>" +
              escapeHtml(s.name || "Stat") +
              "</th><td>" +
              escapeHtml(s.value != null ? s.value : "—") +
              "</td></tr>"
            );
          })
          .join("");
        return (
          '<article class="player-stat-card">' +
          "<h3>" +
          escapeHtml(cat.name || "Stats") +
          "</h3>" +
          '<table class="player-stat-table"><tbody>' +
          rows +
          "</tbody></table>" +
          "</article>"
        );
      })
      .join("");
  }

  function renderCategories(overview, hostId, emptyMsg) {
    var host = $(hostId);
    if (!host) return;
    var cats = relevantCategories(overview);
    var allowed = allowedCategoriesForPosition(playerPosition());
    if (allowed && allowed.length === 0 && !state.showAllStats) {
      host.innerHTML =
        '<p class="player-empty">Box-score categories aren’t tracked for ' +
        escapeHtml(playerPosition() || "this position") +
        ".</p>";
      return;
    }
    host.innerHTML = renderStatCards(
      cats,
      emptyMsg || "No relevant stats for this position."
    );
  }

  function renderSeasonPanel() {
    var overview = state.seasonOverview;
    var gamesEl = $("seasonGames");
    var teamEl = $("seasonTeamLine");
    var emptyWrap = $("seasonEmpty");
    var grid = $("seasonStats");

    if (!overview || !hasUsefulStats(overview)) {
      if (teamEl) teamEl.textContent = state.team || "";
      if (gamesEl) gamesEl.textContent = "";
      if (emptyWrap) {
        emptyWrap.hidden = false;
        emptyWrap.textContent =
          "No " +
          SEASON_YEAR +
          " " +
          (playerPosition() ? playerPosition() + " " : "") +
          "stats yet — see Career below for prior seasons.";
      }
      if (grid) grid.innerHTML = "";
      return;
    }
    if (emptyWrap) emptyWrap.hidden = true;
    if (teamEl) {
      var bits = [];
      if (pick(overview, "team")) bits.push(pick(overview, "team"));
      if (pick(overview, "conference")) bits.push(pick(overview, "conference"));
      if (playerPosition()) bits.push(playerPosition());
      teamEl.textContent = bits.join(" · ");
    }
    if (gamesEl) {
      var g = pick(overview, "games");
      gamesEl.textContent = g != null ? g + " games" : "";
    }
    renderCategories(
      overview,
      "seasonStats",
      "No " + (playerPosition() || "") + " box-score stats for " + SEASON_YEAR + "."
    );
  }

  function headlineStats(overview) {
    var cats = relevantCategories(overview, { requireSignal: true });
    var prefs = headlinePrefsForPosition(playerPosition());
    var found = [];
    var seen = {};

    function pushStat(catName, s, labelPrefix) {
      if (!s || found.length >= 5) return;
      var label = (labelPrefix ? labelPrefix + " " : "") + (s.name || "Stat");
      var key = label + ":" + String(s.value);
      if (seen[key]) return;
      seen[key] = true;
      found.push({ label: label, value: s.value });
    }

    prefs.forEach(function (pref) {
      var cat = cats.find(function (c) {
        return categoryKey(c).indexOf(pref.cat) !== -1;
      });
      if (!cat) return;
      var prefix =
        pref.cat === "rushing"
          ? "Rush"
          : pref.cat === "receiving"
            ? "Rec"
            : pref.cat === "passing"
              ? "Pass"
              : pref.cat === "defensive"
                ? "Def"
                : "";
      (pref.stats || []).forEach(function (want) {
        var hit = (cat.stats || []).find(function (s) {
          var n = String(s.name || "").toUpperCase();
          return n === want || n.indexOf(want) !== -1;
        });
        if (hit && categoryHasSignal({ stats: [hit] })) {
          var usePrefix = want === "YDS" || want === "TD" || want === "ATT";
          pushStat(cat.name, hit, usePrefix ? prefix : "");
        }
      });
    });

    return found;
  }

  function renderCareer() {
    var host = $("careerBody");
    var empty = $("careerEmpty");
    var detailsHost = $("careerDetails");
    if (!host) return;

    var rows = careerRowsToShow();
    if (!rows.length) {
      host.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        empty.textContent = state.showAllStats
          ? "No prior seasons found in CFBD for this player yet."
          : "No prior " +
            (playerPosition() || "position") +
            " seasons with stats yet.";
      }
      if (detailsHost) detailsHost.innerHTML = "";
      return;
    }
    if (empty) empty.hidden = true;

    host.innerHTML = rows
      .map(function (row) {
        var o = row.data;
        var head = headlineStats(o);
        var headHtml = head.length
          ? head
              .map(function (h) {
                return (
                  '<span class="player-chip"><strong>' +
                  escapeHtml(String(h.value)) +
                  "</strong> " +
                  escapeHtml(h.label) +
                  "</span>"
                );
              })
              .join("")
          : '<span class="player-chip muted">See details</span>';
        var team = pick(o, "team") || state.team || "—";
        var games = pick(o, "games");
        return (
          "<tr>" +
          "<td><strong>" +
          row.year +
          "</strong></td>" +
          "<td>" +
          escapeHtml(team) +
          "</td>" +
          "<td>" +
          escapeHtml(games != null ? String(games) : "—") +
          "</td>" +
          '<td class="player-career-chips">' +
          headHtml +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    if (detailsHost) {
      detailsHost.innerHTML = rows
        .map(function (row) {
          var o = row.data;
          var team = pick(o, "team") || state.team || "";
          var games = pick(o, "games");
          var sub = [team, games != null ? games + " games" : ""]
            .filter(Boolean)
            .join(" · ");
          var cats = relevantCategories(o);
          return (
            '<details class="player-career-year"' +
            (row.year === rows[0].year ? " open" : "") +
            ">" +
            '<summary class="player-career-year-title">' +
            row.year +
            (sub ? " <span>" + escapeHtml(sub) + "</span>" : "") +
            "</summary>" +
            '<div class="player-stat-grid">' +
            renderStatCards(
              cats,
              "No " +
                (playerPosition() || "") +
                " box-score breakdown for this season."
            ) +
            "</div></details>"
          );
        })
        .join("");
    }
  }

  function rerenderStats() {
    renderHeader();
    renderSeasonPanel();
    renderCareer();
  }

  async function init() {
    parseParams();

    if (!state.playerId) {
      setStatus("Missing player id. Open a player from a team roster.", true);
      $("playerName").textContent = "Player not found";
      return;
    }

    setStatus("Loading player…");
    try {
      var data = await loadProfile();
      state.bio = data.bio || {};
      state.team = data.team || state.team;
      state.name = data.name || state.name;
      state.seasonOverview = data.seasonOverview || null;
      state.career = Array.isArray(data.career) ? data.career : [];
      if (data.seasonYear) SEASON_YEAR = Number(data.seasonYear) || SEASON_YEAR;

      renderHeader();
      renderSeasonPanel();
      renderCareer();

      var toggle = $("statsScopeToggle");
      if (toggle && !toggle.dataset.bound) {
        toggle.dataset.bound = "1";
        toggle.addEventListener("click", function () {
          state.showAllStats = !state.showAllStats;
          rerenderStats();
        });
      }

      var cache = data.cache || {};
      if (cache.hit) {
        setStatus("Loaded from cache (" + (cache.source || "server") + ").");
        setTimeout(function () {
          setStatus("");
        }, 1800);
      } else {
        setStatus("");
      }
    } catch (err) {
      setStatus(
        (err.message || "Failed to load player") +
          (err.details ? " — " + err.details : ""),
        true
      );
      renderHeader();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
