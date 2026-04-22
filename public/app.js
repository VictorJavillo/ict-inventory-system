let filteredData = [];
let inventoryData = [];
let statusChart;
let licenseChart;
let categoryChart;
const officeAllowedUnits = ["581ACWG", "582ACWG", "583ACWG", "584ACWG"];

/* =========================
   COMMON HELPERS
========================= */
function $(id) {
  return document.getElementById(id);
}

function getValue(id) {
  const el = $(id);
  return el ? String(el.value ?? "").trim() : "";
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value ?? "";
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value ?? "";
}

function setImage(id, src) {
  const el = $(id);
  if (el) el.src = src || "";
}

function safeJSON(res) {
  return res.json().catch(() => ({}));
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeOptionValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function setSelectValueFlexible(id, value, fallback = "") {
  const el = $(id);
  if (!el) return;

  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    el.value = fallback;
    return;
  }

  const normalizedRaw = normalizeOptionValue(rawValue);

  const matchedOption = Array.from(el.options).find(option => {
    return normalizeOptionValue(option.value) === normalizedRaw;
  });

  if (matchedOption) {
    el.value = matchedOption.value;
    return;
  }

  el.value = fallback;
}

function isComputerCategory(category) {
  const normalized = normalizeText(category);
  return (
    normalized === "desktop computer" ||
    normalized === "desktop" ||
    normalized === "laptop" ||
    normalized === "laptop computer"
  );
}

function setFieldLock(id, locked) {
  const el = $(id);
  if (!el) return;

  const tag = el.tagName.toLowerCase();

  if (tag === "select") {
    el.disabled = locked;
  } else {
    el.readOnly = locked;
  }

  if (locked) {
    el.classList.add("na-field");
  } else {
    el.classList.remove("na-field");
  }
}

function clearNAValue(id) {
  const el = $(id);
  if (!el) return;

  if (normalizeText(el.value) === "n/a") {
    el.value = "";
  }
}

/* =========================
   CATEGORY / OFFICE LOGIC
========================= */
function handleCategoryChange() {
  const categoryEl = $("category");
  if (!categoryEl) return;

  const isComputer = isComputerCategory(categoryEl.value);

  const osEl = $("os");
  const windowsTypeEl = $("windows_type");
  const officeEl = $("ms_office");
  const antivirusEl = $("antivirus");

  if (!isComputer) {
    if (osEl) osEl.value = "N/A";
    if (windowsTypeEl) windowsTypeEl.value = "N/A";
    if (officeEl) officeEl.value = "N/A";
    if (antivirusEl) antivirusEl.value = "N/A";

    setFieldLock("os", true);
    setFieldLock("windows_type", true);
    setFieldLock("ms_office", true);
    setFieldLock("antivirus", true);
  } else {
    clearNAValue("os");
    clearNAValue("windows_type");
    clearNAValue("ms_office");
    clearNAValue("antivirus");

    setFieldLock("os", false);
    setFieldLock("windows_type", false);
    setFieldLock("ms_office", false);
    setFieldLock("antivirus", false);
  }
}

function isOfficeAllowedUnit(unitValue) {
  return officeAllowedUnits.includes(String(unitValue || "").trim().toUpperCase());
}

function handleUnitOfficeLogic() {
  const unitEl = $("unit");
  const officeInputEl = $("office_input");

  if (!unitEl || !officeInputEl) return;

  const selectedUnit = String(unitEl.value || "").trim().toUpperCase();
  const allowed = isOfficeAllowedUnit(selectedUnit);

  if (allowed) {
    setFieldLock("office_input", false);

    if (normalizeText(officeInputEl.value) === "n/a") {
      officeInputEl.value = "";
    }

    officeInputEl.placeholder = "Enter office";
  } else {
    officeInputEl.value = "N/A";
    setFieldLock("office_input", true);
    officeInputEl.placeholder = "N/A";
  }
}

function getNextNR() {
  if (!Array.isArray(inventoryData) || inventoryData.length === 0) return 1;

  const maxNr = inventoryData.reduce((max, item) => {
    const current = parseInt(item.nr, 10);
    return !isNaN(current) && current > max ? current : max;
  }, 0);

  return maxNr + 1;
}

function buildUnitDisplay(unitValue, officeValue) {
  const cleanUnit = String(unitValue || "").trim();
  let cleanOffice = String(officeValue || "").trim();

  if (!cleanUnit) {
    if (cleanOffice && normalizeText(cleanOffice) !== "n/a") {
      return `${cleanOffice} Office`;
    }
    return "";
  }

  if (!isOfficeAllowedUnit(cleanUnit)) {
    return cleanUnit;
  }

  if (!cleanOffice || normalizeText(cleanOffice) === "n/a") {
    return cleanUnit;
  }

  return `${cleanUnit} - ${cleanOffice} Office`;
}

