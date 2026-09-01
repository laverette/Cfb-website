/**
 * 2026 FBS conference membership overrides (static JSON).
 * Used by Teams page and recruit map.
 */
(function (global) {
  const MAP_URL = "/data/fbs-conferences-2026.json";
  let schoolToConference = {};
  let conferenceList = [];
  let supplementalTeams = [];
  let loaded = false;
  let loadPromise = null;

  function normKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function buildIndex(data) {
    schoolToConference = {};
    conferenceList = [];
    supplementalTeams = Array.isArray(data?.supplementalTeams) ? data.supplementalTeams : [];
    const groups = (data && data.conferences) || {};
    conferenceList = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    Object.keys(groups).forEach(function (conf) {
      (groups[conf] || []).forEach(function (school) {
        schoolToConference[normKey(school)] = conf;
      });
    });
  }

  function conferenceForSchool(schoolName) {
    if (!schoolName || !loaded) return null;
    return schoolToConference[normKey(schoolName)] || null;
  }

  function getConferenceList() {
    return conferenceList.slice();
  }

  async function load() {
    if (loaded) return true;
    if (loadPromise) return loadPromise;
    loadPromise = fetch(MAP_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (data) buildIndex(data);
        loaded = true;
        return true;
      })
      .catch(function () {
        loaded = true;
        return false;
      });
    return loadPromise;
  }

  function applyConferenceOverrides(teams, conferenceAbbreviation) {
    const abbrFn = typeof conferenceAbbreviation === "function" ? conferenceAbbreviation : (c) => c;
    return (teams || []).map(function (team) {
      const candidates = [
        team.school,
        team.name,
      ].filter(Boolean);
      let override = null;
      for (let i = 0; i < candidates.length && !override; i++) {
        override = conferenceForSchool(candidates[i]);
        if (!override && String(candidates[i]).includes(" ")) {
          const withoutLast = String(candidates[i]).split(" ").slice(0, -1).join(" ");
          override = conferenceForSchool(withoutLast);
        }
      }
      if (!override) return team;
      return {
        ...team,
        conference: override,
        conferenceAbbr: abbrFn(override),
      };
    });
  }

  function mergeSupplementalTeams(teams, conferenceAbbreviation) {
    const abbrFn = typeof conferenceAbbreviation === "function" ? conferenceAbbreviation : (c) => c;
    const existing = new Set(
      (teams || []).map((t) => normKey(t.school || t.name || ""))
    );
    const merged = [...(teams || [])];
    supplementalTeams.forEach(function (row) {
      const key = normKey(row.school);
      if (!key || existing.has(key)) return;
      merged.push({
        teamKey: encodeURIComponent(row.school),
        school: row.school,
        mascot: row.mascot || "",
        abbreviation: row.abbreviation || "",
        conference: row.conference || conferenceForSchool(row.school) || "",
        conferenceAbbr: abbrFn(row.conference || conferenceForSchool(row.school) || ""),
        logoUrl: row.logoUrl || "",
        name: row.mascot ? `${row.school} ${row.mascot}` : row.school,
      });
      existing.add(key);
    });
    return merged.sort((a, b) => String(a.school || a.name).localeCompare(String(b.school || b.name)));
  }

  global.FbsConferences = {
    load: load,
    conferenceForSchool: conferenceForSchool,
    getConferenceList: getConferenceList,
    applyConferenceOverrides: applyConferenceOverrides,
    mergeSupplementalTeams: mergeSupplementalTeams,
  };

  // Back-compat for recruit map
  global.RecruitFbsConferences = {
    load: load,
    conferenceForTeam: conferenceForSchool,
  };
})(window);
