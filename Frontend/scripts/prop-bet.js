/**
 * Prop Bet Evaluator — player search + single-leg line evaluation.
 */
(function () {
  const SEASON = 2026;
  const state = {
    teams: [],
    selectedPlayer: null,
    selectedOpponent: null,
    searchTimer: null,
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(n, digits) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return Number(n).toFixed(digits != null ? digits : 1);
  }

  function leanLabel(lean) {
    if (lean === "over") return "Lean Over";
    if (lean === "under") return "Lean Under";
    return "Toss-up";
  }

  async function apiGet(params) {
    const url = new URL("/api/prop-eval", window.location.origin);
    Object.entries(params).forEach(([k, v]) => {
      if (v == null || v === "") return;
      url.searchParams.set(k, String(v));
    });
    const resp = await fetch(url.toString(), { headers: { accept: "application/json" } });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(body.error || resp.statusText || "Request failed");
      err.status = resp.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  async function loadTeams() {
    try {
      const url = new URL("/api/power/teams", window.location.origin);
      url.searchParams.set("season", String(SEASON));
      const resp = await fetch(url.toString(), { headers: { accept: "application/json" } });
      const data = await resp.json().catch(() => ({}));
      state.teams = Array.isArray(data.teams) ? data.teams : [];
    } catch {
      state.teams = [];
    }
  }

  function filterTeams(q) {
    const needle = String(q || "").trim().toLowerCase();
    if (!needle) return state.teams.slice(0, 12);
    return state.teams
      .filter((t) => {
        const hay = `${t.name || ""} ${t.abbreviation || ""} ${t.conference || ""}`.toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 12);
  }

  function teamLabel(t) {
    return t?.name || "Team";
  }

  function setEvaluateEnabled() {
    const btn = document.getElementById("evaluateBtn");
    const hasPlayer = Boolean(state.selectedPlayer?.id);
    const hasStat = Boolean(document.getElementById("propStat")?.value);
    const hasLine = document.getElementById("propLine")?.value !== "";
    if (btn) btn.disabled = !(hasPlayer && hasStat && hasLine);
  }

  function populateStats(stats) {
    const sel = document.getElementById("propStat");
    if (!sel) return;
    const list = Array.isArray(stats) && stats.length ? stats : [];
    if (!list.length) {
      sel.innerHTML = '<option value="">No prop stats found</option>';
      sel.disabled = true;
      setEvaluateEnabled();
      return;
    }
    sel.disabled = false;
    sel.innerHTML =
      '<option value="">Choose a stat…</option>' +
      list
        .map(
          (s) =>
            `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`
        )
        .join("");
    setEvaluateEnabled();
  }

  async function loadPlayerStats(player) {
    populateStats([]);
    const sel = document.getElementById("propStat");
    if (sel) {
      sel.disabled = true;
      sel.innerHTML = '<option value="">Loading stats…</option>';
    }
    try {
      const data = await apiGet({
        action: "stats",
        playerId: player.id,
        team: player.team || "",
        season: SEASON,
      });
      populateStats(data.stats);
    } catch (err) {
      if (sel) {
        sel.innerHTML = `<option value="">${escapeHtml(err.message)}</option>`;
        sel.disabled = true;
      }
    }
  }

  function bindPlayerCombo() {
    const combo = document.getElementById("playerCombo");
    const input = document.getElementById("playerSearch");
    const list = document.getElementById("playerList");
    if (!combo || !input || !list) return;

    function close() {
      list.hidden = true;
      list.innerHTML = "";
    }

    function open(players) {
      if (!players.length) {
        list.innerHTML = '<li class="matchup-combo-empty">No players found</li>';
        list.hidden = false;
        return;
      }
      list.innerHTML = players
        .map((p, i) => {
          const meta = [p.team, p.position, p.jersey != null ? `#${p.jersey}` : ""]
            .filter(Boolean)
            .join(" · ");
          return (
            `<li class="matchup-combo-option" role="option" data-i="${i}">` +
            `${escapeHtml(p.name)}` +
            (meta
              ? `<span class="matchup-combo-meta">${escapeHtml(meta)}</span>`
              : "") +
            `</li>`
          );
        })
        .join("");
      list.hidden = false;
      list.querySelectorAll(".matchup-combo-option").forEach((opt) => {
        opt.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const idx = Number(opt.getAttribute("data-i"));
          commit(players[idx]);
        });
      });
    }

    function commit(player) {
      if (!player) return;
      state.selectedPlayer = player;
      document.getElementById("playerId").value = player.id;
      document.getElementById("playerTeam").value = player.team || "";
      document.getElementById("playerName").value = player.name || "";
      input.value = player.team
        ? `${player.name} (${player.team})`
        : player.name;
      close();
      loadPlayerStats(player);
      setEvaluateEnabled();
    }

    async function runSearch(q) {
      if (String(q || "").trim().length < 2) {
        close();
        return;
      }
      list.innerHTML = '<li class="matchup-combo-empty">Searching…</li>';
      list.hidden = false;
      try {
        const data = await apiGet({
          action: "search",
          q: q.trim(),
          season: SEASON,
        });
        open(data.players || []);
      } catch (err) {
        list.innerHTML = `<li class="matchup-combo-empty">${escapeHtml(err.message)}</li>`;
        list.hidden = false;
      }
    }

    input.addEventListener("input", () => {
      state.selectedPlayer = null;
      document.getElementById("playerId").value = "";
      document.getElementById("playerTeam").value = "";
      document.getElementById("playerName").value = "";
      populateStats([]);
      setEvaluateEnabled();
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => runSearch(input.value), 280);
    });

    input.addEventListener("focus", () => {
      if (input.value.trim().length >= 2) runSearch(input.value);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    document.addEventListener("click", (e) => {
      if (!combo.contains(e.target)) close();
    });
  }

  function bindOpponentCombo() {
    const combo = document.getElementById("oppCombo");
    const input = document.getElementById("opponentSearch");
    const list = document.getElementById("opponentList");
    if (!combo || !input || !list) return;

    function close() {
      list.hidden = true;
      list.innerHTML = "";
    }

    function open(items) {
      if (!items.length) {
        list.innerHTML = '<li class="matchup-combo-empty">No matching teams</li>';
        list.hidden = false;
        return;
      }
      list.innerHTML = items
        .map((t, i) => {
          const conf = t.conference ? ` · ${escapeHtml(t.conference)}` : "";
          return (
            `<li class="matchup-combo-option" role="option" data-i="${i}">` +
            `${escapeHtml(teamLabel(t))}<span class="matchup-combo-meta">${conf}</span></li>`
          );
        })
        .join("");
      list.hidden = false;
      list.querySelectorAll(".matchup-combo-option").forEach((opt) => {
        opt.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const idx = Number(opt.getAttribute("data-i"));
          commit(items[idx]);
        });
      });
    }

    function commit(team) {
      state.selectedOpponent = team;
      document.getElementById("opponentId").value = team ? String(team.teamId) : "";
      input.value = team ? teamLabel(team) : "";
      close();
    }

    input.addEventListener("focus", () => open(filterTeams(input.value)));
    input.addEventListener("input", () => {
      if (!input.value.trim()) {
        state.selectedOpponent = null;
        document.getElementById("opponentId").value = "";
      }
      open(filterTeams(input.value));
    });
    document.addEventListener("click", (e) => {
      if (!combo.contains(e.target)) close();
    });
  }

  function renderResult(data) {
    const box = document.getElementById("propResult");
    if (!box) return;
    const lean = data.lean || "tossup";
    const opp = data.opponent;
    const oppBits = [];
    if (opp?.name) {
      let o = opp.name;
      if (opp.ranking != null) o += ` (#${opp.ranking})`;
      if (opp.homeAway) o += ` · ${opp.homeAway}`;
      if (opp.fromSchedule && opp.week != null) o += ` · week ${opp.week}`;
      oppBits.push(o);
    }

    box.innerHTML = `
      <div class="prop-player-row">
        ${
          opp?.logoUrl
            ? `<img class="prop-player-logo" src="${escapeHtml(opp.logoUrl)}" alt="" loading="lazy">`
            : ""
        }
        <div>
          <p class="prop-player-name">${escapeHtml(data.player?.name || "Player")}</p>
          <p class="prop-player-sub">${escapeHtml(
            [data.player?.team, data.player?.position, data.stat?.label]
              .filter(Boolean)
              .join(" · ")
          )}</p>
        </div>
      </div>

      <div class="prop-verdict">
        <p class="prop-verdict-lean is-${escapeHtml(lean)}">${escapeHtml(leanLabel(lean))}</p>
        <p class="prop-verdict-meta">
          Confidence ${escapeHtml(String(data.confidence ?? "—"))}% ·
          Edge ${data.edge >= 0 ? "+" : ""}${escapeHtml(fmt(data.edge, 1))} vs line
        </p>
      </div>

      <div class="prop-metrics">
        <div class="prop-metric">
          <span class="prop-metric-label">Line</span>
          <div class="prop-metric-value">${escapeHtml(fmt(data.line, 1))}</div>
        </div>
        <div class="prop-metric">
          <span class="prop-metric-label">Projected</span>
          <div class="prop-metric-value">${escapeHtml(fmt(data.expected, 1))}</div>
        </div>
        <div class="prop-metric">
          <span class="prop-metric-label">Season avg (${escapeHtml(String(data.games || "—"))} g)</span>
          <div class="prop-metric-value">${escapeHtml(fmt(data.seasonAvg, 1))}</div>
        </div>
        <div class="prop-metric">
          <span class="prop-metric-label">Opp adjust</span>
          <div class="prop-metric-value">${
            data.adjustmentPct != null
              ? escapeHtml(`${data.adjustmentPct >= 0 ? "+" : ""}${(data.adjustmentPct * 100).toFixed(0)}%`)
              : "—"
          }</div>
        </div>
      </div>

      <p class="prop-reason">${escapeHtml(data.adjustmentReason || "")}${
        oppBits.length
          ? `<br><strong>Opponent:</strong> ${escapeHtml(oppBits.join(""))}`
          : "<br>No opponent matched — projection uses season average only."
      }</p>
      <p class="prop-disclaimer">${escapeHtml(data.disclaimer || "")}</p>
    `;
  }

  async function evaluate() {
    const box = document.getElementById("propResult");
    const player = state.selectedPlayer;
    const stat = document.getElementById("propStat")?.value;
    const line = document.getElementById("propLine")?.value;
    if (!player?.id || !stat || line === "") return;

    if (box) box.innerHTML = '<p class="prop-loading">Evaluating…</p>';
    const btn = document.getElementById("evaluateBtn");
    if (btn) btn.disabled = true;

    try {
      const oppName =
        state.selectedOpponent?.name ||
        document.getElementById("opponentSearch")?.value?.trim() ||
        "";
      const data = await apiGet({
        action: "evaluate",
        playerId: player.id,
        team: player.team || "",
        name: player.name || "",
        stat,
        line,
        opponent: oppName,
        season: SEASON,
      });
      renderResult(data);
    } catch (err) {
      if (box) {
        box.innerHTML = `<p class="prop-error">${escapeHtml(err.message)}</p>`;
      }
    } finally {
      setEvaluateEnabled();
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindPlayerCombo();
    bindOpponentCombo();
    document.getElementById("propStat")?.addEventListener("change", setEvaluateEnabled);
    document.getElementById("propLine")?.addEventListener("input", setEvaluateEnabled);
    document.getElementById("evaluateBtn")?.addEventListener("click", evaluate);
    await loadTeams();
  });
})();
