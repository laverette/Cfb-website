/**
 * Centralized product analytics client (2026 free beta).
 * Fire-and-forget — never throws into product flows.
 * Does NOT trigger CFBD/ESPN.
 *
 * Usage:
 *   ProductAnalytics.trackEvent('prop_evaluated', { season: 2026, week: 6 });
 *   ProductAnalytics.trackOnce('prop_lab_opened', {}, 'prop_lab_opened');
 */
(function (global) {
  var STORAGE_SESSION = "analytics_session_id";
  var STORAGE_SHARE_REF = "analytics_share_ref";
  var STORAGE_SESSION_FLAG = "analytics_session_started";
  var onceKeys = Object.create(null);
  var endpoint = "/api/analytics/track";

  function cryptoRandomId() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === "function") {
        return global.crypto.randomUUID();
      }
    } catch (e) {}
    var s = "";
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
  }

  function getAnonymousSessionId() {
    try {
      var existing = localStorage.getItem(STORAGE_SESSION);
      if (existing && existing.length >= 8) return existing;
      var id = cryptoRandomId();
      localStorage.setItem(STORAGE_SESSION, id);
      return id;
    } catch (e) {
      return cryptoRandomId();
    }
  }

  function getAuthToken() {
    try {
      return localStorage.getItem("authToken") || null;
    } catch (e) {
      return null;
    }
  }

  function captureShareReferralFromUrl() {
    try {
      var params = new URLSearchParams(global.location.search || "");
      var share = params.get("share");
      if (!share) return null;
      var clean = String(share).trim().slice(0, 64);
      if (!clean) return null;
      // First-touch only within this browser.
      var existing = sessionStorage.getItem(STORAGE_SHARE_REF) || localStorage.getItem(STORAGE_SHARE_REF);
      if (!existing) {
        sessionStorage.setItem(STORAGE_SHARE_REF, clean);
        localStorage.setItem(STORAGE_SHARE_REF, clean);
      }
      return clean;
    } catch (e) {
      return null;
    }
  }

  function getShareReferral() {
    try {
      return (
        sessionStorage.getItem(STORAGE_SHARE_REF) ||
        localStorage.getItem(STORAGE_SHARE_REF) ||
        null
      );
    } catch (e) {
      return null;
    }
  }

  function mergeProps(properties) {
    var props = properties && typeof properties === "object" ? Object.assign({}, properties) : {};
    var shareId = getShareReferral();
    if (shareId && props.share_id == null && props.shareId == null) {
      props.share_id = shareId;
    }
    try {
      props.page = String(global.location.pathname || "").slice(0, 120);
    } catch (e) {}
    return props;
  }

  /**
   * @param {string} name
   * @param {object} [properties]
   * @returns {Promise<boolean>}
   */
  function trackEvent(name, properties) {
    try {
      var eventName = String(name || "").trim();
      if (!eventName) return Promise.resolve(false);

      var body = {
        event: eventName,
        anonymousSessionId: getAnonymousSessionId(),
        properties: mergeProps(properties),
      };

      var headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      var token = getAuthToken();
      if (token) headers.Authorization = "Bearer " + token;

      // Fire-and-forget: do not await in product code; swallow all failures.
      var p = fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body),
        keepalive: true,
      })
        .then(function (res) {
          return res.ok;
        })
        .catch(function () {
          if (typeof console !== "undefined" && console.warn) {
            console.warn("[analytics] event dropped:", eventName);
          }
          return false;
        });
      return p;
    } catch (e) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[analytics] trackEvent failed safely");
      }
      return Promise.resolve(false);
    }
  }

  /**
   * Dedupe within this page lifetime (and optionally sessionStorage).
   * @param {string} name
   * @param {object} [properties]
   * @param {string} [key] dedupe key; defaults to event name
   * @param {{ session?: boolean }} [opts] if session=true, also persist in sessionStorage
   */
  function trackOnce(name, properties, key, opts) {
    var k = key || name;
    var useSession = opts && opts.session;
    try {
      if (onceKeys[k]) return Promise.resolve(false);
      if (useSession) {
        var sk = "analytics_once_" + k;
        if (sessionStorage.getItem(sk)) {
          onceKeys[k] = true;
          return Promise.resolve(false);
        }
        sessionStorage.setItem(sk, "1");
      }
      onceKeys[k] = true;
    } catch (e) {
      if (onceKeys[k]) return Promise.resolve(false);
      onceKeys[k] = true;
    }
    return trackEvent(name, properties);
  }

  function startSessionIfNeeded() {
    captureShareReferralFromUrl();
    try {
      if (sessionStorage.getItem(STORAGE_SESSION_FLAG)) return;
      sessionStorage.setItem(STORAGE_SESSION_FLAG, "1");
    } catch (e) {}
    trackEvent("session_started", {
      path: (global.location && global.location.pathname) || "",
    });
  }

  function trackShareOpen(shareId) {
    var id = String(shareId || "").trim().slice(0, 64);
    if (!id) return Promise.resolve(false);
    try {
      sessionStorage.setItem(STORAGE_SHARE_REF, id);
      if (!localStorage.getItem(STORAGE_SHARE_REF)) {
        localStorage.setItem(STORAGE_SHARE_REF, id);
      }
    } catch (e) {}
    // Total opens every load; unique viewers computed server-side by actor.
    // Still dedupe rapid remounts in the same page lifetime.
    return trackOnce(
      "shared_card_opened",
      { share_id: id },
      "shared_card_opened:" + id,
      { session: true }
    );
  }

  function trackSignupAttribution() {
    var shareId = getShareReferral();
    if (!shareId) return Promise.resolve(false);
    return trackEvent("viewer_signed_up", { share_id: shareId, source: "share_card" });
  }

  var api = {
    trackEvent: trackEvent,
    trackOnce: trackOnce,
    getAnonymousSessionId: getAnonymousSessionId,
    getShareReferral: getShareReferral,
    captureShareReferralFromUrl: captureShareReferralFromUrl,
    startSessionIfNeeded: startSessionIfNeeded,
    trackShareOpen: trackShareOpen,
    trackSignupAttribution: trackSignupAttribution,
    _resetOnceForTests: function () {
      onceKeys = Object.create(null);
    },
  };

  global.ProductAnalytics = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startSessionIfNeeded);
  } else {
    startSessionIfNeeded();
  }
})(typeof window !== "undefined" ? window : globalThis);
