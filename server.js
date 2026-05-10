const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const XLSX = require("xlsx");
require("dotenv").config();

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const DEFAULT_SESSION_TIMEOUT = 1000 * 60 * 30; // 30 minutes
const DEFAULT_MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 1000 * 60 * 15; // 15 minutes

const loginAttempts = new Map();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const BACKUP_DIR = path.join(__dirname, "backups");

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/* =========================
   PREMIUM SECURITY CORE
========================= */
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "ict_inventory_secret_key_change_me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: DEFAULT_SESSION_TIMEOUT
    }
  })
);

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

/* =========================
   HELPERS
========================= */
function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeCategory(value) {
  const v = normalizeText(value).toLowerCase();

  if (v === "desktop" || v === "desktop computer") return "Desktop Computer";
  if (v === "laptop" || v === "laptop computer") return "Laptop";
  if (v === "printer") return "Printer";
  if (v === "mobile phone") return "Mobile Phone";
  if (v === "handheld radio") return "Handheld Radio";
  if (v === "television") return "Television";

  return normalizeText(value);
}

function normalizeStatus(value) {
  const v = normalizeText(value).toUpperCase();
  if (v === "OPNL") return "OPNL";
  return "NOPNL";
}

function normalizeUnit(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeLicenseValue(value) {
  const v = normalizeText(value).toLowerCase();

  if (v === "licensed") return "Licensed";
  if (v === "unlicensed") return "Unlicensed";
  if (v === "n/a" || v === "na") return "N/A";

  return normalizeText(value);
}

function normalizeWindowsType(value) {
  const v = normalizeText(value).toLowerCase();

  if (v === "windows 7") return "Windows 7";
  if (v === "windows 8") return "Windows 8";
  if (v === "windows 10") return "Windows 10";
  if (v === "windows 10 pro") return "Windows 10 Pro";
  if (v === "windows 11") return "Windows 11";
  if (v === "windows 11 pro") return "Windows 11 Pro";
  if (v === "n/a" || v === "na") return "N/A";

  return normalizeText(value);
}

function isComputerCategory(category) {
  const normalized = normalizeCategory(category).toLowerCase();
  return normalized === "desktop computer" || normalized === "laptop";
}

function sanitizeInventoryPayload(body) {
  const category = normalizeCategory(body.category);
  const isComputer = isComputerCategory(category);

  return {
    nr: normalizeText(body.nr),
    category,
    description: normalizeText(body.description),
    serial_number: normalizeText(body.serial_number),
    property_number: normalizeText(body.property_number),
    status: normalizeStatus(body.status),
    date_issued: normalizeText(body.date_issued),
    unit: normalizeUnit(body.unit),
    os: isComputer ? normalizeLicenseValue(body.os) : "N/A",
    windows_type: isComputer ? normalizeWindowsType(body.windows_type) : "N/A",
    ms_office: isComputer ? normalizeLicenseValue(body.ms_office) : "N/A",
    antivirus: isComputer ? normalizeLicenseValue(body.antivirus) : "N/A",
    remarks: normalizeText(body.remarks)
  };
}

function sanitizeBorrowPayload(body) {
  return {
    borrower_name: normalizeText(body.borrower_name),
    office_unit: normalizeText(body.office_unit),
    equipment: normalizeText(body.equipment),
    quantity: Number(body.quantity) || 0,
    date_borrowed: normalizeText(body.date_borrowed),
    date_return: normalizeText(body.date_return),
    purpose: normalizeText(body.purpose),
    remarks: normalizeText(body.remarks)
  };
}

function isValidRole(role) {
  return ["admin", "staff", "viewer"].includes(role);
}

function isStrongPassword(password) {
  const value = String(password || "");
  return (
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value)
  );
}

async function getNextNR() {
  const result = await pool.query(`
    SELECT MAX(CAST(nr AS INTEGER)) AS "maxNr"
    FROM inventory
    WHERE nr IS NOT NULL
      AND TRIM(nr) <> ''
      AND nr ~ '^[0-9]+$'
  `);

  const maxNr = result.rows[0]?.maxNr ? Number(result.rows[0].maxNr) : 0;
  return maxNr + 1;
}

