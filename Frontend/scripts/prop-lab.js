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
    positionRules: null,
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
    keepIds: [],
    cutIds: [],
    summaryOpen: false,
    payoutOdds: "",
    payoutTimer: null,
    saveBusy: false,
    deleteConfirmId: null,
    lastSavedId: null,
  };

  function isMobile() {
    return window.matchMedia("(max-width: 899px)").matches;
  }

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

  function pctTogether(p) {
    if (p == null || !Number.isFinite(Number(p))) return "—";
    const n = Number(p);
    if (n < 0.005) return "<1%";
    if (n < 0.15) return `${(n * 100).toFixed(1)}%`;
    return `${Math.round(n * 100)}%`;
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

  function fillStats(stats, position) {
    const sel = document.getElementById("propStat");
    if (!sel) return;
    if (stats) state.stats = stats;
    const prev = sel.value;

    // Before a player is chosen there is nothing to filter against, so show the
    // whole catalog. Once one is chosen, only that position's props are valid.
    const hasPlayer = Boolean(state.selectedPlayer);
    const eligible = hasPlayer ? statsForPosition(position, state.stats) : state.stats.slice();

    sel.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = hasPlayer && !eligible.length ? "No props for this position" : "Stat";
    sel.appendChild(placeholder);
    for (const s of eligible) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      sel.appendChild(opt);
    }
    sel.disabled = hasPlayer && !eligible.length;

    if (eligible.some((s) => s.id === prev)) sel.value = prev;
    else if (eligible.length === 1) sel.value = eligible[0].id;
  }

  function canonicalPosition(position) {
    const pos = String(position || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    if (!pos) return null;
    const aliases = state.positionRules?.aliases || {};
    for (const canon of Object.keys(aliases)) {
      if ((aliases[canon] || []).includes(pos)) return canon;
    }
    return pos;
  }

  // Mirrors statsForPosition on the server: a known position gets exactly its
  // props, a defensive position gets none, and a missing or unrecognized one
  // gets every offensive prop but never kicking.
  function statsForPosition(position, catalog) {
    const list = catalog || [];
    const canon = canonicalPosition(position);
    const rules = state.positionRules;
    const nonOffensive = rules?.nonOffensive || [];
    const skill = rules?.skill || ["QB", "RB", "WR", "TE", "ATH"];

    if (canon && nonOffensive.includes(canon)) return [];
    if (canon) {
      const hit = list.filter((s) => (s.positions || []).includes(canon));
      if (hit.length) return hit;
    }
    return list.filter((s) => (s.positions || []).some((p) => skill.includes(p)));
  }

  function bindPlayerCombo() {
    const input = document.getElementById("playerSearch");
    const list = document.getElementById("playerList");
    const sheet = document.getElementById("playerSheet");
    const sheetInput = document.getElementById("playerSheetInput");
    const sheetList = document.getElementById("playerSheetList");
    const sheetClose = document.getElementById("playerSheetClose");
    if (!input || !list) return;
    if (list.parentElement !== document.body) document.body.appendChild(list);
    list.classList.add("prop-player-list-portal");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-haspopup", "listbox");

    function place() {
      if (list.hidden || isMobile()) return;
      const box = dropdownPlacement(input.getBoundingClientRect());
      list.style.left = box.left;
      list.style.width = box.width;
      list.style.maxHeight = box.maxHeight;
      list.style.top = box.top;
      list.style.bottom = box.bottom;
    }

    function paintActive() {
      const host = isMobile() ? sheetList : list;
      if (!host) return;
      host.querySelectorAll("li[data-id]").forEach((li, i) => {
        li.classList.toggle("is-active", i === state.searchActive);
        if (i === state.searchActive) {
          li.setAttribute("aria-selected", "true");
          input.setAttribute("aria-activedescendant", li.id);
        } else li.removeAttribute("aria-selected");
      });
    }

    function closeSheet() {
      if (!sheet) return;
      sheet.hidden = true;
      document.body.classList.remove("prop-sheet-open");
    }

    function openSheet() {
      if (!sheet || !sheetInput) return;
      sheet.hidden = false;
      document.body.classList.add("prop-sheet-open");
      sheetInput.value = input.value || "";
      pinSheet();
      sheetInput.focus();
      if (sheetInput.value.trim().length >= 2) run(sheetInput.value, true);
    }

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      state.searchActive = -1;
      if (!isMobile()) closeSheet();
    }

    function renderHits(host, players) {
      if (!players.length) {
        host.innerHTML = "<li class='matchup-combo-empty'>No players found</li>";
        return;
      }
      host.innerHTML = players
        .map(
          (p, i) =>
            `<li role="option" id="playerOpt${i}" data-idx="${i}" data-id="${escapeHtml(p.id)}" data-team="${escapeHtml(
              p.team || ""
            )}" data-name="${escapeHtml(p.name)}" data-position="${escapeHtml(p.position || "")}">${escapeHtml(p.name)} <span>${escapeHtml(
              [p.team, p.position].filter(Boolean).join(" · ")
            )}</span></li>`
        )
        .join("");
      host.querySelectorAll("li[data-id]").forEach((li) => {
        li.addEventListener("mousedown", (e) => e.preventDefault());
        li.addEventListener("click", () => {
          choosePlayer({
            id: li.getAttribute("data-id"),
            team: li.getAttribute("data-team"),
            name: li.getAttribute("data-name"),
            position: li.getAttribute("data-position"),
          });
          closeSheet();
        });
      });
    }

    async function run(q, forSheet) {
      if (!q || q.trim().length < 2) {
        if (!forSheet) close();
        if (sheetList && forSheet) sheetList.innerHTML = "";
        return;
      }
      try {
        const data = await api({ action: "search", q: q.trim(), year: state.season });
        const players = data.players || [];
        state.searchHits = players.slice(0, 12);
        if (isMobile() || forSheet) {
          if (sheetList) renderHits(sheetList, players);
          input.setAttribute("aria-expanded", "true");
          return;
        }
        if (!players.length) {
          list.innerHTML = "<li class='matchup-combo-empty'>No players found</li>";
          list.hidden = false;
          input.setAttribute("aria-expanded", "true");
          place();
          return;
        }
        renderHits(list, players);
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        state.searchActive = 0;
        paintActive();
        place();
      } catch {
        const msg = "<li class='matchup-combo-empty'>Search failed</li>";
        if (isMobile() || forSheet) {
          if (sheetList) sheetList.innerHTML = msg;
        } else {
          list.innerHTML = msg;
          list.hidden = false;
          place();
        }
        input.setAttribute("aria-expanded", "true");
      }
    }

    input.addEventListener("focus", () => {
      if (isMobile()) {
        input.blur();
        openSheet();
      }
    });
    input.addEventListener("click", () => {
      if (isMobile()) openSheet();
    });
    input.addEventListener("input", () => {
      if (isMobile()) return;
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => run(input.value), 180);
    });
    sheetInput?.addEventListener("input", () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => run(sheetInput.value, true), 160);
    });
    sheetClose?.addEventListener("click", closeSheet);
    input.addEventListener("keydown", (e) => {
      if (isMobile()) return;
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
        choosePlayer({ id: p.id, team: p.team, name: p.name, position: p.position });
      }
    });
    input.addEventListener("blur", () => {
      if (!isMobile()) setTimeout(close, 160);
    });
    function pinSheet() {
      const vv = window.visualViewport;
      if (!sheet || sheet.hidden || !vv) return;
      sheet.style.top = `${vv.offsetTop}px`;
      sheet.style.left = `${vv.offsetLeft}px`;
      sheet.style.width = `${vv.width}px`;
      sheet.style.height = `${vv.height}px`;
    }

    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", pinSheet);
    window.visualViewport?.addEventListener("scroll", pinSheet);
  }

  function choosePlayer(p) {
    state.selectedPlayer = p;
    document.getElementById("playerId").value = p.id;
    document.getElementById("playerTeam").value = p.team || "";
    document.getElementById("playerName").value = p.name || "";
    document.getElementById("playerSearch").value = p.name || "";
    document.getElementById("playerList").hidden = true;
    document.getElementById("playerSearch").setAttribute("aria-expanded", "false");
    const sheet = document.getElementById("playerSheet");
    if (sheet) {
      sheet.hidden = true;
      document.body.classList.remove("prop-sheet-open");
    }
    const hint = document.getElementById("oppHint");
    if (hint) {
      const pos = p.position ? ` · ${p.position}` : "";
      hint.textContent = p.team
        ? `${p.name}${pos} · ${p.team} — opponent will come from the Week ${state.week || ""} schedule.`
        : "Opponent fills from the week’s schedule after you pick a player.";
    }
    fillStats(null, p.position);
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
        return `<li class="prop-leg ${e?.error ? "is-error" : ""} ${state.keepIds.includes(leg.id) ? "is-keep" : ""} ${
          state.cutIds.includes(leg.id) ? "is-cut" : ""
        }" data-id="${escapeHtml(leg.id)}">
          <span class="prop-leg-idx">${i + 1}</span>
          <div>
            <p class="prop-leg-name">${escapeHtml(leg.name)}</p>
            <p class="prop-leg-meta">
              <span>${escapeHtml(leg.statLabel || leg.statId)}</span>
              <input
                class="prop-leg-line"
                type="number"
                step="0.5"
                inputmode="decimal"
                enterkeyhint="done"
                value="${escapeHtml(String(leg.line))}"
                aria-label="Edit line for ${escapeHtml(leg.name)}"
                ${leg.loading || !e || e.error ? "disabled" : ""}
              >
              <select class="prop-leg-side" aria-label="Edit side for ${escapeHtml(leg.name)}" ${
                leg.loading || !e || e.error ? "disabled" : ""
              }>
                <option value="more" ${(leg.side || "more") === "more" ? "selected" : ""}>More</option>
                <option value="less" ${leg.side === "less" ? "selected" : ""}>Less</option>
              </select>
              ${e?.opponent?.name ? `<span>· vs ${escapeHtml(e.opponent.name)}</span>` : ""}
            </p>
          </div>
          ${kpis}
          <div class="prop-leg-actions">
            <button type="button" class="prop-chip" data-act="details">Details</button>
            <button type="button" class="prop-chip" data-act="dup">Dup</button>
            <button type="button" class="prop-chip" data-act="remove">Remove</button>
          </div>
        </li>`;
      })
      .join("");
    const warn = state.dupWarning
      ? `<p class="prop-dup-warn">${escapeHtml(state.dupWarning)} <button type="button" class="prop-chip" id="dupOverride">Add anyway</button></p>`
      : "";
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
      row.querySelector('[data-act="details"]')?.addEventListener("click", () => {
        document.querySelector(`.prop-card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      const lineInput = row.querySelector(".prop-leg-line");
      const sideSel = row.querySelector(".prop-leg-side");
      let timer = null;
      const commit = () => {
        const line = Number(lineInput?.value);
        const side = sideSel?.value || "more";
        editLeg(id, line, side);
      };
      lineInput?.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(commit, 280);
      });
      lineInput?.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          clearTimeout(timer);
          commit();
          lineInput.blur();
        }
      });
      lineInput?.addEventListener("blur", () => {
        clearTimeout(timer);
        commit();
      });
      sideSel?.addEventListener("change", commit);
    });
  }

  function syncDock() {
    const evals = evaluatedLegs();
    const add = document.getElementById("dockAdd");
    const best = document.getElementById("dockBest4");
    const compare = document.getElementById("dockCompare");
    if (add) add.disabled = state.legs.length >= MAX_LEGS;
    if (best) {
      best.disabled = evals.length < 3;
      best.textContent = evals.length >= 4 ? "Best 4" : "Best 3";
    }
    if (compare) compare.disabled = evals.length < 2;
  }

  function updateAnalysisBar(a) {
    const bar = document.getElementById("analysisBar");
    const text = document.getElementById("analysisBarText");
    if (!bar) return;
    if (!a?.grade) {
      bar.hidden = true;
      bar.classList.remove("is-on");
      return;
    }
    bar.hidden = false;
    bar.classList.add("is-on");
    if (text) {
      const value = a.value;
      const together = a.together?.label ? ` · All hit ${a.together.label}` : "";
      const call = value?.verdictLabel ? ` · ${value.verdictLabel}` : "";
      text.textContent = `${a.grade}${call}${together} · Risk ${a.risk || "—"}`;
    }
  }

  function bindTipTaps(root) {
    (root || document).querySelectorAll(".prop-info, .prop-flag[title], .prop-tag-hi[title]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const tip = btn.getAttribute("title") || btn.getAttribute("data-tip") || "";
        if (!tip) return;
        let pop = btn.parentElement?.querySelector(".prop-info-tip");
        if (!pop || pop.previousElementSibling !== btn) {
          pop = document.createElement("span");
          pop.className = "prop-info-tip";
          btn.insertAdjacentElement("afterend", pop);
        }
        pop.textContent = tip;
        pop.classList.toggle("is-open");
      });
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
    const shareBtn = document.getElementById("shareLinkBtn");
    if (shareBtn) shareBtn.disabled = evals.length < 1;
    syncDock();
    if (!host) return;
    if (!evals.length) {
      host.className = "prop-summary-idle";
      host.innerHTML = "Add at least one evaluated leg to see if the card is worth putting in.";
      updateAnalysisBar(null);
      return;
    }
    if (!a) {
      host.className = "prop-summary-idle";
      host.innerHTML = '<p class="prop-loading">Scoring entry…</p>';
      return;
    }
    updateAnalysisBar(a);
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
    const together = a.together;
    const togetherNote = together
      ? together.corrUsed
        ? `Independent (if these ${together.n} legs were unrelated): ${escapeHtml(
            pctTogether(together.independent)
          )}. Correlations adjust that to ${escapeHtml(together.pctLabel)}.`
        : `These ${together.n} legs look independent, so all-hit is the product of the individual probabilities.`
      : "";
    const value = a.value;
    const verdictClass =
      value?.verdict === "play" ? "is-play" : value?.verdict === "lean" ? "is-lean" : value?.verdict === "pass" ? "is-pass" : "";
    const reasons = (value?.reasons || []).map((r) => `<li>${escapeHtml(r)}</li>`).join("");
    host.className = "";
    host.innerHTML = `
      ${
        value
          ? `<div class="prop-verdict ${verdictClass}">
              <div class="prop-verdict-head">
                <strong>${escapeHtml(value.verdictLabel)}</strong>
                <button type="button" class="prop-info" title="${escapeHtml(value.tooltip || "")}">i</button>
              </div>
              <p>${escapeHtml(value.summary || "")}</p>
              <p class="prop-verdict-ev">${escapeHtml(value.evLabel || "")} at ${escapeHtml(value.payout?.label || "")}</p>
            </div>`
          : ""
      }
      <div class="prop-grade-row">
        <div class="prop-kpi prop-kpi-together">
          <span>All hit <button type="button" class="prop-info" title="${escapeHtml(
            together?.tooltip || "Estimated chance every listed leg hits together."
          )}">i</button></span>
          <strong>${escapeHtml(together?.pctLabel || "—")}</strong>
          <em>${escapeHtml(together?.americanLabel || "")}</em>
        </div>
        <div class="prop-kpi"><span>Entry grade</span><strong>${escapeHtml(a.grade || "—")}</strong></div>
        <div class="prop-kpi"><span>Strength <button type="button" class="prop-info" title="${escapeHtml(
          a.strengthTooltip || "A relative score based on leg quality, confidence, correlation, and concentration. It is not the probability that every leg hits."
        )}">i</button></span><strong>${escapeHtml(String(a.entryStrength ?? "—"))}</strong></div>
        <div class="prop-kpi"><span>Risk</span><strong>${escapeHtml(a.risk || "—")}</strong></div>
      </div>
      ${togetherNote ? `<p class="prop-together-note">${togetherNote}</p>` : ""}
      <div class="prop-analysis-extra" id="summaryExtra">
        <details ${state.summaryOpen ? "open" : ""} data-extra="value">
          <summary>Why this call</summary>
          ${reasons ? `<ul class="prop-risk-drivers">${reasons}</ul>` : '<p class="prop-market-note">Add legs to score the card against a payout.</p>'}
        </details>
        <details ${state.summaryOpen ? "open" : ""} data-extra="strongest">
          <summary>Strongest leg</summary>
          <p class="prop-corr">${escapeHtml(a.strongestCaption || a.strongestLabel || a.strongest?.player?.name || "—")}</p>
        </details>
        <details ${state.summaryOpen ? "open" : ""} data-extra="weakest">
          <summary>Weakest leg</summary>
          <p class="prop-corr">${escapeHtml(a.weakestCaption || a.weakestLabel || a.weakest?.player?.name || "—")}</p>
        </details>
        <details ${state.summaryOpen ? "open" : ""} data-extra="risk">
          <summary>Risk drivers</summary>
          ${drivers ? `<ul class="prop-risk-drivers">${drivers}</ul>` : '<p class="prop-market-note">No major risk drivers flagged.</p>'}
        </details>
        <details ${state.summaryOpen ? "open" : ""} data-extra="corr">
          <summary>Correlations</summary>
          ${corrs || '<p class="prop-corr">No material correlations flagged.</p>'}
        </details>
        <details ${state.summaryOpen ? "open" : ""} data-extra="opt">
          <summary>Optimizer</summary>
          <div class="prop-opt-mode">
            <button type="button" class="prop-chip ${state.bestMode === "upside" ? "is-on" : ""}" data-mode="upside">Highest Upside</button>
            <button type="button" class="prop-chip ${state.bestMode === "balanced" ? "is-on" : ""}" data-mode="balanced">Balanced</button>
            <button type="button" class="prop-chip ${state.bestMode === "risk" ? "is-on" : ""}" data-mode="risk">Lowest Risk</button>
          </div>
          <p class="prop-market-note">${escapeHtml(a.note || "")}</p>
        </details>
      </div>
    `;
    host.querySelectorAll("#summaryExtra details").forEach((el) => {
      el.addEventListener("toggle", () => {
        state.summaryOpen = [...host.querySelectorAll("#summaryExtra details")].some((d) => d.open);
      });
    });
    host.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.bestMode = btn.getAttribute("data-mode");
        refreshAnalysis().then(() => {
          renderSummary();
        });
      });
    });
    bindTipTaps(host);
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
    return `<table class="prop-log"><thead><tr><th>Wk</th><th>Opp</th><th>Result</th><th>Value</th>${extraHead}<th>Hit</th></tr></thead><tbody>${body}</tbody></table>
      <div class="prop-log-stack">${list
        .map((g) => {
          const hit = g.hit ? "Hit" : "Miss";
          return `<div class="prop-log-card${g.isFcs ? " is-fcs" : ""}"><strong>Wk ${escapeHtml(
            String(g.week ?? "—")
          )}</strong> · ${escapeHtml(g.opp || "—")}${g.isFcs ? " · FCS" : ""} · ${escapeHtml(fmt(g.value, 1))} · ${hit}</div>`;
        })
        .join("")}</div>
      <p class="prop-log-key">* FCS opponent</p>`;
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
        const unusual = e.lineSanity?.unusual
          ? `<div class="prop-unusual"><strong>Unusual line</strong> ${escapeHtml(e.lineSanity.message || "")}</div>`
          : "";
        const hiLo =
          e.highProbLowConf || (pHit >= 0.8 && ["C", "D"].includes(e.confidence))
            ? `<span class="prop-tag-hi" title="The line is far from the modeled range, but the current data sample is limited.">High probability, low confidence</span>`
            : "";
        const fcsHint = e.fcs?.of ? `FCS-heavy: ${e.fcs.games} of ${e.fcs.of} games` : "";
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
          <p class="prop-card-sub prop-dist-line">Mean ${escapeHtml(fmt(e.projection, 1))} · Median ${escapeHtml(
          fmt(e.median, 1)
        )} · SD ${escapeHtml(fmt(e.distribution?.sd, 1))} · P20–P80 ${escapeHtml(fmt(e.range?.p20, 0))}–${escapeHtml(
          fmt(e.range?.p80, 0)
        )}</p>
          <div class="prop-flags">${flagHtml(e.flags, e.fcs)}${fcsHint && !(e.flags || []).includes("FCS-Heavy Sample") ? `<span class="prop-flag" title="${escapeHtml(FLAG_HELP["FCS-Heavy Sample"])}">${escapeHtml(fcsHint)}</span>` : ""}</div>
          ${e.scheduleWarning ? `<p class="prop-error">${escapeHtml(e.scheduleWarning)}</p>` : ""}
          <div class="prop-sec"><h4>Why ${escapeHtml((e.side || "more").toUpperCase())}</h4><p>${escapeHtml(whyOne)}</p></div>
          <div class="prop-sec"><h4>Caution</h4><p>${escapeHtml(cautionOne)}</p></div>
          <details class="prop-acc" data-acc="form"><summary>Recent form</summary>
            <div class="prop-form-grid">
              <div><span>Season</span><strong>${fmt(e.form?.season, 1)}</strong></div>
              <div><span>L3</span><strong>${fmt(e.form?.l3, 1)}</strong></div>
              <div><span>Prior</span><strong>${fmt(e.form?.prior, 1)}</strong></div>
              <div><span>Hit</span><strong>${escapeHtml(e.hitCountLabel || "—")}</strong></div>
            </div>
            <p class="prop-market-note">Mean ${escapeHtml(fmt(e.projection, 1))} · Median ${escapeHtml(fmt(e.median, 1))} · SD ${escapeHtml(
          fmt(e.distribution?.sd, 1)
        )} · P20–P80 ${escapeHtml(fmt(e.range?.p20, 0))}–${escapeHtml(fmt(e.range?.p80, 0))}</p>
          </details>
          <details class="prop-acc" data-acc="usage"><summary>Usage</summary><p>${escapeHtml(share)} · Role: ${escapeHtml(e.usage?.role)} — ${escapeHtml(
          e.usage?.roleDetail || ""
        )}${e.usage?.inferred ? " · inferred" : ""}</p></details>
          <details class="prop-acc" data-acc="matchup"><summary>Matchup</summary>
              <p>${escapeHtml(e.matchup?.headline ? `Matchup: ${e.matchup.headline}` : e.matchup?.note || "")}</p>
              <ul>${factors}</ul>
              <p class="prop-market-note">Projection adjustment: ${escapeHtml(
                e.matchup?.adjPctDisplay != null ? `${e.matchup.adjPctDisplay}%` : "—"
              )}</p>
          </details>
          <details class="prop-acc" data-acc="env"><summary>Game environment</summary>
              <p>Blowout risk: ${escapeHtml(e.environment?.blowoutRisk || "—")} · ${escapeHtml(
          (e.environment?.notes || []).join(" · ") || "No script adjustment"
        )}</p>${market}
          </details>
          <details class="prop-acc" data-acc="why"><summary>Why the model likes ${(e.side || "more").toUpperCase()}</summary><ul>${(e.why || [])
          .map((x) => `<li>${escapeHtml(x)}</li>`)
          .join("")}</ul></details>
          <details class="prop-acc" data-acc="caution"><summary>Reasons for caution</summary><ul>${(e.caution || [])
          .map((x) => `<li>${escapeHtml(x)}</li>`)
          .join("")}</ul></details>
          <details class="prop-acc" data-acc="break"><summary>Projection breakdown</summary><div class="prop-breakdown">${breakdown}<div class="is-final">Final: ${fmt(
          e.projection,
          1
        )}</div></div></details>
          <details class="prop-acc" data-acc="log" data-expand-log="${escapeHtml(leg.id)}"><summary>Game log</summary><div data-log-host></div></details>
          <details class="prop-acc" data-acc="whatif"><summary>What-if lines</summary>
              <div class="prop-whatif" data-id="${escapeHtml(leg.id)}">
                ${alts.map((n) => `<button type="button" data-line="${n}">${n} → …</button>`).join("")}
                <label>Custom <input type="number" step="0.5" inputmode="decimal" value="${escapeHtml(String(line))}" data-custom></label>
                <button type="button" class="prop-chip" data-apply>Apply line</button>
              </div>
          </details>
          <details class="prop-acc prop-debug" data-acc="debug"${debugMode ? " open" : ""}><summary>Model Debug</summary><pre data-debug-host></pre></details>
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
    host.querySelectorAll("details[data-expand-log]").forEach((el) => {
      el.addEventListener("toggle", () => {
        if (!el.open) return;
        const hostLog = el.querySelector("[data-log-host]");
        if (hostLog && !hostLog.innerHTML) {
          const leg = state.legs.find((l) => l.id === el.getAttribute("data-expand-log"));
          hostLog.innerHTML = logTable(leg?.evaluation?.gameLog, debugMode);
        }
      });
    });
    host.querySelectorAll("details.prop-acc").forEach((el) => {
      const card = el.closest(".prop-card");
      const key = `${card?.getAttribute("data-id")}:${el.getAttribute("data-acc")}`;
      if (state.expanded[key]) el.open = true;
      if (el.open && el.hasAttribute("data-expand-log")) {
        const hostLog = el.querySelector("[data-log-host]");
        const leg = state.legs.find((l) => l.id === el.getAttribute("data-expand-log"));
        if (hostLog && !hostLog.innerHTML) hostLog.innerHTML = logTable(leg?.evaluation?.gameLog, debugMode);
      }
      if (el.open && el.getAttribute("data-acc") === "debug") fillDebug(el, card?.getAttribute("data-id"));
      el.addEventListener("toggle", () => {
        state.expanded[key] = el.open;
        if (el.open && el.getAttribute("data-acc") === "debug") fillDebug(el, card?.getAttribute("data-id"));
      });
    });
    bindTipTaps(host);
  }

  function fillDebug(el, id) {
    const pre = el.querySelector("[data-debug-host]");
    if (!pre || pre.textContent) return;
    const e = state.legs.find((l) => l.id === id)?.evaluation;
    if (!e) return;
    const md = e.modelDebug || {};
    pre.textContent = JSON.stringify(
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
      },
      null,
      2
    );
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

  async function applyLine(legId, line, side, { keepList = false } = {}) {
    const leg = state.legs.find((l) => l.id === legId);
    if (!leg?.evaluation?.distribution || !Number.isFinite(line)) return;
    const nextSide = String(side || leg.side || "more").toLowerCase() === "less" ? "less" : "more";
    if (Number(leg.line) === Number(line) && String(leg.side || "more") === nextSide) return;
    try {
      const next = await api(
        { action: "reline" },
        { method: "POST", body: { evaluation: leg.evaluation, line, side: nextSide } }
      );
      leg.line = line;
      leg.side = nextSide;
      leg.evaluation = next;
      delete state.preview[legId];
      await refreshAnalysis();
      if (keepList) {
        patchLegKpis(legId);
        renderSummary();
        renderCards();
      } else {
        renderAll();
      }
    } catch {
      /* keep existing */
    }
  }

  function patchLegKpis(legId) {
    const row = document.querySelector(`.prop-leg[data-id="${CSS.escape(legId)}"]`);
    const leg = state.legs.find((l) => l.id === legId);
    const e = leg?.evaluation;
    if (!row || !e || e.error) return;
    const host = row.querySelector(".prop-leg-kpis");
    if (!host) return;
    host.innerHTML = `
      <div class="prop-kpi-chip"><span>Proj</span><strong>${escapeHtml(fmt(e.projection, 1))}</strong></div>
      <div class="prop-kpi-chip"><span>P(${escapeHtml((e.side || "more").toUpperCase())})</span><strong class="${
        e.pHit >= 0.58 ? "is-good" : e.pHit < 0.52 ? "is-bad" : "is-gold"
      }">${escapeHtml(pct(e.pHit))}</strong></div>
      <div class="prop-kpi-chip"><span>Score</span><strong>${escapeHtml(String(e.propScore ?? "—"))}</strong><em>${escapeHtml(
        e.propScoreLabel || ""
      )}</em></div>
      <div class="prop-kpi-chip"><span>Model Conf</span><strong>${escapeHtml(e.confidence || "")}</strong></div>
    `;
  }

  function editLeg(id, line, side) {
    if (!Number.isFinite(line) || line < 0) return;
    applyLine(id, line, side, { keepList: true });
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
      const data = await api({ action: "analyze" }, { method: "POST", body: { legs, mode: state.bestMode, payout: state.payoutOdds } });
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
            debug: !isMobile(),
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
    const keepIds = (result.keep || []).map((l) => l.clientId).filter(Boolean);
    const cutIds = (result.cut || []).map((l) => l.clientId).filter(Boolean);
    state.keepIds = keepIds;
    state.cutIds = cutIds;
    const keep = (result.keep || [])
      .map(
        (l) =>
          `<article class="prop-bestn-item is-keep"><span class="prop-bestn-tag">KEEP</span><p><strong>${escapeHtml(
            l.player?.name
          )}</strong> — ${escapeHtml(l.stat?.short || l.stat?.label || "")} ${escapeHtml(String(l.line ?? ""))} ${escapeHtml(
            (l.side || "").toUpperCase()
          )} · score ${escapeHtml(String(l.propScore))}</p></article>`
      )
      .join("");
    const cut = (result.cut || [])
      .map(
        (l) =>
          `<article class="prop-bestn-item is-cut"><span class="prop-bestn-tag">CUT</span><p><strong>${escapeHtml(
            l.player?.name
          )}</strong> — ${escapeHtml(l.stat?.short || l.stat?.label || "")} ${escapeHtml(String(l.line ?? ""))} ${escapeHtml(
            (l.side || "").toUpperCase()
          )} · score ${escapeHtml(String(l.propScore))}</p><p class="prop-market-note">${escapeHtml(
            l.cutReason || result.reason || "Removed to lower correlation or variance."
          )}</p></article>`
      )
      .join("");
    const why = (result.why || []).map((w) => `<li>${escapeHtml(w)}</li>`).join("");
    const together = result.together;
    const togetherLine = together?.label
      ? `<p class="prop-together-note">This ${n}-leg set all-hit: <strong>${escapeHtml(together.label)}</strong></p>`
      : "";
    panel.innerHTML = `<div class="matchup-panel-head"><h2 class="matchup-panel-title">Best ${n} of ${escapeHtml(String((result.keep || []).length + (result.cut || []).length))}</h2></div>
      <p class="prop-market-note">Mode: ${escapeHtml(result.mode || state.bestMode)} · Why this ${n}-leg set</p>
      ${togetherLine}
      ${why ? `<ul class="prop-risk-drivers">${why}</ul>` : ""}
      ${keep}${cut}
      <p class="prop-corr">${escapeHtml(result.reason || "")}</p>`;
    renderEntryList();
  }

  function renderCompare() {
    const panel = document.getElementById("comparePanel");
    const legs = evaluatedLegs().slice(0, 4);
    if (!panel || legs.length < 2) return;
    panel.hidden = false;
    const bestScore = Math.max(...legs.map((l) => l.propScore || 0));
    const cards = legs
      .map((l) => {
        const best = l.propScore === bestScore ? " is-best" : "";
        return `<article class="prop-compare-card${best}">
          <h3>${escapeHtml(l.player?.name)}</h3>
          <p class="prop-card-sub">${escapeHtml(l.stat?.short || l.stat?.label || "")} · ${escapeHtml(fmt(l.line, 1))} ${escapeHtml(
          (l.side || "").toUpperCase()
        )}</p>
          <div class="prop-compare-metrics">
            <div><span>Projection</span><strong>${escapeHtml(fmt(l.projection, 1))}</strong></div>
            <div><span>Probability</span><strong>${escapeHtml(pct(l.pHit))}</strong></div>
            <div><span>Score</span><strong>${escapeHtml(String(l.propScore))} ${escapeHtml(l.propScoreLabel || "")}</strong></div>
            <div><span>Confidence</span><strong>${escapeHtml(l.confidence || "—")}</strong></div>
            <div><span>Recent hit</span><strong>${escapeHtml(pct(l.form?.hitRateL5))}</strong></div>
            <div><span>Matchup</span><strong>${escapeHtml(l.matchup?.headline || (l.matchup?.adjPct != null ? `${(l.matchup.adjPct * 100).toFixed(1)}%` : "—"))}</strong></div>
          </div>
        </article>`;
      })
      .join("");
    const rows = legs
      .map((l) => {
        const best = l.propScore === bestScore ? "is-best" : "";
        return `<tr>
          <td>${escapeHtml(l.player?.name)}</td>
          <td>${escapeHtml(l.stat?.short || l.stat?.label)}</td>
          <td>${escapeHtml(fmt(l.line, 1))} ${escapeHtml((l.side || "").toUpperCase())}</td>
          <td>${escapeHtml(fmt(l.projection, 1))}</td>
          <td>${escapeHtml(pct(l.pHit))}</td>
          <td>${escapeHtml(pct(l.form?.hitRateL5))}</td>
          <td>${escapeHtml(l.matchup?.headline || "—")}</td>
          <td>Model Conf ${escapeHtml(l.confidence)}</td>
          <td class="${best}">${escapeHtml(String(l.propScore))} ${escapeHtml(l.propScoreLabel || "")}</td>
        </tr>`;
      })
      .join("");
    panel.innerHTML = `<div class="matchup-panel-head"><h2 class="matchup-panel-title">Compare legs</h2></div>
      <div class="prop-compare-cards">${cards}</div>
      <table><thead><tr><th>Player</th><th>Prop</th><th>Line</th><th>Proj</th><th>P(hit)</th><th>L5 hit</th><th>Matchup</th><th>Confidence</th><th>Prop Score</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function setSaveStatus(message, kind = "info") {
    const el = document.getElementById("saveStatus");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.className = "prop-save-status";
      return;
    }
    el.hidden = false;
    el.className = `prop-save-status is-${kind}`;
    el.textContent = message;
  }

  function defaultSaveTitle() {
    return `Week ${state.week || "?"} — ${evaluatedLegs().length}-leg card`;
  }

  function openSavePanel() {
    const panel = document.getElementById("savePanel");
    const title = document.getElementById("saveTitle");
    const preview = document.getElementById("savePreview");
    const legs = evaluatedLegs();
    if (!panel || !legs.length) return;
    if (!authToken()) {
      setSaveStatus("Log in to save cards to your account.", "err");
      return;
    }
    if (title && !title.value.trim()) title.value = defaultSaveTitle();
    if (preview) {
      const names = legs
        .slice(0, 4)
        .map((e) => `${e.player?.name || "Player"} ${String(e.side || "more").toUpperCase()} ${e.stat?.label || e.stat?.id || ""} ${e.line}`)
        .join(" · ");
      const more = legs.length > 4 ? ` · +${legs.length - 4} more` : "";
      preview.textContent = `${legs.length} leg${legs.length === 1 ? "" : "s"}: ${names}${more}`;
    }
    panel.hidden = false;
    setSaveStatus("");
    title?.focus();
    title?.select();
  }

  function closeSavePanel() {
    const panel = document.getElementById("savePanel");
    if (panel) panel.hidden = true;
  }

  function slimAnalysis(analysis) {
    if (!analysis || typeof analysis !== "object") return null;
    return {
      note: analysis.note || null,
      risk: analysis.risk || null,
      grade: analysis.grade || null,
      entryStrength: analysis.entryStrength ?? null,
      together: analysis.together || null,
      value: analysis.value || null,
      riskDrivers: analysis.riskDrivers || [],
      correlations: Array.isArray(analysis.correlations)
        ? analysis.correlations.map((c) => ({
            label: c.label,
            explanation: c.explanation,
            sign: c.sign,
            corr: c.corr,
          }))
        : [],
      strongestCaption: analysis.strongestCaption || null,
      weakestCaption: analysis.weakestCaption || null,
      strongestLabel: analysis.strongestLabel || null,
      weakestLabel: analysis.weakestLabel || null,
    };
  }

  function cardSharePayload(legs, analysis, meta = {}) {
    return {
      v: 1,
      title: meta.title || defaultSaveTitle(),
      seasonYear: meta.seasonYear ?? state.season,
      weekNumber: meta.weekNumber ?? state.week,
      modelVersion: meta.modelVersion || legs[0]?.modelVersion || null,
      // Keep analysis lean — full evaluate dumps blow past useful share sizes
      // and slow open-on-friend-device to a crawl.
      analysis: slimAnalysis(analysis),
      legs: (legs || []).map((e) => ({
        playerId: e.player?.id,
        playerName: e.player?.name,
        team: e.player?.team,
        position: e.player?.position,
        opponent: e.opponent?.name || e.opponent,
        statId: e.stat?.id,
        statLabel: e.stat?.label,
        line: e.line,
        side: e.side,
        projection: e.projection,
        pHit: e.pHit,
        pMore: e.pMore,
        pLess: e.pLess,
        confidence: e.confidence,
        propScore: e.propScore,
        propScoreLabel: e.propScoreLabel,
        flags: e.flags,
        modelVersion: e.modelVersion,
      })),
    };
  }

  function sharePageUrl(shareId) {
    // Prefer a stable prop-bet.html path even if the user somehow landed elsewhere.
    const basePath = /prop-bet\.html$/i.test(location.pathname)
      ? location.pathname
      : new URL("prop-bet.html", location.href).pathname;
    return `${location.origin}${basePath}?share=${encodeURIComponent(shareId)}`;
  }

  async function createShareLink(payload) {
    const data = await api(
      { action: "share" },
      { method: "POST", body: { action: "share", payload } }
    );
    if (!data.shareId) throw new Error("Share link was not created");
    return sharePageUrl(data.shareId);
  }

  async function loadSharePayload(shareId) {
    const data = await api({ action: "share", id: shareId });
    return data.payload || null;
  }

  function formatCardText(payload) {
    const lines = [
      payload.title || "Prop Lab card",
      `Week ${payload.weekNumber ?? "?"} · ${payload.seasonYear ?? ""}`.trim(),
    ];
    for (const l of payload.legs || []) {
      const side = String(l.side || "more").toUpperCase();
      const p = Number.isFinite(Number(l.pHit)) ? ` · P(hit) ${(Number(l.pHit) * 100).toFixed(0)}%` : "";
      lines.push(`• ${l.playerName || "Player"} ${side} ${l.statLabel || l.statId} ${l.line}${p}`);
    }
    if (payload.analysis?.value?.verdictLabel) {
      lines.push(`Verdict: ${payload.analysis.value.verdictLabel}`);
    }
    if (payload.analysis?.together?.label) {
      lines.push(`Together: ${payload.analysis.together.label}`);
    }
    return lines.filter(Boolean).join("\n");
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function applyCardPayload(payload, { frozen = true } = {}) {
    if (!payload || !Array.isArray(payload.legs) || !payload.legs.length) return false;
    state.legs = payload.legs.map((l) => ({
      id: uid(),
      playerId: l.playerId,
      name: l.playerName,
      team: l.team,
      statId: l.statId,
      statLabel: l.statLabel,
      line: Number(l.line),
      side: l.side || "more",
      loading: false,
      evaluation: {
        player: { id: l.playerId, name: l.playerName, team: l.team, position: l.position },
        opponent: typeof l.opponent === "string" ? { name: l.opponent } : l.opponent || null,
        stat: { id: l.statId, label: l.statLabel },
        line: Number(l.line),
        side: l.side || "more",
        projection: l.projection,
        pHit: l.pHit,
        pMore: l.pMore,
        pLess: l.pLess,
        confidence: l.confidence,
        propScore: l.propScore,
        propScoreLabel: l.propScoreLabel,
        flags: l.flags || [],
        modelVersion: l.modelVersion,
        frozen,
      },
    }));
    state.analysis = payload.analysis || null;
    if (payload.weekNumber != null) state.week = Number(payload.weekNumber) || state.week;
    if (payload.seasonYear != null) state.season = Number(payload.seasonYear) || state.season;
    renderAll();
    return true;
  }

  function applySavedEntry(entry) {
    const legs = (entry.legs || []).map((l) => {
      const snap = l.projection_snapshot || {};
      return {
        playerId: l.player_id,
        playerName: l.player_name,
        team: l.team,
        position: snap.position,
        opponent: l.opponent || snap.opponent,
        statId: l.stat_id,
        statLabel: snap.statLabel,
        line: Number(l.line),
        side: l.side,
        projection: snap.projection,
        pHit: snap.pHit,
        pMore: snap.pMore,
        pLess: snap.pLess,
        confidence: snap.confidence,
        propScore: snap.propScore,
        propScoreLabel: snap.propScoreLabel,
        flags: snap.flags,
        modelVersion: snap.modelVersion || entry.model_version,
      };
    });
    return applyCardPayload(
      {
        title: entry.title,
        seasonYear: entry.season_year,
        weekNumber: entry.week_number,
        modelVersion: entry.model_version,
        analysis: entry.entry_snapshot?.analysis || null,
        legs,
      },
      { frozen: true }
    );
  }

  async function saveEntryConfirm() {
    if (state.saveBusy) return;
    const legs = evaluatedLegs();
    if (!legs.length) {
      setSaveStatus("Add and evaluate at least one leg before saving.", "err");
      return;
    }
    if (!authToken()) {
      setSaveStatus("Log in to save cards to your account.", "err");
      return;
    }
    const titleInput = document.getElementById("saveTitle");
    const title = (titleInput?.value || "").trim() || defaultSaveTitle();
    state.saveBusy = true;
    const btn = document.getElementById("saveConfirmBtn");
    if (btn) btn.disabled = true;
    setSaveStatus("Saving card…", "info");
    try {
      const data = await api(
        { action: "save" },
        {
          method: "POST",
          body: {
            title,
            seasonYear: state.season,
            weekNumber: state.week,
            legs,
            analysis: state.analysis,
          },
        }
      );
      state.lastSavedId = data.entry?.id ?? null;
      closeSavePanel();
      setSaveStatus(`Saved “${title}”. Use Copy link on the card to share it.`, "ok");
      await loadSaved();
    } catch (err) {
      setSaveStatus(err.message || "Could not save this card.", "err");
    } finally {
      state.saveBusy = false;
      if (btn) btn.disabled = false;
    }
  }

  async function loadSaved() {
    const host = document.getElementById("savedEntries");
    if (!host) return;
    if (!authToken()) {
      host.innerHTML =
        "<p class='prop-market-note'>Log in to save cards here. Shared links still open without an account.</p>";
      return;
    }
    try {
      const data = await api({ action: "entries" });
      const rows = data.entries || [];
      if (!rows.length) {
        host.innerHTML = "<p class='prop-market-note'>No saved cards yet — build a card and hit Save.</p>";
        return;
      }
      host.innerHTML = rows
        .map((e) => {
          const preview = e.entry_snapshot?.legsPreview || [];
          const legLines = preview.length
            ? preview
                .slice(0, 4)
                .map(
                  (l) =>
                    `<li>${escapeHtml(l.playerName || "Player")} · ${escapeHtml(
                      String(l.side || "more").toUpperCase()
                    )} ${escapeHtml(l.statLabel || l.statId || "")} ${escapeHtml(String(l.line))}</li>`
                )
                .join("") +
              (preview.length > 4 ? `<li>+${preview.length - 4} more</li>` : "")
            : `<li>${escapeHtml(String(e.week_number != null ? `Week ${e.week_number}` : "Saved card"))}</li>`;
          const confirm =
            String(state.deleteConfirmId) === String(e.id)
              ? `<div class="prop-saved-confirm">Delete this card?
                   <button type="button" class="btn btn-gold btn-sm" data-confirm-delete="${escapeHtml(String(e.id))}">Yes, delete</button>
                   <button type="button" class="btn btn-outline-light btn-sm" data-cancel-delete>Keep</button>
                 </div>`
              : `<div class="prop-saved-actions">
                   <button type="button" class="btn btn-gold btn-sm" data-load="${escapeHtml(String(e.id))}">Load</button>
                   <button type="button" class="btn btn-outline-light btn-sm" data-copy="${escapeHtml(String(e.id))}">Copy link</button>
                   <button type="button" class="btn btn-outline-light btn-sm" data-delete="${escapeHtml(String(e.id))}">Delete</button>
                 </div>`;
          return `<article class="prop-saved-card" data-eid="${escapeHtml(String(e.id))}">
            <div class="prop-saved-card-top">
              <strong>${escapeHtml(e.title || "Untitled card")}</strong>
              <span class="prop-saved-meta">Week ${escapeHtml(String(e.week_number ?? "?"))} · v${escapeHtml(
                e.model_version || "?"
              )} · ${escapeHtml(String(e.created_at || "").slice(0, 10))}</span>
            </div>
            <ul class="prop-saved-legs">${legLines}</ul>
            ${confirm}
          </article>`;
        })
        .join("");

      host.querySelectorAll("[data-load]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-load");
          setSaveStatus("Loading card…", "info");
          try {
            const row = await api({ action: "entry", id });
            if (!applySavedEntry(row.entry)) {
              setSaveStatus("That card has no legs to load.", "err");
              return;
            }
            setSaveStatus(`Loaded “${row.entry.title || "card"}” (frozen snapshot).`, "ok");
            document.getElementById("propCards")?.scrollIntoView({ behavior: "smooth", block: "start" });
          } catch (err) {
            setSaveStatus(err.message || "Could not load that card.", "err");
          }
        });
      });

      host.querySelectorAll("[data-copy]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-copy");
          setSaveStatus("Creating share link…", "info");
          try {
            const row = await api({ action: "entry", id });
            const entry = row.entry;
            const legs = (entry.legs || []).map((l) => {
              const snap = l.projection_snapshot || {};
              return {
                player: { id: l.player_id, name: l.player_name, team: l.team, position: snap.position },
                opponent: { name: l.opponent },
                stat: { id: l.stat_id, label: snap.statLabel },
                line: Number(l.line),
                side: l.side,
                projection: snap.projection,
                pHit: snap.pHit,
                pMore: snap.pMore,
                pLess: snap.pLess,
                confidence: snap.confidence,
                propScore: snap.propScore,
                propScoreLabel: snap.propScoreLabel,
                flags: snap.flags,
                modelVersion: snap.modelVersion || entry.model_version,
              };
            });
            const payload = cardSharePayload(legs, entry.entry_snapshot?.analysis, {
              title: entry.title,
              seasonYear: entry.season_year,
              weekNumber: entry.week_number,
              modelVersion: entry.model_version,
            });
            const link = await createShareLink(payload);
            showShareLink(link);
            await copyShareUrl(link);
          } catch (err) {
            setSaveStatus(err.message || "Could not copy that card.", "err");
          }
        });
      });

      host.querySelectorAll("[data-delete]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.deleteConfirmId = btn.getAttribute("data-delete");
          loadSaved();
        });
      });
      host.querySelectorAll("[data-cancel-delete]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.deleteConfirmId = null;
          loadSaved();
        });
      });
      host.querySelectorAll("[data-confirm-delete]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-confirm-delete");
          setSaveStatus("Deleting…", "info");
          try {
            await api({ action: "delete" }, { method: "POST", body: { id } });
            state.deleteConfirmId = null;
            setSaveStatus("Card deleted.", "ok");
            await loadSaved();
          } catch (err) {
            setSaveStatus(err.message || "Could not delete that card.", "err");
          }
        });
      });
    } catch {
      host.innerHTML =
        "<p class='prop-market-note'>Saved cards unavailable. If you just set up Prop Lab, refresh after the database tables are live.</p>";
    }
  }

  async function tryOpenSharedCard() {
    const params = new URLSearchParams(location.search);
    const shareId = params.get("share");
    if (!shareId) return;
    setSaveStatus("Opening shared card…", "info");
    try {
      const payload = await loadSharePayload(shareId);
      if (!applyCardPayload(payload, { frozen: true })) {
        setSaveStatus("That share link could not be read.", "err");
        return;
      }
      setSaveStatus(
        `Opened shared card “${payload.title || ""}” — ${payload.legs.length} prop${
          payload.legs.length === 1 ? "" : "s"
        } loaded.`,
        "ok"
      );
      document.getElementById("entryList")?.scrollIntoView({ behavior: "smooth", block: "start" });
      try {
        const url = new URL(location.href);
        url.searchParams.delete("share");
        url.searchParams.delete("card");
        history.replaceState({}, "", url.pathname + url.search + url.hash);
      } catch {
        /* ignore */
      }
    } catch (err) {
      setSaveStatus(err.message || "That share link is missing or expired.", "err");
    }
  }

  function showShareLink(url) {
    const box = document.getElementById("shareLinkBox");
    const input = document.getElementById("shareLinkInput");
    if (input) input.value = url;
    if (box) {
      box.hidden = false;
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (input) {
      input.focus();
      input.select();
    }
  }

  async function publishShareLink() {
    const legs = evaluatedLegs();
    if (!legs.length) {
      setSaveStatus("Add and evaluate at least one leg before sharing.", "err");
      return null;
    }
    const titleInput = document.getElementById("saveTitle");
    const title = (titleInput?.value || "").trim() || defaultSaveTitle();
    const payload = cardSharePayload(legs, state.analysis, {
      title,
      seasonYear: state.season,
      weekNumber: state.week,
    });
    setSaveStatus("Creating share link…", "info");
    const link = await createShareLink(payload);
    showShareLink(link);
    return link;
  }

  async function copyShareUrl(url) {
    const ok = await copyText(url);
    setSaveStatus(
      ok
        ? "Share URL copied. Paste it to a friend — they will see the same props."
        : "Could not copy automatically — select the link above and copy it.",
      ok ? "ok" : "err"
    );
    return ok;
  }

  async function copyCurrentCardLink() {
    try {
      const link = await publishShareLink();
      if (link) await copyShareUrl(link);
    } catch (err) {
      setSaveStatus(err.message || "Could not create a share link.", "err");
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
    document.getElementById("payoutOdds")?.addEventListener("input", (e) => {
      state.payoutOdds = e.target.value;
      clearTimeout(state.payoutTimer);
      state.payoutTimer = setTimeout(() => {
        refreshAnalysis().then(renderSummary);
      }, 320);
    });
    document.getElementById("payoutOdds")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(state.payoutTimer);
        state.payoutOdds = e.target.value;
        refreshAnalysis().then(renderSummary);
      }
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
    document.getElementById("saveBtn")?.addEventListener("click", openSavePanel);
    document.getElementById("shareLinkBtn")?.addEventListener("click", copyCurrentCardLink);
    document.getElementById("saveConfirmBtn")?.addEventListener("click", saveEntryConfirm);
    document.getElementById("saveCopyBtn")?.addEventListener("click", copyCurrentCardLink);
    document.getElementById("shareLinkCopyBtn")?.addEventListener("click", async () => {
      const input = document.getElementById("shareLinkInput");
      const url = (input?.value || "").trim();
      if (!url) {
        await copyCurrentCardLink();
        return;
      }
      input.select();
      await copyShareUrl(url);
    });
    document.getElementById("shareLinkHideBtn")?.addEventListener("click", () => {
      const box = document.getElementById("shareLinkBox");
      if (box) box.hidden = true;
    });
    document.getElementById("saveCancelBtn")?.addEventListener("click", () => {
      closeSavePanel();
      setSaveStatus("");
    });
    document.getElementById("saveTitle")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        saveEntryConfirm();
      }
      if (ev.key === "Escape") {
        closeSavePanel();
        setSaveStatus("");
      }
    });
    document.getElementById("propBoardRefresh")?.addEventListener("click", () => loadBoard(state.boardLoaded));
    document.getElementById("dockAdd")?.addEventListener("click", () => {
      const ready =
        document.getElementById("playerId")?.value &&
        document.getElementById("propStat")?.value &&
        document.getElementById("propLine")?.value;
      if (ready) {
        addProp();
        return;
      }
      document.getElementById("addPropForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("playerSearch")?.click();
    });
    document.getElementById("dockBest4")?.addEventListener("click", () => {
      const n = evaluatedLegs().length >= 4 ? 4 : 3;
      refreshAnalysis().then(() => {
        renderBestN(n);
        renderSummary();
        document.getElementById("bestNPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    document.getElementById("dockCompare")?.addEventListener("click", () => {
      renderCompare();
      document.getElementById("comparePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("analysisBar")?.addEventListener("click", () => {
      state.summaryOpen = true;
      renderSummary();
      document.getElementById("entrySummary")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("propStat")?.addEventListener("change", () => {
      if (document.getElementById("propStat").value) document.getElementById("propLine")?.focus();
    });
    document.getElementById("propLine")?.addEventListener("focus", () => {
      setTimeout(() => document.getElementById("propLine")?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
    });
    document.getElementById("propLine")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("propSide")?.focus();
      }
    });
    document.getElementById("propSide")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addProp(e);
      }
    });
    try {
      const meta = await api({ action: "meta" }).catch(() => null);
      fillWeekSelect(meta || { week: { weekNumber: 3 }, season: 2026, modelVersion: "2.1.0" });
    } catch {
      fillWeekSelect({ week: { weekNumber: 3 }, season: 2026, modelVersion: "2.1.0" });
    }
    try {
      const catalog = await api({ action: "catalog" });
      if (catalog.positionRules) state.positionRules = catalog.positionRules;
      fillStats(catalog.stats);
    } catch {
      /* catalog stays empty until the function is reachable */
    }
    await loadSaved();
    await tryOpenSharedCard();
  });
})();
