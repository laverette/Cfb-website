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
  /** Committed college filter: only set when user selects a team from suggestions */
  let selectedCommittedTeam = '';
  let collegeSuggestionMatches = [];
  let collegeSuggestionsOpen = false;

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

  function getBranding(teamName) {
    if (window.RecruitTeamBranding && window.RecruitTeamBranding.lookup) {
      return window.RecruitTeamBranding.lookup(teamName);
    }
    return null;
  }

  function resolveFootballConference(college) {
    if (!college) return null;
    if (window.RecruitFbsConferences && window.RecruitFbsConferences.conferenceForTeam) {
      return window.RecruitFbsConferences.conferenceForTeam(college);
    }
    return null;
  }

  function normalizeRecruitForUi(r) {
    const college = committedCollege(r);
    const branding = college ? getBranding(college) : null;
    const loc =
      window.RecruitLocation &&
      window.RecruitLocation.locationKeyForRecruit({
        stateProvince: r.stateProvince || r.hometown_state,
        country: r.country || r.hometown_country,
      });
    return {
      id: r.id,
      player_name: r.name || r.player_name || '',
      committed_to: college,
      team: college,
      school: r.school || null,
      branding: branding,
      team_school: r.team_school || null,
      conference: resolveFootballConference(college),
      location_key: loc ? loc.key : null,
      location_label: loc ? loc.label : null,
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
    const locationMap = {};
    const positions = [];
    const classifications = [];
    const starLevels = [];
    recruits.forEach(function (r) {
      const p = normalizeRecruitForUi(r);
      if (p.committed_to) colleges.push(p.committed_to);
      if (p.conference) conferences.push(p.conference);
      if (p.season_year != null) years.push(p.season_year);
      if (p.location_key && p.location_label) {
        locationMap[p.location_key] = p.location_label;
      }
      if (p.position) positions.push(p.position);
      if (p.recruit_type) classifications.push(p.recruit_type);
      if (p.stars != null) starLevels.push(p.stars);
    });
    const locations = Object.keys(locationMap)
      .map(function (key) {
        return { key: key, label: locationMap[key] };
      })
      .sort(function (a, b) {
        if (window.RecruitLocation && window.RecruitLocation.sortLocationLabels) {
          return window.RecruitLocation.sortLocationLabels(a.label, b.label);
        }
        return a.label.localeCompare(b.label);
      });
    return {
      colleges: uniqueSorted(colleges),
      conferences: uniqueSorted(conferences),
      years: uniqueSorted(years, true),
      locations: locations,
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

  function fillLocationSelect(locations) {
    const sel = document.getElementById('fltLocation');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">All locations</option>';
    (locations || []).forEach(function (loc) {
      const o = document.createElement('option');
      o.value = loc.key;
      o.textContent = loc.label;
      sel.appendChild(o);
    });
    if ([...sel.options].some(function (opt) {
      return opt.value === cur;
    })) {
      sel.value = cur;
    }
  }

  function applyFilterMetaToSelects() {
    if (!filterMeta) return;
    fillLocationSelect(filterMeta.locations);
    fillSelect(document.getElementById('fltConference'), filterMeta.conferences, null, 'All conferences');
    fillSelect(document.getElementById('fltYear'), filterMeta.years, String, 'All years');
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

  function teamBadgeHtml(p) {
    if (!p.committed_to) return '';
    const b = p.branding;
    let style = '';
    if (b && b.primary && window.RecruitTeamBranding) {
      const on = window.RecruitTeamBranding.contrastTextColor(b.primary, '#f5deb3', '#1a1a1a');
      style =
        ' style="border-color:' +
        b.primary +
        ';background:color-mix(in srgb,' +
        b.primary +
        ' 28%, #1a1a1a);color:' +
        on +
        ';"';
    }
    return (
      '<span class="recruit-badge recruit-badge-team' +
      (b && b.primary ? ' has-team-color' : '') +
      '"' +
      style +
      '>' +
      escapeHtml(p.committed_to) +
      '</span>'
    );
  }

  function brandingLogoHtml(p, className) {
    if (!p.branding || !window.RecruitTeamBranding) return '';
    return window.RecruitTeamBranding.logoImgHtml(p.branding, className, p.committed_to || '');
  }

  function recruitBadgesHtml(p, mutedClass, opts) {
    opts = opts || {};
    const muted = mutedClass || 'recruit-badge-muted';
    const badges = [];
    const sd = starDisplay(p.stars);
    if (sd) badges.push('<span class="recruit-badge">' + escapeHtml(sd) + '</span>');
    if (p.position) badges.push('<span class="recruit-badge ' + muted + '">' + escapeHtml(p.position) + '</span>');
    if (p.season_year != null) {
      badges.push('<span class="recruit-badge ' + muted + '">' + escapeHtml(String(p.season_year)) + '</span>');
    }
    if (p.recruit_type && !opts.hideClass) {
      badges.push('<span class="recruit-badge ' + muted + '">' + escapeHtml(String(p.recruit_type)) + '</span>');
    }
    if (p.committed_to && !opts.hideCollege) {
      badges.push(teamBadgeHtml(p));
    }
    const cls = 'recruit-badges' + (opts.compact ? ' recruit-badges-compact' : '');
    return badges.length ? '<div class="' + cls + '">' + badges.join('') + '</div>' : '';
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
    const logo = brandingLogoHtml(p, 'recruit-team-logo-sm');
    const commitLine = escapeHtml(commit);
    return (
      '<div class="player-list-row-inner">' +
      (p.branding && p.branding.logo ? '<div class="player-list-row-logo">' + logo + '</div>' : '') +
      '<div class="player-list-row-body">' +
      '<div class="recruit-card-name">' +
      escapeHtml(p.player_name) +
      '</div>' +
      recruitBadgesHtml(p, 'recruit-badge-muted', { hideCollege: true, compact: true }) +
      '<div class="recruit-card-meta recruit-card-commit">' +
      commitLine +
      (stats.length ? ' · ' + escapeHtml(stats.join(' · ')) : '') +
      '</div>' +
      '<div class="recruit-card-meta recruit-card-hometown">🏠 ' +
      escapeHtml(ht) +
      '</div></div></div>'
    );
  }

  function applyRowTeamStyle(row, p) {
    if (p.branding && p.branding.primary && window.RecruitTeamBranding) {
      row.classList.add('has-team-branding');
      row.setAttribute('style', window.RecruitTeamBranding.brandStyleAttr(p.branding));
    } else {
      row.classList.remove('has-team-branding');
      row.removeAttribute('style');
    }
  }

  function matchesCollegeFilter(committedTo, filterVal) {
    if (!filterVal) return true;
    if (!committedTo) return false;
    return String(committedTo).toLowerCase() === String(filterVal).toLowerCase();
  }

  function hideCollegeSuggestions() {
    collegeSuggestionsOpen = false;
    collegeSuggestionMatches = [];
    const box = document.getElementById('fltTeamSuggestions');
    if (box) {
      box.hidden = true;
      box.innerHTML = '';
    }
  }

  function showCollegeSuggestions(matches) {
    const box = document.getElementById('fltTeamSuggestions');
    if (!box) return;
    collegeSuggestionMatches = matches || [];
    collegeSuggestionsOpen = collegeSuggestionMatches.length > 0;
    if (!collegeSuggestionsOpen) {
      hideCollegeSuggestions();
      return;
    }
    box.hidden = false;
    box.innerHTML = '';
    collegeSuggestionMatches.forEach(function (name, idx) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'college-suggestion-item' + (idx === 0 ? ' is-top' : '');
      btn.textContent = name;
      btn.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        selectCommittedCollege(name);
      });
      box.appendChild(btn);
    });
  }

  function updateCollegeSuggestionsFromInput() {
    const input = document.getElementById('fltTeam');
    if (!input || !filterMeta) return;
    const q = input.value.trim().toLowerCase();
    if (!q) {
      hideCollegeSuggestions();
      return;
    }
    const matches = (filterMeta.colleges || []).filter(function (name) {
      return String(name).toLowerCase().indexOf(q) !== -1;
    });
    matches.sort(function (a, b) {
      const al = a.toLowerCase();
      const bl = b.toLowerCase();
      const aExact = al === q;
      const bExact = bl === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      if (al.startsWith(q) && !bl.startsWith(q)) return -1;
      if (!al.startsWith(q) && bl.startsWith(q)) return 1;
      return a.localeCompare(b);
    });
    showCollegeSuggestions(matches.slice(0, 12));
  }

  function selectCommittedCollege(name) {
    const input = document.getElementById('fltTeam');
    selectedCommittedTeam = String(name).trim();
    if (input) input.value = selectedCommittedTeam;
    hideCollegeSuggestions();
    redrawMapAndList();
  }

  function clearCommittedCollegeSelection() {
    selectedCommittedTeam = '';
    hideCollegeSuggestions();
  }

  function onCollegeInputChange() {
    const input = document.getElementById('fltTeam');
    if (!input) return;
    const val = input.value.trim();
    if (!val) {
      clearCommittedCollegeSelection();
      redrawMapAndList();
      return;
    }
    if (
      selectedCommittedTeam &&
      val.toLowerCase() !== selectedCommittedTeam.toLowerCase()
    ) {
      selectedCommittedTeam = '';
      applyPageTeamThemeFromFilters();
      updateCollegeSuggestionsFromInput();
      redrawMapAndList();
      return;
    }
    updateCollegeSuggestionsFromInput();
  }

  function starMarkerTier(stars) {
    const n = parseInt(String(stars), 10);
    if (!Number.isFinite(n) || n <= 0) return 'low';
    if (n >= 5) return '5';
    if (n >= 4) return '4';
    if (n >= 3) return '3';
    return 'low';
  }

  function starMarkerLabel(stars) {
    const tier = starMarkerTier(stars);
    if (tier === '5') return '5';
    if (tier === '4') return '4';
    if (tier === '3') return '3';
    return '2';
  }

  function createStarMarkerIcon(p) {
    const tier = starMarkerTier(p.stars);
    const label = starMarkerLabel(p.stars);
    return L.divIcon({
      className: 'recruit-star-marker-wrap',
      html:
        '<div class="recruit-star-marker recruit-star-marker--' +
        tier +
        '" aria-label="' +
        label +
        ' star recruit">' +
        label +
        '</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });
  }

  function updateFilterActiveStates() {
    const wrapMap = { fltTeam: 'wrapFltTeam' };
    ['fltConference', 'fltYear', 'fltLocation', 'fltPosition', 'fltClassification', 'fltStars', 'fltSearch', 'fltSchool', 'fltDataset'].forEach(
      function (inputId) {
        const el = document.getElementById(inputId);
        if (!el) return;
        const wrap = wrapMap[inputId] ? document.getElementById(wrapMap[inputId]) : el.parentElement;
        if (!wrap) return;
        wrap.classList.toggle('filter-active', !!(el.value && String(el.value).trim()));
      }
    );
    const teamWrap = document.getElementById('wrapFltTeam');
    if (teamWrap) {
      teamWrap.classList.toggle('filter-active', !!selectedCommittedTeam);
    }
  }

  function popupHtml(p) {
    const ht = hometownText(p);
    const commit = commitDisplay(p);
    const brandCls = p.branding && p.branding.primary ? ' recruit-popup-branded' : '';
    const brandStyle =
      p.branding && window.RecruitTeamBranding
        ? window.RecruitTeamBranding.brandStyleAttr(p.branding)
        : '';
    const header =
      '<div class="recruit-popup-header">' +
      brandingLogoHtml(p, 'recruit-team-logo-popup') +
      '<div class="recruit-popup-name">' +
      escapeHtml(p.player_name) +
      '</div></div>';
    return (
      '<div class="recruit-popup' +
      brandCls +
      '"' +
      (brandStyle ? ' style="' + brandStyle + '"' : '') +
      '>' +
      header +
      recruitBadgesHtml(p, 'recruit-badge-muted', { hideCollege: true }) +
      '<div class="recruit-popup-line recruit-popup-commit"><strong>Committed:</strong> ' +
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
      '<div class="recruit-detail-inner">' +
      '<div class="recruit-detail-header">' +
      brandingLogoHtml(p, 'recruit-team-logo-detail') +
      '<div class="recruit-detail-name">' +
      escapeHtml(p.player_name) +
      '</div></div>' +
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
      recruitStatsLine(p) +
      '</div>'
    );
  }

  function applyPageTeamThemeFromFilters() {
    if (!window.RecruitTeamBranding) return;
    const brand = selectedCommittedTeam
      ? window.RecruitTeamBranding.lookup(selectedCommittedTeam)
      : null;
    window.RecruitTeamBranding.applyPageTheme(brand && brand.primary ? brand : null);
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
    if (selectedCommittedTeam) params.team = selectedCommittedTeam;
    if (v('fltConference')) params.conference = v('fltConference');
    if (v('fltYear')) params.year = v('fltYear');
    if (v('fltLocation')) params.location = v('fltLocation');
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
      if (
        params.location &&
        window.RecruitLocation &&
        !window.RecruitLocation.matchesLocationFilter(
          {
            stateProvince: p.hometown_state,
            country: p.hometown_country,
          },
          params.location
        )
      ) {
        return false;
      }
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
    const detailEl = document.getElementById('detailBox');
    if (p && detailEl) {
      detailEl.innerHTML = detailHtml(p);
      if (p.branding && p.branding.primary && window.RecruitTeamBranding) {
        detailEl.classList.add('has-team-branding');
        detailEl.setAttribute('style', window.RecruitTeamBranding.brandStyleAttr(p.branding));
      } else {
        detailEl.classList.remove('has-team-branding');
        detailEl.removeAttribute('style');
      }
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
        m = L.marker([p.latitude, p.longitude], { icon: createStarMarkerIcon(p) });
        const popupCls =
          'recruit-leaflet-popup' +
          (p.branding && p.branding.primary ? ' recruit-leaflet-popup-team' : '');
        m.bindPopup(popupHtml(p), { className: popupCls, maxWidth: 260 });
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
      applyRowTeamStyle(row, p);
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
    applyPageTeamThemeFromFilters();
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
    selectedCommittedTeam = '';
    const teamInput = document.getElementById('fltTeam');
    if (teamInput) teamInput.value = '';
    hideCollegeSuggestions();
    filterMeta = buildFilterMeta(recruits);
    applyFilterMetaToSelects();
    redrawMapAndList();
    return true;
  }

  async function bootstrap() {
    const emptyEl = document.getElementById('recruitEmptyState');
    const mainEl = document.getElementById('recruitMainContent');

    if (window.RecruitTeamBranding && window.RecruitTeamBranding.load) {
      await window.RecruitTeamBranding.load();
    }
    if (window.RecruitFbsConferences && window.RecruitFbsConferences.load) {
      await window.RecruitFbsConferences.load();
    }

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

    ['fltConference', 'fltYear', 'fltLocation', 'fltPosition', 'fltClassification', 'fltStars'].forEach(
      function (id) {
        document.getElementById(id).addEventListener('change', scheduleRedrawMapAndList);
      }
    );
    const teamEl = document.getElementById('fltTeam');
    const searchEl = document.getElementById('fltSearch');
    const schoolEl = document.getElementById('fltSchool');
    let searchTmr;
    let schoolTmr;
    if (teamEl) {
      teamEl.addEventListener('input', onCollegeInputChange);
      teamEl.addEventListener('focus', updateCollegeSuggestionsFromInput);
      teamEl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          if (collegeSuggestionMatches.length) {
            selectCommittedCollege(collegeSuggestionMatches[0]);
          } else if (filterMeta && filterMeta.colleges) {
            const q = teamEl.value.trim().toLowerCase();
            const exact = filterMeta.colleges.find(function (n) {
              return String(n).toLowerCase() === q;
            });
            if (exact) selectCommittedCollege(exact);
          }
          return;
        }
        if (ev.key === 'Escape') hideCollegeSuggestions();
      });
      teamEl.addEventListener('blur', function () {
        setTimeout(hideCollegeSuggestions, 180);
      });
    }
    document.addEventListener('mousedown', function (ev) {
      const wrap = document.getElementById('wrapFltTeam');
      if (!wrap || wrap.contains(ev.target)) return;
      hideCollegeSuggestions();
    });
    searchEl.addEventListener('input', function () {
      clearTimeout(searchTmr);
      searchTmr = setTimeout(redrawMapAndList, 320);
    });
    schoolEl.addEventListener('input', function () {
      clearTimeout(schoolTmr);
      schoolTmr = setTimeout(redrawMapAndList, 320);
    });
    document.getElementById('clearFiltersBtn').addEventListener('click', function () {
      ['fltConference', 'fltYear', 'fltLocation', 'fltPosition', 'fltClassification', 'fltStars'].forEach(
        function (id) {
          document.getElementById(id).value = '';
        }
      );
      if (teamEl) teamEl.value = '';
      clearCommittedCollegeSelection();
      searchEl.value = '';
      schoolEl.value = '';
      redrawMapAndList();
    });
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
