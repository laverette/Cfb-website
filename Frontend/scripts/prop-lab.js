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
    best3: null,
    best4: null,
    selectedPlayer: null,
    searchTimer: null,
    searchHits: [],
    searchActive: -1,
    boardLoaded: false,
    boardLoading: false,
    analyzing: false,
    expanded: {},
    preview: {},
    bestMode: "balanced",
    dupWarning: "",
    allowExactDup: false,
  };

  const FLAG_HELP = {
    "Small Sample": "Fewer than three current-season games in the projection sample.",
    "FCS-Heavy Sample": "A large share of the current sample came against FCS opponents.",
    "High Variance": "Week-to-week results swing more than typical for this stat.",
    "Role Change": "Recent usage does not match the rest of the sample.",
    "New Starter": "Limited established role or freshman/new starter flag.",
    Transfer: "Player changed teams — prior-year stats are a weaker prior.",
    "Missing Data": "Some CFBD fields were unavailable.",
    "Limited History": "Thin or missing prior-year history.",
    "Missing Prior": "No usable prior-season sample for this stat.",
    "Low Usage Stability": "Opportunity share is inferred or moving quickly.",
    "Weak Opponent Sample": "The sample is tilted toward weaker or FCS defenses.",
    "Unusual Line": "This line sits far outside the typical range for the selected stat.",
  };

  function ordinal(n) {
    const x = Math.round(Number(n));
    if (!Number.isFinite(x)) return "";
    const v = Math.abs(x) % 100;
    if (v >= 11 && v <= 13) return `${x}th`;
    const last = Math.abs(x) % 10;
    if (last === 1) return `${x}st`;
    if (last === 2) return `${x}nd`;
    if (last === 3) return `${x}rd`;
    return `${x}th`;
  }

  function dropdownPlacement(rect) {
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxH = 240;
    const gap = 4;
    const available = Math.max(96, (openUp ? spaceAbove : spaceBelow) - gap - 8);
    const height = Math.min(maxH, available);
    if (openUp) {
      return { openUp: true, top: "auto", bottom: `${window.innerHeight - rect.top + gap}px`, left: `${rect.left}px`, width: `${rect.width}px`, maxHeight: `${height}px` };
    }
    return { openUp: false, top: `${rect.bottom + gap}px`, bottom: "auto", left: `${rect.left}px`, width: `${rect.width}px`, maxHeight: `${height}px` };
  }

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
      metaEl.textContent = `${state.season}${start} · model ${meta?.modelVersion || "2.1.0"}`;
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
    if (list.parentElement !== document.body) document.body.appendChild(list);
    list.classList.add("prop-player-list-portal");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-haspopup", "listbox");

    function place() {
      if (list.hidden) return;
      const box = dropdownPlacement(input.getBoundingClientRect());
      list.style.left = box.left;
      list.style.width = box.width;
      list.style.maxHeight = box.maxHeight;
      list.style.top = box.top;
      list.style.bottom = box.bottom;
    }

    function paintActive() {
      list.querySelectorAll("li[data-id]").forEach((li, i) => {
        li.classList.toggle("is-active", i === state.searchActive);
        if (i === state.searchActive) {
          li.setAttribute("aria-selected", "true");
          input.setAttribute("aria-activedescendant", li.id);
        } else li.removeAttribute("aria-selected");
      });
    }

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      state.searchActive = -1;
    }

    async function run(q) {
      if (!q || q.trim().length < 2) {
        close();
        list.innerHTML = "";
        return;
      }
      try {
        const data = await api({ action: "search", q: q.trim(), year: state.season });
        const players = data.players || [];
        state.searchHits = players.slice(0, 12);
        if (!players.length) {
          list.innerHTML = "<li class='matchup-combo-empty'>No players found</li>";
          list.hidden = false;
          input.setAttribute("aria-expanded", "true");
          place();
          return;
        }
        list.innerHTML = state.searchHits
          .map(
            (p, i) =>
              `<li role="option" id="playerOpt${i}" data-idx="${i}" data-id="${escapeHtml(p.id)}" data-team="${escapeHtml(
                p.team || ""
              )}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)} <span>${escapeHtml(
                [p.team, p.position].filter(Boolean).join(" · ")
              )}</span></li>`
          )
          .join("");
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        state.searchActive = 0;
        paintActive();
        place();
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
        input.setAttribute("aria-expanded", "true");
        place();
      }
    }

    input.addEventListener("input", () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => run(input.value), 180);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.hidden) run(input.value);
        else {
          state.searchActive = Math.min(state.searchHits.length - 1, state.searchActive + 1);
          paintActive();
        }
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        state.searchActive = Math.max(0, state.searchActive - 1);
        paintActive();
      }
      if (e.key === "Enter" && !list.hidden && state.searchHits[state.searchActive]) {
        e.preventDefault();
        const p = state.searchHits[state.searchActive];
        choosePlayer({ id: p.id, team: p.team, name: p.name });
      }
    });
    input.addEventListener("blur", () => setTimeout(close, 160));
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
  }

  function choosePlayer(p) {
    state.selectedPlayer = p;
    document.getElementById("playerId").value = p.id;
    document.getElementById("playerTeam").value = p.team || "";
    document.getElementById("playerName").value = p.name || "";
    document.getElementById("playerSearch").value = p.name || "";
    document.getElementById("playerList").hidden = true;
    document.getElementById("playerSearch").setAttribute("aria-expanded", "false");
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
      document.getElementById("dupWarnSlot")?.remove();
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
        const loading = leg.loading ? "<em>Fetching player history…</em>" : "";
        const err = e?.error ? `<span class="is-bad">${escapeHtml(e.error)}</span>` : "";
        const kpis = e && !e.error
          ? `<div class="prop-leg-kpis">
              <div class="prop-kpi-chip"><span>Proj</span><strong>${escapeHtml(fmt(e.projection, 1))}</strong></div>
              <div class="prop-kpi-chip"><span>P(${escapeHtml((e.side || "more").toUpperCase())})</span><strong class="${
                e.pHit >= 0.58 ? "is-good" : e.pHit < 0.52 ? "is-bad" : "is-gold"
              }">${escapeHtml(pct(e.pHit))}</strong></div>
              <div class="prop-kpi-chip"><span>Score</span><strong>${escapeHtml(String(e.propScore ?? "—"))}</strong><em>${escapeHtml(
                e.propScoreLabel || ""
              )}</em></div>
              <div class="prop-kpi-chip"><span>Model Conf</span><strong>${escapeHtml(e.confidence || "")}</strong></div>
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
    const existingWarn = document.getElementById("dupWarnSlot");
    if (existingWarn) existingWarn.remove();
    if (warn) {
      const slot = document.createElement("div");
      slot.id = "dupWarnSlot";
      slot.innerHTML = warn;
      list.after(slot);
      slot.querySelector("#dupOverride")?.addEventListener("click", () => {
        state.allowExactDup = true;
        state.dupWarning = "";
        addProp();
      });
    }
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
    const best3Btn = document.getElementById("best3Btn");
    const best4Btn = document.getElementById("bestNBtn");
    if (best3Btn) best3Btn.disabled = evals.length < 3;
    if (best4Btn) best4Btn.disabled = evals.length < 4;
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
      .slice(0, 5)
      .map(
        (c) =>
          `<div class="prop-corr-block ${c.sign === "negative" ? "is-neg" : "is-pos"}">
            <span class="prop-corr-cat">${escapeHtml(c.category || `${(c.strength || "").toUpperCase()} ${(c.sign || "").toUpperCase()}`)}</span>
            <p class="prop-corr">${escapeHtml(c.pairLabel || c.label || "")}</p>
            <p class="prop-market-note">${escapeHtml(c.explanation || "")}${
              c.historicalR != null
                ? ` · Historical r = ${c.historicalR > 0 ? "+" : ""}${c.historicalR}`
                : c.heuristic
                  ? " · Heuristic relationship"
                  : ""
            }</p>
          </div>`
      )
      .join("");
    const drivers = (a.riskDrivers || []).map((d) => `<li>${escapeHtml(d)}</li>`).join("");
    host.className = "";
    host.innerHTML = `
      <div class="prop-grade-row">
        <div class="prop-kpi"><span>Entry grade</span><strong>${escapeHtml(a.grade || "—")}</strong></div>
        <div class="prop-kpi"><span>Avg score</span><strong>${escapeHtml(String(a.avgScore ?? "—"))}</strong></div>
        <div class="prop-kpi"><span>Risk</span><strong>${escapeHtml(a.risk || "—")}</strong></div>
        <div class="prop-kpi"><span>Entry Strength <button type="button" class="prop-info" title="${escapeHtml(
          a.strengthTooltip || "A relative score based on leg quality, confidence, correlation, and concentration. It is not the probability that every leg hits."
        )}">i</button></span><strong>${escapeHtml(String(a.entryStrength ?? "—"))}</strong></div>
      </div>
      ${drivers ? `<p class="prop-market-note">Risk drivers</p><ul class="prop-risk-drivers">${drivers}</ul>` : ""}
      <p class="prop-corr"><strong>Strongest</strong><br>${escapeHtml(a.strongestCaption || a.strongestLabel || a.strongest?.player?.name || "—")}</p>
      <p class="prop-corr"><strong>Weakest</strong><br>${escapeHtml(a.weakestCaption || a.weakestLabel || a.weakest?.player?.name || "—")}</p>
      ${corrs || '<p class="prop-corr">No material correlations flagged.</p>'}
      <div class="prop-opt-mode">
        <button type="button" class="prop-chip ${state.bestMode === "upside" ? "is-on" : ""}" data-mode="upside">Highest Upside</button>
        <button type="button" class="prop-chip ${state.bestMode === "balanced" ? "is-on" : ""}" data-mode="balanced">Balanced</button>
        <button type="button" class="prop-chip ${state.bestMode === "risk" ? "is-on" : ""}" data-mode="risk">Lowest Risk</button>
      </div>
      <p class="prop-market-note">${escapeHtml(a.note || "")}</p>
    `;
    host.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.bestMode = btn.getAttribute("data-mode");
        refreshAnalysis().then(() => {
          renderSummary();
        });
      });
    });
  }

  function flagHtml(flags, fcs) {
    return (flags || [])
      .map((f) => {
        let label = f;
        if (f === "FCS-Heavy Sample" && fcs?.of) label = `FCS-heavy: ${fcs.games} of ${fcs.of} games`;
        return `<span class="prop-flag" title="${escapeHtml(FLAG_HELP[f] || f)}">${escapeHtml(label)}</span>`;
      })
      .join("");
  }

  function logTable(rows, extra) {
    const list = (rows || []).slice(-8);
    if (!list.length) return "<p>No game log for this sample.</p>";
    const extraHead = extra ? "<th>Adj</th><th>Opp Q</th>" : "";
    const body = list
      .map((g) => {
        const hitCls = g.hit ? "is-hit" : "is-miss";
        const fcs = g.isFcs ? " is-fcs" : "";
        return `<tr class="${fcs.trim()}">
          <td>${escapeHtml(g.week ?? "—")}</td>
          <td>${escapeHtml(g.opp || "—")}${g.isFcs ? " · FCS" : ""}</td>
          <td>${escapeHtml(g.result || "—")}</td>
          <td>${escapeHtml(fmt(g.value, 1))}</td>
          ${extra ? `<td>${escapeHtml(fmt(g.adjusted, 1))}</td><td>${escapeHtml(fmt(g.oppQuality, 2))}</td>` : ""}
          <td class="${hitCls}">${g.hit ? "Y" : "N"}</td>
        </tr>`;
      })
      .join("");
    return `<table class="prop-log"><thead><tr><th>Wk</th><th>Opp</th><th>Result</th><th>Value</th>${extraHead}<th>Hit</th></tr></thead><tbody>${body}</tbody></table><p class="prop-log-key">* FCS opponent</p>`;
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
          return `<article class="prop-card"><p class="prop-loading">Fetching player history…</p><p class="prop-market-note">Building matchup profile and running the distribution.</p></article>`;
        }
        if (!e || e.error) {
          return `<article class="prop-card"><h3>${escapeHtml(leg.name)}</h3><p class="prop-error">${escapeHtml(
            e?.error || "Could not evaluate this leg. Others are unaffected."
          )}</p></article>`;
        }
        const shown = state.preview[leg.id] || {};
        const line = shown.line ?? e.line;
        const pHit = shown.pHit ?? e.pHit;
        const score = shown.propScore ?? e.propScore;
        const scoreLabel = shown.propScoreLabel ?? e.propScoreLabel;
        const opp = e.opponent?.name
          ? `${e.opponent.homeAway === "home" ? "vs" : "@"} ${e.opponent.name}`
          : e.scheduleWarning || "No scheduled game found";
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
            const defPct = f.defensePct != null ? Math.round(f.defensePct * 100) : f.pct != null ? Math.round((1 - f.pct) * 100) : null;
            const q = f.quality || "";
            const pctile = defPct != null ? `${q ? `${q} · ` : ""}${ordinal(defPct)} defensive percentile` : q;
            return `<li>${escapeHtml(f.label)}${pctile ? `: ${escapeHtml(pctile)}` : ""}</li>`;
          })
          .join("");
        const whyOne = (e.why && e.why[0]) || "Limited positive signal after shrinkage.";
        const cautionOne = (e.caution && e.caution[0]) || "Treat this as a model estimate, not a lock.";
        const breakdown = (e.breakdown || [])
          .map((b) => `<div>${escapeHtml(b.label)}: ${b.value >= 0 ? "+" : ""}${fmt(b.value, 1)}</div>`)
          .join("");
        const alts = e.whatIfLines || [];
        const market =
          e.market && (e.market.spread != null || e.market.total != null)
            ? `<p class="prop-market-note">CFBD close: spread ${fmt(e.market.spread, 1)} · total ${fmt(e.market.total, 1)}</p>`
            : `<p class="prop-market-note">Market odds not loaded.</p>`;
        const md = e.modelDebug || {};
        const unusual = e.lineSanity?.unusual
          ? `<div class="prop-unusual"><strong>Unusual line</strong> ${escapeHtml(e.lineSanity.message || "")}</div>`
          : "";
        const hiLo =
          e.highProbLowConf || (pHit >= 0.8 && ["C", "D"].includes(e.confidence))
            ? `<span class="prop-tag-hi" title="The line is far from the modeled range, but the current data sample is limited.">High probability, low confidence</span>`
            : "";
        const fcsHint = e.fcs?.of ? `FCS-heavy: ${e.fcs.games} of ${e.fcs.of} games` : "";
        const open = state.expanded[leg.id] ? " open" : "";
        const debug = `<details class="prop-debug"${debugMode ? " open" : ""}><summary>Model Debug</summary><pre>${escapeHtml(
          JSON.stringify(
            {
              projectionMean: md.projectionMean ?? e.projection,
              median: md.median ?? e.median,
              sd: md.sd ?? e.distribution?.sd,
              sdPack: md.sdPack,
              p20: md.p20 ?? e.range?.p20,
              p80: md.p80 ?? e.range?.p80,
              dist: md.dist ?? e.distribution?.dist,
              simIterations: md.simIterations,
              rawPMore: md.rawPMore,
              calibrationAdjustment: md.calibrationAdjustment,
              uncertaintyAdjustment: md.uncertaintyAdjustment,
              finalPMore: md.finalPMore ?? e.pMore,
              confidenceGrade: md.confidenceGrade ?? e.confidence,
              confidenceBreakdown: md.confidenceBreakdown || e.confidenceBreakdown,
              confidenceReasons: md.confidenceReasons || e.confidenceReasons,
              propScore: md.propScore || e.propScoreComponents,
              fcs: md.fcs || e.fcs,
              cache: md.cacheSummary || md.cache || e.apiUsage,
              lineSanity: md.lineSanity || e.lineSanity,
              currentYearWeight: md.currentYearWeight || e.debug?.currentYearWeight,
              priorYearWeight: md.priorYearWeight || e.debug?.priorYearWeight,
              flags: e.flags,
              games: (e.debug?.gamesIncluded || []).map((g) => ({
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
        )}</pre></details>`;
        return `<article class="prop-card" data-id="${escapeHtml(leg.id)}">
          <div class="prop-card-head">
            <h3>${escapeHtml(e.player?.name)}</h3>
            <p class="prop-card-sub">${escapeHtml([e.player?.team, e.player?.position, opp].filter(Boolean).join(" · "))}</p>
            <p class="prop-card-prop">${escapeHtml(e.stat?.label)} · ${escapeHtml(fmt(line, 1))} ${escapeHtml(
          (e.side || "more").toUpperCase()
        )}</p>
          </div>
          <div class="prop-card-hero">
            <div><span>Projection</span><strong>${escapeHtml(fmt(e.projection, 1))}</strong></div>
            <div class="${pHit >= 0.58 ? "is-good" : pHit < 0.52 ? "is-bad" : ""}"><span>P(${escapeHtml(
          (e.side || "more").toUpperCase()
        )})</span><strong>${escapeHtml(pct(pHit))}</strong></div>
            <div><span>Prop Score</span><strong>${escapeHtml(String(score))}</strong><em>${escapeHtml(scoreLabel || "")}</em></div>
            <div class="is-conf"><span>Model Confidence <button type="button" class="prop-info" title="Confidence reflects data quality and model reliability, not whether the prop is good or bad.">i</button></span><strong>${escapeHtml(
              e.confidence || "—"
            )}</strong></div>
          </div>
          ${unusual}${hiLo}
          <p class="prop-card-sub">Mean ${escapeHtml(fmt(e.projection, 1))} · Median ${escapeHtml(
          fmt(e.median, 1)
        )} · SD ${escapeHtml(fmt(e.distribution?.sd, 1))} · P20–P80 ${escapeHtml(fmt(e.range?.p20, 0))}–${escapeHtml(
          fmt(e.range?.p80, 0)
        )}</p>
          <div class="prop-flags">${flagHtml(e.flags, e.fcs)}${fcsHint && !(e.flags || []).includes("FCS-Heavy Sample") ? `<span class="prop-flag" title="${escapeHtml(FLAG_HELP["FCS-Heavy Sample"])}">${escapeHtml(fcsHint)}</span>` : ""}</div>
          ${e.scheduleWarning ? `<p class="prop-error">${escapeHtml(e.scheduleWarning)}</p>` : ""}
          <div class="prop-sec"><h4>Recent</h4>
            <div class="prop-form-grid">
              <div><span>Season</span><strong>${fmt(e.form?.season, 1)}</strong></div>
              <div><span>L3</span><strong>${fmt(e.form?.l3, 1)}</strong></div>
              <div><span>Prior</span><strong>${fmt(e.form?.prior, 1)}</strong></div>
              <div><span>Hit</span><strong>${escapeHtml(e.hitCountLabel || "—")}</strong></div>
            </div>
          </div>
          <div class="prop-sec"><h4>Why ${escapeHtml((e.side || "more").toUpperCase())}</h4><p>${escapeHtml(whyOne)}</p></div>
          <div class="prop-sec"><h4>Caution</h4><p>${escapeHtml(cautionOne)}</p></div>
          <details class="prop-details"${open} data-expand="${escapeHtml(leg.id)}">
            <summary>View full analysis</summary>
            <div class="prop-sec"><h4>Usage</h4><p>${escapeHtml(share)} · Role: ${escapeHtml(e.usage?.role)} — ${escapeHtml(
          e.usage?.roleDetail || ""
        )}${e.usage?.inferred ? " · inferred" : ""}</p></div>
            <div class="prop-sec"><h4>Matchup</h4>
              <p>${escapeHtml(e.matchup?.headline ? `Matchup: ${e.matchup.headline}` : e.matchup?.note || "")}</p>
              <ul>${factors}</ul>
              <p class="prop-market-note">Projection adjustment: ${escapeHtml(
                e.matchup?.adjPctDisplay != null ? `${e.matchup.adjPctDisplay}%` : "—"
              )}</p>
            </div>
            <div class="prop-sec"><h4>Game environment</h4>
              <p>Blowout risk: ${escapeHtml(e.environment?.blowoutRisk || "—")} · ${escapeHtml(
          (e.environment?.notes || []).join(" · ") || "No script adjustment"
        )}</p>${market}
            </div>
            <div class="prop-sec"><h4>Why the model likes ${(e.side || "more").toUpperCase()}</h4><ul>${(e.why || [])
          .map((x) => `<li>${escapeHtml(x)}</li>`)
          .join("")}</ul></div>
            <div class="prop-sec"><h4>Reasons for caution</h4><ul>${(e.caution || [])
          .map((x) => `<li>${escapeHtml(x)}</li>`)
          .join("")}</ul></div>
            <div class="prop-sec"><h4>Projection breakdown</h4><div class="prop-breakdown">${breakdown}<div class="is-final">Final: ${fmt(
          e.projection,
          1
        )}</div></div></div>
            <div class="prop-sec"><h4>Game log</h4>${logTable(e.gameLog, debugMode)}</div>
            <div class="prop-sec"><h4>What-if lines</h4>
              <div class="prop-whatif" data-id="${escapeHtml(leg.id)}">
                ${alts.map((n) => `<button type="button" data-line="${n}">${n} → …</button>`).join("")}
                <label>Custom <input type="number" step="0.5" value="${escapeHtml(String(line))}" data-custom></label>
                <button type="button" class="prop-chip" data-apply>Apply line</button>
              </div>
            </div>
            ${debug}
          </details>
        </article>`;
      })
      .join("");

    host.querySelectorAll(".prop-whatif").forEach((box) => {
      const id = box.getAttribute("data-id");
      box.querySelectorAll("button[data-line]").forEach((btn) => {
        const line = Number(btn.getAttribute("data-line"));
        const p = whatIfPct(id, line);
        btn.textContent = `${line} → ${p}`;
        if (state.preview[id]?.line === line) btn.classList.add("is-preview");
        btn.addEventListener("click", () => previewLine(id, line));
      });
      const custom = box.querySelector("[data-custom]");
      let t = null;
      custom?.addEventListener("input", (ev) => {
        clearTimeout(t);
        t = setTimeout(() => previewLine(id, Number(ev.target.value), { render: false }), 180);
      });
      box.querySelector("[data-apply]")?.addEventListener("click", () => {
        const line = Number(custom?.value || state.preview[id]?.line);
        applyLine(id, line);
      });
    });
    host.querySelectorAll("details[data-expand]").forEach((el) => {
      el.addEventListener("toggle", () => {
        state.expanded[el.getAttribute("data-expand")] = el.open;
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

  function poissonCdf(k, lambda) {
    if (k < 0) return 0;
    let p = 0;
    let term = Math.exp(-Math.max(lambda, 0));
    for (let i = 0; i <= k; i += 1) {
      p += term;
      term *= Math.max(lambda, 0) / (i + 1);
    }
    return Math.max(0, Math.min(1, p));
  }

  function whatIfP(legId, line) {
    const leg = state.legs.find((l) => l.id === legId);
    const d = leg?.evaluation?.distribution;
    if (!d || !Number.isFinite(line)) return null;
    const mean = d.mean;
    const sd = Math.max(d.sd || 1, 0.4);
    const kind = d.dist || d.type;
    let pMore = 0.5;
    if (kind === "poisson") {
      pMore = 1 - poissonCdf(Math.floor(line), Math.max(0.01, mean));
    } else if (kind === "lognormal") {
      const m = Math.max(mean, 0.5);
      const v = sd * sd;
      const sigma = Math.sqrt(Math.log(1 + v / (m * m)));
      const mu = Math.log(m) - 0.5 * sigma * sigma;
      const z = (Math.log(Math.max(line, 0.01)) - mu) / sigma;
      pMore = 1 - 0.5 * (1 + erf(z / Math.SQRT2));
    } else {
      pMore = 1 - 0.5 * (1 + erf((line - mean) / (sd * Math.SQRT2)));
    }
    pMore = Math.max(0.005, Math.min(0.995, pMore));
    const side = leg.evaluation.side || "more";
    return side === "less" ? 1 - pMore : pMore;
  }

  function whatIfPct(legId, line) {
    const p = whatIfP(legId, line);
    return p == null ? "—" : `${Math.round(p * 100)}%`;
  }

  function localScore(pHit, letter) {
    const p = Math.max(0.005, Math.min(0.995, pHit));
    const raw = 50 + 100 * (p - 0.5);
    const conf =
      { A: 1, "A-": 0.98, "B+": 0.96, B: 0.94, "B-": 0.92, "C+": 0.9, C: 0.87, D: 0.84 }[letter] || 0.9;
    const score = Math.max(20, Math.min(96, Math.round(raw * conf)));
    const label = score >= 80 ? "Strong" : score >= 65 ? "Lean" : score >= 55 ? "Slight Lean" : "Pass";
    return { score, label };
  }

  function previewLine(legId, line, { render = true } = {}) {
    if (!Number.isFinite(line)) return;
    const pHit = whatIfP(legId, line);
    if (pHit == null) return;
    const letter = state.legs.find((l) => l.id === legId)?.evaluation?.confidence;
    const scored = localScore(pHit, letter);
    state.preview[legId] = { line, pHit, propScore: scored.score, propScoreLabel: scored.label };
    if (render) renderCards();
    else {
      const card = document.querySelector(`.prop-card[data-id="${legId}"]`);
      if (!card) return;
      const prop = card.querySelector(".prop-card-prop");
      const e = state.legs.find((l) => l.id === legId)?.evaluation;
      if (prop && e) prop.textContent = `${e.stat?.label || ""} · ${fmt(line, 1)} ${(e.side || "more").toUpperCase()}`;
      const hero = card.querySelectorAll(".prop-card-hero div");
      if (hero[1]) hero[1].querySelector("strong").textContent = pct(pHit);
      if (hero[2]) {
        hero[2].querySelector("strong").textContent = String(scored.score);
        const em = hero[2].querySelector("em");
        if (em) em.textContent = scored.label;
      }
    }
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
      delete state.preview[legId];
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
      state.best3 = null;
      state.best4 = null;
      return;
    }
    try {
      const data = await api({ action: "analyze" }, { method: "POST", body: { legs, mode: state.bestMode } });
      state.analysis = data.analysis;
      state.best3 = data.best3;
      state.best4 = data.best4;
    } catch {
      state.analysis = null;
    }
  }

  function sameLeg(a, b) {
    return (
      String(a.playerId) === String(b.playerId) &&
      String(a.statId) === String(b.statId) &&
      Number(a.line) === Number(b.line) &&
      String(a.side || "more").toLowerCase() === String(b.side || "more").toLowerCase()
    );
  }

  async function addProp(evt) {
    evt?.preventDefault();
    if (state.legs.length >= MAX_LEGS) return;
    const player = state.selectedPlayer;
    const statId = document.getElementById("propStat")?.value;
    const line = document.getElementById("propLine")?.value;
    const side = document.getElementById("propSide")?.value || "more";
    if (!player?.id || !statId || line === "") return;
    const proposed = { playerId: player.id, statId, line: Number(line), side };
    const dup = state.legs.find((l) => sameLeg(l, proposed));
    if (dup && !state.allowExactDup) {
      state.dupWarning = "This exact leg is already in the card.";
      renderEntryList();
      return;
    }
    state.allowExactDup = false;
    state.dupWarning = "";
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
    const search = document.getElementById("playerSearch");
    if (search) {
      search.focus();
      search.select?.();
    }
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
            debug: true,
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
      evaluation: src.evaluation ? { ...src.evaluation } : null,
    };
    if (copy.evaluation) copy.evaluation.clientId = copy.id;
    const idx = state.legs.findIndex((l) => l.id === id);
    state.legs.splice(idx + 1, 0, copy);
    refreshAnalysis().then(renderAll);
    renderAll();
  }

  function renderBestN(which) {
    const panel = document.getElementById("bestNPanel");
    const result = which === 3 ? state.best3 : state.best4;
    if (!panel || !result) return;
    panel.hidden = false;
    const n = result.n || which;
    const keep = (result.keep || [])
      .map((l) => `<li>KEEP ${escapeHtml(l.player?.name)} — ${escapeHtml(l.stat?.short || l.stat?.label || "")} ${escapeHtml(String(l.line ?? ""))} ${escapeHtml((l.side || "").toUpperCase())} — score ${escapeHtml(String(l.propScore))}</li>`)
      .join("");
    const cut = (result.cut || [])
      .map((l) => `<li>CUT ${escapeHtml(l.player?.name)} — ${escapeHtml(l.stat?.short || l.stat?.label || "")} ${escapeHtml(String(l.line ?? ""))} ${escapeHtml((l.side || "").toUpperCase())} — score ${escapeHtml(String(l.propScore))}</li>`)
      .join("");
    const why = (result.why || []).map((w) => `<li>${escapeHtml(w)}</li>`).join("");
    panel.innerHTML = `<div class="matchup-panel-head"><h2 class="matchup-panel-title">Best ${n} of ${escapeHtml(String((result.keep || []).length + (result.cut || []).length))}</h2></div>
      <p class="prop-market-note">Mode: ${escapeHtml(result.mode || state.bestMode)} · Why this ${n}-leg set</p>
      ${why ? `<ul class="prop-risk-drivers">${why}</ul>` : ""}
      <ol>${keep}${cut}</ol>
      <p class="prop-corr">${escapeHtml(result.reason || "")}</p>`;
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
          <td>Model Conf ${escapeHtml(l.confidence)}</td>
          <td class="${best}">${escapeHtml(String(l.propScore))} ${escapeHtml(l.propScoreLabel || "")}</td>
        </tr>`;
      })
      .join("");
    panel.innerHTML = `<div class="matchup-panel-head"><h2 class="matchup-panel-title">Compare legs</h2></div>
      <table><thead><tr><th>Player</th><th>Prop</th><th>Line</th><th>Proj</th><th>Edge</th><th>P(hit)</th><th>L5 hit</th><th>Matchup</th><th>Confidence</th><th>Prop Score</th></tr></thead><tbody>${rows}</tbody></table>`;
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
    const compares = evaluatedLegs()
      .map((leg) => {
        const hit = rows.find(
          (p) =>
            String(p.playerName || "").toLowerCase() === String(leg.player?.name || "").toLowerCase()
        );
        if (!hit || hit.line == null || leg.line == null) return "";
        const gap = Number(hit.line) - Number(leg.line);
        if (!Number.isFinite(gap) || Math.abs(gap) < 3) return "";
        return `<p class="prop-market-note">${escapeHtml(leg.player?.name)} — PrizePicks ${fmt(leg.line, 1)} vs consensus ${fmt(
          hit.line,
          1
        )}. ${
          gap > 0
            ? "PrizePicks offers a materially lower threshold than market consensus."
            : "PrizePicks is higher than market consensus."
        }</p>`;
      })
      .filter(Boolean)
      .join("");
    if (compares) host.insertAdjacentHTML("afterbegin", compares);
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
    document.getElementById("addPropForm")?.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        addProp(e);
      }
    });
    document.getElementById("labWeek")?.addEventListener("change", (e) => {
      state.week = Number(e.target.value);
    });
    document.getElementById("best3Btn")?.addEventListener("click", () => {
      refreshAnalysis().then(() => {
        renderBestN(3);
        renderSummary();
      });
    });
    document.getElementById("bestNBtn")?.addEventListener("click", () => {
      refreshAnalysis().then(() => {
        renderBestN(4);
        renderSummary();
      });
    });
    document.getElementById("compareBtn")?.addEventListener("click", renderCompare);
    document.getElementById("saveBtn")?.addEventListener("click", saveEntry);
    document.getElementById("propBoardRefresh")?.addEventListener("click", () => loadBoard(state.boardLoaded));
    try {
      const meta = await api({ action: "meta" }).catch(() => null);
      fillWeekSelect(meta || { week: { weekNumber: 3 }, season: 2026, modelVersion: "2.1.0" });
    } catch {
      fillWeekSelect({ week: { weekNumber: 3 }, season: 2026, modelVersion: "2.1.0" });
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