async function logActivity(user, action, module, details) {
  try {
    const username = user?.username || "SYSTEM";
    const role = user?.role || "system";

    await pool.query(
      `INSERT INTO activity_logs (username, role, action, module, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        normalizeText(username),
        normalizeText(role),
        normalizeText(action).toUpperCase(),
        normalizeText(module).toUpperCase(),
        normalizeText(details)
      ]
    );
  } catch (error) {
    console.error("Activity log error:", error.message);
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return "0 KB";
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function getPgDumpPath() {
  if (process.env.PG_DUMP_PATH && process.env.PG_DUMP_PATH.trim()) {
    return process.env.PG_DUMP_PATH.trim();
  }
  return "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe";
}

function getPsqlPath() {
  if (process.env.PSQL_PATH && process.env.PSQL_PATH.trim()) {
    return process.env.PSQL_PATH.trim();
  }
  return "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
}

async function getSystemSetting(key, fallback = "") {
  try {
    const result = await pool.query(
      `SELECT setting_value
       FROM system_settings
       WHERE setting_key = $1
       LIMIT 1`,
      [key]
    );

    if (result.rows.length === 0) return fallback;
    return result.rows[0].setting_value ?? fallback;
  } catch (error) {
    console.error("Get system setting error:", error.message);
    return fallback;
  }
}

async function setSystemSetting(key, value) {
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (setting_key)
     DO UPDATE SET
       setting_value = EXCLUDED.setting_value,
       updated_at = NOW()`,
    [key, value]
  );
}

async function getAdminSettingsRow() {
  try {
    const result = await pool.query(`SELECT * FROM admin_settings LIMIT 1`);
    if (result.rows.length === 0) {
      return {
        allow_user_creation: true,
        allow_user_deletion: true,
        require_strong_password: false,
        enable_login_audit: true,
        session_timeout: 30,
        max_login_attempts: DEFAULT_MAX_LOGIN_ATTEMPTS
      };
    }
    return result.rows[0];
  } catch (error) {
    return {
      allow_user_creation: true,
      allow_user_deletion: true,
      require_strong_password: false,
      enable_login_audit: true,
      session_timeout: 30,
      max_login_attempts: DEFAULT_MAX_LOGIN_ATTEMPTS
    };
  }
}

async function getSessionTimeoutMs() {
  const settings = await getAdminSettingsRow();
  const minutes = Number(settings.session_timeout) || 30;
  return minutes * 60 * 1000;
}

async function getMaxLoginAttempts() {
  const settings = await getAdminSettingsRow();
  const max = Number(settings.max_login_attempts) || DEFAULT_MAX_LOGIN_ATTEMPTS;
  return max > 0 ? max : DEFAULT_MAX_LOGIN_ATTEMPTS;
}

async function isLoginAuditEnabled() {
  const settings = await getAdminSettingsRow();
  return settings.enable_login_audit !== false;
}

async function isStrongPasswordRequired() {
  const settings = await getAdminSettingsRow();
  return settings.require_strong_password === true;
}

/* =========================
   PREMIUM SECURITY HELPERS
========================= */
function getClientKey(req, username = "") {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown_ip";

  return `${normalizeText(username).toLowerCase()}|${ip}`;
}

function getLoginAttempt(key) {
  if (!loginAttempts.has(key)) {
    loginAttempts.set(key, {
      count: 0,
      lockUntil: null
    });
  }
  return loginAttempts.get(key);
}

function isLocked(key) {
  const record = getLoginAttempt(key);

  if (record.lockUntil && Date.now() < record.lockUntil) {
    return true;
  }

  if (record.lockUntil && Date.now() >= record.lockUntil) {
    record.count = 0;
    record.lockUntil = null;
  }

  return false;
}

function recordFailedAttempt(key, maxAttempts) {
  const record = getLoginAttempt(key);
  record.count += 1;

  if (record.count >= maxAttempts) {
    record.lockUntil = Date.now() + LOCK_TIME;
  }

  loginAttempts.set(key, record);
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

function getRemainingLockMinutes(key) {
  const record = getLoginAttempt(key);
  if (!record.lockUntil) return 0;
  return Math.ceil((record.lockUntil - Date.now()) / 60000);
}

function touchSession(req) {
  if (req.session) {
    req.session.lastActivity = Date.now();
  }
}

async function sessionTimeoutGuard(req, res, next) {
  const openPaths = [
  "/",
  "/login.html",
  "/index.html",
  "/manifest.json",
  "/service-worker.js",
  "/style.css",
  "/app.js",
  "/api/login",
  "/api/session",
  "/api/session-check"
];

  if (openPaths.includes(req.path)) {
    return next();
  }

  if (!req.session.user) {
    return next();
  }

  const sessionTimeout = await getSessionTimeoutMs();
  const now = Date.now();
  const lastActivity = req.session.lastActivity || now;

  if (now - lastActivity > sessionTimeout) {
    return req.session.destroy(() => {
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ error: "Session expired", expired: true });
      }
      return res.redirect("/login.html");
    });
  }

  req.session.lastActivity = now;
  next();
}

function requireAuthPage(req, res, next) {
  const allowed = [
  "/",
  "/login.html",
  "/index.html",
  "/manifest.json",
  "/service-worker.js",
  "/api/login",
  "/api/session",
  "/api/session-check",
  "/style.css",
  "/app.js"
];

  if (allowed.includes(req.path)) {
    return next();
  }

  if (req.session.user) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.redirect("/login.html");
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many login requests. Please try again later."
  }
});
app.use(express.static(path.join(__dirname, "public"), {
  index: false
}));
app.use(sessionTimeoutGuard);
app.use(requireAuthPage);

app.get("/manifest.json", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "manifest.json"));
});

app.get("/service-worker.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.sendFile(path.join(__dirname, "public", "service-worker.js"));
});


function sendProtectedPage(fileName, allowedRoles = ["admin", "staff", "viewer"]) {
  return (req, res) => {
    if (!req.session.user) {
      return res.redirect("/login.html");
    }

    if (!allowedRoles.includes(req.session.user.role)) {
      return res.redirect("/dashboard.html");
    }

    return res.sendFile(path.join(__dirname, "public", fileName));
  };
}

