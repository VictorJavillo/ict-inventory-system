let CURRENT_USER = null;

const ROLE_ACCESS = {
  admin: {
    dashboard: true,
    inventory: true,
    borrow: true,
    users: true,
    logs: true,
    backup: true,
    settings: true,

    inventoryAdd: true,
    inventoryEdit: true,
    inventoryDelete: true,

    borrowAdd: true,
    borrowEdit: true,
    borrowReturn: true,
    borrowDelete: true,

    backupCreate: true,
    backupRestore: true,

    userManage: true,
    logsView: true
  },

  staff: {
    dashboard: true,
    inventory: true,
    borrow: true,
    users: false,
    logs: false,
    backup: true,
    settings: true,

    inventoryAdd: true,
    inventoryEdit: true,
    inventoryDelete: false,

    borrowAdd: true,
    borrowEdit: true,
    borrowReturn: true,
    borrowDelete: false,

    backupCreate: true,
    backupRestore: false,

    userManage: false,
    logsView: false
  },

  viewer: {
    dashboard: true,
    inventory: true,
    borrow: true,
    users: false,
    logs: false,
    backup: false,
    settings: true,

    inventoryAdd: false,
    inventoryEdit: false,
    inventoryDelete: false,

    borrowAdd: false,
    borrowEdit: false,
    borrowReturn: false,
    borrowDelete: false,

    backupCreate: false,
    backupRestore: false,

    userManage: false,
    logsView: false
  }
};

function getRolePermissions(role) {
  return ROLE_ACCESS[role] || ROLE_ACCESS.viewer;
}

async function fetchCurrentUser() {
  try {
    const res = await fetch("/api/session-check");

    if (!res.ok) {
      window.location.href = "/login.html";
      return null;
    }

    const data = await res.json();
    CURRENT_USER = data.user;
    return data.user;
  } catch (error) {
    window.location.href = "/login.html";
    return null;
  }
}

function getCurrentPageKey() {
  const path = window.location.pathname.toLowerCase();

  if (path.includes("dashboard")) return "dashboard";
  if (path.includes("inventory")) return "inventory";
  if (path.includes("borrow")) return "borrow";
  if (path.includes("users")) return "users";
  if (path.includes("logs")) return "logs";
  if (path.includes("backup")) return "backup";
  if (path.includes("settings")) return "settings";

  return "dashboard";
}

function redirectToAllowedPage(role) {
  const perms = getRolePermissions(role);

  if (perms.dashboard) return (window.location.href = "/dashboard.html");
  if (perms.inventory) return (window.location.href = "/inventory.html");
  if (perms.borrow) return (window.location.href = "/borrow.html");
  if (perms.settings) return (window.location.href = "/settings.html");

  window.location.href = "/login.html";
}

function enforcePageAccess(user) {
  const role = user?.role || "viewer";
  const perms = getRolePermissions(role);
  const pageKey = getCurrentPageKey();

  if (!perms[pageKey]) {
    alert("You do not have permission to access this page.");
    redirectToAllowedPage(role);
    return false;
  }

  return true;
}

function applySidebarAccess(user) {
  const role = user?.role || "viewer";
  const perms = getRolePermissions(role);

  const map = {
    dashboard: 'a[href="dashboard.html"]',
    inventory: 'a[href="inventory.html"]',
    borrow: 'a[href="borrow.html"]',
    users: 'a[href="users.html"]',
    logs: 'a[href="logs.html"]',
    backup: 'a[href="backup.html"]',
    settings: 'a[href="settings.html"]'
  };

  Object.entries(map).forEach(([key, selector]) => {
    const link = document.querySelector(selector);
    if (!link) return;

    if (perms[key]) {
      link.style.display = "";
    } else {
      link.style.display = "none";
    }
  });
}

function applyRoleBadges(user) {
  const role = user?.role || "viewer";

  document.querySelectorAll("[data-user-role]").forEach((el) => {
    el.textContent = role.toUpperCase();
  });

  document.querySelectorAll("[data-user-name]").forEach((el) => {
    el.textContent = user?.username || "User";
  });
}

function setReadOnlyBanner(user) {
  const role = user?.role || "viewer";
  const existing = document.getElementById("roleReadOnlyBanner");

  if (existing) existing.remove();

  if (role !== "viewer") return;

  const banner = document.createElement("div");
  banner.id = "roleReadOnlyBanner";
  banner.innerHTML = `
    <div style="
      margin: 12px 0;
      padding: 12px 16px;
      border-radius: 12px;
      background: rgba(255, 193, 7, 0.15);
      border: 1px solid rgba(255, 193, 7, 0.35);
      color: #ffd666;
      font-weight: 600;
    ">
      Viewer mode: read-only access only.
    </div>
  `;

  const main =
    document.querySelector(".main") ||
    document.querySelector(".content") ||
    document.querySelector("main") ||
    document.body;

  main.prepend(banner);
}

function hideByPermission(user) {
  const role = user?.role || "viewer";
  const perms = getRolePermissions(role);

  document.querySelectorAll("[data-permission]").forEach((el) => {
    const permissionKey = el.getAttribute("data-permission");
    if (!perms[permissionKey]) {
      el.style.display = "none";
    }
  });
}

function disableViewerForms(user) {
  const role = user?.role || "viewer";
  if (role !== "viewer") return;

  document.querySelectorAll("form").forEach((form) => {
    form.querySelectorAll("input, select, textarea, button").forEach((el) => {
      if (
        el.type !== "button" &&
        el.type !== "submit" &&
        el.type !== "reset"
      ) {
        el.disabled = true;
      }
    });
  });

  document.querySelectorAll("[data-viewer-allow='true']").forEach((el) => {
    el.disabled = false;
  });
}

async function initRoleBasedPage() {
  const user = await fetchCurrentUser();
  if (!user) return;

  const allowed = enforcePageAccess(user);
  if (!allowed) return;

  applySidebarAccess(user);
  applyRoleBadges(user);
  setReadOnlyBanner(user);
  hideByPermission(user);
  disableViewerForms(user);

  window.__CURRENT_USER__ = user;
}

async function logoutUser() {
  try {
    const res = await fetch("/api/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    const data = await res.json();

    if (data.success) {
      window.location.href = "/login.html";
    } else {
      alert(data.error || "Logout failed.");
    }
  } catch (error) {
    alert("Logout failed.");
  }
}

setInterval(async () => {
  try {
    const res = await fetch("/api/session-check");
    if (!res.ok) {
      window.location.href = "/login.html";
    }
  } catch (error) {
    window.location.href = "/login.html";
  }
}, 60000);