/**
 * Prop Lab — PrizePicks entry builder + analytics UI.
 */
(function () {
  const API = "/api/prop-eval";
  const MAX_LEGS = 8;
  const debugMode =
    /localhost|127\.0\.0\.1/.test(location.hostname) ||
    new URLSearchParams(location.search).get("debug") === "1";

  const state = {
    season: 2026,
    week: null,
    stats: [],
    legs: [],
    analysis: null,
    best4: null,
    selectedPlayer: null,
    searchTimer: null,
    boardLoaded: false,
    boardLoading: false,
    analyzing: false,
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

  function pct(p) {
    if (p == null || !Number.isFinite(Number(p))) return "—";
    return `${Math.round(Number(p) * 100)}%`;
  }

  function authToken() {
    return localStorage.getItem("authToken") || "";
  }

  function uid() {
    return `leg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  async function api(params, { method = "GET", body = null } = {}) {
    const url = new URL(API, window.location.origin);
    if (method === "GET") {
      Object.entries(params || {}).forEach(([k, v]) => {
        if (v != null && v !== "") url.searchParams.set(k, String(v));
      });
    }
    const headers = { accept: "application/json" };
    if (body) headers["content-type"] = "application/json";
    const token = authToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const resp = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify({ ...params, ...body }) : undefined,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data.error || `Request failed (${resp.status})`);
      err.body = data;
      throw err;
    }
    return data;
  }

  function evaluatedLegs() {
    return state.legs.map((l) => l.evaluation).filter((e) => e && !e.error);
  }

  function fillWeekSelect(meta) {
    const sel = document.getElementById("labWeek");
    if (!sel) return;
    const current = meta?.week?.weekNumber || 3;
    sel.innerHTML = "";
    for (let w = 1; w <= 15; w += 1) {
      const opt = document.createElement("option");
      opt.value = String(w);
      opt.textContent = `Week ${w}`;
      if (w === current) opt.selected = true;
      sel.appendChild(opt);
    }
    state.week = current;
    state.season = meta?.season || meta?.week?.seasonYear || 2026;
    const metaEl = document.getElementById("labWeekMeta");
    if (metaEl) {
      const start = meta?.week?.startDate ? ` · ${meta.week.startDate}` : "";
      metaEl.textContent = `${state.season}${start} · model ${meta?.modelVersion || "2.0.0"}`;
    }
  }

  function fillStats(stats) {
    const sel = document.getElementById("propStat");
    if (!sel) return;
    state.stats = stats || [];
    sel.innerHTML = '<option value="">Stat</option>';
    for (const s of state.stats) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      sel.appendChild(opt);
    }
  }

  function bindPlayerCombo() {
    const input = document.getElementById("playerSearch");
    const list = document.getElementById("playerList");
    if (!input || !list) return;

    async function run(q) {
      if (!q || q.trim().length < 2) {
        list.hidden = true;
        list.innerHTML = "";
        return;
      }
      try {
        const data = await api({ action: "search", q: q.trim(), year: state.season });
        const players = data.players || [];
        if (!players.length) {
          list.innerHTML = "<li class='matchup-combo-empty'>No players found</li>";
          list.hidden = false;
          return;
        }
        list.innerHTML = players
          .slice(0, 12)
          .map(
            (p, i) =>
              `<li role="option" data-idx="${i}" data-id="${escapeHtml(p.id)}" data-team="${escapeHtml(
                p.team || ""
              )}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)} <span>${escapeHtml(
                [p.team, p.position].filter(Boolean).join(" · ")
              )}</span></li>`
          )
          .join("");
        list.hidden = false;
        list.querySelectorAll("li[data-id]").forEach((li) => {
          li.addEventListener("mousedown", (e) => {
            e.preventDefault();
            choosePlayer({
              id: li.getAttribute("data-id"),
              team: li.getAttribute("data-team"),
              name: li.getAttribute("data-name"),
            });
          });
        });
      } catch {
        list.innerHTML = "<li class='matchup-combo-empty'>Search failed</li>";
        list.hidden = false;
      }
    }

    input.addEventListener("input", () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => run(input.value), 180);
    });
    input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 150));
  }

  function choosePlayer(p) {
    state.selectedPlayer = p;
    document.getElementById("playerId").value = p.id;
    document.getElementById("playerTeam").value = p.team || "";
    document.getElementById("playerName").value = p.name || "";
    document.getElementById("playerSearch").value = p.name || "";
    document.getElementById("playerList").hidden = true;
    const hint = document.getElementById("oppHint");
    if (hint) {
      hint.textContent = p.team
        ? `${p.name} · ${p.team} — opponent will come from the Week ${state.week || ""} schedule.`
        : "Opponent fills from the week’s schedule after you pick a player.";
    }
    document.getElementById("propStat")?.focus();
  }

  function renderEntryList() {
    const list = document.getElementById("entryList");
    const empty = document.getElementById("entryEmpty");
    if (!list) return;
    if (!state.legs.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    const ranked = state.legs.slice().sort((a, b) => {
      const as = a.evaluation?.propScore || 0;
      const bs = b.evaluation?.propScore || 0;
      return bs - as;
    });
    list.innerHTML = ranked
      .map((leg, i) => {
        const e = leg.evaluation;
        const loading = leg.loading ? "<em>evaluating…</em>" : "";
        const err = e?.error ? `<span class="is-bad">${escapeHtml(e.error)}</span>` : "";
        const kpis = e && !e.error
          ? `<div class="prop-leg-kpis">
              <span>Proj <strong>${escapeHtml(fmt(e.projection, 1))}</strong></span>
              <span>P(${escapeHtml((e.side || "more").toUpperCase())}) <strong class="${
                e.pHit >= 0.58 ? "is-good" : e.pHit < 0.52 ? "is-bad" : "is-gold"
              }">${escapeHtml(pct(e.pHit))}</strong></span>
              <span>Score <strong>${escapeHtml(String(e.propScore ?? "—"))}</strong></span>
              <span>${escapeHtml(e.confidence || "")}</span>
            </div>`
          : `<div class="prop-leg-kpis">${loading || err}</div>`;
        return `<li class="prop-leg ${e?.error ? "is-error" : ""}" data-id="${escapeHtml(leg.id)}">
          <span class="prop-leg-idx">${i + 1}</span>
          <div>
            <p class="prop-leg-name">${escapeHtml(leg.name)}</p>
            <p class="prop-leg-meta">${escapeHtml(leg.statLabel || leg.statId)} ${escapeHtml(
          String(leg.line)
        )} ${escapeHtml((leg.side || "more").toUpperCase())}${
          e?.opponent?.name ? ` · vs ${escapeHtml(e.opponent.name)}` : ""
        }</p>
          </div>
          ${kpis}
          <div class="prop-leg-actions">
            <button type="button" class="prop-chip" data-act="dup">Dup</button>
            <button type="button" class="prop-chip" data-act="remove">Remove</button>
          </div>
        </li>`;
      })
      .join("");
    list.querySelectorAll(".prop-leg").forEach((row) => {
      const id = row.getAttribute("data-id");
      row.querySelector('[data-act="remove"]')?.addEventListener("click", () => removeLeg(id));
      row.querySelector('[data-act="dup"]')?.addEventListener("click", () => duplicateLeg(id));
    });
  }

  function renderSummary() {
    const host = document.getElementById("entrySummary");
    const a = state.analysis;
    const evals = evaluatedLegs();
    document.getElementById("bestNBtn").disabled = evals.length < 2;
    document.getElementById("compareBtn").disabled = evals.length < 2;
    document.getElementById("saveBtn").disabled = evals.length < 1 || !authToken();
    if (!host) return;
    if (!evals.length) {
      host.className = "prop-summary-idle";
      host.innerHTML = "Add at least one evaluated leg to see grade, risk, and correlations.";
      return;
    }
    if (!a) {
      host.className = "prop-summary-idle";
      host.innerHTML = '<p class="prop-loading">Scoring entry…</p>';
      return;
    }
    const corrs = (a.correlations || [])
      .slice(0, 4)
      .map(
        (c) =>
          `<p class="prop-corr ${c.sign === "negative" ? "is-neg" : "is-pos"}">${escapeHtml(
            c.strength.toUpperCase()
          )}: ${escapeHtml(c.label || "")}</p>`
      )
      .join("");
    host.className = "";
    host.innerHTML = `
      <div class="prop-grade-row">
        <div class="prop-kpi"><span>Entry grade</span><strong>${escapeHtml(a.grade || "—")}</strong></div>
        <div class="prop-kpi"><span>Avg score</span><strong>${escapeHtml(String(a.avgScore ?? "—"))}</strong></div>
        <div class="prop-kpi"><span>Risk</span><strong>${escapeHtml(a.risk || "—")}</strong></div>
        <div class="prop-kpi"><span>Strength</span><strong>${escapeHtml(String(a.entryStrength ?? "—"))}</strong></div>
      </div>
      <p class="prop-corr">Strongest: ${escapeHtml(a.strongest?.player?.name || "—")} · Weakest: ${escapeHtml(
        a.weakest?.player?.name || "—"
      )}</p>
      ${corrs || '<p class="prop-corr">No material correlations flagged.</p>'}
      <p class="prop-market-note">${escapeHtml(a.note || "")}</p>
    `;
  }

  function flagHtml(flags) {
    return (flags || []).map((f) => `<span class="prop-flag">${escapeHtml(f)}</span>`).join("");
  }

  function logTable(rows, extra) {
    const list = (rows || []).slice(-8);
    if (!list.length) return "<p>No game log for this sample.</p>";
    const extraHead = extra ? "<th>Adj</th><th>Opp Q</th>" : "";
    const body = list
      .map((g) => {
        const hitCls = g.hit ? "is-hit" : "is-miss";
        return `<tr>
          <td>${escapeHtml(g.week ?? "—")}</td>
          <td>${escapeHtml(g.opp || "—")}${g.isFcs ? " *" : ""}</td>
          <td>${escapeHtml(g.result || "—")}</td>
          <td>${escapeHtml(fmt(g.value, 1))}</td>
          ${extra ? `<td>${escapeHtml(fmt(g.adjusted, 1))}</td><td>${escapeHtml(fmt(g.oppQuality, 2))}</td>` : ""}
          <td class="${hitCls}">${g.hit ? "Y" : "N"}</td>
        </tr>`;
      })
      .join("");
    return `<table class="prop-log"><thead><tr><th>Wk</th><th>Opp</th><th>Result</th><th>Value</th>${extraHead}<th>Hit</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderCards() {
    const host = document.getElementById("propCards");
    if (!host) return;
    const ranked = state.legs
      .slice()
      .sort((a, b) => (b.evaluation?.propScore || 0) - (a.evaluation?.propScore || 0));
    if (!ranked.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = ranked
      .map((leg) => {
        const e = leg.evaluation;
        if (leg.loading) {
          return `<article class="prop-card"><p class="prop-loading">Evaluating ${escapeHtml(leg.name)}…</p></article>`;
        }
        if (!e || e.error) {
          return `<article class="prop-card"><h3>${escapeHtml(leg.name)}</h3><p class="prop-error">${escapeHtml(
            e?.error || "Could not evaluate this leg. Others are unaffected."
          )}</p></article>`;
        }
        const opp = e.opponent?.name
          ? `${e.opponent.homeAway === "home" ? "vs" : "@"} ${e.opponent.name}`
          : "";
        const share =
          e.usage?.recShare != null
            ? `Receiving share (est.): ${(e.usage.recShare * 100).toFixed(0)}%`
            : e.usage?.carryShare != null
              ? `Carry share (est.): ${(e.usage.carryShare * 100).toFixed(0)}%`
              : e.usage?.attShare != null
                ? `Attempt share (est.): ${(e.usage.attShare * 100).toFixed(0)}%`
                : "Usage share unavailable";
        const factors = (e.matchup?.factors || [])
          .map((f) => {
            const pctile = f.pct != null ? `${Math.round(f.pct * 100)}th pct` : "";
            return `<li>${escapeHtml(f.label)}${pctile ? ` · ${pctile}` : ""}</li>`;
          })
          .join("");
        const why = (e.why || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
        const caution = (e.caution || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
        const breakdown = (e.breakdown || [])
          .map((b) => `${escapeHtml(b.label)}: ${b.value >= 0 ? "+" : ""}${fmt(b.value, 1)}`)
          .join(" · ");
        const alts = [e.line - 18, e.line - 9, e.line, e.line + 11]
          .filter((n, i, arr) => n > 0 && arr.indexOf(n) === i)
          .map((n) => Number(n % 1 === 0 ? n + 0.5 : n.toFixed(1)));
        const market =
          e.market && (e.market.spread != null || e.market.total != null)
            ? `<p class="prop-market-note">CFBD close: spread ${fmt(e.market.spread, 1)} · total ${fmt(
                e.market.total,
                1
              )}</p>`
            : `<p class="prop-market-note">Market odds not loaded.</p>`;
        const debug = debugMode && e.debug
          ? `<details class="prop-debug"><summary>Model Debug</summary><pre>${escapeHtml(
              JSON.stringify(
                {
                  currentYearWeight: e.debug.currentYearWeight,
                  priorYearWeight: e.debug.priorYearWeight,
                  opportunity: e.debug.opportunity?.rawOppProj,
                  efficiency: e.debug.efficiency,
                  opponentAdjustment: e.debug.opponentAdjustment,
                  gameScriptAdjustment: e.debug.gameScriptAdjustment,
                  finalProjection: e.debug.finalProjection,
                  sd: e.debug.sd,
                  pRaw: e.debug.pRaw,
                  pMore: e.debug.pMore,
                  reliability: e.debug.reliability,
                  confidenceInputs: e.debug.confidenceInputs,
                  flags: e.debug.flags,
                  apiUsage: e.debug.apiUsage || e.apiUsage,
                  games: (e.debug.gamesIncluded || []).map((g) => ({
                    week: g.week,
                    opp: g.opponent,
                    raw: g.raw,
                    adj: g.value,
                    w: g.weight,
                    fcs: g.isFcs,
                  })),
                },
                null,
                2
              )
            )}</pre></details>`
          : "";
        return `<article class="prop-card" data-id="${escapeHtml(leg.id)}">
          <div class="prop-card-head">
            <h3>${escapeHtml(e.player?.name)}</h3>
            <p class="prop-card-sub">${escapeHtml(
              [e.player?.team, e.player?.position, opp].filter(Boolean).join(" · ")
            )}</p>
          </div>
          <div class="prop-card-hero">
            <div><span>${escapeHtml(e.stat?.label)}</span><strong>${escapeHtml(fmt(e.line, 1))} ${escapeHtml(
          (e.side || "more").toUpperCase()
        )}</strong></div>
            <div><span>Model</span><strong>${escapeHtml(fmt(e.projection, 1))}</strong></div>
            <div class="${e.pHit >= 0.58 ? "is-good" : ""}"><span>P(${escapeHtml(
          (e.side || "more").toUpperCase()
        )})</span><strong>${escapeHtml(pct(e.pHit))}</strong></div>
            <div><span>Score / Conf</span><strong>${escapeHtml(String(e.propScore))} · ${escapeHtml(
          e.confidence
        )}</strong></div>
          </div>
          <p class="prop-card-sub">Expected range ${escapeHtml(fmt(e.range?.p20, 0))} – ${escapeHtml(
          fmt(e.range?.p80, 0)
        )}</p>
          <div class="prop-flags">${flagHtml(e.flags)}</div>
          <div class="prop-sec"><h4>Recent form</h4>
            <p>Season ${fmt(e.form?.season, 1)} · L3 ${fmt(e.form?.l3, 1)} · L5 ${fmt(e.form?.l5, 1)} · Prior ${fmt(
          e.form?.prior,
          1
        )} · Hit vs line ${pct(e.form?.hitRate)} (L5 ${pct(e.form?.hitRateL5)})</p>
          </div>
          <div class="prop-sec"><h4>Usage</h4>
            <p>${escapeHtml(share)} · Role: ${escapeHtml(e.usage?.role)} — ${escapeHtml(e.usage?.roleDetail || "")}${
          e.usage?.inferred ? " · inferred" : ""
        }</p>
          </div>
          <div class="prop-sec"><h4>Matchup</h4>
            <p>${escapeHtml(e.matchup?.note || "")}</p>
            <ul>${factors}</ul>
          </div>
          <div class="prop-sec"><h4>Game environment</h4>
            <p>Blowout risk: ${escapeHtml(e.environment?.blowoutRisk || "—")} · ${escapeHtml(
          (e.environment?.notes || []).join(" · ") || "No script adjustment"
        )}</p>
            ${market}
          </div>
          <div class="prop-sec"><h4>Why the model likes ${(e.side || "more").toUpperCase()}</h4><ul>${why}</ul></div>
          <div class="prop-sec"><h4>Reasons for caution</h4><ul>${caution}</ul></div>
          <div class="prop-sec"><h4>Projection breakdown</h4><p>${breakdown} → final ${fmt(e.projection, 1)}</p></div>
          <div class="prop-sec"><h4>Game log (current season)</h4>${logTable(e.gameLog, debugMode)}</div>
          <div class="prop-sec"><h4>What-if lines</h4>
            <div class="prop-whatif" data-id="${escapeHtml(leg.id)}">
              ${alts
                .map(
                  (n) =>
                    `<button type="button" data-line="${n}">${n} → …</button>`
                )
                .join("")}
              <label>Custom <input type="number" step="0.5" value="${escapeHtml(String(e.line))}" data-custom></label>
            </div>
          </div>
          ${debug}
        </article>`;
      })
      .join("");

    host.querySelectorAll(".prop-whatif").forEach((box) => {
      const id = box.getAttribute("data-id");
      box.querySelectorAll("button[data-line]").forEach((btn) => {
        const line = Number(btn.getAttribute("data-line"));
        const p = whatIf(id, line);
        btn.textContent = `${line} → ${p}`;
        btn.addEventListener("click", () => applyLine(id, line));
      });
      box.querySelector("[data-custom]")?.addEventListener("change", (ev) => {
        applyLine(id, Number(ev.target.value));
      });
    });
  }

  function erf(x) {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + p * ax);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return sign * y;
  }

  function whatIf(legId, line) {
    const leg = state.legs.find((l) => l.id === legId);
    const d = leg?.evaluation?.distribution;
    if (!d || !Number.isFinite(line)) return "—";
    const mean = d.mean;
    const sd = Math.max(d.sd || 1, 0.4);
    let pMore = 0.5;
    if (d.dist === "lognormal" || d.type === "lognormal") {
      const m = Math.max(mean, 0.5);
      const v = sd * sd;
      const sigma = Math.sqrt(Math.log(1 + v / (m * m)));
      const mu = Math.log(m) - 0.5 * sigma * sigma;
      const z = (Math.log(Math.max(line, 0.01)) - mu) / sigma;
      pMore = 1 - 0.5 * (1 + erf(z / Math.SQRT2));
    } else {
      pMore = 1 - 0.5 * (1 + erf((line - mean) / (sd * Math.SQRT2)));
    }
    const games = d.games || 0;
    const rel = d.reliability || 0.6;
    let p = 0.5 + (pMore - 0.5) * rel;
    const cap = games < 3 ? 0.68 : games < 5 ? 0.74 : 0.8;
    p = Math.max(1 - cap, Math.min(cap, p));
    const side = leg.evaluation.side || "more";
    const hit = side === "less" ? 1 - p : p;
    return `${Math.round(hit * 100)}%`;
  }

  async function applyLine(legId, line) {
    const leg = state.legs.find((l) => l.id === legId);
    if (!leg?.evaluation?.distribution || !Number.isFinite(line)) return;
    try {
      const next = await api(
        { action: "reline" },
        { method: "POST", body: { evaluation: leg.evaluation, line, side: leg.side } }
      );
      leg.line = line;
      leg.evaluation = next;
      await refreshAnalysis();
      renderAll();
    } catch {
      /* keep existing */
    }
  }

  function renderAll() {
    renderEntryList();
    renderSummary();
    renderCards();
  }

  async function refreshAnalysis() {
    const legs = evaluatedLegs();
    if (!legs.length) {
      state.analysis = null;
      state.best4 = null;
      return;
    }
    try {
      const data = await api({ action: "analyze" }, { method: "POST", body: { legs, n: 4 } });
      state.analysis = data.analysis;
      state.best4 = data.best4;
    } catch {
      state.analysis = null;
    }
  }

  async function addProp(evt) {
    evt?.preventDefault();
    if (state.legs.length >= MAX_LEGS) return;
    const player = state.selectedPlayer;
    const statId = document.getElementById("propStat")?.value;
    const line = document.getElementById("propLine")?.value;
    const side = document.getElementById("propSide")?.value || "more";
    if (!player?.id || !statId || line === "") return;
    const stat = state.stats.find((s) => s.id === statId);
    const leg = {
      id: uid(),
      playerId: player.id,
      name: player.name,
      team: player.team,
      statId,
      statLabel: stat?.label || statId,
      line: Number(line),
      side,
      loading: true,
      evaluation: null,
    };
    state.legs.push(leg);
    renderAll();
    document.getElementById("propLine").value = "";
    document.getElementById("playerSearch").focus();
    try {
      const evaluation = await api(
        { action: "evaluate" },
        {
          method: "POST",
          body: {
            playerId: player.id,
            team: player.team,
            name: player.name,
            stat: statId,
            line: Number(line),
            side,
            season: state.season,
            week: state.week,
            debug: debugMode ? true : undefined,
          },
        }
      );
      leg.evaluation = { ...evaluation, clientId: leg.id };
      leg.loading = false;
    } catch (err) {
      leg.loading = false;
      leg.evaluation = { error: err.message, player: { name: player.name }, stat: { id: statId }, clientId: leg.id };
    }
    await refreshAnalysis();
    renderAll();
  }

  function removeLeg(id) {
    state.legs = state.legs.filter((l) => l.id !== id);
    refreshAnalysis().then(renderAll);
    renderAll();
  }

  function duplicateLeg(id) {
    const src = state.legs.find((l) => l.id === id);
    if (!src || state.legs.length >= MAX_LEGS) return;
    const copy = {
      ...src,
      id: uid(),
      evaluation: src.evaluation ? { ...src.evaluation, clientId: null } : null,
    };
    if (copy.evaluation) copy.evaluation.clientId = copy.id;
    state.legs.push(copy);
    refreshAnalysis().then(renderAll);
    renderAll();
  }

  function renderBestN() {
    const panel = document.getElementById("bestNPanel");
    if (!panel || !state.best4) return;
    panel.hidden = false;
    const keep = (state.best4.keep || [])
      .map((l) => `<li>KEEP ${escapeHtml(l.player?.name)} — score ${escapeHtml(String(l.propScore))}</li>`)
      .join("");
    const cut = (state.best4.cut || [])
      .map((l) => `<li>CUT ${escapeHtml(l.player?.name)} — score ${escapeHtml(String(l.propScore))}</li>`)
      .join("");
    panel.innerHTML = `<div class="matchup-panel-head"><h2 class="matchup-panel-title">Which legs to keep</h2></div>
      <ol>${keep}${cut}</ol>
      <p class="prop-corr">${escapeHtml(state.best4.reason || "")}</p>`;
  }

  function renderCompare() {
    const panel = document.getElementById("comparePanel");
    const legs = evaluatedLegs().slice(0, 4);
    if (!panel || legs.length < 2) return;
    panel.hidden = false;
    const bestScore = Math.max(...legs.map((l) => l.propScore || 0));
    const rows = legs
      .map((l) => {
        const best = l.propScore === bestScore ? "is-best" : "";
        return `<tr>
          <td>${escapeHtml(l.player?.name)}</td>
          <td>${escapeHtml(l.stat?.short || l.stat?.label)}</td>
          <td>${escapeHtml(fmt(l.line, 1))} ${escapeHtml((l.side || "").toUpperCase())}</td>
          <td>${escapeHtml(fmt(l.projection, 1))}</td>
          <td>${escapeHtml(fmt(l.edge, 1))}</td>
          <td>${escapeHtml(pct(l.pHit))}</td>
          <td>${escapeHtml(pct(l.form?.hitRateL5))}</td>
          <td>${escapeHtml(l.matchup?.adjPct != null ? `${(l.matchup.adjPct * 100).toFixed(1)}%` : "—")}</td>
          <td>${escapeHtml(l.confidence)}</td>
          <td class="${best}">${escapeHtml(String(l.propScore))}</td>
        </tr>`;
      })
      .join("");
    panel.innerHTML = `<div class="matchup-panel-head"><h2 class="matchup-panel-title">Compare legs</h2></div>
      <table><thead><tr><th>Player</th><th>Prop</th><th>Line</th><th>Proj</th><th>Edge</th><th>P(hit)</th><th>L5 hit</th><th>Matchup</th><th>Conf</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  async function saveEntry() {
    const title = window.prompt("Name this card", `Week ${state.week} — Saturday Card`);
    if (!title) return;
    try {
      await api(
        { action: "save" },
        {
          method: "POST",
          body: {
            title,
            seasonYear: state.season,
            weekNumber: state.week,
            legs: evaluatedLegs(),
            analysis: state.analysis,
          },
        }
      );
      await loadSaved();
    } catch (err) {
      window.alert(err.message || "Could not save. Run sql/prop_lab_schema.sql in Supabase if tables are missing.");
    }
  }

  async function loadSaved() {
    const host = document.getElementById("savedEntries");
    if (!host || !authToken()) {
      if (host) host.innerHTML = "<p class='prop-market-note'>Log in to save cards. Re-running an old card uses the current model separately.</p>";
      return;
    }
    try {
      const data = await api({ action: "entries" });
      const rows = data.entries || [];
      if (!rows.length) {
        host.innerHTML = "<p class='prop-market-note'>No saved cards yet.</p>";
        return;
      }
      host.innerHTML =
        "<p class='prop-market-note'>Saved (frozen at save time)</p>" +
        rows
          .map(
            (e) =>
              `<button type="button" class="prop-chip" data-eid="${escapeHtml(String(e.id))}">${escapeHtml(
                e.title
              )} · v${escapeHtml(e.model_version)} · ${escapeHtml(String(e.created_at || "").slice(0, 10))}</button>`
          )
          .join("");
      host.querySelectorAll("[data-eid]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const row = await api({ action: "entry", id: btn.getAttribute("data-eid") });
          const entry = row.entry;
          state.legs = (entry.legs || []).map((l) => {
            const snap = l.projection_snapshot || {};
            return {
              id: uid(),
              playerId: l.player_id,
              name: l.player_name,
              team: l.team,
              statId: l.stat_id,
              statLabel: snap.statLabel,
              line: Number(l.line),
              side: l.side,
              loading: false,
              evaluation: {
                ...snap,
                player: { id: l.player_id, name: l.player_name, team: l.team },
                opponent: { name: l.opponent },
                stat: { id: l.stat_id, label: snap.statLabel },
                frozen: true,
              },
            };
          });
          state.analysis = entry.entry_snapshot?.analysis || null;
          renderAll();
        });
      });
    } catch {
      host.innerHTML = "<p class='prop-market-note'>Saved entries unavailable until the Prop Lab SQL migration is applied.</p>";
    }
  }

  function american(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const x = Number(n);
    return x > 0 ? `+${x}` : String(x);
  }

  function renderBoard(data) {
    const host = document.getElementById("propBoard");
    const lead = document.getElementById("propBoardLead");
    const status = document.getElementById("propBoardStatus");
    if (!host) return;
    if (lead) {
      lead.textContent = `Market board · ${data.propCount || 0} props${data.cached ? " (cached)" : ""}`;
    }
    if (status) {
      const notes = [];
      if (Array.isArray(data.warnings)) notes.push(...data.warnings);
      if (data.quota?.remaining != null) notes.push(`Odds API credits left: ${data.quota.remaining}`);
      status.hidden = !notes.length;
      status.textContent = notes.join(" · ");
    }
    const rows = Array.isArray(data.props) ? data.props : [];
    if (!rows.length) {
      host.innerHTML = '<p class="prop-board-empty">No graded market props.</p>';
      return;
    }
    host.innerHTML = rows
      .map((p) => {
        const g = p.grade || {};
        const marketBit =
          g.impliedOver != null
            ? `<div><span>Mkt Over</span><strong>${escapeHtml(pct(g.impliedOver))}</strong></div>`
            : `<div><span>Market</span><strong>not loaded</strong></div>`;
        return `<article class="prop-board-card">
          <div class="prop-board-card-top">
            <div>
              <p class="prop-board-player">${escapeHtml(p.playerName)}</p>
              <p class="prop-board-sub">${escapeHtml([p.playerTeam, p.statLabel].filter(Boolean).join(" · "))}</p>
            </div>
            <div class="prop-board-edge is-${escapeHtml(p.lean || "tossup")}">
              <span class="prop-board-edge-label">Model P(Over)</span>
              <span class="prop-board-edge-val">${escapeHtml(pct(g.pOver))}</span>
            </div>
          </div>
          <div class="prop-board-metrics">
            <div><span>Line</span><strong>${escapeHtml(fmt(p.line, 1))}</strong></div>
            <div><span>Proj</span><strong>${escapeHtml(fmt(p.expected, 1))}</strong></div>
            <div><span>Score</span><strong>${escapeHtml(String(p.propScore ?? "—"))}</strong></div>
            ${marketBit}
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
    if (state.boardLoading) return;
    state.boardLoading = true;
    const btn = document.getElementById("propBoardRefresh");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Loading…";
    }
    if (host) host.innerHTML = '<p class="prop-loading">Fetching market board…</p>';
    try {
      const data = await api({ action: "board", season: state.season, force: force ? "1" : "" });
      state.boardLoaded = true;
      renderBoard(data);
    } catch (err) {
      if (host) {
        host.innerHTML = /ODDS_API_KEY/i.test(err.message)
          ? `<p class="prop-error">Odds API key not configured. Manual PrizePicks entry still works.</p>`
          : `<p class="prop-error">${escapeHtml(err.message)}</p>`;
      }
    } finally {
      state.boardLoading = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = state.boardLoaded ? "Refresh board" : "Load market board";
      }
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindPlayerCombo();
    document.getElementById("addPropForm")?.addEventListener("submit", addProp);
    document.getElementById("labWeek")?.addEventListener("change", (e) => {
      state.week = Number(e.target.value);
    });
    document.getElementById("bestNBtn")?.addEventListener("click", () => {
      refreshAnalysis().then(() => {
        renderBestN();
        renderSummary();
      });
    });
    document.getElementById("compareBtn")?.addEventListener("click", renderCompare);
    document.getElementById("saveBtn")?.addEventListener("click", saveEntry);
    document.getElementById("propBoardRefresh")?.addEventListener("click", () => loadBoard(state.boardLoaded));
    try {
      const meta = await api({ action: "meta" }).catch(() => null);
      fillWeekSelect(meta || { week: { weekNumber: 3 }, season: 2026, modelVersion: "2.0.0" });
    } catch {
      fillWeekSelect({ week: { weekNumber: 3 }, season: 2026, modelVersion: "2.0.0" });
    }
    try {
      const catalog = await api({ action: "catalog" });
      fillStats(catalog.stats);
    } catch {
      /* catalog stays empty until the function is reachable */
    }
    await loadSaved();
  });
})();