app.get("/login.html", (req, res) => {
  if (req.session.user) {
    return res.redirect("/dashboard.html");
  }

  return res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/dashboard.html", sendProtectedPage("dashboard.html", ["admin", "staff", "viewer"]));
app.get("/inventory.html", sendProtectedPage("inventory.html", ["admin", "staff", "viewer"]));
app.get("/borrow.html", sendProtectedPage("borrow.html", ["admin", "staff", "viewer"]));
app.get("/settings.html", sendProtectedPage("settings.html", ["admin", "staff", "viewer"]));
app.get("/users.html", sendProtectedPage("users.html", ["admin"]));
app.get("/logs.html", sendProtectedPage("logs.html", ["admin"]));
app.get("/backup.html", sendProtectedPage("backup.html", ["admin", "staff"]));


app.use("/backups", express.static(BACKUP_DIR));

/* =========================
   DATABASE INIT
========================= */
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        full_name TEXT,
        username TEXT UNIQUE,
        email TEXT,
        password TEXT,
        role TEXT DEFAULT 'viewer',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS full_name TEXT
    `);

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email TEXT
    `);

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'viewer'
    `);

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
    `);

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);

    await pool.query(`
      UPDATE users
      SET role = 'admin'
      WHERE username = 'admin' AND (role IS NULL OR TRIM(role) = '')
    `);

    await pool.query(`
      UPDATE users
      SET status = 'active'
      WHERE status IS NULL OR TRIM(status) = ''
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        nr TEXT,
        category TEXT,
        description TEXT,
        serial_number TEXT,
        property_number TEXT,
        status TEXT,
        date_issued TEXT,
        unit TEXT,
        os TEXT,
        windows_type TEXT,
        ms_office TEXT,
        antivirus TEXT,
        remarks TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS borrows (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        borrower_name TEXT,
        office_unit TEXT,
        equipment TEXT,
        quantity INTEGER,
        date_borrowed TEXT,
        date_return TEXT,
        purpose TEXT,
        remarks TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        username TEXT,
        role TEXT,
        action TEXT,
        module TEXT,
        details TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        setting_key TEXT UNIQUE,
        setting_value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        allow_user_creation BOOLEAN DEFAULT true,
        allow_user_deletion BOOLEAN DEFAULT true,
        require_strong_password BOOLEAN DEFAULT false,
        enable_login_audit BOOLEAN DEFAULT true,
        session_timeout INTEGER DEFAULT 30,
        max_login_attempts INTEGER DEFAULT 5
      )
    `);

    const adminSettingsCheck = await pool.query(`SELECT id FROM admin_settings LIMIT 1`);
    if (adminSettingsCheck.rows.length === 0) {
      await pool.query(`INSERT INTO admin_settings DEFAULT VALUES`);
    }

    const existingAdmin = await pool.query(
      `SELECT * FROM users WHERE username = $1 LIMIT 1`,
      ["admin"]
    );

    if (existingAdmin.rows.length === 0) {
      const hashedPassword = await bcrypt.hash("admin123", 10);



await pool.query(
  `INSERT INTO users (username, password, role, status)
   VALUES ($1, $2, $3, $4)`,
  ["admin", hashedPassword, "admin", "active"]
);


      console.log("Default user created: admin / admin123");

      await logActivity(
        { username: "SYSTEM", role: "system" },
        "CREATE",
        "USERS",
        "Default admin account created"
      );
    } else {
      const admin = existingAdmin.rows[0];

      if (admin.password && !admin.password.startsWith("$2")) {
        const hashedPassword = await bcrypt.hash(admin.password, 10);

        await pool.query(
          `UPDATE users SET password = $1 WHERE username = $2`,
          [hashedPassword, "admin"]
        );

        console.log("Admin password upgraded to hashed.");
      }

      if (!admin.role || admin.role.trim() === "") {
        await pool.query(
          `UPDATE users SET role = $1 WHERE username = $2`,
          ["admin", "admin"]
        );
      }

      if (!admin.status || admin.status.trim() === "") {
        await pool.query(
          `UPDATE users SET status = $1 WHERE username = $2`,
          ["active", "admin"]
        );
      }
    }

    const existingSystemName = await pool.query(
      `SELECT id FROM system_settings WHERE setting_key = $1 LIMIT 1`,
      ["system_name"]
    );

    if (existingSystemName.rows.length === 0) {
      await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ($1, $2)`,
        ["system_name", "ICT Inventory"]
      );
    }

    console.log("Supabase/Postgres database ready.");
  } catch (error) {
    console.error("Database initialization error:", error.message);
  }
}

/* =========================
   AUTH MIDDLEWARE
========================= */
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  touchSession(req);
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access only" });
  }

  next();
}


function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!allowedRoles.includes(req.session.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    touchSession(req);
    next();
  };
}

/* =========================
   AUTH ROUTES
========================= */
app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const username = normalizeText(req.body.username);
  const password = String(req.body.password || "");
  const attemptKey = getClientKey(req, username);

  try {
    const auditEnabled = await isLoginAuditEnabled();
    const maxAttempts = await getMaxLoginAttempts();

    if (!username || !password) {
      return res.status(400).json({
        error: "Username and password are required"
      });
    }

    if (isLocked(attemptKey)) {
      const minutes = getRemainingLockMinutes(attemptKey);

      if (auditEnabled) {
        await logActivity(
          { username: username || "UNKNOWN", role: "unknown" },
          "LOCKED_LOGIN",
          "AUTH",
          `Blocked login attempt for locked key: ${attemptKey}`
        );
      }

      return res.status(429).json({
        error: `Too many failed login attempts. Try again in ${minutes} minute(s).`
      });
    }

    const result = await pool.query(
      `SELECT * FROM users WHERE username = $1 LIMIT 1`,
      [username]
    );

    const user = result.rows[0];

    if (!user) {
      recordFailedAttempt(attemptKey, maxAttempts);

      if (auditEnabled) {
        await logActivity(
          { username: username || "UNKNOWN", role: "unknown" },
          "FAILED_LOGIN",
          "AUTH",
          `Failed login attempt for unknown username: ${username || "UNKNOWN"}`
        );
      }

      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    if ((user.status || "active").toLowerCase() !== "active") {
      if (auditEnabled) {
        await logActivity(
          { username: user.username, role: user.role || "viewer" },
          "BLOCKED_LOGIN",
          "AUTH",
          `Inactive account tried to login: ${user.username}`
        );
      }

      return res.status(403).json({
        error: "Your account is inactive. Please contact admin."
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      recordFailedAttempt(attemptKey, maxAttempts);

      if (auditEnabled) {
        await logActivity(
          { username: user.username, role: user.role || "viewer" },
          "FAILED_LOGIN",
          "AUTH",
          `Invalid password attempt for user: ${user.username}`
        );
      }

      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    clearLoginAttempts(attemptKey);

   req.session.user = {
  id: user.id,
  username: user.username,
  role: user.role || "staff",
  assigned_unit: user.assigned_unit || null,
  assigned_office: user.assigned_office || null,
  assigned_site: user.assigned_site || null
};

    req.session.lastActivity = Date.now();

    if (auditEnabled) {
      await logActivity(
        req.session.user,
        "LOGIN",
        "AUTH",
        "User logged in successfully"
      );
    }

    res.json({
      success: true,
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        role: user.role || "viewer",
      assigned_unit: user.assigned_unit || null,
    assigned_office: user.assigned_office || null,
    assigned_site: user.assigned_site || null
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Server error during login" });
  }
});

app.get("/api/session", (req, res) => {
  if (req.session.user) {
    req.session.lastActivity = Date.now();

    return res.json({
      loggedIn: true,
      user: req.session.user
    });
  }

  res.json({
    loggedIn: false
  });
});

app.get("/api/session-check", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      expired: true,
      message: "Session expired"
    });
  }

  req.session.lastActivity = Date.now();

  return res.json({
    success: true,
    user: req.session.user
  });
});

app.post("/api/logout", async (req, res) => {
  const currentUser = req.session.user;

  try {
    if (currentUser) {
      const auditEnabled = await isLoginAuditEnabled();
      if (auditEnabled) {
        await logActivity(currentUser, "LOGOUT", "AUTH", "User logged out");
      }
    }

    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }

      res.clearCookie("connect.sid");
      return res.json({ success: true });
    });
  } catch (error) {
    console.error("Logout error:", error.message);
    res.status(500).json({ error: "Logout failed" });
  }
});

/* =========================
   ADMIN SETTINGS
========================= */
app.get("/api/settings", requireRole("admin"), async (req, res) => {
  try {
    const adminResult = await pool.query(
      `SELECT username, role, status, created_at
       FROM users
       WHERE username = $1
       LIMIT 1`,
      ["admin"]
    );

    const adminUser = adminResult.rows[0] || null;
    const systemName = await getSystemSetting("system_name", "ICT Inventory");

    res.json({
      success: true,
      settings: {
        systemName,
        adminUsername: adminUser?.username || "admin",
        adminRole: adminUser?.role || "admin",
        adminStatus: adminUser?.status || "active",
        createdAt: adminUser?.created_at || null
      }
    });
  } catch (error) {
    console.error("Fetch settings error:", error.message);
    res.status(500).json({ error: "Failed to fetch settings." });
  }
});

app.post("/api/settings/system-name", requireRole("admin"), async (req, res) => {
  try {
    const systemName = normalizeText(req.body.systemName);

    if (!systemName) {
      return res.status(400).json({ error: "System name is required." });
    }

    await setSystemSetting("system_name", systemName);

    await logActivity(
      req.session.user,
      "UPDATE",
      "SETTINGS",
      `Updated system name to: ${systemName}`
    );

    res.json({
      success: true,
      message: "System name updated successfully.",
      systemName
    });
  } catch (error) {
    console.error("Update system name error:", error.message);
    res.status(500).json({ error: "Failed to update system name." });
  }
});

app.post("/api/settings/change-password", requireRole("admin"), async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: "All password fields are required." });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "New password and confirm password do not match." });
    }

    const strongRequired = await isStrongPasswordRequired();
    if (strongRequired && !isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: "New password must be at least 8 characters and include uppercase, lowercase, and number."
      });
    }

    if (!strongRequired && newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters." });
    }

    const result = await pool.query(
      `SELECT id, username, password
       FROM users
       WHERE username = $1
       LIMIT 1`,
      ["admin"]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Admin account not found." });
    }

    const adminUser = result.rows[0];
    const isMatch = await bcrypt.compare(currentPassword, adminUser.password);

    if (!isMatch) {
      await logActivity(
        req.session.user,
        "FAILED_PASSWORD_CHANGE",
        "SETTINGS",
        "Incorrect current password while attempting admin password change"
      );

      return res.status(400).json({ error: "Current password is incorrect." });
    }


    await pool.query(
      `UPDATE users
       SET password = $1
       WHERE id = $2`,
      [hashedPassword, adminUser.id]
    );

    await logActivity(
      req.session.user,
      "CHANGE_PASSWORD",
      "SETTINGS",
      "Admin password changed successfully"
    );

    res.json({
      success: true,
      message: "Admin password updated successfully."
    });
  } catch (error) {
    console.error("Change password error:", error.message);
    res.status(500).json({ error: "Failed to change password." });
  }
});

/* =========================
   USER MANAGEMENT
========================= */
app.get("/api/users", requireLogin, requireRole("admin"), async (req, res) => { 
  try {
    const result = await pool.query(
      `SELECT id, full_name, username, email, role, status, created_at
       FROM users
       ORDER BY id ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Fetch users error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/users", requireRole("admin"), async (req, res) => {
  try {
    const username = normalizeText(req.body.username);
    const password = String(req.body.password || "").trim();
    const role = normalizeText(req.body.role).toLowerCase() || "viewer";
    const status = normalizeText(req.body.status || "active").toLowerCase() || "active";
    const full_name = normalizeText(req.body.full_name);
    const email = normalizeText(req.body.email);
    const assigned_unit = normalizeText(req.body.assigned_unit);
const assigned_office = normalizeText(req.body.assigned_office);
const assigned_site = normalizeText(req.body.assigned_site);

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    if (!isValidRole(role)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }

    const settings = await getAdminSettingsRow();
    if (settings.allow_user_creation === false) {
      return res.status(403).json({ error: "User creation is disabled in admin settings." });
    }

    if (settings.require_strong_password === true && !isStrongPassword(password)) {
      return res.status(400).json({
        error: "Password must be at least 8 characters and include uppercase, lowercase, and number."
      });
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE username = $1 LIMIT 1`,
      [username]
    );
    const hashedPassword = await bcrypt.hash(password, 10);

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Username already exists." });
    }


    const result = await pool.query(
  `INSERT INTO users
   (full_name, username, email, password, role, status, assigned_unit, assigned_office, assigned_site)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
   RETURNING id, full_name, username, email, role, status, assigned_unit, assigned_office, assigned_site, created_at`,
  [
    full_name || null,
    username,
    email || null,
    hashedPassword,
    role,
    status,
    role === "admin" ? null : assigned_unit || null,
    role === "admin" ? null : assigned_office || null,
    role === "admin" ? null : assigned_site || null
  ]
);

    await logActivity(
      req.session.user,
      "CREATE",
      "USERS",
      `Created user: ${result.rows[0].username} with role: ${result.rows[0].role} and status: ${result.rows[0].status}`
    );

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error("Create user error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/users/:id", requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const role = normalizeText(req.body.role).toLowerCase();
    const newPassword = String(req.body.password || "").trim();
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const status = normalizeText(req.body.status).toLowerCase();
    const full_name = normalizeText(req.body.full_name);
    const email = normalizeText(req.body.email);
    const assigned_unit = normalizeText(req.body.assigned_unit);
const assigned_office = normalizeText(req.body.assigned_office);
const assigned_site = normalizeText(req.body.assigned_site);

    const existing = await pool.query(
      `SELECT id, username, role, status FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const user = existing.rows[0];
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (role) {
      if (!isValidRole(role)) {
        return res.status(400).json({ error: "Invalid role." });
      }

      if (user.username === "admin" && role === "viewer") {
        return res.status(400).json({ error: "Main admin cannot be downgraded to viewer." });
      }

      updates.push(`role = $${paramIndex++}`);
      params.push(role);
    }

    if (status) {
      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({ error: "Invalid status." });
      }

      if (user.username === "admin" && status === "inactive") {
        return res.status(400).json({ error: "Main admin cannot be set to inactive." });
      }

      updates.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (full_name) {
      updates.push(`full_name = $${paramIndex++}`);
      params.push(full_name);
    }

    if (email) {
      updates.push(`email = $${paramIndex++}`);
      params.push(email);
    }

    if (newPassword) {
      const strongRequired = await isStrongPasswordRequired();
      if (strongRequired && !isStrongPassword(newPassword)) {
        return res.status(400).json({
          error: "Password must be at least 8 characters and include uppercase, lowercase, and number."
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      updates.push(`password = $${paramIndex++}`);
      params.push(hashedPassword);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    params.push(id);

    await pool.query(
      `UPDATE users
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex}`,
      params
    );

    const updated = await pool.query(
      `SELECT id, full_name, username, email, role, status, created_at FROM users WHERE id = $1`,
      [id]
    );

    await logActivity(
      req.session.user,
      "UPDATE",
      "USERS",
      `Updated user: ${user.username}`
    );

    res.json({
      success: true,
      user: updated.rows[0]
    });
  } catch (error) {
    console.error("Update user error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/users/:id", requireRole("admin"), async (req, res) => {
  try {
    const settings = await getAdminSettingsRow();
    if (settings.allow_user_deletion === false) {
      return res.status(403).json({ error: "User deletion is disabled in admin settings." });
    }

    const { id } = req.params;

    const existing = await pool.query(
      `SELECT id, username FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const user = existing.rows[0];

    if (user.username === "admin") {
      return res.status(400).json({ error: "Main admin cannot be deleted." });
    }

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);

    await logActivity(
      req.session.user,
      "DELETE",
      "USERS",
      `Deleted user: ${user.username}`
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Delete user error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   INVENTORY CRUD
========================= */
app.get("/api/inventory", requireLogin, async (req, res) => {
  try {
    const user = req.session.user;

    // 🔥 ADMIN = see all inventory
    if (user.role === "admin") {
      const result = await pool.query(`
        SELECT * FROM inventory
        ORDER BY id DESC
      `);

      return res.json(result.rows);
    }
    // 🔒 STAFF = see only assigned unit
const result = await pool.query(
  `
  SELECT *
  FROM inventory
  WHERE unit = $1
  ORDER BY id DESC
  `,
  [user.assigned_unit]
);

res.json(result.rows);

  } catch (error) {
    console.error("Fetch inventory error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/inventory", requireRole("admin", "staff"), async (req, res) => {
  try {
    const payload = sanitizeInventoryPayload(req.body);
    if (req.session.user.role !== "admin") {
  payload.unit = req.session.user.assigned_unit;
}
    const finalNr = payload.nr !== "" ? payload.nr : String(await getNextNR());

    const result = await pool.query(
      `INSERT INTO inventory
      (nr, category, description, serial_number, property_number, status, date_issued, unit, os, windows_type, ms_office, antivirus, remarks)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, nr, category, description`,
      [
        String(finalNr),
        payload.category,
        payload.description,
        payload.serial_number,
        payload.property_number,
        payload.status,
        payload.date_issued,
        payload.unit,
        payload.os,
        payload.windows_type,
        payload.ms_office,
        payload.antivirus,
        payload.remarks
      ]
    );

    await logActivity(
      req.session.user,
      "CREATE",
      "INVENTORY",
      `Added inventory ID ${result.rows[0].id}, NR ${result.rows[0].nr}, Category ${result.rows[0].category}, Description ${result.rows[0].description}`
    );

    res.json({ success: true, id: result.rows[0].id, nr: result.rows[0].nr });
  } catch (error) {
    console.error("Insert inventory error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/inventory/:id", requireRole("admin", "staff"), async (req, res) => {
  const { id } = req.params;

  try {
    const payload = sanitizeInventoryPayload(req.body);
    if (req.session.user.role !== "admin") {
  payload.unit = req.session.user.assigned_unit;
}

    const existingResult = await pool.query(
      `SELECT * FROM inventory WHERE id = $1 LIMIT 1`,
      [id]
    );

    const existingRow = existingResult.rows[0];

    if (!existingRow) {
      return res.status(404).json({ error: "Record not found." });
    }

    const finalNr = payload.nr !== "" ? payload.nr : existingRow.nr || "";

    const updateResult = await pool.query(
      `UPDATE inventory SET
        nr = $1,
        category = $2,
        description = $3,
        serial_number = $4,
        property_number = $5,
        status = $6,
        date_issued = $7,
        unit = $8,
        os = $9,
        windows_type = $10,
        ms_office = $11,
        antivirus = $12,
        remarks = $13
      WHERE id = $14
      RETURNING id, nr, category, description`,
      [
        finalNr,
        payload.category,
        payload.description,
        payload.serial_number,
        payload.property_number,
        payload.status,
        payload.date_issued,
        payload.unit,
        payload.os,
        payload.windows_type,
        payload.ms_office,
        payload.antivirus,
        payload.remarks,
        id
      ]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: "Record not found." });
    }

    await logActivity(
      req.session.user,
      "UPDATE",
      "INVENTORY",
      `Updated inventory ID ${updateResult.rows[0].id}, NR ${updateResult.rows[0].nr}, Category ${updateResult.rows[0].category}, Description ${updateResult.rows[0].description}`
    );

    res.json({
      success: true,
      message: "Inventory updated successfully.",
      nr: finalNr
    });
  } catch (error) {
    console.error("Update inventory error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/inventory/:id", requireRole("admin"), async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT id, nr, category, description FROM inventory WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Record not found." });
    }

    const item = existing.rows[0];

    const result = await pool.query(
      `DELETE FROM inventory WHERE id = $1 RETURNING id`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Record not found." });
    }

    await logActivity(
      req.session.user,
      "DELETE",
      "INVENTORY",
      `Deleted inventory ID ${item.id}, NR ${item.nr}, Category ${item.category}, Description ${item.description}`
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Delete inventory error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   BORROW CRUD
========================= */
app.get("/api/borrows", requireLogin, async (req, res) => {
  try {
    const user = req.session.user;

    if (user.role === "admin") {
      const result = await pool.query(`
        SELECT * FROM borrows
        ORDER BY id ASC
      `);

      return res.json(result.rows);
    }

    if (!user.assigned_unit) {
      return res.json([]);
    }

    const result = await pool.query(
      `
      SELECT *
      FROM borrows
      WHERE office_unit ILIKE $1
      ORDER BY id ASC
      `,
      [user.assigned_unit + "%"]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Fetch borrows error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/borrows", requireRole("admin", "staff"), async (req, res) => {
  try {
    const payload = sanitizeBorrowPayload(req.body);

    const result = await pool.query(
      `INSERT INTO borrows
      (borrower_name, office_unit, equipment, quantity, date_borrowed, date_return, purpose, remarks)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, borrower_name, equipment, quantity`,
      [
        payload.borrower_name,
        payload.office_unit,
        payload.equipment,
        payload.quantity,
        payload.date_borrowed,
        payload.date_return,
        payload.purpose,
        payload.remarks
      ]
    );

    await logActivity(
      req.session.user,
      "CREATE",
      "BORROW",
      `Added borrow record ID ${result.rows[0].id}, Borrower ${result.rows[0].borrower_name}, Equipment ${result.rows[0].equipment}, Quantity ${result.rows[0].quantity}`
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error("Insert borrow error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/borrows/:id", requireRole("admin", "staff"), async (req, res) => {
  try {
    const { id } = req.params;
    const payload = sanitizeBorrowPayload(req.body);

    const existing = await pool.query(
      `SELECT * FROM borrows WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Borrow record not found." });
    }

    const updated = await pool.query(
      `UPDATE borrows SET
        borrower_name = $1,
        office_unit = $2,
        equipment = $3,
        quantity = $4,
        date_borrowed = $5,
        date_return = $6,
        purpose = $7,
        remarks = $8
      WHERE id = $9
      RETURNING id, borrower_name, equipment, quantity`,
      [
        payload.borrower_name,
        payload.office_unit,
        payload.equipment,
        payload.quantity,
        payload.date_borrowed,
        payload.date_return,
        payload.purpose,
        payload.remarks,
        id
      ]
    );

    await logActivity(
      req.session.user,
      "UPDATE",
      "BORROW",
      `Updated borrow record ID ${updated.rows[0].id}, Borrower ${updated.rows[0].borrower_name}, Equipment ${updated.rows[0].equipment}, Quantity ${updated.rows[0].quantity}`
    );

    res.json({ success: true, record: updated.rows[0] });
  } catch (error) {
    console.error("Update borrow error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/borrows/:id/return", requireRole("admin", "staff"), async (req, res) => {
  try {
    const { id } = req.params;
    const returnDate =
      normalizeText(req.body.date_return) || new Date().toISOString().slice(0, 10);
    const remarks = normalizeText(req.body.remarks);

    const existing = await pool.query(
      `SELECT * FROM borrows WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Borrow record not found." });
    }

    const borrow = existing.rows[0];

    const updated = await pool.query(
      `UPDATE borrows
       SET date_return = $1,
           remarks = CASE
             WHEN COALESCE(TRIM($2), '') = '' THEN remarks
             ELSE $2
           END
       WHERE id = $3
       RETURNING *`,
      [returnDate, remarks, id]
    );

    await logActivity(
      req.session.user,
      "RETURN",
      "BORROW",
      `Returned borrow record ID ${borrow.id}, Borrower ${borrow.borrower_name}, Equipment ${borrow.equipment}, Return Date ${returnDate}`
    );

    res.json({ success: true, record: updated.rows[0] });
  } catch (error) {
    console.error("Return borrow error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/borrows/:id", requireRole("admin"), async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT id, borrower_name, equipment, quantity FROM borrows WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Borrow record not found." });
    }

    const borrow = existing.rows[0];

    const result = await pool.query(
      `DELETE FROM borrows WHERE id = $1 RETURNING id`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Borrow record not found." });
    }

    await logActivity(
      req.session.user,
      "DELETE",
      "BORROW",
      `Deleted borrow record ID ${borrow.id}, Borrower ${borrow.borrower_name}, Equipment ${borrow.equipment}, Quantity ${borrow.quantity}`
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Delete borrow error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   DASHBOARD STATS
========================= */
app.get("/api/stats", requireLogin, async (req, res) => {
  try {
    const user = req.session.user;

    let inventoryResult;

    // 🔥 ADMIN = all
    if (user.role === "admin") {
      inventoryResult = await pool.query(`
        SELECT * FROM inventory
      `);
    } 
    // 🔒 STAFF = sariling unit lang
    else {
      if (!user.assigned_unit) {
        return res.json({
          totalAssets: 0,
          opnlAssets: 0,
          nopnlAssets: 0,
          borrowedAssets: 0,
          inventory: []
        });
      }

      inventoryResult = await pool.query(
        `
        SELECT *
        FROM inventory
        WHERE SPLIT_PART(unit, ' - ', 1) = $1
`,
[user.assigned_unit + "%"]
      );
    }

    const borrowResult = await pool.query(`SELECT * FROM borrows`);

    const inventoryRows = inventoryResult.rows;
    const borrowRows = borrowResult.rows;

    const stats = {
      totalAssets: inventoryRows.length,
      opnlAssets: inventoryRows.filter(i => i.status === "OPNL").length,
      nopnlAssets: inventoryRows.filter(i => i.status === "NOPNL").length,
      borrowedAssets: borrowRows.length,
      inventory: inventoryRows
    };

    res.json(stats);

  } catch (error) {
    console.error("Stats error:", error.message);
    res.status(500).json({ error: error.message });
  }
});
/* =========================
   FILTERS
========================= */
app.get("/inventory/filter", requireLogin, async (req, res) => {
  const { category, unit } = req.query;

  try {
    let sql = "SELECT * FROM inventory WHERE 1=1";
    const params = [];

    if (category) {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }

    if (unit) {
      params.push(unit);
      sql += ` AND unit = $${params.length}`;
    }

    sql += " ORDER BY id ASC";

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Filter inventory error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   ACTIVITY LOGS
========================= */
app.get("/api/activity-logs", requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM activity_logs
      ORDER BY created_at DESC, id DESC
      LIMIT 500
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Fetch activity logs error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/logs", requireLogin, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM activity_logs
      ORDER BY created_at DESC, id DESC
      LIMIT 500
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Fetch logs error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   BACKUP ROUTES
========================= */
app.post("/api/backup", requireLogin, requireRole("admin"), async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ error: "DATABASE_URL is not configured." });
    }

    const pgDumpPath = getPgDumpPath();

    if (!fs.existsSync(pgDumpPath)) {
      return res.status(500).json({
        error: `pg_dump not found at: ${pgDumpPath}`
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFileName = `ict_inventory_backup_${timestamp}.sql`;
    const backupFilePath = path.join(BACKUP_DIR, backupFileName);

    const command = `"${pgDumpPath}" --dbname="${process.env.DATABASE_URL}" --file="${backupFilePath}"`;

    exec(command, async (error, stdout, stderr) => {
      if (error) {
        console.error("Backup error:", error.message);
        console.error("Backup stderr:", stderr);
        return res.status(500).json({
          error: "Backup failed.",
          details: stderr || error.message
        });
      }

      await logActivity(
        req.session.user,
        "CREATE",
        "BACKUP",
        `Created database backup: ${backupFileName}`
      );

      res.json({
        success: true,
        message: "Backup created successfully.",
        file: backupFileName
      });
    });
  } catch (error) {
    console.error("Create backup error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/backups", requireRole("admin", "staff"), async (req, res) => {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((file) => file.toLowerCase().endsWith(".sql"))
      .map((file) => {
        const filePath = path.join(BACKUP_DIR, file);
        const stats = fs.statSync(filePath);

        return {
          name: file,
          createdAt: stats.birthtime,
          createdAtText: new Date(stats.birthtime).toLocaleString(),
          size: formatFileSize(stats.size)
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(({ createdAt, ...rest }) => rest);

    res.json(files);
  } catch (error) {
    console.error("Fetch backups error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/restore", requireLogin, requireRole("admin"), async (req, res) => {
  try {
    const fileName = normalizeText(req.body.file);

    if (!fileName) {
      return res.status(400).json({ error: "Backup file is required." });
    }

    const filePath = path.join(BACKUP_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Backup file not found." });
    }

    const psqlPath = getPsqlPath();

    if (!fs.existsSync(psqlPath)) {
      return res.status(500).json({
        error: `psql not found at: ${psqlPath}`
      });
    }

    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ error: "DATABASE_URL is not configured." });
    }

    const command = `"${psqlPath}" "${process.env.DATABASE_URL}" -f "${filePath}"`;

    exec(command, async (error, stdout, stderr) => {
      if (error) {
        console.error("Restore error:", error.message);
        console.error("Restore stderr:", stderr);
        return res.status(500).json({
          error: "Restore failed.",
          details: stderr || error.message
        });
      }

      await logActivity(
        req.session.user,
        "RESTORE",
        "BACKUP",
        `Restored database backup: ${fileName}`
      );

      res.json({
        success: true,
        message: "Database restored successfully."
      });
    });
  } catch (error) {
    console.error("Restore route error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   TEST DB
========================= */
app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      success: true,
      time: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================
   STEP 10F SETTINGS ROUTES
========================= */

// CURRENT USER
// CURRENT USER
app.get("/api/me", requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, username, email, role, status, assigned_unit, assigned_office, assigned_site
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.session.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const user = result.rows[0];

    req.session.user = {
      ...req.session.user,
      role: user.role || "staff",
      assigned_unit: user.assigned_unit || null,
      assigned_office: user.assigned_office || null,
      assigned_site: user.assigned_site || null
    };

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE ACCOUNT
app.put("/api/me", requireLogin, async (req, res) => {
  try {
    const full_name = String(req.body.full_name || "").trim();
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim();

    if (!username) {
      return res.status(400).json({ error: "Username required." });
    }

    const duplicate = await pool.query(
      `SELECT id FROM users WHERE username = $1 AND id <> $2 LIMIT 1`,
      [username, req.session.user.id]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({ error: "Username already taken." });
    }

    const result = await pool.query(
      `UPDATE users
       SET full_name = $1,
           username = $2,
           email = $3
       WHERE id = $4
       RETURNING id, full_name, username, email, role, status`,
      [full_name, username, email, req.session.user.id]
    );

    req.session.user.username = result.rows[0].username;

    await logActivity(
      req.session.user,
      "UPDATE",
      "PROFILE",
      `Updated own account profile: ${result.rows[0].username}`
    );

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CHANGE PASSWORD
app.post("/api/change-password", requireLogin, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required." });
    }

    const strongRequired = await isStrongPasswordRequired();
    if (strongRequired && !isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: "New password must be at least 8 characters and include uppercase, lowercase, and number."
      });
    }

    if (!strongRequired && newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters." });
    }

    const userResult = await pool.query(
      `SELECT * FROM users WHERE id = $1 LIMIT 1`,
      [req.session.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const user = userResult.rows[0];
    const match = await bcrypt.compare(currentPassword, user.password);

    if (!match) {
      await logActivity(
        req.session.user,
        "FAILED_PASSWORD_CHANGE",
        "PROFILE",
        "Incorrect current password"
      );

      return res.status(400).json({ error: "Current password incorrect." });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users SET password = $1 WHERE id = $2`,
      [hashed, user.id]
    );

    await logActivity(
      req.session.user,
      "CHANGE_PASSWORD",
      "PROFILE",
      "User changed own password"
    );

    res.json({
      success: true,
      message: "Password updated."
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET ADMIN SETTINGS
app.get("/api/admin/settings", requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM admin_settings LIMIT 1`);
    const row = result.rows[0];

    res.json({
      settings: {
        allowUserCreation: row.allow_user_creation,
        allowUserDeletion: row.allow_user_deletion,
        requireStrongPassword: row.require_strong_password,
        enableLoginAudit: row.enable_login_audit,
        sessionTimeout: row.session_timeout,
        maxLoginAttempts: row.max_login_attempts
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SAVE ADMIN SETTINGS
app.put("/api/admin/settings", requireRole("admin"), async (req, res) => {
  try {
    const sessionTimeout = Number(req.body.sessionTimeout) || 30;
    const maxLoginAttempts = Number(req.body.maxLoginAttempts) || 5;

    await pool.query(
      `UPDATE admin_settings
       SET allow_user_creation = $1,
           allow_user_deletion = $2,
           require_strong_password = $3,
           enable_login_audit = $4,
           session_timeout = $5,
           max_login_attempts = $6
       WHERE id = 1`,
      [
        !!req.body.allowUserCreation,
        !!req.body.allowUserDeletion,
        !!req.body.requireStrongPassword,
        !!req.body.enableLoginAudit,
        sessionTimeout,
        maxLoginAttempts
      ]
    );

    await logActivity(
      req.session.user,
      "UPDATE",
      "ADMIN_SETTINGS",
      `Updated admin security settings: timeout=${sessionTimeout} mins, maxLoginAttempts=${maxLoginAttempts}`
    );

    res.json({
      success: true,
      message: "Admin settings saved."
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Backup folder ready at: ${BACKUP_DIR}`);
  });
});