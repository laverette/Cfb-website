/**
 * Heisman odds board + ballot (cast / optional lock / crowd %).
 */
(function () {
  "use strict";

  var STORAGE_TOKEN = "authToken";
  var STORAGE_USER = "currentUser";
  var seasonYear = 2026;

  var state = {
    candidates: [],
    myPick: null,
    community: null,
    result: null,
    prophets: [],
    selectedKey: null,
    filter: "",
    boardMeta: null,
    brandingReady: false,
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

  function authHeaders() {
    var token = localStorage.getItem(STORAGE_TOKEN);
    if (!token) return {};
    return { Authorization: "Bearer " + token };
  }

  function isLoggedIn() {
    return !!(localStorage.getItem(STORAGE_TOKEN) && localStorage.getItem(STORAGE_USER));
  }

  function setStatus(msg, isError) {
    var el = $("statusLine");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", Boolean(isError));
  }

  function loginHref() {
    return "login.html?redirect=" + encodeURIComponent("list.html");
  }

  async function ensureBranding() {
    if (state.brandingReady) return;
    if (window.RecruitTeamBranding) {
      await RecruitTeamBranding.load();
    }
    state.brandingReady = true;
  }

  function teamBrandFor(candidate) {
    var c = candidate || {};
    var brand = null;
    if (window.RecruitTeamBranding && c.team) {
      brand = RecruitTeamBranding.lookup(c.team);
    }
    return {
      name: c.team || (brand && brand.displayName) || "",
      abbr: c.teamAbbr || (brand && brand.key && brand.key.slice(0, 4).toUpperCase()) || "",
      logo: c.teamLogo || (brand && brand.logo) || "",
      primary: c.teamColor || (brand && brand.primary) || "#3e2723",
      secondary: c.teamAltColor || (brand && brand.secondary) || "#ffd700",
    };
  }

  function brandStyleAttr(brand) {
    if (!brand || !brand.primary) return "";
    return (
      "--hs-team-primary:" +
      brand.primary +
      ";--hs-team-secondary:" +
      brand.secondary +
      ";"
    );
  }

  function playerCardHtml(candidate, opts) {
    opts = opts || {};
    if (!candidate) {
      return '<div class="heisman-pick-empty">Select a player on the odds board.</div>';
    }
    var brand = teamBrandFor(candidate);
    var pos = candidate.position || "";
    var odds = candidate.americanDisplay || "—";
    var impl =
      candidate.impliedPct != null ? candidate.impliedPct + "% implied" : "";
    var headshot = candidate.headshot
      ? '<img class="heisman-headshot" src="' +
        escapeHtml(candidate.headshot) +
        '" alt="" loading="lazy" width="72" height="72" onerror="this.style.display=\'none\'">'
      : '<div class="heisman-headshot heisman-headshot-fallback" aria-hidden="true">' +
        escapeHtml((candidate.playerName || "?").slice(0, 1)) +
        "</div>";
    var teamLogo = brand.logo
      ? '<img class="heisman-team-logo" src="' +
        escapeHtml(brand.logo) +
        '" alt="" loading="lazy" width="28" height="28">'
      : brand.abbr
        ? '<span class="heisman-team-logo-fallback">' + escapeHtml(brand.abbr) + "</span>"
        : "";
    var lockedBadge = opts.locked
      ? '<span class="heisman-locked-badge">Locked</span>'
      : opts.saved && !opts.locked
        ? '<span class="heisman-saved-badge">Your pick</span>'
        : "";

    return (
      '<article class="heisman-pick-card' +
      (opts.locked ? " is-locked" : "") +
      '" style="' +
      brandStyleAttr(brand) +
      '">' +
      '<div class="heisman-pick-card-accent"></div>' +
      headshot +
      '<div class="heisman-pick-main">' +
      '<div class="heisman-pick-name-row">' +
      "<h3>" +
      escapeHtml(candidate.playerName) +
      "</h3>" +
      lockedBadge +
      "</div>" +
      '<div class="heisman-pick-team-row">' +
      teamLogo +
      "<span>" +
      escapeHtml(brand.name || "—") +
      (pos ? ' · <span class="heisman-pos">' + escapeHtml(pos) + "</span>" : "") +
      "</span>" +
      "</div>" +
      '<div class="heisman-pick-odds-row">' +
      '<span class="heisman-pick-odds">' +
      escapeHtml(odds) +
      "</span>" +
      (impl ? '<span class="heisman-pick-impl">' + escapeHtml(impl) + "</span>" : "") +
      "</div>" +
      (opts.locked && opts.lockedOdds
        ? '<p class="heisman-pick-note">Frozen at ' + escapeHtml(opts.lockedOdds) + " for Prophet bragging rights.</p>"
        : opts.saved
          ? '<p class="heisman-pick-note">Saved on your ballot. Odds may move until you lock.</p>'
          : '<p class="heisman-pick-note">Live board odds — cast your ballot to save this pick.</p>') +
      "</div></article>"
    );
  }

  async function loadPage() {
    setStatus("Loading Heisman odds…");
    var url = new URL("/api/heisman", window.location.origin);
    url.searchParams.set("season", String(seasonYear));
    var res = await fetch(url.toString(), {
      headers: Object.assign({ Accept: "application/json" }, authHeaders()),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      throw new Error(data.error || data.details || "Failed to load");
    }
    state.candidates = (data.board && data.board.candidates) || [];
    state.myPick = data.myPick || null;
    state.community = data.community || null;
    state.result = data.result || null;
    state.prophets = data.prophets || [];
    state.boardMeta = data.board || null;
    if (state.myPick) state.selectedKey = state.myPick.playerKey;
    else if (!state.selectedKey && state.candidates[0]) {
      state.selectedKey = state.candidates[0].playerKey;
    }
    seasonYear = data.seasonYear || seasonYear;
    return data;
  }

  function selectedCandidate() {
    return state.candidates.find(function (c) {
      return String(c.playerKey) === String(state.selectedKey);
    });
  }

  function candidateByKey(key) {
    return state.candidates.find(function (c) {
      return String(c.playerKey) === String(key);
    });
  }

  function renderBallot() {
    var panel = $("myPickPanel");
    var actions = $("ballotActions");
    var submitBtn = $("submitBallotBtn");
    var lockOption = $("lockOption");
    var lockCheckbox = $("lockOnSubmit");
    var lockLabel = $("lockOddsLabel");
    var changeHint = $("changePickHint");
    var gate = $("loginGate");
    var loginLink = $("loginLink");
    if (loginLink) loginLink.href = loginHref();

    var pick = state.myPick;
    var sel = selectedCandidate();
    var locked = pick && pick.isLocked;

    if (!isLoggedIn()) {
      if (gate) gate.hidden = false;
      if (actions) actions.hidden = true;
    } else {
      if (gate) gate.hidden = true;
      if (actions) actions.hidden = locked;
    }

    if (locked) {
      var lockedCand =
        candidateByKey(pick.playerKey) ||
        Object.assign({}, pick, {
          playerName: pick.playerName,
          americanDisplay: pick.americanDisplay,
          team: pick.team,
        });
      panel.innerHTML = playerCardHtml(lockedCand, {
        locked: true,
        lockedOdds: pick.americanDisplay,
      });
      return;
    }

    if (sel) {
      panel.innerHTML = playerCardHtml(sel, {
        saved: pick && String(pick.playerKey) === String(sel.playerKey),
      });
    } else {
      panel.innerHTML = playerCardHtml(null);
    }

    if (lockLabel && sel) lockLabel.textContent = sel.americanDisplay || "—";
    if (lockCheckbox) lockCheckbox.checked = false;

    if (submitBtn) {
      submitBtn.disabled = !isLoggedIn() || !state.selectedKey;
      var sameAsSaved =
        pick && String(pick.playerKey) === String(state.selectedKey);
      submitBtn.textContent = sameAsSaved ? "Update ballot" : "Cast ballot";
    }
    if (changeHint) {
      changeHint.hidden = !pick;
      changeHint.textContent = pick
        ? "You can switch players and update until you lock."
        : "";
    }
    if (lockOption) lockOption.hidden = !isLoggedIn();
  }

  function renderBoard() {
    var body = $("boardBody");
    var empty = $("boardEmpty");
    var meta = $("boardMeta");
    if (!body) return;

    if (meta && state.boardMeta) {
      var asOf = state.boardMeta.fetchedAt
        ? new Date(state.boardMeta.fetchedAt).toLocaleString()
        : "";
      meta.textContent =
        (state.boardMeta.provider || "Sportsbook") +
        " · " +
        (state.boardMeta.marketName || "Heisman") +
        (asOf ? " · as of " + asOf : "") +
        " · " +
        state.candidates.length +
        " players · click a row to select";
    }

    var q = String(state.filter || "")
      .trim()
      .toLowerCase();
    var rows = state.candidates.filter(function (c) {
      if (!q) return true;
      var blob = (
        (c.playerName || "") +
        " " +
        (c.team || "") +
        " " +
        (c.position || "")
      ).toLowerCase();
      return blob.indexOf(q) !== -1;
    });

    if (!rows.length) {
      body.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    body.innerHTML = rows
      .map(function (c) {
        var isSel = String(c.playerKey) === String(state.selectedKey);
        var isMine =
          state.myPick && String(state.myPick.playerKey) === String(c.playerKey);
        var brand = teamBrandFor(c);
        var logo = brand.logo
          ? '<img class="heisman-row-logo" src="' +
            escapeHtml(brand.logo) +
            '" alt="" loading="lazy" width="28" height="28">'
          : '<span class="heisman-row-logo-fallback">' +
            escapeHtml(brand.abbr || "?") +
            "</span>";
        var headshot = c.headshot
          ? '<img class="heisman-row-headshot" src="' +
            escapeHtml(c.headshot) +
            '" alt="" loading="lazy" width="36" height="36" onerror="this.style.display=\'none\'">'
          : "";
        return (
          '<tr class="heisman-row' +
          (isSel ? " is-selected" : "") +
          (isMine ? " is-mypick" : "") +
          '" data-key="' +
          escapeHtml(c.playerKey) +
          '" style="' +
          brandStyleAttr(brand) +
          '" tabindex="0" role="button" aria-pressed="' +
          (isSel ? "true" : "false") +
          '">' +
          "<td class=\"heisman-rank-cell\">" +
          escapeHtml(String(c.rank)) +
          "</td>" +
          '<td class="heisman-player-cell">' +
          '<div class="heisman-player-cell-inner">' +
          headshot +
          logo +
          '<div class="heisman-player-text">' +
          '<span class="heisman-player-name">' +
          escapeHtml(c.playerName) +
          (isMine ? ' <span class="heisman-yours-tag">Yours</span>' : "") +
          "</span>" +
          '<span class="heisman-player-sub">' +
          escapeHtml([brand.name, c.position].filter(Boolean).join(" · ")) +
          "</span>" +
          "</div></div></td>" +
          '<td class="heisman-odds">' +
          escapeHtml(c.americanDisplay || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(c.impliedPct != null ? c.impliedPct + "%" : "—") +
          "</td>" +
          "<td>" +
          escapeHtml(
            c.pickPct != null && state.community && state.community.totalPicks
              ? c.pickPct + "%"
              : "—"
          ) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    body.querySelectorAll(".heisman-row").forEach(function (row) {
      function selectRow() {
        if (state.myPick && state.myPick.isLocked) {
          setStatus("Your pick is locked — cannot change.", true);
          return;
        }
        state.selectedKey = row.getAttribute("data-key");
        renderAll();
        setStatus("");
      }
      row.addEventListener("click", selectRow);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectRow();
        }
      });
    });
  }

  function renderCrowd() {
    var host = $("crowdBody");
    var hint = $("crowdHint");
    if (!host) return;
    var dist = (state.community && state.community.distribution) || [];
    var total = (state.community && state.community.totalPicks) || 0;
    if (hint) {
      hint.textContent = total
        ? total + " ballot" + (total === 1 ? "" : "s") + " cast so far."
        : "No ballots yet — be the first.";
    }
    if (!dist.length) {
      host.innerHTML = '<p class="heisman-empty">No community picks yet.</p>';
      return;
    }
    var max = Math.max.apply(
      null,
      dist.map(function (d) {
        return d.pickCount;
      })
    );
    host.innerHTML = dist
      .slice(0, 12)
      .map(function (d) {
        var cand = candidateByKey(d.playerKey);
        var brand = teamBrandFor(cand || { team: d.team });
        var width = max > 0 ? Math.round((d.pickCount / max) * 100) : 0;
        var logo = brand.logo
          ? '<img class="heisman-crowd-logo" src="' +
            escapeHtml(brand.logo) +
            '" alt="" loading="lazy" width="22" height="22">'
          : "";
        return (
          '<div class="heisman-crowd-row" style="' +
          brandStyleAttr(brand) +
          '">' +
          '<div class="heisman-crowd-label">' +
          logo +
          "<span>" +
          escapeHtml(d.playerName) +
          (d.lockedCount
            ? ' <span class="heisman-muted">(' + d.lockedCount + " locked)</span>"
            : "") +
          "</span></div>" +
          "<strong>" +
          escapeHtml(String(d.pickPct)) +
          "%</strong>" +
          '<div class="heisman-bar-track"><div class="heisman-bar-fill" style="width:' +
          width +
          '%"></div></div>' +
          "</div>"
        );
      })
      .join("");
  }

  function renderProphets() {
    var card = $("prophetCard");
    var host = $("prophetBody");
    if (!card || !host) return;
    if (!state.result) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    var winner =
      escapeHtml(state.result.winnerName) +
      " is the official winner.";
    if (!state.prophets.length) {
      host.innerHTML =
        "<p>" +
        winner +
        '</p><p class="heisman-empty">No locked longshots hit this year.</p>';
      return;
    }
    host.innerHTML =
      "<p>" +
      winner +
      "</p>" +
      state.prophets
        .map(function (p, i) {
          return (
            '<div class="heisman-prophet-row">' +
            "<span>#" +
            (i + 1) +
            "</span>" +
            "<strong>" +
            escapeHtml(p.displayName || p.username) +
            "</strong>" +
            "<span>locked " +
            escapeHtml(p.americanDisplay) +
            "</span>" +
            "</div>"
          );
        })
        .join("");
  }

  function renderAll() {
    renderBallot();
    renderBoard();
    renderCrowd();
    renderProphets();
  }

  async function submitBallot() {
    if (!isLoggedIn()) {
      window.location.href = loginHref();
      return;
    }
    if (!state.selectedKey) return;

    var shouldLock = $("lockOnSubmit") && $("lockOnSubmit").checked;
    setStatus("Saving ballot…");

    try {
      var res = await fetch("/api/heisman/pick", {
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json", Accept: "application/json" },
          authHeaders()
        ),
        body: JSON.stringify({
          season: seasonYear,
          playerKey: state.selectedKey,
        }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        setStatus(data.error || "Could not save ballot", true);
        return;
      }
      state.myPick = data.pick;

      if (shouldLock) {
        setStatus("Ballot saved — locking odds…");
        var lockRes = await fetch("/api/heisman/lock", {
          method: "POST",
          headers: Object.assign(
            { "Content-Type": "application/json", Accept: "application/json" },
            authHeaders()
          ),
          body: JSON.stringify({ season: seasonYear }),
        });
        var lockData = await lockRes.json().catch(function () {
          return {};
        });
        if (!lockRes.ok) {
          setStatus(
            (lockData.error || "Ballot saved, but lock failed") +
              ". You can try locking again.",
            true
          );
          await refreshCommunityOnly();
          renderAll();
          return;
        }
        state.myPick = lockData.pick;
        await refreshCommunityOnly();
        renderAll();
        setStatus(
          "Locked at " +
            (lockData.pick && lockData.pick.americanDisplay
              ? lockData.pick.americanDisplay
              : "current odds") +
            ". Ride or die."
        );
        return;
      }

      await refreshCommunityOnly();
      renderAll();
      setStatus("Ballot saved. Lock optional if you want Prophet bragging rights.");
    } catch (_) {
      setStatus("Network error saving ballot", true);
    }
  }

  async function refreshCommunityOnly() {
    try {
      return await loadPage();
    } catch (_) {
      return null;
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    var submitBtn = $("submitBallotBtn");
    var filter = $("boardFilter");
    if (submitBtn) submitBtn.addEventListener("click", submitBallot);
    if (filter) {
      filter.addEventListener("input", function () {
        state.filter = filter.value;
        renderBoard();
      });
    }

    try {
      await ensureBranding();
      await loadPage();
      renderAll();
      setStatus("");
    } catch (err) {
      setStatus(err.message || "Failed to load Heisman board", true);
      renderAll();
    }
  });
})();
