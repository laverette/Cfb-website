/**
 * Hometown location keys for recruit map filters (US states vs countries).
 */
(function (global) {
  const US_STATES = new Set([
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN",
    "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH",
    "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA",
    "VT", "WA", "WI", "WV", "WY", "DC",
  ]);

  const CANADIAN_PROVINCES = new Set([
    "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
  ]);

  /** CFBD odd stateProvince codes → display country */
  const STATE_TO_COUNTRY = {
    AUST: "Australia",
    AUSTRALIA: "Australia",
    SWED: "Sweden",
    EN: "England",
    ENG: "England",
    UK: "United Kingdom",
    GER: "Germany",
    DEU: "Germany",
    MEX: "Mexico",
    BAH: "Bahamas",
    NORT: "Northern Ireland",
  };

  const COUNTRY_LABELS = {
    USA: "United States",
    US: "United States",
    "UNITED STATES": "United States",
    CAN: "Canada",
    CANADA: "Canada",
    AUS: "Australia",
    AUSTRALIA: "Australia",
    GBR: "United Kingdom",
    UK: "United Kingdom",
    ENGLAND: "England",
    DEU: "Germany",
    GERMANY: "Germany",
    MEX: "Mexico",
    MEXICO: "Mexico",
    BHS: "Bahamas",
    BAHAMAS: "Bahamas",
  };

  function isUsCountry(country) {
    const c = String(country || "USA").trim().toUpperCase();
    return c === "USA" || c === "US" || c === "UNITED STATES";
  }

  function titleCaseCountry(name) {
    const s = String(name || "").trim();
    if (!s) return "Unknown";
    if (COUNTRY_LABELS[s.toUpperCase()]) return COUNTRY_LABELS[s.toUpperCase()];
    return s
      .toLowerCase()
      .replace(/\b\w/g, function (ch) {
        return ch.toUpperCase();
      });
  }

  /**
   * Returns { key, label } for filter dropdown.
   * key is used in filter params; label is shown in UI.
   */
  function locationKeyForRecruit(r) {
    const state = String(r.stateProvince || r.hometown_state || "").trim().toUpperCase();
    const countryRaw = String(r.country || r.hometown_country || "").trim();
    const countryUp = countryRaw.toUpperCase();

    if (STATE_TO_COUNTRY[state]) {
      const country = STATE_TO_COUNTRY[state];
      return { key: "country:" + country, label: country };
    }

    if (CANADIAN_PROVINCES.has(state) || countryUp === "CAN" || countryUp === "CANADA") {
      return { key: "country:Canada", label: "Canada" };
    }

    if (isUsCountry(countryRaw)) {
      if (US_STATES.has(state)) {
        return { key: "US:" + state, label: state };
      }
      return { key: "US:—", label: "United States (other)" };
    }

    if (countryRaw) {
      const label = titleCaseCountry(countryRaw);
      return { key: "country:" + label, label: label };
    }

    if (US_STATES.has(state)) {
      return { key: "US:" + state, label: state };
    }

    return { key: "country:Unknown", label: "Unknown" };
  }

  function matchesLocationFilter(p, filterKey) {
    if (!filterKey) return true;
    const loc = locationKeyForRecruit({
      stateProvince: p.hometown_state,
      country: p.hometown_country,
    });
    return loc.key === filterKey;
  }

  function sortLocationLabels(a, b) {
    const aUs = a.startsWith("US:") || a.length === 2;
    const bUs = b.startsWith("US:") || b.length === 2;
    if (aUs && !bUs) return -1;
    if (!aUs && bUs) return 1;
    return a.localeCompare(b);
  }

  global.RecruitLocation = {
    locationKeyForRecruit: locationKeyForRecruit,
    matchesLocationFilter: matchesLocationFilter,
    sortLocationLabels: sortLocationLabels,
  };
})(window);