function parseUnitDisplay(savedUnitValue) {
  const raw = String(savedUnitValue || "").trim();

  if (!raw) {
    return {
      unit: "",
      office: ""
    };
  }

  if (raw.includes(" - ")) {
    const parts = raw.split(" - ");
    const unitPart = String(parts[0] || "").trim();
    const officePart = String(parts.slice(1).join(" - ") || "")
      .replace(/\s*Office\s*$/i, "")
      .trim();

    return {
      unit: unitPart,
      office: officePart
    };
  }

  return {
    unit: raw,
    office: ""
  };
}

/* =========================
   SESSION
========================= */
async function checkSession() {
  try {
    const res = await fetch("/api/session");
    const data = await safeJSON(res);

    if (!data.loggedIn) {
      window.location.href = "/login.html";
    }
  } catch (err) {
    console.error("Session check failed:", err);
  }
}

async function logout() {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch (err) {
    console.error("Logout failed:", err);
  }
  window.location.href = "/login.html";
}

/* =========================
   MODAL
========================= */
function openModal(id) {
  const modal = $(id);
  if (modal) modal.style.display = "flex";
}

function closeModal(id) {
  const modal = $(id);
  if (modal) modal.style.display = "none";
}

/* =========================
   FORMATTING
========================= */
function badgeStatus(status) {
  return status === "OPNL"
    ? `<span class="badge badge-opnl">OPNL</span>`
    : `<span class="badge badge-nopnl">NOPNL</span>`;
}

function sortInventoryAscending(data) {
  return [...data].sort((a, b) => {
    const aNr = Number(a.nr) || 0;
    const bNr = Number(b.nr) || 0;

    if (aNr !== bNr) return aNr - bNr;

    const aId = Number(a.id) || 0;
    const bId = Number(b.id) || 0;
    return aId - bId;
  });
}

function formatMonthInput(value) {
  if (!value) return "";

  if (/^\d{4}-\d{2}$/.test(value)) {
    return value;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.slice(0, 7);
  }

  const date = new Date(value);
  if (isNaN(date.getTime())) return "";

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthYearDisplay(value) {
  if (!value) return "";

  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric"
    });
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric"
    });
  }

  const date = new Date(value);
  if (isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });
}

function parseMonthValue(dateValue) {
  if (!dateValue) return null;

  if (/^\d{4}-\d{2}$/.test(dateValue)) {
    const [year, month] = dateValue.split("-").map(Number);
    return new Date(year, month - 1, 1);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const [year, month] = dateValue.split("-").map(Number);
    return new Date(year, month - 1, 1);
  }

  const date = new Date(dateValue);
  return isNaN(date.getTime()) ? null : date;
}

function getDateClass(dateValue) {
  if (!dateValue) return "";

  const date = parseMonthValue(dateValue);
  if (!date) return "";

  const today = new Date();
  const diffMonths =
    (today.getFullYear() - date.getFullYear()) * 12 +
    (today.getMonth() - date.getMonth());

  const diffYears = diffMonths / 12;

  if (diffYears <= 2) return "green";
  if (diffYears > 2 && diffYears < 3.5) return "yellow";
  if (diffYears >= 3.5) return "red";
  return "";
}

/* =========================
   INVENTORY MODAL / FORM
========================= */
function openInventoryModal(item = null) {
  const form = $("inventoryForm");
  if (!form) return;

  form.reset();

  setValue("editId", "");
  setText("modalTitle", "Add Equipment");
  setValue("date_issued", "");
  setValue("office_input", "N/A");

  if (item) {
    setValue("editId", item.id || "");
    setSelectValueFlexible("category", item.category || "");

    handleCategoryChange();

    setValue("description", item.description || "");
    setValue("serial_number", item.serial_number || "");
    setValue("property_number", item.property_number || "");
    setSelectValueFlexible("status", item.status || "NOPNL");
    setValue("date_issued", formatMonthInput(item.date_issued));

    const parsedUnit = parseUnitDisplay(item.unit || "");
    setSelectValueFlexible("unit", parsedUnit.unit || "", "");
    setValue("office_input", parsedUnit.office || "");

    handleUnitOfficeLogic();

    setSelectValueFlexible("os", item.os || "", "");
    setSelectValueFlexible("windows_type", item.windows_type || "", "");
    setSelectValueFlexible("ms_office", item.ms_office || "", "");
    setSelectValueFlexible("antivirus", item.antivirus || "", "");

    setValue("remarks", item.remarks || "");
    setText("modalTitle", "Edit Equipment");
  } else {
    handleCategoryChange();
    handleUnitOfficeLogic();
  }

  openModal("inventoryModal");
}

