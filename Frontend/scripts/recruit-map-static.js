/**
 * Public Recruit Map — static JSON only (no JawsDB).
 * Data: /data/recruits/manifest.json + dataset files.
 * Export: Client/scripts/export-recruit-map-data.js (CFBD → JSON; no MySQL).
 */
(function () {
  const RECRUITS_DATA_BASE = '/data/recruits/';
  let map = null;
  let clusterLayer = null;
  const markersById = {};
  const playerById = {};
  let recruitManifest = null;
  let allRecruits = [];
  let filterMeta = null;
  let recruitMapRedrawDebounceTimer = null;
  let datasetLoadToken = 0;

  function scheduleRedrawMapAndList() {
    if (recruitMapRedrawDebounceTimer) clearTimeout(recruitMapRedrawDebounceTimer);
    recruitMapRedrawDebounceTimer = setTimeout(function () {
      recruitMapRedrawDebounceTimer = null;
      redrawMapAndList();
    }, 280);
  }

  function setMapPendingBanner(visible, message) {
    const el = document.getElementById('recruitMapPendingBanner');
    if (!el) return;
    if (visible && message) {
      el.textContent = message;
      el.style.display = 'block';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function committedCollege(r) {
    const c = r.committedTo != null ? r.committedTo : r.committed_to;
    return c != null && String(c).trim() !== '' ? String(c).trim() : null;
  }

  function normalizeRecruitForUi(r) {
    const college = committedCollege(r);
    return {
      id: r.id,
      player_name: r.name || r.player_name || '',
      committed_to: college,
      team: college,
      school: r.school || null,
      team_school: r.team_school || null,
      conference: r.conference || null,
      season_year: r.year != null ? r.year : r.season_year,
      position: r.position || null,
      recruit_type: r.recruitType || r.recruit_type || null,
      hometown_city: r.city || r.hometown_city || null,
      hometown_state: r.stateProvince || r.hometown_state || null,
      hometown_country: r.country || r.hometown_country || null,
      hometown_full: r.hometown || r.hometown_full || null,
      latitude: r.latitude,
      longitude: r.longitude,
      stars: r.stars,
      rating: r.rating,
      ranking: r.ranking,
    };
  }

  function hasValidCoords(p) {
    return Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
  }

  function uniqueSorted(values, desc) {
    const seen = {};
    const out = [];
    (values || []).forEach(function (v) {
      if (v == null || v === '') return;
      const key = String(v);
      if (seen[key]) return;
      seen[key] = true;
      out.push(v);
    });
    out.sort(function (a, b) {
      if (typeof a === 'number' && typeof b === 'number') {
        return desc ? b - a : a - b;
      }
      return String(a).localeCompare(String(b));
    });
    return out;
  }

  function buildFilterMeta(recruits) {
    const colleges = [];
    const conferences = [];
    const years = [];
    const states = [];
    const positions = [];
    const classifications = [];
    const starLevels = [];
    recruits.forEach(function (r) {
      const p = normalizeRecruitForUi(r);
      if (p.committed_to) colleges.push(p.committed_to);
      if (p.conference) conferences.push(p.conference);
      if (p.season_year != null) years.push(p.season_year);
      if (p.hometown_state) states.push(p.hometown_state);
      if (p.position) positions.push(p.position);
      if (p.recruit_type) classifications.push(p.recruit_type);
      if (p.stars != null) starLevels.push(p.stars);
    });
    return {
      colleges: uniqueSorted(colleges),
      conferences: uniqueSorted(conferences),
      years: uniqueSorted(years, true),
      states: uniqueSorted(states),
      positions: uniqueSorted(positions),
      classifications: uniqueSorted(classifications),
      starLevels: uniqueSorted(starLevels, true),
    };
  }

  async function fetchManifest() {
    const res = await fetch(RECRUITS_DATA_BASE + 'manifest.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json().catch(function () {
      return null;
    });
    if (!data || !Array.isArray(data.datasets)) return null;
    return data;
  }

  async function fetchRecruitDataset(file) {
    const res = await fetch(RECRUITS_DATA_BASE + file, { cache: 'no-store' });
    if (!res.ok) throw new Error('Dataset file not found');
    const data = await res.json().catch(function () {
      return null;
    });
    if (!Array.isArray(data)) throw new Error('Invalid recruit dataset');
    return data;
  }

  function datasetKey(entry) {
    return entry.year + ':' + entry.classification;
  }

  function datasetLabel(entry) {
    return (
      entry.year +
      ' · ' +
      entry.classification +
      ' (' +
      (entry.count != null ? entry.count : '?') +
      ')'
    );
  }

  function fillSelect(sel, values, formatter, emptyLabel) {
    const cur = sel.value;
    const first = emptyLabel != null ? emptyLabel : 'All';
    sel.innerHTML = '<option value="">' + first + '</option>';
    (values || []).forEach(function (v) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = formatter ? formatter(v) : String(v);
      sel.appendChild(o);
    });
    if ([...sel.options].some(function (opt) {
      return opt.value === cur;
    })) {
      sel.value = cur;
    }
  }

  function fillDatasetSelect(manifest, selectedKey) {
    const sel = document.getElementById('fltDataset');
    if (!sel) return;
    sel.innerHTML = '';
    (manifest.datasets || []).forEach(function (d) {
      const o = document.createElement('option');
      o.value = datasetKey(d);
      o.textContent = datasetLabel(d);
      sel.appendChild(o);
    });
    if (
      selectedKey &&
      [...sel.options].some(function (o) {
        return o.value === selectedKey;
      })
    ) {
      sel.value = selectedKey;
    } else if (sel.options.length) {
      sel.selectedIndex = 0;
    }
  }

  function fillCollegeDatalist(colleges) {
    const list = document.getElementById('fltTeamList');
    if (!list) return;
    list.innerHTML = '';
    (colleges || []).forEach(function (name) {
      const o = document.createElement('option');
      o.value = String(name);
      list.appendChild(o);
    });
  }

  function applyFilterMetaToSelects() {
    if (!filterMeta) return;
    fillCollegeDatalist(filterMeta.colleges);
    fillSelect(document.getElementById('fltConference'), filterMeta.conferences, null, 'All conferences');
    fillSelect(document.getElementById('fltYear'), filterMeta.years, String, 'All years');
    fillSelect(document.getElementById('fltState'), filterMeta.states, null, 'All states');
    fillSelect(document.getElementById('fltPosition'), filterMeta.positions, null, 'All positions');
    fillSelect(document.getElementById('fltClassification'), filterMeta.classifications, null, 'All');
    fillSelect(document.getElementById('fltStars'), filterMeta.starLevels, String, 'All');
  }

  function starDisplay(stars) {
    let n = parseInt(String(stars), 10);
    if (!Number.isFinite(n) || n <= 0) return '';
    n = Math.min(5, Math.max(1, n));
    return String(n) + '★';
  }

  function hometownText(p) {
    return (
      p.hometown_full ||
      [p.hometown_city, p.hometown_state, p.hometown_country].filter(Boolean).join(', ') ||
      '—'
    );
  }

  function recruitBadgesHtml(p, mutedClass) {
    const muted = mutedClass || 'recruit-badge-muted';
    const badges = [];
    const sd = starDisplay(p.stars);
    if (sd) badges.push('<span class="recruit-badge">' + escapeHtml(sd) + '</span>');
    if (p.position) badges.push('<span class="recruit-badge ' + muted + '">' + escapeHtml(p.position) + '</span>');
    if (p.season_year != null) {
      badges.push('<span class="recruit-badge ' + muted + '">' + escapeHtml(String(p.season_year)) + '</span>');
    }
    if (p.recruit_type) {
      badges.push('<span class="recruit-badge ' + muted + '">' + escapeHtml(String(p.recruit_type)) + '</span>');
    }
    if (p.committed_to) {
      badges.push('<span class="recruit-badge">' + escapeHtml(p.committed_to) + '</span>');
    }
    return badges.length ? '<div class="recruit-badges">' + badges.join('') + '</div>' : '';
  }

  function recruitStatsLine(p) {
    const bits = [];
    if (p.rating != null && Number.isFinite(Number(p.rating))) {
      bits.push('Rating: ' + Number(p.rating).toFixed(2));
    }
    if (p.ranking != null && Number.isFinite(Number(p.ranking))) {
      bits.push('National rank: #' + String(p.ranking));
    }
    return bits.length
      ? '<div class="recruit-detail-stats">' + escapeHtml(bits.join(' · ')) + '</div>'
      : '';
  }

  function commitDisplay(p) {
    return p.committed_to ? String(p.committed_to) : 'Uncommitted';
  }

  function playerListRowHtml(p) {
    const ht = hometownText(p);
    const commit = commitDisplay(p);
    const stats = [];
    if (p.rating != null && Number.isFinite(Number(p.rating))) {
      stats.push('r' + Number(p.rating).toFixed(2));
    }
    if (p.ranking != null && Number.isFinite(Number(p.ranking))) {
      stats.push('#' + String(p.ranking));
    }
    return (
      '<div class="recruit-card-name">' +
      escapeHtml(p.player_name) +
      '</div>' +
      recruitBadgesHtml(p, 'recruit-badge-muted') +
      '<div class="recruit-card-meta">' +
      escapeHtml(commit) +
      (stats.length ? ' · ' + escapeHtml(stats.join(' · ')) : '') +
      '</div>' +
      '<div class="recruit-card-meta recruit-card-hometown">🏠 ' +
      escapeHtml(ht) +
      '</div>'
    );
  }

  function matchesCollegeFilter(committedTo, filterVal) {
    if (!filterVal) return true;
    if (!committedTo) return false;
    const c = String(committedTo).toLowerCase();
    const f = filterVal.toLowerCase();
    return c === f || c.indexOf(f) !== -1;
  }

  function updateFilterActiveStates() {
    const wrapMap = { fltTeam: 'wrapFltTeam' };
    ['fltTeam', 'fltConference', 'fltYear', 'fltState', 'fltPosition', 'fltClassification', 'fltStars', 'fltSearch', 'fltSchool', 'fltDataset'].forEach(
      function (inputId) {
        const el = document.getElementById(inputId);
        if (!el) return;
        const wrap = wrapMap[inputId] ? document.getElementById(wrapMap[inputId]) : el.parentElement;
        if (!wrap) return;
        wrap.classList.toggle('filter-active', !!(el.value && String(el.value).trim()));
      }
    );
  }

  function popupHtml(p) {
    const ht = hometownText(p);
    const commit = commitDisplay(p);
    return (
      '<div class="recruit-popup">' +
      '<div class="recruit-popup-name">' +
      escapeHtml(p.player_name) +
      '</div>' +
      recruitBadgesHtml(p, 'recruit-badge-muted') +
      '<div class="recruit-popup-line"><strong>Committed:</strong> ' +
      escapeHtml(commit) +
      '</div>' +
      (p.school
        ? '<div class="recruit-popup-line"><strong>High school:</strong> ' + escapeHtml(p.school) + '</div>'
        : '') +
      '<div class="recruit-popup-line">🏠 ' + escapeHtml(ht) + '</div>' +
      recruitStatsLine(p) +
      '</div>'
    );
  }

  function detailHtml(p) {
    const ht = hometownText(p);
    const commit = commitDisplay(p);
    return (
      '<div class="recruit-detail-name">' +
      escapeHtml(p.player_name) +
      '</div>' +
      recruitBadgesHtml(p, 'recruit-badge-muted') +
      '<div class="recruit-detail-line"><strong>Committed:</strong> ' +
      escapeHtml(commit) +
      '</div>' +
      (p.school
        ? '<div class="recruit-detail-line"><strong>High school:</strong> ' + escapeHtml(p.school) + '</div>'
        : '') +
      '<div class="recruit-detail-line recruit-card-hometown">🏠 <strong>Hometown:</strong> ' +
      escapeHtml(ht) +
      '</div>' +
      (p.conference
        ? '<div class="recruit-detail-line"><strong>Conference:</strong> ' + escapeHtml(p.conference) + '</div>'
        : '') +
      recruitStatsLine(p)
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getFilterParams() {
    function v(id) {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }
    const params = {};
    if (v('fltTeam')) params.team = v('fltTeam');
    if (v('fltConference')) params.conference = v('fltConference');
    if (v('fltYear')) params.year = v('fltYear');
    if (v('fltState')) params.state = v('fltState');
    if (v('fltPosition')) params.position = v('fltPosition');
    if (v('fltClassification')) params.classification = v('fltClassification');
    if (v('fltStars')) params.stars = v('fltStars');
    if (v('fltSearch')) params.search = v('fltSearch');
    if (v('fltSchool')) params.school = v('fltSchool');
    return params;
  }

  function filterRecruits(recruits, params) {
    const search = (params.search || '').toLowerCase();
    const schoolQ = (params.school || '').toLowerCase();
    return recruits.filter(function (raw) {
      const p = normalizeRecruitForUi(raw);
      if (params.team && !matchesCollegeFilter(p.committed_to, params.team)) return false;
      if (params.conference && p.conference !== params.conference) return false;
      if (params.year && String(p.season_year) !== String(params.year)) return false;
      if (params.state && p.hometown_state !== params.state) return false;
      if (params.position && p.position !== params.position) return false;
      if (params.classification && p.recruit_type !== params.classification) return false;
      if (params.stars !== '' && params.stars != null && String(p.stars) !== String(params.stars)) {
        return false;
      }
      if (search && String(p.player_name).toLowerCase().indexOf(search) === -1) return false;
      if (schoolQ && String(p.school || '').toLowerCase().indexOf(schoolQ) === -1) return false;
      return true;
    });
  }

  function selectPlayerRow(id, scroll) {
    document.querySelectorAll('.player-list-row').forEach(function (r) {
      r.classList.toggle('active', r.dataset.playerId === String(id));
    });
    const p = playerById[id];
    if (p) {
      document.getElementById('detailBox').innerHTML = detailHtml(p);
    }
    if (scroll) {
      const row = document.querySelector('.player-list-row[data-player-id="' + id + '"]');
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function redrawMapAndList() {
    const params = getFilterParams();
    const wrap = document.getElementById('playerList');
    const countEl = document.getElementById('resultCount');
    wrap.innerHTML = '';
    Object.keys(markersById).forEach(function (k) {
      delete markersById[k];
    });
    Object.keys(playerById).forEach(function (k) {
      delete playerById[k];
    });

    const filtered = filterRecruits(allRecruits, params);
    const withCoordsAll = allRecruits.filter(function (r) {
      return hasValidCoords(normalizeRecruitForUi(r));
    }).length;
    let onMap = 0;

    if (clusterLayer) clusterLayer.clearLayers();

    filtered.forEach(function (raw) {
      const p = normalizeRecruitForUi(raw);
      playerById[p.id] = p;

      let m = null;
      if (hasValidCoords(p)) {
        m = L.marker([p.latitude, p.longitude]);
        m.bindPopup(popupHtml(p));
        m.__player = p;
        m.on('click', function () {
          selectPlayerRow(p.id, true);
        });
        clusterLayer.addLayer(m);
        markersById[p.id] = m;
        onMap += 1;
      }

      const row = document.createElement('div');
      row.className = 'player-list-row';
      row.dataset.playerId = String(p.id);
      if (!hasValidCoords(p)) row.style.opacity = '0.72';
      row.innerHTML = playerListRowHtml(p);
      row.addEventListener('click', function () {
        selectPlayerRow(p.id);
        if (hasValidCoords(p)) {
          map.setView([p.latitude, p.longitude], Math.max(map.getZoom(), 11));
          if (m) m.openPopup();
        }
      });
      wrap.appendChild(row);
    });

    if (!filtered.length) {
      wrap.innerHTML =
        '<div style="padding:1rem; text-align:center; color:#d7c1a1;">No players match these filters.</div>';
    }

    countEl.textContent =
      filtered.length +
      ' shown · ' +
      onMap +
      ' on map · ' +
      withCoordsAll +
      ' with coords · ' +
      allRecruits.length +
      ' loaded';

    if (allRecruits.length > 0 && withCoordsAll === 0) {
      setMapPendingBanner(true, 'Recruits are loaded but none have map coordinates yet.');
    } else if (filtered.length > 0 && onMap === 0) {
      setMapPendingBanner(true, 'No recruits with coordinates match these filters.');
    } else {
      setMapPendingBanner(false);
    }

    updateFilterActiveStates();
    if (map) {
      setTimeout(function () {
        map.invalidateSize();
      }, 80);
    }
  }

  async function loadDatasetByKey(key) {
    if (!recruitManifest || !recruitManifest.datasets.length) return false;
    const entry = recruitManifest.datasets.find(function (d) {
      return datasetKey(d) === key;
    });
    if (!entry) return false;
    const token = ++datasetLoadToken;
    const recruits = await fetchRecruitDataset(entry.file);
    if (token !== datasetLoadToken) return false;
    allRecruits = recruits;
    filterMeta = buildFilterMeta(recruits);
    applyFilterMetaToSelects();
    redrawMapAndList();
    return true;
  }

  async function bootstrap() {
    const emptyEl = document.getElementById('recruitEmptyState');
    const mainEl = document.getElementById('recruitMainContent');

    recruitManifest = await fetchManifest();
    if (!recruitManifest || !recruitManifest.datasets.length) {
      emptyEl.style.display = 'block';
      mainEl.classList.add('recruit-hidden');
      return;
    }

    emptyEl.style.display = 'none';
    mainEl.classList.remove('recruit-hidden');
    setMapPendingBanner(false);

    map = L.map('recruitMap').setView([39.8283, -98.5795], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    clusterLayer = L.markerClusterGroup({ maxClusterRadius: 52 });
    map.addLayer(clusterLayer);
    setTimeout(function () {
      if (map) map.invalidateSize();
    }, 150);

    fillDatasetSelect(recruitManifest, null);
    const defaultKey = datasetKey(recruitManifest.datasets[0]);
    document.getElementById('fltDataset').value = defaultKey;

    try {
      await loadDatasetByKey(defaultKey);
    } catch (e) {
      emptyEl.style.display = 'block';
      mainEl.classList.add('recruit-hidden');
      return;
    }

    document.getElementById('fltDataset').addEventListener('change', async function () {
      const key = document.getElementById('fltDataset').value;
      try {
        await loadDatasetByKey(key);
      } catch (e) {
        allRecruits = [];
        filterMeta = null;
        redrawMapAndList();
      }
    });

    ['fltConference', 'fltYear', 'fltState', 'fltPosition', 'fltClassification', 'fltStars'].forEach(
      function (id) {
        document.getElementById(id).addEventListener('change', scheduleRedrawMapAndList);
      }
    );
    const teamEl = document.getElementById('fltTeam');
    const searchEl = document.getElementById('fltSearch');
    const schoolEl = document.getElementById('fltSchool');
    let teamTmr;
    let searchTmr;
    let schoolTmr;
    if (teamEl) {
      teamEl.addEventListener('input', function () {
        clearTimeout(teamTmr);
        teamTmr = setTimeout(redrawMapAndList, 320);
      });
    }
    searchEl.addEventListener('input', function () {
      clearTimeout(searchTmr);
      searchTmr = setTimeout(redrawMapAndList, 320);
    });
    schoolEl.addEventListener('input', function () {
      clearTimeout(schoolTmr);
      schoolTmr = setTimeout(redrawMapAndList, 320);
    });
    document.getElementById('clearFiltersBtn').addEventListener('click', function () {
      ['fltTeam', 'fltConference', 'fltYear', 'fltState', 'fltPosition', 'fltClassification', 'fltStars'].forEach(
        function (id) {
          document.getElementById(id).value = '';
        }
      );
      searchEl.value = '';
      schoolEl.value = '';
      redrawMapAndList();
    });
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
