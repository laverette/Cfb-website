/**
 * Client-side committed-team branding for Recruit Map (static JSON only).
 */
(function (global) {
  const BRANDING_URL = "/data/team-branding.json";
  let index = {};
  let aliasIndex = {};
  let loaded = false;
  let loadPromise = null;

  function normKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[.'']/g, "'");
  }

  function parseSchoolFromFullName(teamName) {
    const s = String(teamName || "").trim();
    if (!s) return "";
    if (s.includes("Texas A&M")) return "Texas A&M";
    if (s.includes("Miami (OH)")) return "Miami (OH)";
    if (s.includes("NC State")) return "NC State";
    if (s.includes("App State")) return "App State";
    if (/^Ole Miss\b/i.test(s)) return "Ole Miss";
    if (/^Louisiana Ragin/i.test(s)) return "Louisiana";
    if (/^Southern Miss/i.test(s)) return "Southern Miss";
    if (/^UL Monroe/i.test(s)) return "UL Monroe";
    if (/^Sam Houston/i.test(s)) return "Sam Houston";
    if (/^San José State|^San Jose State/i.test(s)) return "San José State";
    if (/^Hawai/i.test(s)) return "Hawai'i";
    const parts = s.split(/\s+/);
    if (parts.length <= 1) return s;
    return parts.slice(0, -1).join(" ");
  }

  function buildIndex(data) {
    index = {};
    aliasIndex = {};
    const teams = (data && data.teams) || {};
    Object.keys(teams).forEach(function (school) {
      const brand = teams[school];
      const entry = Object.assign({ key: school }, brand);
      index[normKey(school)] = entry;
      if (brand.displayName) index[normKey(brand.displayName)] = entry;
    });
    const aliases = (data && data.aliases) || {};
    Object.keys(aliases).forEach(function (alias) {
      const target = aliases[alias];
      const brand = index[normKey(target)];
      if (brand) aliasIndex[normKey(alias)] = brand;
    });
  }

  function lookup(teamName) {
    if (!teamName || !loaded) return null;
    const raw = String(teamName).trim();
    if (!raw) return null;
    const tries = [raw, parseSchoolFromFullName(raw)];
    for (let i = 0; i < tries.length; i++) {
      const k = normKey(tries[i]);
      if (index[k]) return index[k];
      if (aliasIndex[k]) return aliasIndex[k];
    }
    return null;
  }

  function isExactFilterMatch(filterValue, brand) {
    if (!filterValue || !brand) return false;
    const f = normKey(filterValue);
    return f === normKey(brand.key) || f === normKey(brand.displayName);
  }

  function resolveExactFilterTeam(filterValue) {
    const val = String(filterValue || "").trim();
    if (!val) return null;
    const brand = lookup(val);
    if (!brand || !isExactFilterMatch(val, brand)) return null;
    return brand;
  }

  function hexToRgb(hex) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function luminance(hex) {
    const c = hexToRgb(hex);
    if (!c) return 0;
    const srgb = [c.r, c.g, c.b].map(function (v) {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  }

  function contrastTextColor(bgHex, light, dark) {
    return luminance(bgHex) > 0.45 ? dark || "#1e1e1e" : light || "#f5deb3";
  }

  function brandStyleAttr(brand) {
    if (!brand || !brand.primary) return "";
    const onPrimary = contrastTextColor(brand.primary);
    return (
      '--recruit-team-primary:' +
      brand.primary +
      ';--recruit-team-secondary:' +
      (brand.secondary || brand.primary) +
      ';--recruit-team-accent:' +
      (brand.accent || brand.primary) +
      ';--recruit-team-on-primary:' +
      onPrimary +
      ';'
    );
  }

  function applyPageTheme(brand) {
    const root = document.documentElement;
    const banner = document.getElementById("recruitTeamThemeBanner");
    if (!brand || !brand.primary) {
      document.body.classList.remove("team-theme-active");
      root.style.removeProperty("--recruit-team-primary");
      root.style.removeProperty("--recruit-team-secondary");
      root.style.removeProperty("--recruit-team-accent");
      root.style.removeProperty("--recruit-team-on-primary");
      if (banner) {
        banner.style.display = "none";
        banner.innerHTML = "";
      }
      return;
    }
    document.body.classList.add("team-theme-active");
    root.style.setProperty("--recruit-team-primary", brand.primary);
    root.style.setProperty("--recruit-team-secondary", brand.secondary || brand.primary);
    root.style.setProperty("--recruit-team-accent", brand.accent || brand.primary);
    root.style.setProperty(
      "--recruit-team-on-primary",
      contrastTextColor(brand.primary)
    );
    if (banner) {
      banner.style.display = "flex";
      banner.innerHTML =
        (brand.logo
          ? '<img src="' +
            brand.logo +
            '" alt="" class="recruit-theme-logo" width="22" height="22">'
          : "") +
        '<span>Showing <strong>' +
        (brand.displayName || brand.key) +
        "</strong> commits</span>";
    }
  }

  function logoImgHtml(brand, className, alt) {
    if (!brand || !brand.logo) return "";
    const cls = className || "recruit-team-logo";
    return (
      '<img class="' +
      cls +
      '" src="' +
      brand.logo +
      '" alt="' +
      (alt || brand.displayName || "") +
      '" loading="lazy" width="28" height="28">'
    );
  }

  async function load() {
    if (loaded) return true;
    if (loadPromise) return loadPromise;
    loadPromise = fetch(BRANDING_URL, { cache: "no-store" })
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

  global.RecruitTeamBranding = {
    load: load,
    lookup: lookup,
    resolveExactFilterTeam: resolveExactFilterTeam,
    applyPageTheme: applyPageTheme,
    brandStyleAttr: brandStyleAttr,
    logoImgHtml: logoImgHtml,
    contrastTextColor: contrastTextColor,
  };
})(window);
