/**
 * Site-wide nav: auth cluster + standardized dropdown (single source of truth).
 * Requires: #dropdownMenu, #auth-nav.navbar-auth-cluster
 * Admin link visibility: UI hint only (currentUser.role === 'admin'). Server enforces JWT.
 *
 * Avatars: A1.png … A12.png in Resources/Images/avatars/
 */
(function () {
  var STORAGE_TOKEN = "authToken";
  var STORAGE_USER = "currentUser";
  var AVATAR_DIR = "Resources/Images/avatars/";
  var AVATAR_COUNT = 12;

  var NAV_CATEGORIES = {
    main: { href: "index.html", label: "🏠 Home" },
    picks: {
      label: "📅 Picks & Predictions",
      items: [
        { href: "weeklypicks.html", label: "📅 Weekly Picks" },
        { href: "leagues.html", label: "👥 Private Leagues" },
        { href: "bama.html", label: "📅 Schedule Predictions" },
        { href: "prediction-history.html", label: "🏆 Leaderboards" },
        { href: "predictor.html", label: "🎯 Matchup Predictor" },
        { href: "CFPPredictions.html", label: "🏆 CFP Picks" },
      ]
    },
    teams: {
      label: "🏈 Teams & Players",
      items: [
        { href: "teams.html", label: "🏈 Teams" },
        { href: "power-rankings.html", label: "📈 Power Rankings" },
        { href: "prop-bet.html", label: "📊 Prop Lab" },
        { href: "list.html", label: "👑 Heisman" },
        { href: "recruitmap.html", label: "🗺️ Recruit Map" },
      ]
    },
    admin: {
      label: "🛠️ Admin",
      items: [
        { href: "admin.html", label: "🛠️ Admin Panel" },
        { href: "admin-analytics.html", label: "📊 Beta Analytics" },
      ]
    }
  };

  function basenameOnly(raw) {
    if (!raw || typeof raw !== "string") return "index.html";
    var parts = raw.split("/").filter(Boolean);
    var name =
      parts.length > 0 ? parts[parts.length - 1] : "index.html";
    var q = name.indexOf("?");
    if (q !== -1) name = name.slice(0, q);
    var h = name.indexOf("#");
    if (h !== -1) name = name.slice(0, h);
    return name || "index.html";
  }

  var STORAGE_RETURN = "authReturnTo";

  function rememberReturnTo(target) {
    try {
      if (target) sessionStorage.setItem(STORAGE_RETURN, String(target));
    } catch (e) {
      /* ignore */
    }
  }

  function getLoginHref() {
    var page = basenameOnly(window.location.pathname);
    if (page === "login.html" || page === "reset-password.html") return "login.html";
    // Don't carry another user's ?username= through login — after sign-in
    // we always want the newly logged-in account's own profile.
    var target =
      page === "user-profile.html" ? "user-profile.html" : page + (window.location.search || "");
    if (!/\.html$/i.test(String(target).split(/[?#]/)[0] || "")) {
      target = "index.html";
    }
    rememberReturnTo(target);
    return "login.html?redirect=" + encodeURIComponent(target);
  }

  function parseUser() {
    try {
      var s = localStorage.getItem(STORAGE_USER);
      if (!s) return null;
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  function isLoggedIn() {
    return !!(localStorage.getItem(STORAGE_TOKEN) && parseUser());
  }

  function isAdminRole(user) {
    if (!user) return false;
    return String(user.role || "").toLowerCase() === "admin";
  }

  function profileHrefForUser(user) {
    if (!user) return "user-profile.html";
    if (user.username) {
      return "user-profile.html?username=" + encodeURIComponent(user.username);
    }
    if (user.id != null) {
      return "user-profile.html?id=" + encodeURIComponent(String(user.id));
    }
    return "user-profile.html";
  }

  function parseAvatarId(raw) {
    if (raw == null || raw === "") return null;
    var s = String(raw).trim();
    var n = Number(s);
    if (Number.isInteger(n) && n >= 1 && n <= AVATAR_COUNT) return n;
    var m =
      s.match(/(?:^|[\\/])A(\d{1,2})(?:\.(?:png|jpe?g|webp|svg))?$/i) ||
      s.match(/^A(\d{1,2})$/i) ||
      s.match(/Avatar\s*(\d{1,2})/i);
    if (!m) return null;
    var id = Number(m[1]);
    return Number.isInteger(id) && id >= 1 && id <= AVATAR_COUNT ? id : null;
  }

  function avatarIdForUser(user) {
    if (!user) return null;
    return (
      parseAvatarId(user.avatarId) ||
      parseAvatarId(user.avatar_id) ||
      parseAvatarId(user.avatarUrl) ||
      parseAvatarId(user.avatar_url)
    );
  }

  function avatarPngPath(id) {
    return AVATAR_DIR + "A" + id + ".png";
  }

  function avatarSvgPath(id) {
    return AVATAR_DIR + "A" + id + ".svg";
  }

  /** Prefer custom https avatar URLs; fall back to preset A#.png. */
  function avatarSrcForUser(user) {
    if (!user) return null;
    var rawUrl =
      user.avatarUrl != null
        ? String(user.avatarUrl).trim()
        : user.avatar_url != null
          ? String(user.avatar_url).trim()
          : "";
    if (rawUrl && /^https?:\/\//i.test(rawUrl)) return rawUrl;
    if (rawUrl && /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(rawUrl) && !parseAvatarId(rawUrl)) {
      return rawUrl;
    }
    var id = avatarIdForUser(user);
    if (!id) return null;
    return avatarPngPath(id);
  }

  function avatarImgHtml(user, className, size) {
    var cls = className || "user-avatar";
    var wh = size || 40;
    var src = avatarSrcForUser(user) || "";

    if (!src) {
      var initial = (
        (user && (user.displayName || user.display_name || user.username)) ||
        "?"
      )
        .toString()
        .trim()
        .charAt(0)
        .toUpperCase();
      return (
        '<span class="' +
        cls +
        " " +
        cls +
        '--initial" aria-hidden="true" style="width:' +
        wh +
        "px;height:" +
        wh +
        'px;line-height:' +
        wh +
        'px;">' +
        initial +
        "</span>"
      );
    }
    return (
      '<img class="' +
      cls +
      '" src="' +
      src.replace(/"/g, "&quot;") +
      '" alt="" width="' +
      wh +
      '" height="' +
      wh +
      '" decoding="async">'
    );
  }

  function buildAvatarPickerHtml(selectedId, options) {
    var opts = options || {};
    var gridId = opts.gridId || "avatarPickerGrid";
    var hiddenId = opts.hiddenId || "registerAvatarId";
    var count = AVATAR_COUNT;
    var html =
      '<div class="avatar-picker-grid" id="' +
      gridId +
      '" role="radiogroup" aria-label="Avatar choice">';
    for (var i = 1; i <= count; i++) {
      var on = Number(selectedId) === i;
      html +=
        '<button type="button" class="avatar-pick-option' +
        (on ? " is-selected" : "") +
        '" data-avatar-id="' +
        i +
        '" role="radio" aria-checked="' +
        (on ? "true" : "false") +
        '" aria-label="Avatar ' +
        i +
        '">' +
        '<img src="' +
        avatarPngPath(i) +
        '" alt="" width="64" height="64" decoding="async">' +
        "<span>A" +
        i +
        "</span>" +
        "</button>";
    }
    html += "</div>";
    if (hiddenId) {
      html +=
        '<input type="hidden" id="' +
        hiddenId +
        '" name="avatarId" value="' +
        (selectedId ? String(selectedId) : "") +
        '">';
    }
    return html;
  }

  function wireAvatarPicker(gridEl, hiddenEl, onChange) {
    if (!gridEl || gridEl.dataset.avatarWired === "1") return;
    gridEl.dataset.avatarWired = "1";
    gridEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".avatar-pick-option");
      if (!btn || !gridEl.contains(btn)) return;
      var id = btn.getAttribute("data-avatar-id");
      if (hiddenEl) hiddenEl.value = id;
      var opts = gridEl.querySelectorAll(".avatar-pick-option");
      for (var j = 0; j < opts.length; j++) {
        var on = opts[j] === btn;
        opts[j].classList.toggle("is-selected", on);
        opts[j].setAttribute("aria-checked", on ? "true" : "false");
      }
      if (typeof onChange === "function") onChange(Number(id));
    });
  }

  function buildAuthClusterMarkup() {
    var loginHref = getLoginHref();
    return (
      '<div id="loginButtonSection">' +
      '<a href="' +
      loginHref +
      '" class="navbar-login-btn">Login</a>' +
      "</div>" +
      '<div id="userSection" style="display:none;" class="navbar-auth-stack">' +
      '<a id="userProfileLink" class="navbar-profile-btn" href="user-profile.html" title="View your profile">' +
      '<span id="userAvatarSlot" class="navbar-avatar-slot" aria-hidden="true"></span>' +
      '<span class="navbar-profile-text">' +
      '<span id="userProfileName" class="navbar-user-name">Profile</span>' +
      '<span class="navbar-profile-hint">View profile</span>' +
      "</span>" +
      '<span class="navbar-profile-chevron" aria-hidden="true">›</span>' +
      "</a>" +
      '<button type="button" id="logoutBtn" class="navbar-logout-btn">Logout</button>' +
      "</div>"
    );
  }

  function applyLoggedInState(user) {
    var loginSection = document.getElementById("loginButtonSection");
    var userSection = document.getElementById("userSection");
    var profileLink = document.getElementById("userProfileLink");
    var nameEl = document.getElementById("userProfileName");
    var avatarSlot = document.getElementById("userAvatarSlot");
    var display =
      (user &&
        (user.displayName ||
          user.display_name ||
          user.username)) ||
      "User";
    if (loginSection) loginSection.style.display = "none";
    if (userSection) userSection.style.display = "flex";
    if (nameEl) nameEl.textContent = display;
    if (avatarSlot) avatarSlot.innerHTML = avatarImgHtml(user, "navbar-avatar", 36);
    if (profileLink) {
      profileLink.href = profileHrefForUser(user);
      profileLink.title = "View " + display + "'s profile";
      profileLink.setAttribute("aria-label", "Open profile for " + display);
    }
  }

  function applyLoggedOutState() {
    var loginSection = document.getElementById("loginButtonSection");
    var userSection = document.getElementById("userSection");
    if (loginSection) loginSection.style.display = "block";
    if (userSection) userSection.style.display = "none";
  }

  function attachTopLogoutHandler() {
    var btn = document.getElementById("logoutBtn");
    if (!btn || btn.dataset.authUiBound) return;
    btn.dataset.authUiBound = "1";
    btn.addEventListener("click", function () {
      window.AuthUI.logout();
    });
  }

  function renderAuthNav() {
    var host = document.getElementById("auth-nav");
    if (!host) return;
    host.innerHTML = buildAuthClusterMarkup();
    var user = parseUser();
    var token = localStorage.getItem(STORAGE_TOKEN);
    if (user && token) applyLoggedInState(user);
    else applyLoggedOutState();
    attachTopLogoutHandler();
  }

  function populateDropdownMenu() {
    var menu = document.getElementById("dropdownMenu");
    if (!menu) return;

    var user = parseUser();
    var token = localStorage.getItem(STORAGE_TOKEN);
    var loggedIn = !!(user && token);

    var html = "";
    
    // Home link - prominent and always visible
    html +=
      '<a href="' +
      NAV_CATEGORIES.main.href +
      '" class="dropdown-item dropdown-item-home">' +
      NAV_CATEGORIES.main.label +
      "</a>";
    
    // Picks & Predictions category
    html += '<div class="dropdown-category">';
    html += 
      '<button type="button" class="dropdown-category-header" onclick="toggleCategory(\'picks\')">' +
      '<span>' + NAV_CATEGORIES.picks.label + '</span>' +
      '<span class="category-arrow">▼</span>' +
      '</button>';
    html += '<div class="dropdown-category-content" id="category-picks">';
    for (var i = 0; i < NAV_CATEGORIES.picks.items.length; i++) {
      var item = NAV_CATEGORIES.picks.items[i];
      html +=
        '<a href="' +
        item.href +
        '" class="dropdown-item dropdown-subitem">' +
        item.label +
        "</a>";
    }
    html += '</div></div>';
    
    // Teams & Players category
    html += '<div class="dropdown-category">';
    html += 
      '<button type="button" class="dropdown-category-header" onclick="toggleCategory(\'teams\')">' +
      '<span>' + NAV_CATEGORIES.teams.label + '</span>' +
      '<span class="category-arrow">▼</span>' +
      '</button>';
    html += '<div class="dropdown-category-content" id="category-teams">';
    for (var j = 0; j < NAV_CATEGORIES.teams.items.length; j++) {
      var teamItem = NAV_CATEGORIES.teams.items[j];
      html +=
        '<a href="' +
        teamItem.href +
        '" class="dropdown-item dropdown-subitem">' +
        teamItem.label +
        "</a>";
    }
    html += '</div></div>';

    if (loggedIn && isAdminRole(user)) {
      html += '<div class="dropdown-category dropdown-category-admin">';
      html +=
        '<button type="button" class="dropdown-category-header" onclick="toggleCategory(\'admin\')">' +
        '<span>' + NAV_CATEGORIES.admin.label + '</span>' +
        '<span class="category-arrow">▼</span>' +
        '</button>';
      html += '<div class="dropdown-category-content" id="category-admin">';
      for (var a = 0; a < NAV_CATEGORIES.admin.items.length; a++) {
        var adminItem = NAV_CATEGORIES.admin.items[a];
        html +=
          '<a href="' +
          adminItem.href +
          '" class="dropdown-item dropdown-subitem">' +
          adminItem.label +
          "</a>";
      }
      html += '</div></div>';
    }

    if (loggedIn) {
      html +=
        '<button type="button" class="dropdown-item auth-dropdown-logout" id="dropdownLogoutBtn">🚪 Logout</button>';
    }

    menu.innerHTML = html;

    var dLogout = document.getElementById("dropdownLogoutBtn");
    if (dLogout && !dLogout.dataset.authUiBound) {
      dLogout.dataset.authUiBound = "1";
      dLogout.addEventListener("click", function (e) {
        e.preventDefault();
        window.AuthUI.logout();
        closeAnyOpenMenu();
      });
    }
  }
  
  // Accordion toggle function
  window.toggleCategory = function(categoryId) {
    var content = document.getElementById('category-' + categoryId);
    var allContents = document.querySelectorAll('.dropdown-category-content');
    var allArrows = document.querySelectorAll('.category-arrow');
    
    // Close all other categories
    for (var i = 0; i < allContents.length; i++) {
      if (allContents[i].id !== 'category-' + categoryId) {
        allContents[i].classList.remove('active');
      }
    }
    
    // Reset all arrows
    for (var j = 0; j < allArrows.length; j++) {
      var parentContent = allArrows[j].closest('.dropdown-category').querySelector('.dropdown-category-content');
      if (parentContent && parentContent.id !== 'category-' + categoryId) {
        allArrows[j].textContent = '▼';
      }
    }
    
    // Toggle current category
    if (content) {
      var isActive = content.classList.toggle('active');
      var arrow = content.previousElementSibling.querySelector('.category-arrow');
      if (arrow) {
        arrow.textContent = isActive ? '▲' : '▼';
      }
    }
  };

  function closeAnyOpenMenu() {
    var menu = document.getElementById("dropdownMenu");
    var button = document.querySelector(".hamburger-menu-btn");
    var overlay = document.getElementById("menuOverlay");
    if (menu) menu.classList.remove("show");
    if (button) {
      button.classList.remove("active");
      button.setAttribute("aria-expanded", "false");
    }
    if (overlay) overlay.classList.remove("show");
    if (document.body) document.body.classList.remove("menu-open");
  }

  function refreshAll() {
    renderAuthNav();
    populateDropdownMenu();
  }

  function logout() {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    refreshAll();
    document.dispatchEvent(new CustomEvent("auth:logout"));

    var page = basenameOnly(window.location.pathname);
    if (page === "admin.html") {
      window.location.href = "login.html?redirect=admin.html";
    }
  }

  function refreshFromStorage() {
    refreshAll();
  }

  var profileCheckInFlight = false;
  function maybeValidateToken() {
    if (profileCheckInFlight) return;
    var token = localStorage.getItem(STORAGE_TOKEN);
    if (!token) return;
    var page = basenameOnly(window.location.pathname);
    if (page === "login.html") return;

    var last = sessionStorage.getItem("authProfileCheckedAt");
    var now = Date.now();
    if (last && now - parseInt(last, 10) < 5 * 60 * 1000) return;

    profileCheckInFlight = true;
    fetch("/api/auth/profile", {
      headers: { Authorization: "Bearer " + token },
    })
      .then(function (res) {
        sessionStorage.setItem("authProfileCheckedAt", String(now));
        if (res.status === 401) {
          localStorage.removeItem(STORAGE_TOKEN);
          localStorage.removeItem(STORAGE_USER);
          refreshAll();
          document.dispatchEvent(new CustomEvent("auth:invalid"));
          return null;
        }
        if (!res.ok) return null;
        return res.json().catch(function () {
          return null;
        });
      })
      .then(function (data) {
        if (!data || !data.user) return;
        if (data.token) {
          localStorage.setItem(STORAGE_TOKEN, data.token);
        }
        var prev = parseUser() || {};
        var next = Object.assign({}, prev, data.user);
        if (data.user.avatarUrl != null) next.avatarUrl = data.user.avatarUrl;
        localStorage.setItem(STORAGE_USER, JSON.stringify(next));
        refreshAll();
      })
      .catch(function () {})
      .finally(function () {
        profileCheckInFlight = false;
      });
  }

  window.AuthUI = {
    getAuthToken: function () {
      return localStorage.getItem(STORAGE_TOKEN);
    },
    getCurrentUser: parseUser,
    isLoggedIn: isLoggedIn,
    getLoginHref: getLoginHref,
    rememberReturnTo: rememberReturnTo,
    renderAuthNav: renderAuthNav,
    populateDropdownMenu: populateDropdownMenu,
    refreshAll: refreshAll,
    logout: logout,
    refreshFromStorage: refreshFromStorage,
    maybeValidateToken: maybeValidateToken,
    avatarIdForUser: avatarIdForUser,
    avatarSrcForUser: avatarSrcForUser,
    avatarImgHtml: avatarImgHtml,
    avatarPngPath: avatarPngPath,
    avatarSvgPath: avatarSvgPath,
    buildAvatarPickerHtml: buildAvatarPickerHtml,
    wireAvatarPicker: wireAvatarPicker,
    parseAvatarId: parseAvatarId,
    AVATAR_COUNT: AVATAR_COUNT,
    isAmbientAudioOptedOut: isAmbientAudioOptedOut,
    setAmbientAudioOptOut: setAmbientAudioOptOut,
  };

  function ensureAnalyticsLoaded() {
    if (window.ProductAnalytics) return;
    if (document.querySelector('script[data-product-analytics="1"]')) return;
    var s = document.createElement("script");
    s.src = "scripts/analytics.js";
    s.defer = true;
    s.setAttribute("data-product-analytics", "1");
    document.head.appendChild(s);
  }

  function mountBetaBadge() {
    if (document.getElementById("siteBetaBadge")) return;
    var page = basenameOnly(window.location.pathname);
    if (
      page === "admin.html" ||
      page === "admin-analytics.html" ||
      page === "login.html"
    ) {
      return;
    }
    var cluster = document.getElementById("auth-nav");
    var host = cluster && cluster.parentElement ? cluster.parentElement : null;
    if (!host || !cluster) return;

    // Grid nav: left menu | title | right (suggest + auth).
    // Mobile CSS hides the brand title and centers "Suggest a name" as the
    // only nav copy; the button still opens the name-suggest form.
    var right = document.getElementById("siteNavRight");
    if (!right) {
      right = document.createElement("div");
      right.id = "siteNavRight";
      right.className = "site-nav-right";
      host.insertBefore(right, cluster);
      right.appendChild(cluster);
    }

    var wrap = document.createElement("div");
    wrap.id = "siteBetaBadge";
    wrap.className = "site-beta-wrap";

    var nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.id = "siteNameSuggestOpen";
    nameBtn.className = "site-name-suggest-btn";
    nameBtn.title = "Help name the site — suggest a name (2026 beta)";
    nameBtn.setAttribute("aria-label", "Suggest a site name");
    // Desktop: "2026 Beta · Suggest a name". Mobile CSS shows only the label.
    nameBtn.innerHTML =
      '<span class="site-beta-badge-label">2026 Beta</span>' +
      '<span class="site-name-suggest-sep" aria-hidden="true">·</span>' +
      '<span class="site-name-suggest-label">Suggest a name</span>';

    wrap.appendChild(nameBtn);
    right.insertBefore(wrap, cluster);
  }

  function mountNameSuggestForm() {
    if (document.getElementById("siteNameSuggestRoot")) return;
    if (
      basenameOnly(window.location.pathname) === "admin.html" ||
      basenameOnly(window.location.pathname) === "admin-analytics.html"
    ) {
      return;
    }

    var root = document.createElement("div");
    root.id = "siteNameSuggestRoot";
    root.className = "site-name-suggest-root";
    root.innerHTML =
      '<div class="site-feedback-modal" id="siteNameSuggestModal" hidden>' +
      '<button type="button" class="site-feedback-backdrop" id="siteNameSuggestClose" aria-label="Close"></button>' +
      '<div class="site-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="siteNameSuggestTitle">' +
      '<div class="site-feedback-dialog-head">' +
      '<h2 id="siteNameSuggestTitle">Suggest a site name</h2>' +
      '<button type="button" class="site-feedback-x" id="siteNameSuggestX" aria-label="Close">×</button>' +
      "</div>" +
      '<p class="site-feedback-lead">The site still needs a real name. Drop yours below — short and memorable wins.</p>' +
      '<label class="site-feedback-label" for="siteNameSuggestInput">Name idea</label>' +
      '<input id="siteNameSuggestInput" class="site-feedback-input" type="text" maxlength="80" autocomplete="off" placeholder="e.g. Gridiron Lab">' +
      '<label class="site-feedback-label" for="siteNameSuggestNote">Why it fits <span>(optional)</span></label>' +
      '<textarea id="siteNameSuggestNote" class="site-feedback-input" rows="2" maxlength="500" placeholder="One quick reason…"></textarea>' +
      '<p class="site-feedback-status" id="siteNameSuggestStatus" hidden></p>' +
      '<div class="site-feedback-actions">' +
      '<button type="button" class="btn btn-brown site-feedback-cancel" id="siteNameSuggestCancel">Cancel</button>' +
      '<button type="button" class="btn btn-gold" id="siteNameSuggestSend">Submit</button>' +
      "</div></div></div>";
    document.body.appendChild(root);

    var modal = document.getElementById("siteNameSuggestModal");
    var statusEl = document.getElementById("siteNameSuggestStatus");
    var nameEl = document.getElementById("siteNameSuggestInput");
    var noteEl = document.getElementById("siteNameSuggestNote");
    var sendBtn = document.getElementById("siteNameSuggestSend");

    function openModal() {
      if (statusEl) {
        statusEl.hidden = true;
        statusEl.textContent = "";
        statusEl.classList.remove("is-error", "is-ok");
      }
      modal.hidden = false;
      document.body.classList.add("site-feedback-open");
      if (nameEl) nameEl.focus();
    }

    function closeModal() {
      modal.hidden = true;
      document.body.classList.remove("site-feedback-open");
    }

    function setStatus(text, ok) {
      if (!statusEl) return;
      statusEl.hidden = !text;
      statusEl.textContent = text || "";
      statusEl.classList.toggle("is-ok", !!ok);
      statusEl.classList.toggle("is-error", !ok && !!text);
    }

    if (!document.body.dataset.nameSuggestDelegate) {
      document.body.dataset.nameSuggestDelegate = "1";
      document.addEventListener("click", function (e) {
        var t = e.target && e.target.closest ? e.target.closest("#siteNameSuggestOpen") : null;
        if (!t) return;
        e.preventDefault();
        openModal();
      });
    }

    document.getElementById("siteNameSuggestClose").addEventListener("click", closeModal);
    document.getElementById("siteNameSuggestX").addEventListener("click", closeModal);
    document.getElementById("siteNameSuggestCancel").addEventListener("click", closeModal);

    if (nameEl) {
      nameEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          sendBtn.click();
        }
      });
    }

    sendBtn.addEventListener("click", function () {
      var suggestedName = (nameEl && nameEl.value ? nameEl.value : "").trim();
      var note = (noteEl && noteEl.value ? noteEl.value : "").trim();
      if (suggestedName.length < 2) {
        setStatus("Enter a name with at least 2 characters.", false);
        return;
      }
      sendBtn.disabled = true;
      setStatus("Sending…", true);
      var headers = { "Content-Type": "application/json", Accept: "application/json" };
      var token = localStorage.getItem(STORAGE_TOKEN);
      if (token) headers.Authorization = "Bearer " + token;
      var anonId =
        (window.ProductAnalytics &&
          ProductAnalytics.getAnonymousSessionId &&
          ProductAnalytics.getAnonymousSessionId()) ||
        undefined;
      fetch("/api/name-suggest", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          suggestedName: suggestedName,
          note: note || undefined,
          page: window.location.pathname + (window.location.search || ""),
          anonymousSessionId: anonId,
        }),
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (data) {
              return { ok: res.ok, data: data };
            });
        })
        .then(function (result) {
          if (!result.ok) {
            setStatus(
              (result.data && (result.data.error || result.data.message)) ||
                "Could not send. Try again later.",
              false
            );
            return;
          }
          setStatus("Thanks — name idea saved.", true);
          if (nameEl) nameEl.value = "";
          if (noteEl) noteEl.value = "";
          setTimeout(closeModal, 900);
        })
        .catch(function () {
          setStatus("Could not send. Check your connection and try again.", false);
        })
        .finally(function () {
          sendBtn.disabled = false;
        });
    });
  }

  function mountSiteFeedback() {
    if (document.getElementById("siteFeedbackRoot")) return;
    if (
      basenameOnly(window.location.pathname) === "admin.html" ||
      basenameOnly(window.location.pathname) === "admin-analytics.html"
    ) {
      return;
    }

    var root = document.createElement("div");
    root.id = "siteFeedbackRoot";
    root.className = "site-feedback-root";
    root.innerHTML =
      '<footer class="site-feedback-bar">' +
      '<button type="button" class="site-feedback-link" id="siteFeedbackOpen">Send feedback</button>' +
      "</footer>" +
      '<div class="site-feedback-modal" id="siteFeedbackModal" hidden>' +
      '<button type="button" class="site-feedback-backdrop" id="siteFeedbackClose" aria-label="Close"></button>' +
      '<div class="site-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="siteFeedbackTitle">' +
      '<div class="site-feedback-dialog-head">' +
      '<h2 id="siteFeedbackTitle">Send feedback</h2>' +
      '<button type="button" class="site-feedback-x" id="siteFeedbackX" aria-label="Close">×</button>' +
      "</div>" +
      '<p class="site-feedback-lead">Bugs, ideas, or anything that feels off — short notes are fine.</p>' +
      '<label class="site-feedback-label" for="siteFeedbackCategory">Category</label>' +
      '<select id="siteFeedbackCategory" class="site-feedback-input">' +
      '<option value="bug">Bug</option>' +
      '<option value="feature">Feature request</option>' +
      '<option value="general" selected>General feedback</option>' +
      "</select>" +
      '<label class="site-feedback-label" for="siteFeedbackMessage">Message</label>' +
      '<textarea id="siteFeedbackMessage" class="site-feedback-input" rows="4" maxlength="4000" placeholder="What’s on your mind?"></textarea>' +
      '<label class="site-feedback-label" for="siteFeedbackEmail">Email <span>(optional)</span></label>' +
      '<input id="siteFeedbackEmail" class="site-feedback-input" type="email" autocomplete="email" placeholder="so we can reply">' +
      '<p class="site-feedback-status" id="siteFeedbackStatus" hidden></p>' +
      '<div class="site-feedback-actions">' +
      '<button type="button" class="btn btn-brown site-feedback-cancel" id="siteFeedbackCancel">Cancel</button>' +
      '<button type="button" class="btn btn-gold" id="siteFeedbackSend">Send</button>' +
      "</div></div></div>";
    document.body.appendChild(root);

    var modal = document.getElementById("siteFeedbackModal");
    var statusEl = document.getElementById("siteFeedbackStatus");
    var messageEl = document.getElementById("siteFeedbackMessage");
    var emailEl = document.getElementById("siteFeedbackEmail");
    var categoryEl = document.getElementById("siteFeedbackCategory");
    var sendBtn = document.getElementById("siteFeedbackSend");

    function openModal() {
      var user = parseUser();
      if (user && user.email && emailEl && !emailEl.value) {
        emailEl.value = String(user.email);
      }
      if (statusEl) {
        statusEl.hidden = true;
        statusEl.textContent = "";
        statusEl.classList.remove("is-error", "is-ok");
      }
      modal.hidden = false;
      document.body.classList.add("site-feedback-open");
      if (messageEl) messageEl.focus();
    }

    function closeModal() {
      modal.hidden = true;
      document.body.classList.remove("site-feedback-open");
    }

    function setStatus(text, ok) {
      if (!statusEl) return;
      statusEl.hidden = !text;
      statusEl.textContent = text || "";
      statusEl.classList.toggle("is-ok", !!ok);
      statusEl.classList.toggle("is-error", !ok && !!text);
    }

    document.getElementById("siteFeedbackOpen").addEventListener("click", openModal);
    document.getElementById("siteFeedbackClose").addEventListener("click", closeModal);
    document.getElementById("siteFeedbackX").addEventListener("click", closeModal);
    document.getElementById("siteFeedbackCancel").addEventListener("click", closeModal);

    sendBtn.addEventListener("click", function () {
      var message = (messageEl && messageEl.value ? messageEl.value : "").trim();
      var email = (emailEl && emailEl.value ? emailEl.value : "").trim();
      if (message.length < 8) {
        setStatus("Add a short sentence so we know what to look at.", false);
        return;
      }
      sendBtn.disabled = true;
      setStatus("Sending…", true);
      var headers = { "Content-Type": "application/json", Accept: "application/json" };
      var token = localStorage.getItem(STORAGE_TOKEN);
      if (token) headers.Authorization = "Bearer " + token;
      var anonId =
        (window.ProductAnalytics &&
          ProductAnalytics.getAnonymousSessionId &&
          ProductAnalytics.getAnonymousSessionId()) ||
        undefined;
      fetch("/api/feedback", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          message: message,
          category: (categoryEl && categoryEl.value) || "general",
          email: email || undefined,
          page: window.location.pathname + (window.location.search || ""),
          anonymousSessionId: anonId,
        }),
      })
        .then(function (res) {
          return res.json().catch(function () {
            return {};
          }).then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            setStatus(
              (result.data && (result.data.error || result.data.message)) ||
                "Could not send. Try again later.",
              false
            );
            return;
          }
          setStatus("Thanks — feedback sent.", true);
          if (messageEl) messageEl.value = "";
          setTimeout(closeModal, 900);
        })
        .catch(function () {
          setStatus("Could not send. Check your connection and try again.", false);
        })
        .finally(function () {
          sendBtn.disabled = false;
        });
    });
  }

  function wireMenuFootballSpin() {
    var btn = document.querySelector(".hamburger-menu-btn");
    if (!btn || btn.dataset.spinWired === "1") return;
    btn.dataset.spinWired = "1";
    var angle = 0;
    var raf = 0;
    function tick() {
      if (!btn.classList.contains("active")) {
        angle = 0;
        btn.style.setProperty("--football-rot", "0deg");
        raf = 0;
        return;
      }
      angle = (angle + 8) % 360;
      btn.style.setProperty("--football-rot", angle + "deg");
      raf = requestAnimationFrame(tick);
    }
    function sync() {
      if (btn.classList.contains("active")) {
        if (!raf) raf = requestAnimationFrame(tick);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        angle = 0;
        btn.style.setProperty("--football-rot", "0deg");
      }
    }
    var obs = new MutationObserver(sync);
    obs.observe(btn, { attributes: true, attributeFilter: ["class"] });
    sync();
  }

  var AMBIENT_OPT_OUT_KEY = "siteAmbientAudioOptOut";
  var AMBIENT_TIME_KEY = "siteAmbientAudioTime";

  function isAmbientAudioOptedOut() {
    try {
      return localStorage.getItem(AMBIENT_OPT_OUT_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  var BAND_INDEX_KEY = "bandPlayerIndex";
  var BAND_MUTE_KEY = "bandPlayerMuted";
  var BAND_PLAY_KEY = "bandPlayerPlaying";
  var bandUi = null;

  /**
   * Classic band cuts only. Playback uses files in Resources/Audio.
   * Additional tracks appear once that mp3 is in the folder.
   */
  var BAND_TRACKS = [
    {
      title: "CBS College Football Theme",
      school: "CBS",
      src: "Resources/Audio/site-ambient.mp3",
    },
    { title: "Yea Alabama", school: "Alabama", src: "Resources/Audio/yea-alabama.mp3" },
    { title: "War Eagle", school: "Auburn", src: "Resources/Audio/war-eagle.mp3" },
    { title: "Glory, Glory", school: "Georgia", src: "Resources/Audio/glory-glory.mp3" },
    { title: "Orange and Blue", school: "Florida", src: "Resources/Audio/orange-and-blue.mp3" },
    { title: "Fight for LSU", school: "LSU", src: "Resources/Audio/fight-for-lsu.mp3" },
    { title: "Rocky Top", school: "Tennessee", src: "Resources/Audio/rocky-top.mp3" },
    { title: "Forward Rebels", school: "Ole Miss", src: "Resources/Audio/forward-rebels.mp3" },
    { title: "Hail State", school: "Mississippi State", src: "Resources/Audio/hail-state.mp3" },
    { title: "Arkansas Fight", school: "Arkansas", src: "Resources/Audio/arkansas-fight.mp3" },
    { title: "On, On, U of K", school: "Kentucky", src: "Resources/Audio/on-on-uk.mp3" },
    { title: "Step to the Rear", school: "South Carolina", src: "Resources/Audio/step-to-the-rear.mp3" },
    { title: "Fight Tiger", school: "Missouri", src: "Resources/Audio/fight-tiger.mp3" },
    { title: "Aggie War Hymn", school: "Texas A&M", src: "Resources/Audio/aggie-war-hymn.mp3" },
    { title: "Texas Fight", school: "Texas", src: "Resources/Audio/texas-fight.mp3" },
    { title: "Boomer Sooner", school: "Oklahoma", src: "Resources/Audio/boomer-sooner.mp3" },
    { title: "Dynamite", school: "Vanderbilt", src: "Resources/Audio/vandy-dynamite.mp3" },
  ];

  function setAmbientAudioOptOut(optOut) {
    try {
      if (optOut) localStorage.setItem(AMBIENT_OPT_OUT_KEY, "1");
      else localStorage.removeItem(AMBIENT_OPT_OUT_KEY);
    } catch (e) {
      /* ignore */
    }
    if (bandUi) bandUi.syncOptOut();
    else if (optOut) {
      var audio = document.getElementById("siteAudioEl");
      if (audio) audio.pause();
    }
  }

  function readStorageFlag(key) {
    try {
      return localStorage.getItem(key) === "1";
    } catch (e) {
      return false;
    }
  }

  function writeStorageFlag(key, on) {
    try {
      if (on) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * Corner player. Stays paused until the listener hits play, then skip,
   * back, and mute stay on the pill. Profile opt-out still forces silence.
   */
  function mountSiteAudio() {
    if (document.getElementById("siteAudioRoot")) return;
    var page = basenameOnly(window.location.pathname);
    if (
      page === "admin.html" ||
      page === "admin-analytics.html" ||
      page === "login.html" ||
      page === "reset-password.html"
    ) {
      return;
    }

    var tracks = BAND_TRACKS.map(function (track) {
      return {
        title: track.title,
        school: track.school,
        src: track.src,
      };
    });
    if (typeof window.SITE_AUDIO_SRC === "string" && window.SITE_AUDIO_SRC.trim()) {
      tracks[0].src = window.SITE_AUDIO_SRC.trim();
    }

    var index = 0;
    try {
      var savedIndex = Number(localStorage.getItem(BAND_INDEX_KEY));
      if (Number.isFinite(savedIndex) && savedIndex >= 0 && savedIndex < tracks.length) {
        index = savedIndex;
      }
    } catch (e) {
      index = 0;
    }

    var root = document.createElement("div");
    root.id = "siteAudioRoot";
    root.className = "band-player";
    root.innerHTML =
      '<audio id="siteAudioEl" preload="none" playsinline></audio>' +
      '<div class="band-player-bar" role="group" aria-label="Band music">' +
      '<div class="band-player-transport">' +
      '<button type="button" class="band-player-btn" data-act="prev" aria-label="Previous song">&#8249;</button>' +
      '<button type="button" class="band-player-btn band-player-play" data-act="play" aria-label="Play">&#9654;</button>' +
      '<button type="button" class="band-player-btn" data-act="next" aria-label="Skip song">&#8250;</button>' +
      "</div>" +
      '<button type="button" class="band-player-title" data-act="toggle" aria-expanded="false"></button>' +
      '<button type="button" class="band-player-btn band-player-mute" data-act="mute" aria-pressed="false" aria-label="Mute">Mute</button>' +
      "</div>" +
      '<ol class="band-player-list" hidden></ol>';
    document.body.appendChild(root);

    var audio = document.getElementById("siteAudioEl");
    var playBtn = root.querySelector('[data-act="play"]');
    // Title control uses data-act="toggle" (opens track list + transport).
    var titleBtn = root.querySelector('[data-act="toggle"]');
    var muteBtn = root.querySelector('[data-act="mute"]');
    var listEl = root.querySelector(".band-player-list");
    var muted = readStorageFlag(BAND_MUTE_KEY);
    var listOpen = false;
    var available = {};
    var flashTimer = null;

    function trackAt(i) {
      return tracks[(i + tracks.length) % tracks.length];
    }

    function flashAction(label) {
      if (!titleBtn) return;
      root.classList.add("is-flash");
      titleBtn.setAttribute("data-flash", label);
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(function () {
        root.classList.remove("is-flash");
        titleBtn.removeAttribute("data-flash");
        paint();
      }, 900);
    }

    function paint() {
      var track = trackAt(index);
      var playing = Boolean(audio && !audio.paused && !audio.ended);
      if (titleBtn) {
        var flash = titleBtn.getAttribute("data-flash");
        titleBtn.textContent = flash || track.school + " · " + track.title;
        titleBtn.title = track.title;
        titleBtn.setAttribute("aria-expanded", listOpen ? "true" : "false");
        titleBtn.setAttribute(
          "aria-label",
          listOpen ? "Close player controls" : "Open player controls"
        );
      }
      if (playBtn) {
        playBtn.textContent = playing ? "\u275A\u275A" : "\u25B6";
        playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
        playBtn.classList.toggle("is-active", playing);
      }
      if (muteBtn) {
        muteBtn.textContent = muted ? "Unmute" : "Mute";
        muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
        muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
        muteBtn.classList.toggle("is-active", muted);
      }
      root.classList.toggle("is-open", listOpen);
      root.classList.toggle("is-playing", playing);
      root.classList.toggle("is-muted", muted);
      if (listEl) listEl.hidden = !listOpen;
      var items = listEl ? listEl.querySelectorAll("li") : [];
      for (var n = 0; n < items.length; n += 1) {
        items[n].classList.toggle("is-current", Number(items[n].getAttribute("data-index")) === index);
      }
    }

    function persistTime() {
      if (!audio || !Number.isFinite(audio.currentTime)) return;
      try {
        localStorage.setItem(AMBIENT_TIME_KEY, String(audio.currentTime));
        localStorage.setItem(BAND_INDEX_KEY, String(index));
      } catch (e) {
        /* ignore */
      }
    }

    var loadedSrc = "";

    function loadTrack(i, autoplay) {
      index = (i + tracks.length) % tracks.length;
      var track = trackAt(index);
      audio.muted = muted;
      audio.volume = 0.4;
      if (loadedSrc !== track.src) {
        loadedSrc = track.src;
        audio.src = track.src;
      } else {
        try {
          audio.currentTime = 0;
        } catch (e) {
          /* ignore */
        }
      }
      try {
        sessionStorage.setItem(BAND_PLAY_KEY, autoplay ? "1" : "0");
      } catch (e) {
        /* ignore */
      }
      paint();
      if (!autoplay || isAmbientAudioOptedOut()) {
        audio.pause();
        paint();
        return;
      }
      var pending = audio.play();
      if (pending && typeof pending.catch === "function") {
        pending.catch(function () {
          paint();
        });
      }
    }

    function buildList() {
      listEl.innerHTML = "";
      tracks.forEach(function (track, i) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "band-player-pick";
        btn.textContent = track.school + " — " + track.title;
        btn.addEventListener("click", function () {
          listOpen = false;
          setAmbientAudioOptOut(false);
          loadTrack(i, true);
        });
        li.setAttribute("data-index", String(i));
        li.appendChild(btn);
        listEl.appendChild(li);
      });
      paint();
    }

    function markMissingAndSkip() {
      available[index] = false;
      var start = index;
      for (var step = 1; step <= tracks.length; step += 1) {
        var next = (start + step) % tracks.length;
        if (available[next] !== false) {
          loadTrack(next, true);
          return;
        }
      }
      audio.pause();
      paint();
    }

    audio.muted = muted;
    audio.volume = 0.4;
    buildList();

    function keepPlayableTracks(flags) {
      var nextTracks = [];
      for (var i = 0; i < tracks.length; i += 1) {
        if (!flags[i]) continue;
        nextTracks.push(tracks[i]);
      }
      if (!nextTracks.length) return;
      var currentSrc = tracks[index] && tracks[index].src;
      tracks = nextTracks;
      index = 0;
      for (var j = 0; j < tracks.length; j += 1) {
        if (tracks[j].src === currentSrc) index = j;
      }
      try {
        localStorage.setItem(BAND_INDEX_KEY, String(index));
      } catch (e) {
        /* ignore */
      }
      available = {};
      buildList();
      if (loadedSrc === currentSrc && tracks[index] && tracks[index].src === currentSrc) {
        paint();
        return;
      }
      loadedSrc = "";
      loadTrack(index, !audio.paused && !audio.ended && !isAmbientAudioOptedOut());
    }

    Promise.all(
      tracks.map(function (track, i) {
        if (i === 0) return Promise.resolve(true);
        return fetch(track.src, { method: "GET", headers: { Range: "bytes=0-0" } })
          .then(function (res) {
            return res.ok || res.status === 206;
          })
          .catch(function () {
            return false;
          });
      })
    ).then(function (flags) {
      if (!bandUi || flags.every(Boolean)) return;
      keepPlayableTracks(flags);
    });

    audio.addEventListener("ended", function () {
      loadTrack(index + 1, true);
    });
    audio.addEventListener("play", paint);
    audio.addEventListener("pause", paint);
    audio.addEventListener("error", function () {
      if (audio.getAttribute("src")) markMissingAndSkip();
    });
    audio.addEventListener("timeupdate", function () {
      if (Math.floor(audio.currentTime) % 3 === 0) persistTime();
    });
    window.addEventListener("pagehide", persistTime);

    root.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-act]");
      if (!btn) return;
      var act = btn.getAttribute("data-act");
      if (act === "toggle") {
        listOpen = !listOpen;
        flashAction(listOpen ? "Tracks" : "Player");
        paint();
        return;
      }
      if (act === "prev") {
        if (audio.currentTime > 3) {
          audio.currentTime = 0;
          flashAction("Restart");
          paint();
          return;
        }
        flashAction("Previous");
        loadTrack(index - 1, !audio.paused && !audio.ended && !isAmbientAudioOptedOut());
        return;
      }
      if (act === "next") {
        flashAction("Next");
        loadTrack(index + 1, !audio.paused && !audio.ended && !isAmbientAudioOptedOut());
        return;
      }
      if (act === "play") {
        if (!audio.paused && !audio.ended) {
          audio.pause();
          try {
            sessionStorage.setItem(BAND_PLAY_KEY, "0");
          } catch (e) {
            /* ignore */
          }
          flashAction("Paused");
          paint();
          return;
        }
        setAmbientAudioOptOut(false);
        flashAction("Playing");
        loadTrack(index, true);
        return;
      }
      if (act === "mute") {
        muted = !muted;
        audio.muted = muted;
        writeStorageFlag(BAND_MUTE_KEY, muted);
        flashAction(muted ? "Muted" : "Sound on");
        paint();
      }
    });

    document.addEventListener("pointerdown", function (event) {
      if (!listOpen || root.contains(event.target)) return;
      listOpen = false;
      paint();
    });

    bandUi = {
      syncOptOut: function () {
        if (isAmbientAudioOptedOut()) {
          try {
            sessionStorage.setItem(BAND_PLAY_KEY, "0");
          } catch (e) {
            /* ignore */
          }
          audio.pause();
        }
        paint();
      },
    };

    var resume = false;
    try {
      resume = sessionStorage.getItem(BAND_PLAY_KEY) === "1";
    } catch (e2) {
      resume = false;
    }
    loadTrack(index, resume && !isAmbientAudioOptedOut());

    var token = localStorage.getItem(STORAGE_TOKEN);
    if (token) {
      fetch("/api/auth/settings", {
        headers: { Authorization: "Bearer " + token, accept: "application/json" },
      })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data || !data.settings || !bandUi) return;
          var enabled =
            data.settings.ambientAudioEnabled == null
              ? true
              : Boolean(data.settings.ambientAudioEnabled);
          if (!enabled) setAmbientAudioOptOut(true);
        })
        .catch(function () {});
    }
  }

  function onReady() {
    ensureAnalyticsLoaded();
    refreshAll();
    mountBetaBadge();
    mountNameSuggestForm();
    maybeValidateToken();
    mountSiteFeedback();
    mountSiteAudio();
    wireMenuFootballSpin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }

  window.addEventListener("storage", function (e) {
    if (e.key === STORAGE_TOKEN || e.key === STORAGE_USER) {
      refreshAll();
    }
  });
})();
