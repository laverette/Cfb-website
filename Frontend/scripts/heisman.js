/**
 * Heisman odds board + ballot (pick / lock / crowd %).
 */
(function () {
  "use strict";

  var STORAGE_TOKEN = "authToken";
  var STORAGE_USER = "currentUser";
  var SEASON = 2026;

  var state = {
    candidates: [],
    myPick: null,
    community: null,
    result: null,
    prophets: [],
    selectedKey: null,
    filter: "",
    boardMeta: null,
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

  async function loadPage() {
    setStatus("Loading Heisman odds…");
    var url = new URL("/api/heisman", window.location.origin);
    url.searchParams.set("season", String(SEASON));
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
    SEASON = data.seasonYear || SEASON;
    return data;
  }

  function selectedCandidate() {
    return state.candidates.find(function (c) {
      return String(c.playerKey) === String(state.selectedKey);
    });
  }

  function renderBallot() {
    var panel = $("myPickPanel");
    var saveBtn = $("savePickBtn");
    var lockBtn = $("lockPickBtn");
    var gate = $("loginGate");
    var loginLink = $("loginLink");
    if (loginLink) loginLink.href = loginHref();

    if (!isLoggedIn()) {
      if (gate) gate.hidden = false;
      if (saveBtn) saveBtn.disabled = true;
      if (lockBtn) lockBtn.disabled = true;
    } else {
      if (gate) gate.hidden = true;
    }

    var pick = state.myPick;
    var sel = selectedCandidate();

    if (pick && pick.isLocked) {
      panel.innerHTML =
        "<div><strong>" +
        escapeHtml(pick.playerName) +
        '</strong><span class="heisman-locked-badge">Locked</span></div>' +
        '<div class="muted">Frozen at ' +
        escapeHtml(pick.americanDisplay || "—") +
        (pick.team ? " · " + escapeHtml(pick.team) : "") +
        "</div>" +
        '<div class="muted">If they win, you cash in Prophet bragging rights.</div>';
      if (saveBtn) saveBtn.disabled = true;
      if (lockBtn) {
        lockBtn.disabled = true;
        lockBtn.textContent = "Locked";
      }
      return;
    }

    if (pick) {
      panel.innerHTML =
        "<div><strong>" +
        escapeHtml(pick.playerName) +
        "</strong></div>" +
        '<div class="muted">Current pick · odds when saved: ' +
        escapeHtml(pick.americanDisplay || "—") +
        "</div>" +
        (sel
          ? '<div class="muted">Selected on board: ' +
            escapeHtml(sel.playerName) +
            " (" +
            escapeHtml(sel.americanDisplay) +
            ")</div>"
          : "");
    } else if (sel) {
      panel.innerHTML =
        "<div><strong>" +
        escapeHtml(sel.playerName) +
        "</strong></div>" +
        '<div class="muted">Selected · live odds ' +
        escapeHtml(sel.americanDisplay) +
        (sel.impliedPct != null ? " · " + sel.impliedPct + "%" : "") +
        "</div>" +
        '<div class="muted">Save to cast your ballot. Lock to freeze these odds.</div>';
    } else {
      panel.innerHTML = '<div class="muted">Select a player on the odds board.</div>';
    }

    if (saveBtn) {
      saveBtn.disabled = !isLoggedIn() || !state.selectedKey;
      saveBtn.textContent = pick ? "Update pick" : "Save pick";
    }
    if (lockBtn) {
      lockBtn.disabled = !isLoggedIn() || !pick || pick.isLocked;
      var oddsLabel =
        (sel && sel.americanDisplay) ||
        (pick && pick.americanDisplay) ||
        "";
      lockBtn.textContent = oddsLabel
        ? "Lock in at " + oddsLabel
        : "Lock in";
    }
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
        " players";
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
        var sub = [c.position, c.team].filter(Boolean).join(" · ");
        return (
          '<tr class="' +
          (isSel ? "is-selected " : "") +
          (isMine ? "is-mypick" : "") +
          '" data-key="' +
          escapeHtml(c.playerKey) +
          '">' +
          "<td>" +
          escapeHtml(String(c.rank)) +
          "</td>" +
          "<td><span class=\"heisman-player-name\">" +
          escapeHtml(c.playerName) +
          "</span>" +
          (sub
            ? '<span class="heisman-player-sub">' + escapeHtml(sub) + "</span>"
            : "") +
          "</td>" +
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
          "<td><button type=\"button\" class=\"heisman-pick-btn" +
          (isSel ? " is-active" : "") +
          '" data-select="' +
          escapeHtml(c.playerKey) +
          '">' +
          (isMine ? "Yours" : "Select") +
          "</button></td>" +
          "</tr>"
        );
      })
      .join("");

    body.querySelectorAll("[data-select]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (state.myPick && state.myPick.isLocked) {
          setStatus("Your pick is locked — cannot change.");
          return;
        }
        state.selectedKey = btn.getAttribute("data-select");
        renderAll();
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
        var width = max > 0 ? Math.round((d.pickCount / max) * 100) : 0;
        return (
          '<div class="heisman-crowd-row">' +
          "<span>" +
          escapeHtml(d.playerName) +
          (d.lockedCount
            ? ' <span class="muted">(' + d.lockedCount + " locked)</span>"
            : "") +
          "</span>" +
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

  async function savePick() {
    if (!isLoggedIn()) {
      window.location.href = loginHref();
      return;
    }
    if (!state.selectedKey) return;
    setStatus("Saving pick…");
    try {
      var res = await fetch("/api/heisman/pick", {
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json", Accept: "application/json" },
          authHeaders()
        ),
        body: JSON.stringify({
          season: SEASON,
          playerKey: state.selectedKey,
        }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        setStatus(data.error || "Could not save pick", true);
        return;
      }
      state.myPick = data.pick;
      await refreshCommunityOnly();
      renderAll();
      setStatus("Pick saved. Lock in to freeze these odds for Prophet glory.");
    } catch (_) {
      setStatus("Network error saving pick", true);
    }
  }

  async function lockPick() {
    if (!isLoggedIn()) {
      window.location.href = loginHref();
      return;
    }
    if (
      !confirm(
        "Lock this pick forever? Your odds snapshot will be frozen for bragging rights if they win."
      )
    ) {
      return;
    }
    setStatus("Locking pick…");
    try {
      var res = await fetch("/api/heisman/lock", {
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json", Accept: "application/json" },
          authHeaders()
        ),
        body: JSON.stringify({ season: SEASON }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        setStatus(data.error || "Could not lock pick", true);
        return;
      }
      state.myPick = data.pick;
      await refreshCommunityOnly();
      renderAll();
      setStatus(
        "Locked at " +
          (data.pick && data.pick.americanDisplay
            ? data.pick.americanDisplay
            : "current odds") +
          ". Ride or die."
      );
    } catch (_) {
      setStatus("Network error locking pick", true);
    }
  }

  async function refreshCommunityOnly() {
    try {
      var data = await loadPage();
      return data;
    } catch (_) {
      return null;
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    var saveBtn = $("savePickBtn");
    var lockBtn = $("lockPickBtn");
    var filter = $("boardFilter");
    if (saveBtn) saveBtn.addEventListener("click", savePick);
    if (lockBtn) lockBtn.addEventListener("click", lockPick);
    if (filter) {
      filter.addEventListener("input", function () {
        state.filter = filter.value;
        renderBoard();
      });
    }

    try {
      await loadPage();
      renderAll();
      setStatus("");
    } catch (err) {
      setStatus(err.message || "Failed to load Heisman board", true);
      renderAll();
    }
  });
})();
