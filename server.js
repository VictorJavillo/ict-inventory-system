const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "ict_inventory_secret_key",
    resave: false,
    saveUninitialized: false
  })
);

app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database("./inventory.db", (err) => {
  if (err) {
    console.error("Database error:", err.message);
  } else {
    console.log("Connected to SQLite database.");
  }
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

function ensureInventoryColumns() {
  db.all(`PRAGMA table_info(inventory)`, [], (err, columns) => {
    if (err) {
      console.error("PRAGMA table_info error:", err.message);
      return;
    }

    const columnNames = columns.map((col) => col.name);

    if (!columnNames.includes("date_issued")) {
      db.run(`ALTER TABLE inventory ADD COLUMN date_issued TEXT`, (alterErr) => {
        if (alterErr) {
          console.error("Failed to add date_issued column:", alterErr.message);
        } else {
          console.log("Added missing column: date_issued");
        }
      });
    }

    if (!columnNames.includes("nr")) {
      db.run(`ALTER TABLE inventory ADD COLUMN nr TEXT`, (alterErr) => {
        if (alterErr) {
          console.error("Failed to add nr column:", alterErr.message);
        } else {
          console.log("Added missing column: nr");
        }
      });
    }

    if (!columnNames.includes("windows_type")) {
      db.run(`ALTER TABLE inventory ADD COLUMN windows_type TEXT`, (alterErr) => {
        if (alterErr) {
          console.error("Failed to add windows_type column:", alterErr.message);
        } else {
          console.log("Added missing column: windows_type");
        }
      });
    }
  });
}

function getNextNR(callback) {
  db.get(
    `
    SELECT MAX(CAST(nr AS INTEGER)) AS maxNr
    FROM inventory
    WHERE nr IS NOT NULL AND TRIM(nr) <> ''
    `,
    [],
    (err, row) => {
      if (err) {
        callback(err);
        return;
      }

      const maxNr = row && row.maxNr ? Number(row.maxNr) : 0;
      callback(null, maxNr + 1);
    }
  );
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

  db.run(`
    CREATE TABLE IF NOT EXISTS borrows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

  ensureInventoryColumns();

  db.get(`SELECT * FROM users WHERE username = ?`, ["admin"], (err, row) => {
    if (err) {
      console.error("Default user check error:", err.message);
      return;
    }

    if (!row) {
      db.run(
        `INSERT INTO users (username, password) VALUES (?, ?)`,
        ["admin", "admin123"],
        (insertErr) => {
          if (insertErr) {
            console.error("Default user create error:", insertErr.message);
          } else {
            console.log("Default user created: admin / admin123");
          }
        }
      );
    }
  });
});

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    `SELECT * FROM users WHERE username = ? AND password = ?`,
    [username, password],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(401).json({ error: "Invalid username or password" });

      req.session.user = { id: user.id, username: user.username };
      res.json({ success: true, username: user.username });
    }
  );
});

app.get("/api/session", (req, res) => {
  if (req.session.user) {
    return res.json({ loggedIn: true, user: req.session.user });
  }
  res.json({ loggedIn: false });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/* INVENTORY CRUD */
app.get("/api/inventory", requireLogin, (req, res) => {
  db.all(`SELECT * FROM inventory ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/inventory", requireLogin, (req, res) => {
  const payload = sanitizeInventoryPayload(req.body);

  const insertRecord = (finalNr) => {
    db.run(
      `INSERT INTO inventory
      (nr, category, description, serial_number, property_number, status, date_issued, unit, os, windows_type, ms_office, antivirus, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(finalNr || ""),
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
      ],
      function (err) {
        if (err) {
          console.error("Insert inventory error:", err.message);
          return res.status(500).json({ error: err.message });
        }

        res.json({ success: true, id: this.lastID, nr: finalNr });
      }
    );
  };

  if (payload.nr !== "") {
    insertRecord(payload.nr);
  } else {
    getNextNR((nrErr, nextNr) => {
      if (nrErr) {
        console.error("Generate NR error:", nrErr.message);
        return res.status(500).json({ error: nrErr.message });
      }

      insertRecord(nextNr);
    });
  }
});

app.put("/api/inventory/:id", requireLogin, (req, res) => {
  const { id } = req.params;
  const payload = sanitizeInventoryPayload(req.body);

  db.get(`SELECT * FROM inventory WHERE id = ?`, [id], (findErr, existingRow) => {
    if (findErr) {
      console.error("Find inventory error:", findErr.message);
      return res.status(500).json({ error: findErr.message });
    }

    if (!existingRow) {
      return res.status(404).json({ error: "Record not found." });
    }

    const finalNr = payload.nr !== "" ? payload.nr : existingRow.nr || "";

    db.run(
      `UPDATE inventory SET
        nr = ?,
        category = ?,
        description = ?,
        serial_number = ?,
        property_number = ?,
        status = ?,
        date_issued = ?,
        unit = ?,
        os = ?,
        windows_type = ?,
        ms_office = ?,
        antivirus = ?,
        remarks = ?
      WHERE id = ?`,
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
      ],
      function (err) {
        if (err) {
          console.error("Update inventory error:", err.message);
          return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: "Record not found." });
        }

        res.json({
          success: true,
          message: "Inventory updated successfully.",
          nr: finalNr
        });
      }
    );
  });
});

app.delete("/api/inventory/:id", requireLogin, (req, res) => {
  db.run(`DELETE FROM inventory WHERE id = ?`, [req.params.id], function (err) {
    if (err) {
      console.error("Delete inventory error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "Record not found." });
    }

    res.json({ success: true });
  });
});

/* BORROW CRUD */
app.get("/api/borrows", requireLogin, (req, res) => {
  db.all(`SELECT * FROM borrows ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/borrows", requireLogin, (req, res) => {
  const {
    borrower_name,
    office_unit,
    equipment,
    quantity,
    date_borrowed,
    date_return,
    purpose,
    remarks
  } = req.body;

  db.run(
    `INSERT INTO borrows
    (borrower_name, office_unit, equipment, quantity, date_borrowed, date_return, purpose, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizeText(borrower_name),
      normalizeText(office_unit),
      normalizeText(equipment),
      quantity || 0,
      normalizeText(date_borrowed),
      normalizeText(date_return),
      normalizeText(purpose),
      normalizeText(remarks)
    ],
    function (err) {
      if (err) {
        console.error("Insert borrow error:", err.message);
        return res.status(500).json({ error: err.message });
      }

      res.json({ success: true, id: this.lastID });
    }
  );
});

app.delete("/api/borrows/:id", requireLogin, (req, res) => {
  db.run(`DELETE FROM borrows WHERE id = ?`, [req.params.id], function (err) {
    if (err) {
      console.error("Delete borrow error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "Borrow record not found." });
    }

    res.json({ success: true });
  });
});

/* DASHBOARD STATS */
app.get("/api/stats", requireLogin, (req, res) => {
  db.all(`SELECT * FROM inventory`, [], (err, inventoryRows) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(`SELECT * FROM borrows`, [], (err2, borrowRows) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const stats = {
        totalAssets: inventoryRows.length,
        opnlAssets: inventoryRows.filter((i) => i.status === "OPNL").length,
        nopnlAssets: inventoryRows.filter((i) => i.status === "NOPNL").length,
        borrowedAssets: borrowRows.length,
        inventory: inventoryRows
      };

      res.json(stats);
    });
  });
});

app.get("/inventory/filter", requireLogin, (req, res) => {
  const { category, unit } = req.query;

  let sql = "SELECT * FROM inventory WHERE 1=1";
  const params = [];

  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }

  if (unit) {
    sql += " AND unit = ?";
    params.push(unit);
  }

  sql += " ORDER BY id ASC";

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});