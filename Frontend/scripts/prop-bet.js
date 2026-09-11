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

  function pct(p) {
    if (p == null || !Number.isFinite(Number(p))) return "—";
    return `${Math.round(Number(p) * 100)}%`;
  }

  function american(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const v = Number(n);
    return v > 0 ? `+${v}` : String(v);
  }

  function starsHtml(n) {
    const s = Math.max(0, Math.min(3, Number(n) || 0));
    return "★".repeat(s) + "☆".repeat(3 - s);
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
      clearResult();
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
      clearResult();
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

  function teamLogoForName(name) {
    if (!name) return "";
    const hit = state.teams.find(
      (t) => String(t.name || "").toLowerCase() === String(name).toLowerCase()
    );
    return hit?.logoUrl || "";
  }

  function clearResult() {
    const box = document.getElementById("propResult");
    if (box) {
      box.innerHTML = "<p>Pick a player and line to see a lean.</p>";
      box.className = "prop-result-empty";
    }
  }

  function renderResult(data) {
    const box = document.getElementById("propResult");
    if (!box) return;
    box.className = "";
    const lean = data.lean || "tossup";
    const opp = data.opponent;
    const playerLogo =
      data.playerTeamRating?.logoUrl ||
      teamLogoForName(data.player?.team) ||
      "";
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
          playerLogo
            ? `<img class="prop-player-logo" src="${escapeHtml(playerLogo)}" alt="${escapeHtml(data.player?.team || "")}" loading="lazy">`
            : `<span class="prop-player-logo prop-player-logo-fallback" aria-hidden="true">${escapeHtml(
                (data.player?.team || "?").charAt(0).toUpperCase()
              )}</span>`
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

      ${
        data.grade
          ? `<div class="prop-prob-row">
              <div class="prop-metric">
                <span class="prop-metric-label">Model P(Over)</span>
                <div class="prop-metric-value">${escapeHtml(pct(data.grade.pOver))}</div>
              </div>
              <div class="prop-metric">
                <span class="prop-metric-label">Model P(Under)</span>
                <div class="prop-metric-value">${escapeHtml(pct(data.grade.pUnder))}</div>
              </div>
              <div class="prop-metric">
                <span class="prop-metric-label">Market edge</span>
                <div class="prop-metric-value">${
                  data.grade.probEdgePct != null
                    ? escapeHtml(`${data.grade.probEdgePct >= 0 ? "+" : ""}${data.grade.probEdgePct}%`)
                    : "—"
                }</div>
              </div>
            </div>
            ${
              data.grade.label
                ? `<p class="prop-prob-label">${escapeHtml(data.grade.label)}</p>`
                : ""
            }`
          : ""
      }

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
          <span class="prop-metric-label">Baseline pace</span>
          <div class="prop-metric-value">${escapeHtml(fmt(data.baselineAvg != null ? data.baselineAvg : data.seasonAvg, 1))}</div>
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

      <p class="prop-reason">
        <strong>Sample:</strong> ${escapeHtml(data.sampleNote || `${fmt(data.seasonTotal, 0)} in ${data.games || "—"} games`)}
        ${
          data.seasonAvg != null && data.baselineAvg != null && Math.abs(data.seasonAvg - data.baselineAvg) > 0.05
            ? `<br><strong>${escapeHtml(String(data.seasonYear))} avg:</strong> ${escapeHtml(fmt(data.seasonAvg, 1))}` +
              (data.priorAvg != null
                ? ` · <strong>${escapeHtml(String(data.priorYear))} avg:</strong> ${escapeHtml(fmt(data.priorAvg, 1))}`
                : "")
            : ""
        }
        <br>${escapeHtml(data.adjustmentReason || "")}
        ${
          oppBits.length
            ? `<br><strong>Opponent:</strong> ${
                opp?.logoUrl
                  ? `<img class="prop-opp-logo" src="${escapeHtml(opp.logoUrl)}" alt="" loading="lazy"> `
                  : ""
              }${escapeHtml(oppBits.join(""))}${
                data.opponent && data.opponent.matched === false
                  ? " (no power rating match — limited adjustment)"
                  : ""
              }`
            : "<br>No opponent matched — projection uses baseline pace only."
        }
      </p>
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
        overPrice: document.getElementById("propOverPrice")?.value || "",
        underPrice: document.getElementById("propUnderPrice")?.value || "",
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

  function renderBoard(data) {
    const host = document.getElementById("propBoard");
    const lead = document.getElementById("propBoardLead");
    const status = document.getElementById("propBoardStatus");
    if (!host) return;

    if (lead) {
      const weekBit =
        data.week?.weekNumber != null
          ? `Week ${data.week.weekNumber}${data.week.seasonYear ? ` · ${data.week.seasonYear}` : ""}`
          : "Upcoming NCAAF";
      lead.textContent = `${weekBit} · ${data.propCount || 0} props graded${
        data.cached ? " (cached)" : ""
      }`;
    }

    if (status) {
      const notes = [];
      if (Array.isArray(data.warnings)) notes.push(...data.warnings);
      if (data.quota?.remaining != null) {
        notes.push(`Odds API credits left: ${data.quota.remaining}`);
      }
      if (notes.length) {
        status.hidden = false;
        status.textContent = notes.join(" · ");
      } else {
        status.hidden = true;
        status.textContent = "";
      }
    }

    const rows = Array.isArray(data.props) ? data.props : [];
    if (!rows.length) {
      host.innerHTML =
        '<p class="prop-board-empty">No graded props yet. Check ODDS_API_KEY or try Refresh.</p>';
      return;
    }

    host.innerHTML = rows
      .map((p) => {
        const g = p.grade || {};
        const side = g.side || p.lean || "tossup";
        const edge =
          g.probEdgePct != null
            ? `${g.probEdgePct >= 0 ? "+" : ""}${g.probEdgePct}%`
            : "—";
        return `
        <article class="prop-board-card">
          <div class="prop-board-card-top">
            <div>
              <p class="prop-board-player">${escapeHtml(p.playerName)}</p>
              <p class="prop-board-sub">${escapeHtml(
                [p.playerTeam, p.position, p.statLabel].filter(Boolean).join(" · ")
              )}</p>
              <p class="prop-board-matchup">${escapeHtml(p.awayTeam || "")} @ ${escapeHtml(
                p.homeTeam || ""
              )}</p>
            </div>
            <div class="prop-board-edge is-${escapeHtml(side)}">
              <span class="prop-board-edge-label">${escapeHtml(leanLabel(side))}</span>
              <span class="prop-board-edge-val">${escapeHtml(edge)}</span>
              <span class="prop-board-stars" aria-label="${escapeHtml(String(g.stars || 0))} star edge">${escapeHtml(
                starsHtml(g.stars)
              )}</span>
            </div>
          </div>
          <div class="prop-board-metrics">
            <div><span>Line</span><strong>${escapeHtml(fmt(p.line, 1))}</strong></div>
            <div><span>Proj</span><strong>${escapeHtml(fmt(p.expected, 1))}</strong></div>
            <div><span>P(Over)</span><strong>${escapeHtml(pct(g.pOver))}</strong></div>
            <div><span>Mkt Over</span><strong>${escapeHtml(pct(g.impliedOver))}</strong></div>
            <div><span>Book</span><strong>${escapeHtml(p.bookmaker || "—")}</strong></div>
            <div><span>Odds</span><strong>${escapeHtml(american(p.overPrice))} / ${escapeHtml(
              american(p.underPrice)
            )}</strong></div>
          </div>
        </article>`;
      })
      .join("");
  }

  async function loadBoard(force) {
    const host = document.getElementById("propBoard");
    if (host) host.innerHTML = '<p class="prop-loading">Fetching weekly props…</p>';
    try {
      const data = await apiGet({
        action: "board",
        season: SEASON,
        force: force ? "1" : "",
      });
      renderBoard(data);
    } catch (err) {
      if (host) {
        const needsKey = err.body?.code === "ODDS_API_NOT_CONFIGURED" || /ODDS_API_KEY/i.test(err.message);
        host.innerHTML = needsKey
          ? `<p class="prop-error">Add <code>ODDS_API_KEY</code> in Netlify (from theoddsapi.com) to load this week’s prop board. Manual evaluator below still works.</p>`
          : `<p class="prop-error">${escapeHtml(err.message)}</p>`;
      }
      const lead = document.getElementById("propBoardLead");
      if (lead) lead.textContent = "Board unavailable";
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindPlayerCombo();
    bindOpponentCombo();
    document.getElementById("propStat")?.addEventListener("change", setEvaluateEnabled);
    document.getElementById("propLine")?.addEventListener("input", setEvaluateEnabled);
    document.getElementById("evaluateBtn")?.addEventListener("click", evaluate);
    document.getElementById("propBoardRefresh")?.addEventListener("click", () => loadBoard(true));
    await loadTeams();
    loadBoard(false);
  });
})();
