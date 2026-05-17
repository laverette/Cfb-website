/**
 * 2026 FBS football conference lookup (static JSON only).
 */
(function (global) {
  const MAP_URL = "/data/fbs-conferences-2026.json";
  let schoolToConference = {};
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
    const groups = (data && data.conferences) || {};
    Object.keys(groups).forEach(function (conf) {
      (groups[conf] || []).forEach(function (school) {
        schoolToConference[normKey(school)] = conf;
      });
    });
  }

  function conferenceForTeam(teamName) {
    if (!teamName || !loaded) return null;
    const k = normKey(teamName);
    return schoolToConference[k] || null;
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

  global.RecruitFbsConferences = {
    load: load,
    conferenceForTeam: conferenceForTeam,
  };
})(window);
