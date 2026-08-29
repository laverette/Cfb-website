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

  function categoriesFrom(overview) {
    if (!overview) return [];
    var box = pick(overview, "boxScoreStats", "box_score_stats") || {};
    var cats = pick(box, "categories") || [];
    return Array.isArray(cats) ? cats : [];
  }

  function hasUsefulStats(overview) {
    if (!overview) return false;
    if (overview.games != null && Number(overview.games) > 0) return true;
    return categoriesFrom(overview).some(function (c) {
      return Array.isArray(c.stats) && c.stats.length > 0;
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

    var meta = [];
    if (bio.position) meta.push(bio.position);
    if (bio.jersey != null) meta.push("#" + bio.jersey);
    if (bio.team || state.team) meta.push(bio.team || state.team);
    if (bio.year != null && bio.year !== "") meta.push("Class: " + bio.year);
    $("playerMeta").textContent = meta.join(" · ") || "College football player";

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
    details.push(
      "<span><strong>ID</strong> " + escapeHtml(String(state.playerId || "—")) + "</span>"
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
    if (!overview || !hasUsefulStats(overview)) {
      if (teamEl) teamEl.textContent = state.team || "";
      if (gamesEl) gamesEl.textContent = "";
      renderCategories(
        null,
        "seasonStats",
        "No " + SEASON_YEAR + " stats yet — check Career for prior seasons."
      );
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
    renderCategories(overview, "seasonStats", "No box-score stats for " + SEASON_YEAR + ".");
  }

  function headlineStats(overview) {
    var cats = categoriesFrom(overview);
    var want = ["YDS", "TD", "REC", "CAR", "COMP", "ATT", "INT", "TOT", "SACKS", "FG"];
    var found = [];
    cats.forEach(function (cat) {
      (cat.stats || []).forEach(function (s) {
        var n = String(s.name || "").toUpperCase();
        if (
          want.some(function (w) {
            return n === w || n.includes(w);
          }) &&
          found.length < 6
        ) {
          found.push({ label: s.name, value: s.value });
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

    if (!state.career.length) {
      host.innerHTML = "";
      if (empty) empty.hidden = false;
      if (detailsHost) detailsHost.innerHTML = "";
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
          : '<span class="player-chip muted">Played</span>';
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
      detailsHost.innerHTML = state.career
        .filter(function (row) {
          return hasUsefulStats(row.data) && !(row.data && row.data._usageOnly);
        })
        .map(function (row) {
          var o = row.data;
          var team = pick(o, "team") || state.team || "";
          var games = pick(o, "games");
          var sub = [team, games != null ? games + " games" : ""].filter(Boolean).join(" · ");
          var cats = categoriesFrom(o);
          var cards = cats
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
          return (
            '<div class="player-career-year">' +
            '<h3 class="player-career-year-title">' +
            row.year +
            (sub ? " <span>" + escapeHtml(sub) + "</span>" : "") +
            "</h3>" +
            '<div class="player-stat-grid">' +
            (cards || '<p class="player-empty">No box-score breakdown.</p>') +
            "</div></div>"
          );
        })
        .join("");
    }
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