async function loadInventory() {
  try {
    const res = await fetch("/api/inventory");

    if (res.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    const data = await safeJSON(res);
    inventoryData = sortInventoryAscending(Array.isArray(data) ? data : []);
    filteredData = [];
    renderInventoryTable(inventoryData);
  } catch (err) {
    console.error("Failed to load inventory:", err);
  }
}

function renderInventoryTable(data) {
  const tbody = $("inventoryTableBody");
  if (!tbody) return;

  const sortedData = sortInventoryAscending(data);

  tbody.innerHTML = sortedData.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${item.category || ""}</td>
      <td>${item.description || ""}</td>
      <td>${item.serial_number || ""}</td>
      <td>${item.property_number || ""}</td>
      <td>${badgeStatus(item.status || "")}</td>
      <td>
        <span class="date-badge ${getDateClass(item.date_issued)}">
          ${formatMonthYearDisplay(item.date_issued)}
        </span>
      </td>
      <td>${item.unit || ""}</td>
      <td>${item.os || ""}</td>
      <td>${item.windows_type || ""}</td>
      <td>${item.ms_office || ""}</td>
      <td>${item.antivirus || ""}</td>
      <td>${item.remarks || ""}</td>
      <td class="action-cell">
        <button type="button" class="btn btn-sm btn-warning edit-btn" data-id="${item.id}">Edit</button>
        <button type="button" class="btn btn-sm btn-danger delete-btn" data-id="${item.id}">Delete</button>
      </td>
    </tr>
  `).join("");
}

function filterInventory() {
  const searchInput = $("searchInput");
  const searchColumn = $("searchColumn");

  if (!searchInput || !searchColumn) return;

  const value = searchInput.value.toLowerCase().trim();
  const column = searchColumn.value;

  if (!value) {
    filteredData = [];
    renderInventoryTable(inventoryData);
    return;
  }

  const filtered = inventoryData.filter(item => {
    if (column === "all") {
      return Object.values(item).some(v =>
        String(v ?? "").toLowerCase().includes(value)
      );
    }

    return String(item[column] ?? "").toLowerCase().includes(value);
  });

  filteredData = sortInventoryAscending(filtered);
  renderInventoryTable(filteredData);
}

async function saveInventoryForm(e) {
  e.preventDefault();

  const editId = getValue("editId");
  const category = getValue("category");

  let os = getValue("os").replace(/\s+/g, " ").trim();
  let windowsType = getValue("windows_type").replace(/\s+/g, " ").trim();
  let msOffice = getValue("ms_office").replace(/\s+/g, " ").trim();
  let antivirus = getValue("antivirus").replace(/\s+/g, " ").trim();

  if (!isComputerCategory(category)) {
    os = "N/A";
    windowsType = "N/A";
    msOffice = "N/A";
    antivirus = "N/A";
  }

  const selectedUnit = getValue("unit");
  let officeInputValue = getValue("office_input");

  if (!isOfficeAllowedUnit(selectedUnit)) {
    officeInputValue = "N/A";
  }

  let nrValue = "";

  if (editId) {
    const existingItem = inventoryData.find(item => String(item.id) === String(editId));
    nrValue = existingItem ? existingItem.nr : "";
  } else {
    nrValue = getNextNR();
  }

  const payload = {
    nr: nrValue,
    category,
    description: getValue("description"),
    serial_number: getValue("serial_number"),
    property_number: getValue("property_number"),
    status: getValue("status"),
    date_issued: getValue("date_issued"),
    unit: buildUnitDisplay(selectedUnit, officeInputValue),
    os,
    windows_type: windowsType,
    ms_office: msOffice,
    antivirus,
    remarks: getValue("remarks")
  };

  try {
    const url = editId ? `/api/inventory/${editId}` : "/api/inventory";
    const method = editId ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await safeJSON(res);

    if (!res.ok) {
      alert(result.error || result.message || "Failed to save inventory.");
      return;
    }

    closeModal("inventoryModal");
    await loadInventory();
  } catch (err) {
    console.error("Save failed:", err);
    alert("Failed to save inventory.");
  }
}

async function deleteInventory(id) {
  if (!confirm("Delete this record?")) return;

  try {
    const res = await fetch(`/api/inventory/${id}`, {
      method: "DELETE"
    });

    const result = await safeJSON(res);

    if (!res.ok) {
      alert(result.error || "Failed to delete record.");
      return;
    }

    await loadInventory();
  } catch (err) {
    console.error("Delete failed:", err);
    alert("Failed to delete record.");
  }
}

/* =========================
   BORROW PAGE
========================= */
async function loadBorrows() {
  try {
    const res = await fetch("/api/borrows");

    if (res.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    const data = await safeJSON(res);
    const tbody = $("borrowTableBody");

    if (tbody) {
      tbody.innerHTML = (Array.isArray(data) ? data : []).map((item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${item.borrower_name || ""}</td>
          <td>${item.office_unit || ""}</td>
          <td>${item.equipment || ""}</td>
          <td>${item.quantity || ""}</td>
          <td>${item.date_borrowed || ""}</td>
          <td>${item.date_return || ""}</td>
          <td>${item.purpose || ""}</td>
          <td>${item.remarks || ""}</td>
          <td><button type="button" class="btn btn-danger" onclick="deleteBorrow(${item.id})">Delete</button></td>
        </tr>
      `).join("");
    }
  } catch (err) {
    console.error("Failed to load borrows:", err);
  }
}

