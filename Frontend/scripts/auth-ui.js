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
        { href: "bama.html", label: "📅 Schedule Predictions" },
        { href: "prediction-history.html", label: "🏆 Leaderboards" },
        { href: "power-rankings.html", label: "📈 Power Rankings" },
        { href: "predictor.html", label: "🎯 Matchup Predictor" },
        { href: "prop-bet.html", label: "📊 Prop Evaluator" },
        { href: "CFPPredictions.html", label: "🏆 CFP Picks" },
      ]
    },
    teams: {
      label: "🏈 Teams & Players",
      items: [
        { href: "teams.html", label: "🏈 Teams" },
        { href: "list.html", label: "👑 Heisman" },
        { href: "recruitmap.html", label: "🗺️ Recruit Map" },
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

  function getLoginHref() {
    var page = basenameOnly(window.location.pathname);
    if (page === "login.html") return "login.html";
    var target = page + (window.location.search || "");
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

  /** Prefer A#.png files. */
  function avatarSrcForUser(user) {
    var id = avatarIdForUser(user);
    if (!id) return null;
    return avatarPngPath(id);
  }

  function avatarImgHtml(user, className, size) {
    var id = avatarIdForUser(user);
    var cls = className || "user-avatar";
    var wh = size || 40;
    if (!id) {
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
    var png = avatarPngPath(id);
    return (
      '<img class="' +
      cls +
      '" src="' +
      png +
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
      html +=
        '<a href="admin.html" class="dropdown-item dropdown-item-admin">🛠️ Admin</a>';
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
  };

  function onReady() {
    refreshAll();
    maybeValidateToken();
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
