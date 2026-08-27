/**
 * Player profile — bio + season / career stats via CFBD proxy.
 * URL: player.html?id={playerId}&team={school}&year={season}&name={optional}
 */
(function () {
  "use strict";

  var CAREER_YEARS_BACK = 6;
  var CURRENT_YEAR = new Date().getFullYear();

  var state = {
    playerId: null,
    team: "",
    name: "",
    year: CURRENT_YEAR,
    bio: null,
    seasonOverview: null,
    career: [],
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

  async function cfbd(path, params) {
    var url = new URL("/.netlify/functions/cfbd", window.location.origin);
    url.searchParams.set("path", path);
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === "") return;
      url.searchParams.set(k, String(v));
    });
    var resp = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    var body = await resp.json().catch(function () {
      return null;
    });
    if (!resp.ok) {
      var err = new Error(
        (body && (body.error || body.message)) || "CFBD error (" + resp.status + ")"
      );
      err.status = resp.status;
      throw err;
    }
    return body;
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

  function parseParams() {
    var p = qs();
    state.playerId = p.get("id") || p.get("playerId") || null;
    state.team = p.get("team") || "";
    state.name = p.get("name") || "";
    var y = Number(p.get("year") || p.get("season") || CURRENT_YEAR);
    state.year = Number.isFinite(y) && y >= 2000 ? y : CURRENT_YEAR;
  }

  async function loadBio() {
    var fromRoster = null;
    if (state.team) {
      try {
        var roster = await cfbd("/roster", { team: state.team, year: state.year });
        var arr = Array.isArray(roster) ? roster : [];
        fromRoster = arr.find(function (r) {
          return String(r.id) === String(state.playerId);
        });
        if (!fromRoster && state.name) {
          var needle = state.name.toLowerCase();
          fromRoster = arr.find(function (r) {
            var n = ((r.firstName || "") + " " + (r.lastName || "")).trim().toLowerCase();
            return n === needle || n.includes(needle);
          });
        }
      } catch (_) {}
    }

    var fromSearch = null;
    var searchTerm = state.name || (fromRoster
      ? ((fromRoster.firstName || "") + " " + (fromRoster.lastName || "")).trim()
      : "");
    if (searchTerm) {
      try {
        var hits = await cfbd("/player/search", {
          searchTerm: searchTerm,
          team: state.team || undefined,
          year: state.year,
        });
        if (Array.isArray(hits) && hits.length) {
          fromSearch =
            hits.find(function (h) {
              return String(h.id) === String(state.playerId);
            }) || hits[0];
          if (!state.playerId && fromSearch && fromSearch.id != null) {
            state.playerId = String(fromSearch.id);
          }
        }
      } catch (_) {}
    }

    state.bio = Object.assign({}, fromSearch || {}, fromRoster || {});
    if (!state.bio.id && state.playerId) state.bio.id = state.playerId;
    if (!state.team && state.bio.team) state.team = state.bio.team;
    if (!state.name) state.name = playerDisplayName(state.bio);
  }

  async function loadSeasonOverview(year) {
    if (!state.playerId) return null;
    try {
      return await cfbd("/player/season/overview", {
        year: year,
        playerId: state.playerId,
      });
    } catch (e1) {
      try {
        return await cfbd("/player/season/overview", {
          year: year,
          player_id: state.playerId,
        });
      } catch (_) {
        return null;
      }
    }
  }

  /** Fallback: long-format /stats/player/season filtered by playerId */
  async function loadSeasonStatsFallback(year) {
    if (!state.team || !state.playerId) return null;
    try {
      var rows = await cfbd("/stats/player/season", {
        year: year,
        team: state.team,
        seasonType: "both",
      });
      if (!Array.isArray(rows)) return null;
      var mine = rows.filter(function (r) {
        return (
          String(r.playerId) === String(state.playerId) ||
          String(r.athleteId) === String(state.playerId) ||
          String(r.athlete_id) === String(state.playerId)
        );
      });
      if (!mine.length) return null;
      var byCat = {};
      mine.forEach(function (r) {
        var cat = r.category || "Stats";
        if (!byCat[cat]) byCat[cat] = [];
        byCat[cat].push({
          name: r.statType || r.stat_type || "stat",
          value: r.stat != null ? String(r.stat) : "—",
        });
      });
      return {
        season: year,
        id: String(state.playerId),
        name: playerDisplayName(state.bio),
        position: state.bio && state.bio.position,
        team: state.team,
        games: null,
        boxScoreStats: {
          categories: Object.keys(byCat).map(function (name) {
            return { name: name, stats: byCat[name] };
          }),
        },
        _fallback: true,
      };
    } catch (_) {
      return null;
    }
  }

  async function loadSeason(year) {
    var overview = await loadSeasonOverview(year);
    if (!overview) overview = await loadSeasonStatsFallback(year);
    return overview;
  }

  async function loadCareer() {
    var years = [];
    for (var y = state.year; y >= state.year - CAREER_YEARS_BACK; y -= 1) {
      years.push(y);
    }
    var results = await Promise.all(
      years.map(function (y) {
        return loadSeason(y).then(function (data) {
          return { year: y, data: data };
        });
      })
    );
    state.career = results.filter(function (r) {
      return r.data && hasUsefulStats(r.data);
    });
  }

  function hasUsefulStats(overview) {
    if (!overview) return false;
    if (overview.games != null && Number(overview.games) > 0) return true;
    var cats = categoriesFrom(overview);
    return cats.some(function (c) {
      return Array.isArray(c.stats) && c.stats.length > 0;
    });
  }

  function categoriesFrom(overview) {
    if (!overview) return [];
    var box = pick(overview, "boxScoreStats", "box_score_stats") || {};
    var cats = pick(box, "categories") || [];
    return Array.isArray(cats) ? cats : [];
  }

  function renderHeader() {
    var bio = state.bio || {};
    var name = playerDisplayName(bio);
    document.title = name + " · Player Profile";
    $("playerName").textContent = name;

    var meta = [];
    if (bio.position) meta.push(bio.position);
    if (bio.jersey != null) meta.push("#" + bio.jersey);
    if (bio.team || state.team) meta.push(bio.team || state.team);
    if (bio.year != null && bio.year !== "") meta.push("Class: " + bio.year);
    $("playerMeta").textContent = meta.join(" · ") || "College football player";

    var details = [];
    details.push("<span><strong>Height</strong> " + escapeHtml(formatHeight(bio.height)) + "</span>");
    details.push(
      "<span><strong>Weight</strong> " +
        escapeHtml(bio.weight != null ? bio.weight + " lbs" : "—") +
        "</span>"
    );
    var hometown = [bio.homeCity || bio.hometown, bio.homeState]
      .filter(Boolean)
      .join(", ");
    if (!hometown && bio.hometown) hometown = bio.hometown;
    details.push("<span><strong>Hometown</strong> " + escapeHtml(hometown || "—") + "</span>");
    details.push("<span><strong>ID</strong> " + escapeHtml(String(state.playerId || "—")) + "</span>");
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
  }

  function renderSeasonSelect() {
    var sel = $("seasonSelect");
    if (!sel) return;
    var years = [];
    for (var y = CURRENT_YEAR; y >= CURRENT_YEAR - CAREER_YEARS_BACK - 1; y -= 1) {
      years.push(y);
    }
    sel.innerHTML = years
      .map(function (y) {
        return (
          '<option value="' +
          y +
          '"' +
          (y === state.year ? " selected" : "") +
          ">" +
          y +
          "</option>"
        );
      })
      .join("");
  }

  function renderCategories(overview, hostId, emptyMsg) {
    var host = $(hostId);
    if (!host) return;
    var cats = categoriesFrom(overview);
    if (!cats.length) {
      host.innerHTML = '<p class="player-empty">' + escapeHtml(emptyMsg) + "</p>";
      return;
    }
    host.innerHTML = cats
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

  function renderSeasonPanel() {
    var overview = state.seasonOverview;
    var gamesEl = $("seasonGames");
    var teamEl = $("seasonTeamLine");
    if (!overview) {
      if (teamEl) teamEl.textContent = "";
      if (gamesEl) gamesEl.textContent = "";
      renderCategories(null, "seasonStats", "No season stats found for " + state.year + ".");
      return;
    }
    if (teamEl) {
      var bits = [];
      if (pick(overview, "team")) bits.push(pick(overview, "team"));
      if (pick(overview, "conference")) bits.push(pick(overview, "conference"));
      if (pick(overview, "position")) bits.push(pick(overview, "position"));
      teamEl.textContent = bits.join(" · ");
    }
    if (gamesEl) {
      var g = pick(overview, "games");
      gamesEl.textContent = g != null ? g + " games" : "";
    }
    renderCategories(
      overview,
      "seasonStats",
      "No box-score stats for " + state.year + "."
    );
  }

  function headlineStats(overview) {
    var cats = categoriesFrom(overview);
    var want = ["YDS", "TD", "REC", "CAR", "COMP", "ATT", "INT", "TOT", "SACKS", "FG"];
    var found = [];
    cats.forEach(function (cat) {
      (cat.stats || []).forEach(function (s) {
        var n = String(s.name || "").toUpperCase();
        if (want.some(function (w) { return n === w || n.includes(w); }) && found.length < 4) {
          found.push({ label: s.name, value: s.value });
        }
      });
    });
    return found;
  }

  function renderCareer() {
    var host = $("careerBody");
    var empty = $("careerEmpty");
    if (!host) return;
    if (!state.career.length) {
      host.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    host.innerHTML = state.career
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
          : '<span class="player-chip muted">Stats available</span>';
        var team = pick(o, "team") || state.team || "—";
        var games = pick(o, "games");
        return (
          "<tr>" +
          "<td><button type=\"button\" class=\"player-year-btn\" data-year=\"" +
          row.year +
          '">' +
          row.year +
          "</button></td>" +
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

    host.querySelectorAll(".player-year-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var y = Number(btn.getAttribute("data-year"));
        if (!Number.isFinite(y)) return;
        selectYear(y);
      });
    });
  }

  async function selectYear(year) {
    state.year = year;
    var sel = $("seasonSelect");
    if (sel) sel.value = String(year);
    var url = new URL(window.location.href);
    url.searchParams.set("year", String(year));
    if (state.playerId) url.searchParams.set("id", String(state.playerId));
    if (state.team) url.searchParams.set("team", state.team);
    if (state.name) url.searchParams.set("name", state.name);
    window.history.replaceState({}, "", url.toString());

    setStatus("Loading " + year + " stats…");
    state.seasonOverview = await loadSeason(year);
    renderSeasonPanel();
    setStatus("");
  }

  async function init() {
    parseParams();
    renderSeasonSelect();

    if (!state.playerId && !state.name) {
      setStatus("Missing player id. Open a player from a team roster.", true);
      $("playerName").textContent = "Player not found";
      return;
    }

    setStatus("Loading player…");
    try {
      await loadBio();
      if (!state.playerId) {
        setStatus("Could not resolve player id.", true);
        renderHeader();
        return;
      }
      renderHeader();
      state.seasonOverview = await loadSeason(state.year);
      renderSeasonPanel();
      setStatus("Loading career…");
      await loadCareer();
      renderCareer();
      setStatus("");
    } catch (err) {
      setStatus(err.message || "Failed to load player", true);
      renderHeader();
    }

    var sel = $("seasonSelect");
    if (sel) {
      sel.addEventListener("change", function () {
        selectYear(Number(sel.value));
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