async function saveBorrowForm(e) {
  e.preventDefault();

  const payload = {
    borrower_name: getValue("borrower_name"),
    office_unit: getValue("office_unit"),
    equipment: getValue("equipment"),
    quantity: getValue("quantity"),
    date_borrowed: getValue("date_borrowed"),
    date_return: getValue("date_return"),
    purpose: getValue("purpose"),
    remarks: getValue("borrow_remarks")
  };

  try {
    const res = await fetch("/api/borrows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await safeJSON(res);

    if (!res.ok) {
      alert(result.error || "Failed to save borrow record.");
      return;
    }

    const form = $("borrowForm");
    if (form) form.reset();
    await loadBorrows();
  } catch (err) {
    console.error("Borrow save failed:", err);
    alert("Failed to save borrow record.");
  }
}

async function deleteBorrow(id) {
  if (!confirm("Delete this borrow record?")) return;

  try {
    const res = await fetch(`/api/borrows/${id}`, { method: "DELETE" });
    const result = await safeJSON(res);

    if (!res.ok) {
      alert(result.error || "Failed to delete borrow record.");
      return;
    }

    await loadBorrows();
  } catch (err) {
    console.error("Borrow delete failed:", err);
    alert("Failed to delete borrow record.");
  }
}

/* =========================
   DASHBOARD
========================= */
function isLicensedValue(value) {
  const normalized = normalizeText(value);
  return normalized === "licensed" || normalized === "with license";
}

function isUnlicensedValue(value) {
  const normalized = normalizeText(value);
  return normalized === "unlicensed" || normalized === "no license";
}

async function loadDashboard() {
  try {
    const res = await fetch("/api/stats");

    if (res.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    const data = await safeJSON(res);
    const inventoryItems = sortInventoryAscending(Array.isArray(data.inventory) ? data.inventory : []);

    setText("totalAssets", data.totalAssets || inventoryItems.length);
    setText(
      "opnlAssets",
      data.opnlAssets || inventoryItems.filter(item => normalizeText(item.status) === "opnl").length
    );
    setText(
      "nopnlAssets",
      data.nopnlAssets || inventoryItems.filter(item => normalizeText(item.status) === "nopnl").length
    );
    setText("borrowedAssets", data.borrowedAssets || 0);

    renderDashboardTable(inventoryItems);
    renderCharts(inventoryItems);
  } catch (err) {
    console.error("Failed to load dashboard:", err);
  }
}

function renderDashboardTable(items) {
  const tbody = $("dashboardTableBody");
  if (!tbody) return;

  const sortedItems = sortInventoryAscending(items);

  if (!sortedItems.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="empty-state">No inventory records found.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = sortedItems.slice(-10).reverse().map((item, index) => `
    <tr>
      <td>${item.nr || index + 1}</td>
      <td>${item.category || ""}</td>
      <td>${item.description || ""}</td>
      <td>${item.serial_number || ""}</td>
      <td>${item.property_number || ""}</td>
      <td>${badgeStatus(item.status || "")}</td>
      <td>${item.unit || ""}</td>
      <td>${item.os || ""}</td>
      <td>${item.ms_office || ""}</td>
      <td>${item.antivirus || ""}</td>
      <td>${item.remarks || ""}</td>
    </tr>
  `).join("");
}

function renderCharts(items) {
  const statusCanvas = $("statusChart");
  const licenseCanvas = $("licenseChart");
  const categoryCanvas = $("categoryChart");

  if (!statusCanvas || !licenseCanvas || !categoryCanvas || typeof Chart === "undefined") return;

  const statusCtx = statusCanvas.getContext("2d");
  const licenseCtx = licenseCanvas.getContext("2d");
  const categoryCtx = categoryCanvas.getContext("2d");

  const opnlItems = items.filter(item => normalizeText(item.status) === "opnl");
  const nopnlItems = items.filter(item => normalizeText(item.status) === "nopnl");

  const licensedItems = items.filter(item =>
    isLicensedValue(item.os) ||
    isLicensedValue(item.ms_office) ||
    isLicensedValue(item.antivirus)
  );

  const unlicensedItems = items.filter(item =>
    !isLicensedValue(item.os) &&
    !isLicensedValue(item.ms_office) &&
    !isLicensedValue(item.antivirus)
  );

  const categoryMap = {};
  items.forEach(item => {
    const category = String(item.category || "Uncategorized").trim() || "Uncategorized";
    categoryMap[category] = (categoryMap[category] || 0) + 1;
  });

  const categoryLabels = Object.keys(categoryMap);
  const categoryValues = Object.values(categoryMap);

  if (statusChart) statusChart.destroy();
  if (licenseChart) licenseChart.destroy();
  if (categoryChart) categoryChart.destroy();

  const statusGradient1 = statusCtx.createLinearGradient(0, 0, 0, 320);
  statusGradient1.addColorStop(0, "rgba(34,197,94,0.95)");
  statusGradient1.addColorStop(1, "rgba(22,163,74,0.45)");

  const statusGradient2 = statusCtx.createLinearGradient(0, 0, 0, 320);
  statusGradient2.addColorStop(0, "rgba(239,68,68,0.95)");
  statusGradient2.addColorStop(1, "rgba(220,38,38,0.45)");

  statusChart = new Chart(statusCtx, {
    type: "bar",
    data: {
      labels: ["OPNL", "NOPNL"],
      datasets: [{
        label: "Equipment Status",
        data: [opnlItems.length, nopnlItems.length],
        backgroundColor: [statusGradient1, statusGradient2],
        borderColor: ["rgba(74,222,128,1)", "rgba(248,113,113,1)"],
        borderWidth: 1.5,
        borderRadius: 16,
        borderSkipped: false,
        barPercentage: 0.72,
        categoryPercentage: 0.72
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1200,
        easing: "easeOutQuart"
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.96)",
          titleColor: "#ffffff",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(148,163,184,0.35)",
          borderWidth: 1,
          cornerRadius: 12,
          padding: 12,
          displayColors: true,
          callbacks: {
            label: function(context) {
              return ` Total: ${context.parsed.y}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false,
            drawBorder: false
          },
          ticks: {
            color: "#ffffff",
            font: {
              size: 14,
              weight: "600"
            }
          }
        },
        y: {
          beginAtZero: true,
          grace: "10%",
          grid: {
            color: "rgba(255,255,255,0.06)",
            drawBorder: false
          },
          ticks: {
            color: "#cbd5e1",
            precision: 0,
            font: {
              size: 12
            }
          }
        }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;

        if (idx === 0) {
          showChartDetails("OPNL Records", opnlItems);
        } else {
          showChartDetails("NOPNL Records", nopnlItems);
        }
      }
    },
    plugins: [{
      id: "barValueLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();

        chart.getDatasetMeta(0).data.forEach((bar, index) => {
          const value = chart.data.datasets[0].data[index];
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 14px Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(value, bar.x, bar.y - 8);
        });

        ctx.restore();
      }
    }]
  });

  licenseChart = new Chart(licenseCtx, {
    type: "doughnut",
    data: {
      labels: ["Licensed", "No License / N/A"],
      datasets: [{
        data: [licensedItems.length, unlicensedItems.length],
        backgroundColor: [
          "rgba(59,130,246,0.92)",
          "rgba(245,158,11,0.92)"
        ],
        borderColor: [
          "rgba(147,197,253,1)",
          "rgba(252,211,77,1)"
        ],
        borderWidth: 2,
        hoverOffset: 18
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      animation: {
        duration: 1300,
        easing: "easeOutQuart"
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#fff",
            padding: 18,
            usePointStyle: true,
            pointStyle: "circle",
            font: {
              size: 13,
              weight: "600"
            }
          }
        },
        tooltip: {
          backgroundColor: "rgba(15,23,42,.96)",
          titleColor: "#fff",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(255,255,255,.15)",
          borderWidth: 1,
          cornerRadius: 12,
          callbacks: {
            label: function(context) {
              const total = licensedItems.length + unlicensedItems.length || 1;
              const percent = ((context.raw / total) * 100).toFixed(1);
              return ` ${context.label}: ${context.raw} (${percent}%)`;
            }
          }
        }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;

        const idx = elements[0].index;
        if (idx === 0) {
          showChartDetails("Licensed Records", licensedItems);
        } else {
          showChartDetails("No License / N/A Records", unlicensedItems);
        }
      }
    },
    plugins: [{
      id: "centerText",
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;

        const total = licensedItems.length + unlicensedItems.length;
        const licensedPercent = total ? ((licensedItems.length / total) * 100).toFixed(0) : 0;

        const centerX = (chartArea.left + chartArea.right) / 2;
        const centerY = (chartArea.top + chartArea.bottom) / 2;

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 30px Arial";
        ctx.fillText(total, centerX, centerY - 20);

        ctx.fillStyle = "#cbd5e1";
        ctx.font = "14px Arial";
        ctx.fillText("Total Assets", centerX, centerY + 5);

        ctx.fillStyle = "#60a5fa";
        ctx.font = "bold 14px Arial";
        ctx.fillText(`${licensedPercent}% Licensed`, centerX, centerY + 28);

        ctx.restore();
      }
    }]
  });

  categoryChart = new Chart(categoryCtx, {
    type: "bar",
    data: {
      labels: categoryLabels,
      datasets: [{
        label: "Assets per Category",
        data: categoryValues,
        backgroundColor: "rgba(139,92,246,0.78)",
        borderColor: "rgba(167,139,250,1)",
        borderWidth: 1.5,
        borderRadius: 12,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1200,
        easing: "easeOutQuart"
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.96)",
          titleColor: "#ffffff",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(148,163,184,0.35)",
          borderWidth: 1,
          cornerRadius: 12,
          padding: 12,
          callbacks: {
            label: function(context) {
              return ` Total: ${context.raw}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#ffffff",
            font: {
              size: 12,
              weight: "600"
            }
          },
          grid: {
            display: false,
            drawBorder: false
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#cbd5e1",
            precision: 0
          },
          grid: {
            color: "rgba(255,255,255,0.06)",
            drawBorder: false
          }
        }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;

        const idx = elements[0].index;
        const selectedCategory = categoryLabels[idx];
        const filteredItems = items.filter(
          item => String(item.category || "").trim() === selectedCategory
        );

        showChartDetails(`${selectedCategory} Records`, filteredItems);
      }
    },
    plugins: [{
      id: "categoryValueLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();

        chart.getDatasetMeta(0).data.forEach((bar, index) => {
          const value = chart.data.datasets[0].data[index];
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 13px Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(value, bar.x, bar.y - 6);
        });

        ctx.restore();
      }
    }]
  });
}

function showChartDetails(title, items) {
  const titleEl = $("chartDetailsTitle");
  const tbody = $("chartDetailsBody");

  if (titleEl) titleEl.textContent = title;
  if (!tbody) return;

  const sortedItems = sortInventoryAscending(items);

  if (!sortedItems.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="empty-state">No matching records found.</td>
      </tr>
    `;
    openModal("chartModal");
    return;
  }

  tbody.innerHTML = sortedItems.map((item, index) => `
    <tr>
      <td>${item.nr || index + 1}</td>
      <td>${item.category || ""}</td>
      <td>${item.description || ""}</td>
      <td>${item.serial_number || ""}</td>
      <td>${item.property_number || ""}</td>
      <td>${badgeStatus(item.status || "")}</td>
      <td>${item.unit || ""}</td>
      <td>${item.os || ""}</td>
      <td>${item.ms_office || ""}</td>
      <td>${item.antivirus || ""}</td>
      <td>${item.remarks || ""}</td>
    </tr>
  `).join("");

  openModal("chartModal");
}
/* =========================
   PRINT
========================= */
function waitForPrintAssets(root = document) {
  const images = Array.from(root.querySelectorAll("img"));
  if (!images.length) return Promise.resolve();

  return Promise.all(images.map(img => {
    if (img.complete) return Promise.resolve();

    return new Promise(resolve => {
      const done = () => resolve();
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      setTimeout(done, 1200);
    });
  }));
}

async function printInventoryReport() {
  const printDate = $("printDate");
  if (printDate) {
    printDate.textContent = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  const activeData = filteredData.length > 0 ? filteredData : inventoryData;
  const dataToPrint = sortInventoryAscending(activeData);
  const printBody = $("printTableBody");
  if (!printBody) return;

  let html = "";

  dataToPrint.forEach((item, index) => {
    html += `
      <tr>
        <td>${index + 1}</td>
        <td>${item.category || ""}</td>
        <td>${item.description || ""}</td>
        <td>${item.serial_number || ""}</td>
        <td>${item.property_number || ""}</td>
        <td>${item.status || ""}</td>
        <td>${formatMonthYearDisplay(item.date_issued)}</td>
        <td>${item.unit || ""}</td>
        <td>${item.os || ""}</td>
        <td>${item.windows_type || ""}</td>
        <td>${item.ms_office || ""}</td>
        <td>${item.antivirus || ""}</td>
        <td>${item.remarks || ""}</td>
      </tr>
    `;
  });

  printBody.innerHTML = html;
  loadSignatories();
  await waitForPrintAssets($("printArea") || document);

  setTimeout(() => {
    window.print();
  }, 250);
}

function printBorrow() {
  const printArea = $("printArea");
  if (!printArea) return;

  printArea.style.display = "block";
  window.print();
  printArea.style.display = "none";
}

/* =========================
   SIGNATORIES
========================= */
const personnel = {
  batain: {
    name: "Ma Loise Abbie O Batain",
    rank: "SGT",
    position: "CEIS Personnel",
    signature: "images/signatures/batain.png"
  },
  calimbas: {
    name: "ROLAND JAMES A CALIMBAS",
    rank: "CPT",
    position: "Assistant Director for CEIS",
    signature: "images/signatures/calimbas.png"
  },
  liwagan: {
    name: "MAYLENE B LIW-AGAN",
    rank: "MAJ",
    position: "Director for CEIS",
    signature: "images/signatures/liw-agan.png"
  },
  camarillo: {
    name: "Robert Jhon R Camarillo",
    rank: "SGT",
    position: "CEIS Personnel",
    signature: "images/signatures/camarillo.png"
  },
  bantang: {
    name: "Ian Gabriel B Bantang",
    rank: "A1C",
    position: "CEIS Personnel",
    signature: "images/signatures/bantang.png"
  },
  javillo: {
    name: "Victor D Javillo",
    rank: "AM",
    position: "CEIS Personnel",
    signature: "images/signatures/javillo.png"
  },
  bogac: {
    name: "Love Joy S Bog-ac",
    rank: "AW",
    position: "CEIS Personnel",
    signature: "images/signatures/bog-ac.png"
  },
  pacleb: {
    name: "Jayson Carl W Pacleb",
    rank: "AM",
    position: "CEIS Personnel",
    signature: "images/signatures/pacleb.png"
  },
  domingo: {
    name: "Joshua M Domingo",
    rank: "AM",
    position: "CEIS Personnel",
    signature: "images/signatures/domingo.png"
  },
  palomo: {
    name: "Alexander C Palomo",
    rank: "AM",
    position: "CEIS Personnel",
    signature: "images/signatures/palomo.png"
  }
};

function selectPrepared() {
  const el = $("preparedName");
  if (!el) return;

  const key = el.value;
  if (!personnel[key]) return;

  const p = personnel[key];
  setText("preparedPrintName", p.name);
  setText("preparedPrintRank", p.rank);
  setText("preparedPrintPosition", p.position);
  setImage("preparedSignatureImg", p.signature);
  localStorage.setItem("preparedBy", JSON.stringify(p));
}

function selectChecked() {
  const el = $("checkedName");
  if (!el) return;

  const key = el.value;
  if (!personnel[key]) return;

  const p = personnel[key];
  setText("checkedPrintName", p.name);
  setText("checkedPrintRank", p.rank);
  setText("checkedPrintPosition", p.position);
  setImage("checkedSignatureImg", p.signature);
  localStorage.setItem("checkedBy", JSON.stringify(p));
}

function selectPreparedBorrow() {
  const el = $("preparedName");
  if (!el) return;

  const key = el.value;
  if (!personnel[key]) return;

  const p = personnel[key];
  setText("preparedPrintName", p.name);
  setText("preparedPrintRank", p.rank);
  setText("preparedPrintPosition", p.position);
  setImage("preparedSignatureImg", p.signature);

  localStorage.setItem("preparedBy", JSON.stringify(p));
}

function selectCheckedBorrow() {
  const el = $("checkedName");
  if (!el) return;

  const key = el.value;
  if (!personnel[key]) return;

  const p = personnel[key];
  setText("checkedPrintName", p.name);
  setText("checkedPrintRank", p.rank);
  setText("checkedPrintPosition", p.position);
  setImage("checkedSignatureImg", p.signature);

  localStorage.setItem("checkedBy", JSON.stringify(p));
}

function loadSignatories() {
  const prepared = JSON.parse(localStorage.getItem("preparedBy") || "null");
  const checked = JSON.parse(localStorage.getItem("checkedBy") || "null");

  if (prepared) {
    setText("preparedPrintName", prepared.name);
    setText("preparedPrintRank", prepared.rank);
    setText("preparedPrintPosition", prepared.position);
    setImage("preparedSignatureImg", prepared.signature);

    const preparedSelect = $("preparedName");
    if (preparedSelect) {
      const foundKey = Object.keys(personnel).find(
        key =>
          personnel[key].name === prepared.name &&
          personnel[key].rank === prepared.rank
      );
      if (foundKey) preparedSelect.value = foundKey;
    }
  }

  if (checked) {
    setText("checkedPrintName", checked.name);
    setText("checkedPrintRank", checked.rank);
    setText("checkedPrintPosition", checked.position);
    setImage("checkedSignatureImg", checked.signature);

    const checkedSelect = $("checkedName");
    if (checkedSelect) {
      const foundKey = Object.keys(personnel).find(
        key =>
          personnel[key].name === checked.name &&
          personnel[key].rank === checked.rank
      );
      if (foundKey) checkedSelect.value = foundKey;
    }
  }
}

/* =========================
   FILTERS
========================= */
function applyFilter() {
  const categoryEl = $("filterCategory");
  const unitEl = $("filterUnit");

  const category = categoryEl ? categoryEl.value : "";
  const unit = unitEl ? unitEl.value : "";

  filteredData = sortInventoryAscending(
    inventoryData.filter(item => {
      const matchCategory = !category || item.category === category;
      const matchUnit = !unit || String(item.unit || "").startsWith(unit);
      return matchCategory && matchUnit;
    })
  );

  renderInventoryTable(filteredData);
}

function resetFilter() {
  const categoryEl = $("filterCategory");
  const unitEl = $("filterUnit");
  const searchInput = $("searchInput");
  const searchColumn = $("searchColumn");

  if (categoryEl) categoryEl.value = "";
  if (unitEl) unitEl.value = "";
  if (searchInput) searchInput.value = "";
  if (searchColumn) searchColumn.value = "all";

  filteredData = [];
  renderInventoryTable(inventoryData);
}

/* =========================
   EVENTS
========================= */
document.addEventListener("click", function (e) {
  const editBtn = e.target.closest(".edit-btn");
  if (editBtn) {
    const id = editBtn.getAttribute("data-id");
    const item = inventoryData.find(i => String(i.id) === String(id));

    if (item) {
      openInventoryModal(item);
    } else {
      alert("Record not found.");
    }
    return;
  }

  const deleteBtn = e.target.closest(".delete-btn");
  if (deleteBtn) {
    const id = deleteBtn.getAttribute("data-id");
    deleteInventory(id);
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  await checkSession();

  const inventoryForm = $("inventoryForm");
  if (inventoryForm && !inventoryForm.dataset.bound) {
    inventoryForm.addEventListener("submit", saveInventoryForm);
    inventoryForm.dataset.bound = "true";
  }

  const borrowForm = $("borrowForm");
  if (borrowForm && !borrowForm.dataset.bound) {
    borrowForm.addEventListener("submit", saveBorrowForm);
    borrowForm.dataset.bound = "true";
  }

  const categoryEl = $("category");
  if (categoryEl && !categoryEl.dataset.bound) {
    categoryEl.addEventListener("change", handleCategoryChange);
    categoryEl.dataset.bound = "true";
    handleCategoryChange();
  }

  const unitEl = $("unit");
  if (unitEl && !unitEl.dataset.boundOffice) {
    unitEl.addEventListener("change", handleUnitOfficeLogic);
    unitEl.dataset.boundOffice = "true";
    handleUnitOfficeLogic();
  }

  if ($("inventoryTableBody")) {
    await loadInventory();
    loadSignatories();
  }

  if ($("borrowTableBody")) {
    await loadBorrows();
    loadSignatories();
  }

  if ($("dashboardTableBody") || $("statusChart")) {
    await loadDashboard();
  }
});
async function exportInventoryCSV() {
  try {
    const response = await fetch("/api/inventory");

    if (!response.ok) {
      throw new Error("Failed to fetch inventory data.");
    }

    const inventory = await response.json();

    if (!Array.isArray(inventory) || inventory.length === 0) {
      alert("No inventory data found.");
      return;
    }

    const headers = [
      "NR",
      "CATEGORY",
      "DESCRIPTION",
      "SERIAL NUMBER",
      "PROPERTY NUMBER",
      "STATUS",
      "DATE ISSUED",
      "UNIT",
      "OS",
      "WINDOWS TYPE",
      "MS OFFICE",
      "ANTIVIRUS",
      "REMARKS"
    ];

    const csvRows = [];
    csvRows.push(headers.join(","));

    inventory.forEach(item => {
      const row = [
        item.nr ?? "",
        item.category ?? "",
        item.description ?? "",
        item.serial_number ?? "",
        item.property_number ?? "",
        item.status ?? "",
        item.date_issued ?? "",
        item.unit ?? "",
        item.os ?? "",
        item.windows_type ?? "",
        item.ms_office ?? "",
        item.antivirus ?? "",
        item.remarks ?? ""
      ].map(value => {
        const safeValue = String(value).replace(/"/g, '""');
        return `"${safeValue}"`;
      });

      csvRows.push(row.join(","));
    });

    const csvContent = "\uFEFF" + csvRows.join("\n");
    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;"
    });

    const url = window.URL.createObjectURL(blob);

    const now = new Date();
    const fileName = `inventory_report_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.csv`;

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.URL.revokeObjectURL(url);

    alert("Inventory exported successfully.");
  } catch (error) {
    console.error("Export inventory error:", error);
    alert("Failed to export inventory.");
  }
}
async function exportBorrowCSV() {
  try {
    const response = await fetch("/api/borrows");

    if (!response.ok) {
      throw new Error("Failed to fetch borrow data.");
    }

    const borrows = await response.json();

    if (!Array.isArray(borrows) || borrows.length === 0) {
      alert("No borrow records found.");
      return;
    }

    const headers = [
      "BORROWER NAME",
      "OFFICE / UNIT",
      "EQUIPMENT",
      "QUANTITY",
      "DATE BORROWED",
      "DATE RETURN",
      "PURPOSE",
      "REMARKS"
    ];

    const csvRows = [];
    csvRows.push(headers.join(","));

    borrows.forEach(item => {
      const row = [
        item.borrower_name ?? "",
        item.office_unit ?? "",
        item.equipment ?? "",
        item.quantity ?? "",
        item.date_borrowed ?? "",
        item.date_return ?? "",
        item.purpose ?? "",
        item.remarks ?? ""
      ].map(value => {
        const safeValue = String(value).replace(/"/g, '""');
        return `"${safeValue}"`;
      });

      csvRows.push(row.join(","));
    });

    const csvContent = "\uFEFF" + csvRows.join("\n");
    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;"
    });

    const url = window.URL.createObjectURL(blob);

    const now = new Date();
    const fileName = `borrow_report_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.csv`;

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.URL.revokeObjectURL(url);

    alert("Borrow records exported successfully.");
  } catch (error) {
    console.error("Export borrow error:", error);
    alert("Failed to export borrow records.");
  }
}
