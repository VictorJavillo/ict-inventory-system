/* ===============================
   OFFLINE QUEUE + PREMIUM SYNC UI
================================ */

const OFFLINE_QUEUE_KEY = "ict_offline_queue_v1";

function getOfflineQueue() {
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    return Array.isArray(queue) ? queue : [];
  } catch (err) {
    return [];
  }
}

function saveOfflineQueue(queue) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  updatePendingSyncBadge();
}

function addOfflineAction(action) {
console.log("QUEUE LENGTH:", queue.length);
  const queue = getOfflineQueue();

  const newAction = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: action.type,
    url: action.url,
    method: action.method,
    body: action.body || null,
    createdAt: new Date().toISOString()
  };

  queue.push(newAction);

  localStorage.setItem(
    OFFLINE_QUEUE_KEY,
    JSON.stringify(queue)
  );

  updatePendingSyncBadge();

  showSyncToast(
    `${queue.length} pending change(s).`,
    "pending"
  );

  console.log("OFFLINE QUEUE:", queue);
}

function getPendingCount() {
  return getOfflineQueue().length;
}


let CURRENT_USER = null;



async function loadCurrentUser() {
  try {
    const res = await fetch("/api/me");

    if (!res.ok) {
      const cachedUser = JSON.parse(localStorage.getItem("currentUserCache") || "null");

      if (cachedUser) {
        CURRENT_USER = cachedUser;
        applyRoleUI(CURRENT_USER.role);
        return CURRENT_USER;
      }

      window.location.href = "/login.html";
      return null;
    }

    const data = await res.json();
    CURRENT_USER = data.user || data;

    localStorage.setItem("currentUserCache", JSON.stringify(CURRENT_USER));

    applyRoleUI(CURRENT_USER.role);
    return CURRENT_USER;

  } catch (err) {
    console.warn("Offline user fallback:", err);

    const cachedUser = JSON.parse(localStorage.getItem("currentUserCache") || "null");

    if (cachedUser) {
      CURRENT_USER = cachedUser;
      applyRoleUI(CURRENT_USER.role);
      return CURRENT_USER;
    }

    toastWarning("Offline Mode: Please open the app online first before using offline mode.");
    return null;
  }
}

function applyRoleUI(role) {
  document.body.setAttribute("data-role", role);

  const isAdmin = role === "admin";
  const isStaff = role === "staff";
  const isViewer = role === "viewer";

  // ADMIN ONLY: users, logs, backup, signatories, admin cards
  if (!isAdmin) {
    document.querySelectorAll(
      ".admin-only, .signatory-card, " +
      'a[href="users.html"], a[href="logs.html"], a[href="backup.html"]'
    ).forEach(el => el.style.display = "none");
  }

  // STAFF: no delete, no admin tools
  if (isStaff) {
    document.querySelectorAll(
      ".delete-btn, #deleteBtn, .btn-delete"
    ).forEach(el => el.style.display = "none");
  }

  // VIEWER: view only
  if (isViewer) {
    document.querySelectorAll(
      ".edit-btn, .delete-btn, #addBtn, #deleteBtn, " +
      ".btn-add, .btn-edit, .btn-delete, " +
      "button[onclick*='openInventoryModal'], button[onclick*='delete']"
    ).forEach(el => el.style.display = "none");

    document.querySelectorAll("input, select, textarea, button").forEach(el => {
      const allowButtons = [
        "logout",
        "print",
        "search",
        "filter",
        "reset"
      ];

      const text = String(el.textContent || el.value || el.id || "").toLowerCase();
      const id = String(el.id || "").toLowerCase();

      const allowed = allowButtons.some(word => text.includes(word) || id.includes(word));

      if (!allowed) {
        el.disabled = true;
        el.classList.add("viewer-disabled");
      }
    });
  }

  // role badge sa sidebar/header kung may lalagyan
  const roleLabel = document.querySelector("#roleLabel");
  if (roleLabel) {
   roleLabel.textContent = (role || "viewer").toUpperCase();
    roleLabel.className = `role-badge role-${role}`;
  }
}
function applyStaffFilterLock() {
  if (!CURRENT_USER) return;

  const role = (CURRENT_USER.role || "viewer").toLowerCase();
  const assignedUnit = CURRENT_USER.assigned_unit;

  if (role === "admin") return;
  if (!assignedUnit) return;

  const filterUnit = $("filterUnit");
  if (filterUnit) {
    filterUnit.value = assignedUnit;
    filterUnit.disabled = true;
  }

  const unitInput = $("unit");
  if (unitInput) {
    unitInput.value = assignedUnit;
    unitInput.disabled = true;
  }
}
let filteredData = [];
let inventoryData = [];
let currentPage = 1;
let rowsPerPage = 10;
let currentFilteredInventory = [];
let statusChart;
let licenseChart;
let categoryChart;

const officeAllowedUnits = ["581ACWG", "582ACWG", "583ACWG", "584ACWG"];

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

function hideLoader() {
  const loader = $("appLoader");
  if (loader) loader.classList.add("hide");
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

  el.value = matchedOption ? matchedOption.value : fallback;
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

  if (el.tagName.toLowerCase() === "select") {
    el.disabled = locked;
  } else {
    el.readOnly = locked;
    el.disabled = locked;
  }

  el.classList.toggle("na-field", locked);
}

function clearNAValue(id) {
  const el = $(id);
  if (el && normalizeText(el.value) === "n/a") el.value = "";
}

/* =========================
   CATEGORY / OFFICE LOGIC
========================= */
function handleCategoryChange() {
  const categoryEl = $("category");
  if (!categoryEl) return;

  const isComputer = isComputerCategory(categoryEl.value);

  if (!isComputer) {
    setValue("os", "N/A");
    setValue("windows_type", "N/A");
    setValue("ms_office", "N/A");
    setValue("antivirus", "N/A");

    setFieldLock("os", true);
    setFieldLock("windows_type", true);
    setFieldLock("ms_office", true);
    setFieldLock("antivirus", true);
  } else {
    setFieldLock("os", false);
    setFieldLock("windows_type", false);
    setFieldLock("ms_office", false);
    setFieldLock("antivirus", false);

    clearNAValue("os");
    clearNAValue("windows_type");
    clearNAValue("ms_office");
    clearNAValue("antivirus");
  }
}

function isOfficeAllowedUnit(unitValue) {
  return officeAllowedUnits.includes(String(unitValue || "").trim().toUpperCase());
}

function handleUnitOfficeLogic() {
  const unitEl = $("unit");
  const officeEl = $("office");

  if (!unitEl || !officeEl) return;

  const selectedUnit = String(unitEl.value || "").trim().toUpperCase();
  const allowed = isOfficeAllowedUnit(selectedUnit);

  if (allowed) {
    setFieldLock("office", false);
    if (normalizeText(officeEl.value) === "n/a") officeEl.value = "";
    officeEl.placeholder = "Enter specific office";
  } else {
    officeEl.value = "N/A";
    setFieldLock("office", true);
    officeEl.placeholder = "N/A";
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

  if (!cleanUnit) return "";

  if (!isOfficeAllowedUnit(cleanUnit)) return cleanUnit;

  if (!cleanOffice || normalizeText(cleanOffice) === "n/a") return cleanUnit;

  return `${cleanUnit} - ${cleanOffice}`;
}

function parseUnitDisplay(savedUnitValue) {
  const raw = String(savedUnitValue || "").trim();

  if (!raw) return { unit: "", office: "N/A" };

  if (raw.includes(" - ")) {
    const parts = raw.split(" - ");
    return {
      unit: String(parts[0] || "").trim(),
      office: String(parts.slice(1).join(" - ") || "").replace(/\s*Office\s*$/i, "").trim()
    };
  }

  return {
    unit: raw,
    office: "N/A"
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
      return false;
    }

    return true;
  } catch (err) {
    console.error("Session check failed:", err);
    hideLoader();
    return false;
  }
}

async function logout() {
  showConfirmModal({
    title: "Logout Account",
    message: "Are you sure you want to logout from the system?",
    confirmText: "Logout",

    onConfirm: async () => {
      try {
        await fetch("/api/logout", { method: "POST" });
        toastInfo("Logging out...");
      } catch (err) {
        console.error("Logout failed:", err);
        toastError("Logout failed.");
        return;
      }

      setTimeout(() => {
        window.location.href = "/login.html";
      }, 600);
    }
  });
}
/* =========================
   MODAL
========================= */
function openModal(id) {
  const modal = $(id);
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("show");
  }
}

function closeModal(id) {
  const modal = $(id);
  if (modal) {
    modal.style.display = "none";
    modal.classList.remove("show");
  }
}

/* =========================
   FORMATTING
========================= */
function badgeStatus(status) {
  return normalizeText(status) === "opnl"
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

  if (/^\d{4}-\d{2}$/.test(value)) return value;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7);

  const date = new Date(value);
  if (isNaN(date.getTime())) return "";

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthYearDisplay(value) {
  if (!value) return "N/A";

  if (/^\d{4}-\d{2}$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  const date = new Date(value);
  if (isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function parseMonthValue(dateValue) {
  if (!dateValue) return null;

  if (/^\d{4}-\d{2}$/.test(dateValue) || /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const [year, month] = dateValue.split("-").map(Number);
    return new Date(year, month - 1, 1);
  }

  const date = new Date(dateValue);
  return isNaN(date.getTime()) ? null : date;
}

function getDateClass(dateValue) {
  if (!dateValue) return "red";

  const date = parseMonthValue(dateValue);
  if (!date) return "red";

  const today = new Date();
  const diffMonths =
    (today.getFullYear() - date.getFullYear()) * 12 +
    (today.getMonth() - date.getMonth());

  const diffYears = diffMonths / 12;

  if (diffYears <= 2) return "green";
  if (diffYears > 2 && diffYears < 3.5) return "yellow";
  return "red";
}

/* =========================
   INVENTORY
========================= */
function openInventoryModal(item = null) {
  const form = $("inventoryForm");
  if (!form) return;

  form.reset();

  setValue("editId", "");
  setText("modalTitle", "Add Equipment");
  setValue("date_issued", "");
  setValue("office", "N/A");

  if (item) {
    setValue("editId", item.id || "");
    setSelectValueFlexible("category", item.category || "");

    setValue("description", item.description || "");
    setValue("serial_number", item.serial_number || "");
    setValue("property_number", item.property_number || "");
    setSelectValueFlexible("status", item.status || "NOPNL");
    setValue("date_issued", formatMonthInput(item.date_issued));

    const parsedUnit = parseUnitDisplay(item.unit || "");
    setSelectValueFlexible("unit", parsedUnit.unit || "", "");
    setValue("office", parsedUnit.office || "N/A");

    setSelectValueFlexible("os", item.os || "N/A", "N/A");
    setSelectValueFlexible("windows_type", item.windows_type || "N/A", "N/A");
    setSelectValueFlexible("ms_office", item.ms_office || "N/A", "N/A");
    setSelectValueFlexible("antivirus", item.antivirus || "N/A", "N/A");

    setValue("remarks", item.remarks || "");
    setText("modalTitle", "Edit Equipment");
  }

  handleCategoryChange();
  handleUnitOfficeLogic();
  openModal("inventoryModal");
}

/* =========================
   PREMIUM PAGINATION
========================= */

function paginateData(data) {
  const start = (currentPage - 1) * rowsPerPage;
  const end = start + rowsPerPage;

  return data.slice(start, end);
}

function renderPagination(data) {

  const paginationBox =
    document.getElementById("inventoryPagination");

  if (!paginationBox) return;

  const totalPages =
    Math.ceil(data.length / rowsPerPage);

  if (totalPages <= 1) {
    paginationBox.innerHTML = "";
    return;
  }

  let html = `
    <button
      class="page-btn"
      ${currentPage === 1 ? "disabled" : ""}
      onclick="changePage(${currentPage - 1})">
      ‹ Prev
    </button>
  `;

  for (let i = 1; i <= totalPages; i++) {

    if (
      i === 1 ||
      i === totalPages ||
      Math.abs(i - currentPage) <= 1
    ) {

      html += `
        <button
          class="page-btn ${i === currentPage ? "active" : ""}"
          onclick="changePage(${i})">
          ${i}
        </button>
      `;

    } else if (
      i === currentPage - 2 ||
      i === currentPage + 2
    ) {

      html += `<span class="page-dots">...</span>`;
    }
  }

  html += `
    <button
      class="page-btn"
      ${currentPage === totalPages ? "disabled" : ""}
      onclick="changePage(${currentPage + 1})">
      Next ›
    </button>
  `;

  paginationBox.innerHTML = html;

const info = document.getElementById("paginationInfo");

if (info) {

  const start =
    data.length === 0
      ? 0
      : ((currentPage - 1) * rowsPerPage) + 1;

  const end =
    Math.min(currentPage * rowsPerPage, data.length);

  info.innerHTML = `
    Showing
    <strong>${start}-${end}</strong>
    of
    <strong>${data.length}</strong>
    records
  `;
}



}

function changePage(page) {

  currentPage = page;

  const activeData =
    filteredData.length > 0
      ? filteredData
      : inventoryData;

  renderInventoryTable(activeData);

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}
function changeRowsPerPage() {
  const select = document.getElementById("rowsPerPageSelect");
  if (!select) return;

  rowsPerPage = Number(select.value) || 10;
  currentPage = 1;

  const activeData =
    filteredData.length > 0
      ? filteredData
      : inventoryData;

  renderInventoryTable(activeData);
}

function jumpToPage() {
  const input = document.getElementById("pageJumpInput");
  if (!input) return;

  const activeData =
    currentFilteredInventory.length > 0
      ? currentFilteredInventory
      : inventoryData;

  const totalPages = Math.ceil(activeData.length / rowsPerPage);

  let page = Number(input.value);

  if (!page || page < 1) page = 1;
  if (page > totalPages) page = totalPages;

  currentPage = page;

  renderInventoryTable(activeData);

  input.value = "";
}


async function loadInventory() {

  try {

    const res = await fetch("/api/inventory");

    if (res.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    const data = await safeJSON(res);

    // SAVE OFFLINE CACHE
    localStorage.setItem(
      "offlineInventoryCache",
      JSON.stringify(data)
    );

    inventoryData =
      sortInventoryAscending(
        Array.isArray(data) ? data : []
      );

    filteredData = [];

    renderInventoryTable(inventoryData);

    toastSuccess(
      "Inventory synced successfully.",
      "Online Mode"
    );

    hideLoader();

  } catch (err) {

    console.warn(
      "Offline inventory fallback:",
      err
    );

    // LOAD OFFLINE CACHE
    const offlineData = JSON.parse(
      localStorage.getItem("offlineInventoryCache") || "[]"
    );

    inventoryData =
      sortInventoryAscending(
        Array.isArray(offlineData)
          ? offlineData
          : []
      );

    filteredData = [];

    renderInventoryTable(inventoryData);

    toastWarning(
      "Offline Mode: Showing last saved inventory data."
    );

    hideLoader();
  }
}

function renderInventoryTable(data) {
  const tbody = $("inventoryTableBody");
  if (!tbody) return;

  const sortedData = sortInventoryAscending(data);
  currentFilteredInventory = sortedData;

const paginatedData = paginateData(sortedData);

  if (!sortedData.length) {
    tbody.innerHTML = `<tr><td colspan="15" class="empty-state">No equipment records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = paginatedData.map((item, index) => {
    const parsed = parseUnitDisplay(item.unit || "");

    return `
      <tr>
        <td>${(currentPage - 1) * rowsPerPage + index + 1}</td>


       <td class= data-label="Category">
  ${escapeHtml(item.category || "")}
</td>
        <td class= data-label="Description">
  ${escapeHtml(item.description || "")}
</td>
        <td class=data-label="Serial Number">
  ${escapeHtml(item.serial_number || "")}
</td>
        <td  class=data-label="Property Number">
  ${escapeHtml(item.property_number || "")}
</td>
       <td data-label="Status">
  ${badgeStatus(item.status || "")}
</td>
        <td>
          <td class= data-label="Date Issued">
  <span class="date-badge ${getDateClass(item.date_issued)}">
    ${escapeHtml(formatMonthYearDisplay(item.date_issued))}
  </span>
</td>
        </td>
        <td class= data-label="Unit">
  ${escapeHtml(parsed.unit || item.unit || "")}
</td>
        <td class= data-label="Office">
  ${escapeHtml(parsed.office || "N/A")}
</td>
        <td class=" data-label="OS">
  ${escapeHtml(item.os || "N/A")}
</td>
        <td class=" data-label="Windows Type">
  ${escapeHtml(item.windows_type || "N/A")}
</td>
        <td class= data-label="MS Office">
  ${escapeHtml(item.ms_office || "N/A")}
</td>
        <td class= data-label="Antivirus">
  ${escapeHtml(item.antivirus || "N/A")}
</td>
        <td class= data-label="Remarks">
  ${escapeHtml(item.remarks || "")}
</td>
        <td data-label="Action" class="action-cell mobile-detail-row">

  <button
    type="button"
    class="btn btn-sm btn-warning edit-btn desktop-action"
    data-id="${item.id}">
    Edit
  </button>

  <button
    type="button"
    class="btn btn-sm btn-danger delete-btn desktop-action"
    data-id="${item.id}">
    Delete
  </button>

  <button
    type="button"
    class="btn btn-sm btn-primary mobile-action-btn"
    data-id="${item.id}">
    Actions
  </button>

</td>
      </tr>
    `;
  }).join("");
  renderPagination(sortedData);
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
    const parsed = parseUnitDisplay(item.unit || "");
    const searchableItem = {
      ...item,
      unit_only: parsed.unit,
      office: parsed.office
    };

    if (column === "all") {
      return Object.values(searchableItem).some(v =>
        String(v ?? "").toLowerCase().includes(value)
      );
    }

    return String(searchableItem[column] ?? "").toLowerCase().includes(value);
  });

  filteredData = sortInventoryAscending(filtered);
  renderInventoryTable(filteredData);
}

async function saveInventoryForm(e) {
  e.preventDefault();
  

  const editId = getValue("editId");
  const category = getValue("category");

  let os = getValue("os");
  let windowsType = getValue("windows_type");
  let msOffice = getValue("ms_office");
  let antivirus = getValue("antivirus");

  if (!isComputerCategory(category)) {
    os = "N/A";
    windowsType = "N/A";
    msOffice = "N/A";
    antivirus = "N/A";
  }

  const selectedUnit = getValue("unit");
  let officeValue = getValue("office");

  if (!isOfficeAllowedUnit(selectedUnit)) {
    officeValue = "N/A";
  }

  const payload = {
    nr: editId ? "" : getNextNR(),
    category,
    description: getValue("description"),
    serial_number: getValue("serial_number"),
    property_number: getValue("property_number"),
    status: getValue("status"),
    date_issued: getValue("date_issued"),
    unit: buildUnitDisplay(selectedUnit, officeValue),
    os,
    windows_type: windowsType,
    ms_office: msOffice,
    antivirus,
    remarks: getValue("remarks")
  };

try {

  if (!navigator.onLine) {

    addOfflineAction({
      type: editId ? "edit" : "add",
      url: editId
        ? `/api/inventory/${editId}`
        : "/api/inventory",
      method: editId ? "PUT" : "POST",
      body: payload
    });

    if (!editId) {
      inventoryData.push({
        ...payload,
        id: `offline-${Date.now()}`
      });
    } else {
      inventoryData = inventoryData.map(item =>
        String(item.id) === String(editId)
          ? { ...item, ...payload }
          : item
      );
    }

    localStorage.setItem(
      "offlineInventoryCache",
      JSON.stringify(inventoryData)
    );

    closeModal("inventoryModal");

    const form = $("inventoryForm");
    if (form) form.reset();

    renderInventoryTable(inventoryData);

    updatePendingSyncBadge();

    toastWarning(
      editId
        ? "Edit queued offline."
        : "Inventory queued offline."
    );

    return;
  }

  const url = editId
    ? `/api/inventory/${editId}`
    : "/api/inventory";

  const method = editId
    ? "PUT"
    : "POST";

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }); 

    const result = await safeJSON(res);

    if (!res.ok) {
      if (!editId) {
    addOfflineAction({
      type: "add",
      url: "/api/inventory",
      method: "POST",
      body: payload
    });

    toastWarning("Inventory queued offline.");
    return;
  }

  toastError(result.error || result.message || "Failed to save inventory.");
  return;
      

      toastError(result.error || result.message || "Failed to save inventory.");
      return;
    }

    closeModal("inventoryModal");

    toastSuccess(
      editId
        ? "Inventory item updated successfully."
        : "New inventory item added successfully."
    );

    await loadInventory();

  } catch (err) {
  console.error("Save failed:", err);

  addOfflineAction({
    type: editId ? "edit" : "add",
    url: editId
      ? `/api/inventory/${editId}`
      : "/api/inventory",
    method: editId ? "PUT" : "POST",
    body: payload
  });

  toastWarning(
    editId
      ? "Edit queued offline."
      : "Inventory queued offline."
  );

  return;
}
}
async function deleteInventory(id) {
  showConfirmModal({
  title: "Delete Inventory",
  message: "Are you sure you want to delete this inventory record?",
  confirmText: "Delete",

  onConfirm: async () => {

   try {

  if (!navigator.onLine) {
    addOfflineAction({
      type: "delete",
      url: `/api/inventory/${id}`,
      method: "DELETE"
    });

    toastWarning("Delete queued offline.");
    return;
  }

  const res = await fetch(`/api/inventory/${id}`, {
    method: "DELETE"
  });

  const result = await safeJSON(res);

  if (!res.ok) {
    toastError(result.error || "Failed to delete record.");
    return;
  }

  toastWarning("Inventory item deleted.");

  await loadInventory();

} catch (err) {
  console.error("Delete failed:", err);
  toastError("Failed to delete record.");
}

  }
});
}

/* =========================
   BORROW
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
          <td>${escapeHtml(item.borrower_name || "")}</td>
          <td>${escapeHtml(item.office_unit || "")}</td>
          <td>${escapeHtml(item.equipment || "")}</td>
          <td>${escapeHtml(item.quantity || "")}</td>
          <td>${escapeHtml(item.date_borrowed || "")}</td>
          <td>${escapeHtml(item.date_return || "")}</td>
          <td>${escapeHtml(item.purpose || "")}</td>
          <td>${escapeHtml(item.remarks || "")}</td>
          <td><button type="button" class="btn btn-danger" onclick="deleteBorrow(${item.id})">Delete</button></td>
        </tr>
      `).join("");
    }

    hideLoader();
  } catch (err) {
    console.error("Failed to load borrows:", err);
    hideLoader();
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
      toastError(result.error || "Failed to save borrow record.");
      return;
    }

    const form = $("borrowForm");
    if (form) form.reset();

    toastSuccess("Borrow record saved successfully.");

    await loadBorrows();

  } catch (err) {
    console.error("Borrow save failed:", err);
    toastError("Failed to save borrow record.");
  }
}

async function deleteBorrow(id) {
  showConfirmModal({
    title: "Delete Borrow Record",
    message: "Are you sure you want to delete this borrow record?",
    confirmText: "Delete",

    onConfirm: async () => {
      try {
        const res = await fetch(`/api/borrows/${id}`, {
          method: "DELETE"
        });

        const result = await safeJSON(res);

        if (!res.ok) {
          toastError(result.error || "Failed to delete borrow record.");
          return;
        }

        toastWarning("Borrow record deleted.");

        await loadBorrows();

      } catch (err) {
        console.error("Borrow delete failed:", err);
        toastError("Failed to delete borrow record.");
      }
    }
  });
}

/* =========================
   DASHBOARD
========================= */
function isLicensedValue(value) {
  const normalized = normalizeText(value);
  return (
    normalized === "licensed" ||
    normalized === "with license" ||
    normalized === "retail licensed"
  );
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
const dashboardTitle = document.querySelector(".dashboard-hero h1");
const dashboardSubtitle = document.querySelector(".dashboard-hero p");

if (CURRENT_USER && CURRENT_USER.role !== "admin") {
  if (dashboardTitle) dashboardTitle.textContent = `${CURRENT_USER.assigned_unit} Dashboard`;
  if (dashboardSubtitle) dashboardSubtitle.textContent = "Summary of ICT assets assigned to your unit";
} else {
  if (dashboardTitle) dashboardTitle.textContent = "Dashboard Overview";
  if (dashboardSubtitle) dashboardSubtitle.textContent = "Professional summary of ICT assets and inventory records";
}
    setText("totalAssets", data.totalAssets || inventoryItems.length);
    setText("opnlAssets", data.opnlAssets || inventoryItems.filter(item => normalizeText(item.status) === "opnl").length);
    setText("nopnlAssets", data.nopnlAssets || inventoryItems.filter(item => normalizeText(item.status) === "nopnl").length);
    setText("borrowedAssets", data.borrowedAssets || 0);

    renderDashboardTable(inventoryItems);
    renderCharts(inventoryItems);
    hideLoader();
  } catch (err) {
    console.error("Failed to load dashboard:", err);
    hideLoader();
  }
}

function renderDashboardTable(items) {
  const tbody = $("dashboardTableBody");
  if (!tbody) return;

  const sortedItems = sortInventoryAscending(items);

  if (!sortedItems.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="empty-state">No inventory records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = sortedItems.slice(-10).reverse().map((item, index) => {
    const parsed = parseUnitDisplay(item.unit || "");

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.category || "")}</td>
        <td>${escapeHtml(item.description || "")}</td>
        <td>${escapeHtml(item.serial_number || "")}</td>
        <td>${escapeHtml(item.property_number || "")}</td>
        <td>${badgeStatus(item.status || "")}</td>
        <td>${escapeHtml(formatMonthYearDisplay(item.date_issued))}</td>
        <td>${escapeHtml(parsed.unit || item.unit || "")}</td>
        <td>${escapeHtml(item.os || "N/A")}</td>
        <td>${escapeHtml(item.ms_office || "N/A")}</td>
        <td>${escapeHtml(item.antivirus || "N/A")}</td>
        <td>${escapeHtml(item.remarks || "")}</td>
      </tr>
    `;
  }).join("");
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
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.96)",
          titleColor: "#ffffff",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(148,163,184,0.35)",
          borderWidth: 1,
          cornerRadius: 12,
          callbacks: {
            label: context => ` Total: ${context.parsed.y}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#ffffff", font: { size: 14, weight: "600" } }
        },
        y: {
          beginAtZero: true,
          grace: "10%",
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: "#cbd5e1", precision: 0 }
        }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        showChartDetails(idx === 0 ? "OPNL Records" : "NOPNL Records", idx === 0 ? opnlItems : nopnlItems);
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
        backgroundColor: ["rgba(59,130,246,0.92)", "rgba(245,158,11,0.92)"],
        borderColor: ["rgba(147,197,253,1)", "rgba(252,211,77,1)"],
        borderWidth: 2,
        hoverOffset: 18
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#fff",
            padding: 18,
            usePointStyle: true,
            pointStyle: "circle",
            font: { size: 13, weight: "600" }
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
            label: context => {
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
        showChartDetails(idx === 0 ? "Licensed Records" : "No License / N/A Records", idx === 0 ? licensedItems : unlicensedItems);
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
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.96)",
          titleColor: "#ffffff",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(148,163,184,0.35)",
          borderWidth: 1,
          cornerRadius: 12,
          callbacks: {
            label: context => ` Total: ${context.raw}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#ffffff", font: { size: 12, weight: "600" } },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#cbd5e1", precision: 0 },
          grid: { color: "rgba(255,255,255,0.06)" }
        }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const selectedCategory = categoryLabels[elements[0].index];
        const filteredItems = items.filter(item => String(item.category || "").trim() === selectedCategory);
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
    tbody.innerHTML = `<tr><td colspan="11" class="empty-state">No matching records found.</td></tr>`;
    openModal("chartModal");
    return;
  }

  tbody.innerHTML = sortedItems.map((item, index) => {
    const parsed = parseUnitDisplay(item.unit || "");

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.category || "")}</td>
        <td>${escapeHtml(item.description || "")}</td>
        <td>${escapeHtml(item.serial_number || "")}</td>
        <td>${escapeHtml(item.property_number || "")}</td>
        <td>${badgeStatus(item.status || "")}</td>
        <td>${escapeHtml(parsed.unit || item.unit || "")}</td>
        <td>${escapeHtml(item.os || "N/A")}</td>
        <td>${escapeHtml(item.ms_office || "N/A")}</td>
        <td>${escapeHtml(item.antivirus || "N/A")}</td>
        <td>${escapeHtml(item.remarks || "")}</td>
      </tr>
    `;
  }).join("");

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
  generatePrintSummary(dataToPrint);
  const printMode = getValue("printMode") || "table_summary";
const reportPage = document.querySelector(".report-page");

if (reportPage) {
  reportPage.classList.toggle("print-grand-only", printMode === "grand_only");
}
  const printBody = $("printTableBody");
  if (!printBody) return;

  printBody.innerHTML = dataToPrint.map((item, index) => {
    const parsed = parseUnitDisplay(item.unit || "");

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.category || "")}</td>
        <td>${escapeHtml(item.description || "")}</td>
        <td>${escapeHtml(item.serial_number || "")}</td>
        <td>${escapeHtml(item.property_number || "")}</td>
        <td>${escapeHtml(item.status || "")}</td>
        <td>${escapeHtml(formatMonthYearDisplay(item.date_issued))}</td>
        <td>${escapeHtml(parsed.unit || item.unit || "")}</td>
        <td>${escapeHtml(parsed.office || "N/A")}</td>
        <td>${escapeHtml(item.os || "N/A")}</td>
        <td>${escapeHtml(item.windows_type || "N/A")}</td>
        <td>${escapeHtml(item.ms_office || "N/A")}</td>
        <td>${escapeHtml(item.antivirus || "N/A")}</td>
        <td>${escapeHtml(item.remarks || "")}</td>
      </tr>
    `;
  }).join("");

  if (CURRENT_USER && CURRENT_USER.role === "admin") {
  loadSignatories();
} else {
  setText("preparedPrintName", "");
  setText("preparedPrintRank", "");
  setText("preparedPrintPosition", "");
  setImage("preparedSignatureImg", "");

  setText("checkedPrintName", "");
  setText("checkedPrintRank", "");
  setText("checkedPrintPosition", "");
  setImage("checkedSignatureImg", "");
}

await waitForPrintAssets($("printArea") || document);
setTimeout(() => window.print(), 250);

}

function printBorrow() {
  const printArea = $("printArea");
  if (!printArea) return;

  printArea.style.display = "block";
  window.print();
  printArea.style.display = "none";
}
/* =========================
   PRINT SUMMARY (NEW)
========================= */
function generateLastPageMatrixSummary(data) {
  const categoryCount = {};
  let grandTotal = 0;

  data.forEach(item => {
    const category =
      item.category ||
      item.equipment ||
      item.equipment_type ||
      item.equipmentName ||
      item.type ||
      "Uncategorized";

    categoryCount[category] = (categoryCount[category] || 0) + 1;
    grandTotal++;
  });

  const sortedCategories = Object.keys(categoryCount).sort((a, b) =>
    a.localeCompare(b)
  );

  return `
    <div class="print-last-page">

      <div class="last-page-title">
        ICT EQUIPMENT SUMMARY
      </div>

      <table class="last-page-matrix">
        <thead>
          <tr>
            <th colspan="2">TOTAL</th>
            <th>PENDING FOR TURN-IN</th>
            <th>Awaiting PTR from SAO</th>
          </tr>
        </thead>

        <tbody>
          ${sortedCategories.map(category => `
            <tr>
              <td>${category}</td>
              <td>${categoryCount[category]}</td>
              <td>-</td>
              <td>-</td>
            </tr>
          `).join("")}
          <tr class="last-page-total-row">
  <td>GRAND TOTAL</td>
  <td>${grandTotal}</td>
  <td>-</td>
  <td>-</td>
</tr>
        </tbody>
      </table>

<div class="last-page-signatures">
  <div class="last-sig-box">
    <div class="last-sig-label">Prepared by:</div>
    <img id="preparedSignatureImg" class="last-sig-img" alt="Prepared Signature" />
    <div class="last-sig-name" id="preparedPrintName"></div>
    <div class="last-sig-rank">
      <span id="preparedPrintRank"></span>
      <span>PAF</span>
    </div>
    <div class="last-sig-position" id="preparedPrintPosition"></div>
  </div>

  <div class="last-sig-box right">
    <div class="last-sig-label">Certified Correct by:</div>
    <img id="checkedSignatureImg" class="last-sig-img" alt="Checked Signature" />
    <div class="last-sig-name" id="checkedPrintName"></div>
    <div class="last-sig-rank">
      <span id="checkedPrintRank"></span>
      <span>PAF</span>
    </div>
    <div class="last-sig-position" id="checkedPrintPosition"></div>
  </div>
</div>

</div>
`;
}
const customUnitOrder = [
  "DWC",
  "ODO",
  "WOC",
  "HAS",
  "ODP",
  "ODI",
  "CEISO",
  "OFM",
  "ODL",
  "WPM",
  "OESPA",
  "WIGO",
  "PAO",
  "OWSM",
  "SAO",
  "WADJ",
  "WSO",
  "WSM",

  // SITES
  "581ACWG",
  "582ACWG",
  "583ACWG",
  "584ACWG",
  "586ACWG",
  "586MCRS",
  "588RMSS",
  "589ABMS"
];
function generatePrintSummary(data) {
  const summaryBox = $("printSummaryBody");
  const grandTotalBox = $("printGrandTotal");

  if (!summaryBox) return;

  if (!Array.isArray(data) || data.length === 0) {
    summaryBox.innerHTML = `<tr><td colspan="10">No summary available</td></tr>`;
    if (grandTotalBox) grandTotalBox.textContent = "0";
    return;
  }

  const categories = [
    "Desktop Computer",
    "Laptop",
    "Printer",
    "Mobile Phone",
    "Handheld Radio",
    "Base Radio",
    "Television",
    "Others"
  ];

  

  const summary = {};
  const grandColumnTotals = {};
  categories.forEach(cat => grandColumnTotals[cat] = 0);

  let grandTotal = 0;

  data.forEach(item => {
    const parsed = parseUnitDisplay(item.unit || "");

    const site = parsed.unit || item.unit || "N/A";

    const office =
      parsed.office && parsed.office !== "N/A"
        ? parsed.office
        : "GENERAL / NO OFFICE";

    const equipment = categories.includes(item.category)
      ? item.category
      : "Others";

    if (!summary[site]) summary[site] = {};
    if (!summary[site][office]) {
      summary[site][office] = {};
      categories.forEach(cat => summary[site][office][cat] = 0);
    }

    summary[site][office][equipment]++;
    grandColumnTotals[equipment]++;
    grandTotal++;
  });

  
  let rows = "";

  Object.keys(summary)
  .sort((a, b) => {
    const aIndex = customUnitOrder.indexOf(a);
    const bIndex = customUnitOrder.indexOf(b);

    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return a.localeCompare(b);
  })
  .forEach(site => {
    const siteColumnTotals = {};
    categories.forEach(cat => siteColumnTotals[cat] = 0);

    let siteTotal = 0;

    rows += `
      <tr class="summary-site-title">
        <td colspan="${categories.length + 2}">${escapeHtml(site)}</td>
      </tr>
      <tr class="summary-matrix-head">
        <th>Office / Section</th>
        ${categories.map(cat => `<th>${escapeHtml(cat)}</th>`).join("")}
        <th>Total</th>
      </tr>
    `;

    Object.keys(summary[site]).sort().forEach(office => {
      let officeTotal = 0;

      rows += `<tr>`;
      rows += `<td class="summary-office">${escapeHtml(office)}</td>`;

      categories.forEach(cat => {
        const count = summary[site][office][cat] || 0;
        officeTotal += count;
        siteColumnTotals[cat] += count;
        siteTotal += count;

        rows += `
          <td class="summary-count ${count > 0 ? "has-count" : "no-count"}">
            ${count > 0 ? count : ""}
          </td>
        `;
      });

      rows += `<td class="summary-row-total">${officeTotal}</td>`;
      rows += `</tr>`;
    });

    rows += `
      <tr class="summary-site-total">
        <td>SITE TOTAL - ${escapeHtml(site)}</td>
        ${categories.map(cat => `
          <td class="summary-count">${siteColumnTotals[cat] || ""}</td>
        `).join("")}
        <td class="summary-row-total">${siteTotal}</td>
      </tr>
    `;
  });

  rows += `
    <tr class="summary-grand-total-row">
      <td>GRAND TOTAL PER EQUIPMENT</td>
      ${categories.map(cat => `
        <td class="summary-count">${grandColumnTotals[cat] || ""}</td>
      `).join("")}
      <td class="summary-row-total">${grandTotal}</td>
    </tr>
  `;

  summaryBox.innerHTML = rows;

   if (grandTotalBox) {
    grandTotalBox.textContent = grandTotal;
  }

  const lastPageContainer = $("printLastPage");

  if (lastPageContainer) {
    lastPageContainer.innerHTML =
      generateLastPageMatrixSummary(data);
  }
}
/* =========================
   SIGNATORIES
========================= */
const personnel = {
  batain: { name: "Ma Loise Abbie O Batain", rank: "SGT", position: "CEIS Personnel", signature: "images/signatures/batain.png" },
  calimbas: { name: "ROLAND JAMES A CALIMBAS", rank: "CPT", position: "Assistant Director for CEIS", signature: "images/signatures/calimbas.png" },
  liwagan: { name: "MAYLENE B LIW-AGAN", rank: "MAJ", position: "Director for CEIS", signature: "images/signatures/liw-agan.png" },
  camarillo: { name: "Robert Jhon R Camarillo", rank: "SGT", position: "CEIS Personnel", signature: "images/signatures/camarillo.png" },
  bantang: { name: "Ian Gabriel B Bantang", rank: "A1C", position: "CEIS Personnel", signature: "images/signatures/bantang.png" },
  javillo: { name: "Victor D Javillo", rank: "AM", position: "CEIS Personnel", signature: "images/signatures/javillo.png" },
  bogac: { name: "Love Joy S Bog-ac", rank: "AW", position: "CEIS Personnel", signature: "images/signatures/bog-ac.png" },
  pacleb: { name: "Jayson Carl W Pacleb", rank: "AM", position: "CEIS Personnel", signature: "images/signatures/pacleb.png" },
  domingo: { name: "Joshua M Domingo", rank: "AM", position: "CEIS Personnel", signature: "images/signatures/domingo.png" },
  palomo: { name: "Alexander C Palomo", rank: "AM", position: "CEIS Personnel", signature: "images/signatures/palomo.png" }
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
  selectPrepared();
}

function selectCheckedBorrow() {
  selectChecked();
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
        key => personnel[key].name === prepared.name && personnel[key].rank === prepared.rank
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
        key => personnel[key].name === checked.name && personnel[key].rank === checked.rank
      );
      if (foundKey) checkedSelect.value = foundKey;
    }
  }
}

/* =========================
   FILTERS
========================= */

function getActiveInventoryFilters() {
  return {
    category: $("filterCategory") ? $("filterCategory").value.trim() : "",
    unit: $("filterUnit") ? $("filterUnit").value.trim() : "",
    search: $("searchInput") ? $("searchInput").value.toLowerCase().trim() : "",
    column: $("searchColumn") ? $("searchColumn").value : "all"
  };
}

function buildSearchableItem(item) {
  const parsed = parseUnitDisplay(item.unit || "");

  return {
    ...item,
    unit_only: parsed.unit,
    office: parsed.office,
    date_issued_display: formatMonthYearDisplay(item.date_issued)
  };
}

function smartTextMatch(text, search) {
  const source = String(text ?? "").toLowerCase();
  const words = search.split(/\s+/).filter(Boolean);

  return words.every(word => source.includes(word));
}

function applyInventoryFilters() {
  let { category, unit, search, column } = getActiveInventoryFilters();

  if (CURRENT_USER && CURRENT_USER.role !== "admin" && CURRENT_USER.assigned_unit) {
    unit = CURRENT_USER.assigned_unit;
  }

  const result = inventoryData.filter(item => {
    const parsed = parseUnitDisplay(item.unit || "");
    const searchableItem = buildSearchableItem(item);

    const rowText = Object.values(searchableItem)
      .map(value => String(value ?? ""))
      .join(" ")
      .toLowerCase();

    const matchCategory =
      !category || String(item.category || "") === category;

    const matchUnit =
      !unit ||
      String(parsed.unit || "").toLowerCase().includes(unit.toLowerCase()) ||
      String(parsed.office || "").toLowerCase().includes(unit.toLowerCase());

    let matchSearch = true;

    if (search) {
      if (column === "all") {
        matchSearch = smartTextMatch(rowText, search);
      } else {
        matchSearch = smartTextMatch(searchableItem[column], search);
      }
    }

    return matchCategory && matchUnit && matchSearch;
  });

  const hasActiveFilter = Boolean(category || unit || search);

  filteredData = hasActiveFilter
  ? sortInventoryAscending(result)
  : [];

currentPage = 1;

renderInventoryTable(
  hasActiveFilter
    ? filteredData
    : inventoryData
);
}

function filterInventory() {
  applyInventoryFilters();
}

function applyFilter() {
  applyInventoryFilters();
}

function resetFilter() {
  if ($("filterCategory")) $("filterCategory").value = "";
  if ($("filterUnit")) $("filterUnit").value = "";
  if ($("searchInput")) $("searchInput").value = "";
  if ($("searchColumn")) $("searchColumn").value = "all";

  filteredData = [];

currentPage = 1;

renderInventoryTable(inventoryData);
}

/* =========================
   EVENTS
========================= */
document.addEventListener("click", function (e) {

  const actionBtn = e.target.closest(".mobile-action-btn");

  if (actionBtn) {
    openActionSheet(actionBtn.getAttribute("data-id"));
    return;
  }

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

  await loadCurrentUser();

if (navigator.onLine) {
  await checkSession();
}
  applyStaffFilterLock();
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
  updatePendingSyncBadge();

  await loadInventory();

  applyStaffFilterLock();
  applyInventoryFilters();
  loadSignatories();

  syncOfflineInventoryQueue();
}

  if ($("borrowTableBody")) {
    await loadBorrows();
    loadSignatories();
  }

  if ($("dashboardTableBody") || $("statusChart")) {
    await loadDashboard();
  }

  hideLoader();
});

/* =========================
   MOBILE NAV ACTIVE
========================= */

document.addEventListener("DOMContentLoaded", () => {

  const currentPage =
    window.location.pathname.split("/").pop();

  document.querySelectorAll(".mobile-nav-item")
    .forEach(item => {

      const href = item.getAttribute("href");

      if (href === currentPage) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }

    });

});
/* =========================
   MOBILE INVENTORY EXPAND
========================= */

document.addEventListener("click", function (e) {
  const row = e.target.closest(".inventory-table tbody tr");

  if (!row) return;
  if (e.target.closest("button")) return;

  if (window.innerWidth <= 768) {
    row.classList.toggle("mobile-expanded");
  }
});
/* =========================
   MOBILE SEARCHABLE DROPDOWNS
========================= */

function initMobileSearchableDropdowns() {
  if (window.innerWidth > 768) return;

  const selects = document.querySelectorAll(
    ".filter-container select, #category, #unit, #status, #os, #windows_type, #ms_office, #antivirus"
  );

  selects.forEach(select => {
    if (select.dataset.customReady) return;

    select.dataset.customReady = "true";
    select.classList.add("mobile-native-hidden");

    const wrapper = document.createElement("div");
    wrapper.className = "mobile-custom-select";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "mobile-select-trigger";

    const menu = document.createElement("div");
    menu.className = "mobile-select-menu";

    const search = document.createElement("input");
    search.type = "text";
    search.className = "mobile-select-search";
    search.placeholder = "Search option...";

    const optionsBox = document.createElement("div");
    optionsBox.className = "mobile-select-options";

    function updateTrigger() {
      const selected = select.options[select.selectedIndex];
      trigger.textContent = selected ? selected.textContent : "Select";
    }

    function renderOptions(keyword = "") {
      const searchText = keyword.toLowerCase();

      optionsBox.innerHTML = Array.from(select.options)
        .filter(option =>
          option.textContent.toLowerCase().includes(searchText)
        )
        .map(option => `
          <div class="mobile-select-option ${option.value === select.value ? "active" : ""}"
               data-value="${option.value}">
            ${option.textContent}
          </div>
        `).join("");
    }

    trigger.addEventListener("click", () => {
      document.querySelectorAll(".mobile-custom-select.open")
        .forEach(el => {
          if (el !== wrapper) el.classList.remove("open");
        });

      wrapper.classList.toggle("open");
      search.value = "";
      renderOptions();
      setTimeout(() => search.focus(), 100);
    });

    search.addEventListener("input", () => {
      renderOptions(search.value);
    });

    optionsBox.addEventListener("click", e => {
      const option = e.target.closest(".mobile-select-option");
      if (!option) return;

      select.value = option.dataset.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));

      updateTrigger();
      renderOptions();
      wrapper.classList.remove("open");
    });

    document.addEventListener("click", e => {
      if (!wrapper.contains(e.target)) {
        wrapper.classList.remove("open");
      }
    });

    menu.appendChild(search);
    menu.appendChild(optionsBox);
    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    select.parentNode.insertBefore(wrapper, select.nextSibling);

    updateTrigger();
    renderOptions();
  });
}

document.addEventListener("DOMContentLoaded", initMobileSearchableDropdowns);

/* ========================================
   PREMIUM APP TOAST SYSTEM
======================================== */

function initToastContainer() {
  let container = document.querySelector(".toast-container");

  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  return container;
}

function showToast(type = "info", title = "Notice", message = "", duration = 3200) {
  const container = initToastContainer();

  const icons = {
    success: "✓",
    error: "!",
    warning: "⚠",
    info: "i"
  };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" type="button">×</button>
  `;

  container.appendChild(toast);

  const closeToast = () => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 280);
  };

  toast.querySelector(".toast-close").addEventListener("click", closeToast);

  setTimeout(closeToast, duration);
}

/* Shortcut functions */
function toastSuccess(message, title = "Success") {
  showToast("success", title, message);
}

function toastError(message, title = "Error") {
  showToast("error", title, message);
}

function toastWarning(message, title = "Warning") {
  showToast("warning", title, message);
}

function toastInfo(message, title = "Info") {
  showToast("info", title, message);
}
/* ========================================
   PREMIUM CONFIRM MODAL
======================================== */

function showConfirmModal({
  title = "Confirm Action",
  message = "Are you sure?",
  confirmText = "Confirm",
  onConfirm = null
}) {

  const modal = $("confirmModal");
  const titleEl = $("confirmTitle");
  const messageEl = $("confirmMessage");
  const okBtn = $("confirmOkBtn");
  const cancelBtn = $("confirmCancelBtn");

  if (!modal) return;

  titleEl.textContent = title;
  messageEl.textContent = message;
  okBtn.textContent = confirmText;

  modal.classList.add("show");

  function closeModal() {
    modal.classList.remove("show");
  }

  cancelBtn.onclick = () => {
    closeModal();
  };

  okBtn.onclick = async () => {

    closeModal();

    if (typeof onConfirm === "function") {
      await onConfirm();
    }

  };

}
/* ========================================
   PREMIUM MOBILE ACTION SHEET
======================================== */

function initActionSheet() {
  if ($("actionSheetBackdrop")) return;

  const backdrop = document.createElement("div");
  backdrop.id = "actionSheetBackdrop";
  backdrop.className = "action-sheet-backdrop";

  const sheet = document.createElement("div");
  sheet.id = "actionSheet";
  sheet.className = "action-sheet";

  sheet.innerHTML = `
    <div class="action-sheet-title">Manage Record</div>

    <button type="button" class="action-sheet-btn action-sheet-edit" id="sheetEditBtn">
      Edit Record
    </button>

    <button type="button" class="action-sheet-btn action-sheet-delete" id="sheetDeleteBtn">
      Delete Record
    </button>

    <button type="button" class="action-sheet-btn action-sheet-cancel" id="sheetCancelBtn">
      Cancel
    </button>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  backdrop.addEventListener("click", closeActionSheet);
  $("sheetCancelBtn").addEventListener("click", closeActionSheet);
}

function openActionSheet(id) {
  initActionSheet();

  const item = inventoryData.find(i => String(i.id) === String(id));

  $("sheetEditBtn").onclick = () => {
    closeActionSheet();
    if (item) openInventoryModal(item);
  };

  $("sheetDeleteBtn").onclick = () => {
    closeActionSheet();
    deleteInventory(id);
  };

  $("actionSheetBackdrop").classList.add("show");
  $("actionSheet").classList.add("show");
}

function closeActionSheet() {
  const backdrop = $("actionSheetBackdrop");
  const sheet = $("actionSheet");

  if (backdrop) backdrop.classList.remove("show");
  if (sheet) sheet.classList.remove("show");
}
document.addEventListener("keydown", function (e) {
  if (e.target.id === "pageJumpInput" && e.key === "Enter") {
    jumpToPage();
  }
});


/* ========================================
   AUTO MOBILE PWA PROFILE MENU + LOGOUT
======================================== */

function injectMobileProfileMenu() {
  if (document.querySelector(".mobile-profile-menu")) return;
  if (location.pathname.includes("login.html")) return;

  const menu = document.createElement("div");
  menu.className = "mobile-profile-menu";
  menu.innerHTML = `
    <button class="mobile-profile-btn" onclick="toggleMobileProfileMenu()">
      <span class="profile-avatar">👤</span>
      <span class="profile-text">
        <b id="mobileProfileName">Account</b>
        <small id="mobileProfileRole">User</small>
      </span>
      <span class="profile-arrow">⌄</span>
    </button>

    <div class="mobile-profile-dropdown" id="mobileProfileDropdown">
      <div class="profile-dropdown-header">
        <div class="profile-avatar big">👤</div>
        <div>
          <b id="mobileDropdownName">Account</b>
          <small id="mobileDropdownRole">User</small>
        </div>
      </div>

      <button onclick="location.href='settings.html'">⚙️ Settings</button>
      <button class="logout-btn" onclick="logoutUser()">🚪 Logout</button>
    </div>
  `;

  document.body.appendChild(menu);
}

function toggleMobileProfileMenu() {
  const menu = document.getElementById("mobileProfileDropdown");
  if (!menu) return;

  menu.classList.toggle("show");
  document.body.classList.toggle("profile-menu-open", menu.classList.contains("show"));
}

document.addEventListener("click", function (e) {
  const wrapper = document.querySelector(".mobile-profile-menu");
  const menu = document.getElementById("mobileProfileDropdown");

  if (!wrapper || !menu) return;

  if (!wrapper.contains(e.target)) {
    menu.classList.remove("show");
    document.body.classList.remove("profile-menu-open");
  }
});

async function loadMobileProfile() {
  try {
    const res = await fetch("/api/me", { credentials: "include" });
    if (!res.ok) return;

    const data = await res.json();
    const user = data.user || data;

    const name = user.full_name || user.username || "Account";
    const role = user.role || "user";

    [
      ["mobileProfileName", name],
      ["mobileDropdownName", name],
      ["mobileProfileRole", role],
      ["mobileDropdownRole", role]
    ].forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
  } catch (err) {
    console.warn("Profile load skipped:", err);
  }
}

async function logoutUser() {
  if (!confirm("Logout from ICT Inventory System?")) return;

  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include"
    });
  } catch (err) {
    console.warn("Logout request failed:", err);
  }

  sessionStorage.clear();
  window.location.href = "/login.html";
}

document.addEventListener("DOMContentLoaded", function () {
  injectMobileProfileMenu();
  loadMobileProfile();
});

function createSyncBadgeUI() {
  if (document.getElementById("syncBadge")) return;

  const badge = document.createElement("div");
  badge.id = "syncBadge";
  badge.className = "sync-badge hidden";
  badge.innerHTML = `
    <span class="sync-dot"></span>
    <span id="syncBadgeText">0 pending</span>
  `;

  document.body.appendChild(badge);
  updatePendingSyncBadge();
}

function updatePendingSyncBadge() {

  const badge =
    document.getElementById("syncBadge");

  const text =
    document.getElementById("syncBadgeText");

  if (!badge || !text) return;

  const count = getPendingCount();

  console.log("PENDING COUNT:", count);

  if (count > 0) {

    badge.classList.remove("hidden");

    text.textContent =
      `${count} pending`;

  } else {

    badge.classList.add("hidden");

    text.textContent = "Synced";

  }
}
function showSyncToast(message, type = "info") {
  const oldToast = document.querySelector(".sync-toast");
  if (oldToast) oldToast.remove();

  const toast = document.createElement("div");
  toast.className = `sync-toast ${type}`;
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("show");
  }, 50);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
async function syncOfflineQueue() {
  let queue = getOfflineQueue();

  if (!navigator.onLine || queue.length === 0) return;

  showSyncToast("Syncing pending changes...", "syncing");

  const remainingQueue = [];

  for (const item of queue) {
    try {
      const options = {
        method: item.method,
        headers: {
          "Content-Type": "application/json"
        }
      };

      if (item.body) {
        options.body = JSON.stringify(item.body);
      }

      const res = await fetch(item.url, options);

      if (res.status === 409) {
        remainingQueue.push(item);
        showSyncToast("Conflict detected. Please review changes.", "conflict");
        continue;
      }

      if (!res.ok) {
        remainingQueue.push(item);
        continue;
      }

    } catch (err) {
      remainingQueue.push(item);
    }
  }

  saveOfflineQueue(remainingQueue);

  if (remainingQueue.length === 0) {
    showSyncToast("All pending changes synced.", "success");

    if (typeof loadInventory === "function") {
      loadInventory();
    }
  } else {
    showSyncToast(`${remainingQueue.length} change(s) still pending.`, "pending");
  }
}
document.addEventListener("DOMContentLoaded", () => {
  createSyncBadgeUI();
  updatePendingSyncBadge();

  if (navigator.onLine) {
    syncOfflineQueue();
  }
});

window.addEventListener("online", () => {
  showSyncToast("Back online. Auto-sync started.", "syncing");
  syncOfflineQueue();
});

window.addEventListener("offline", () => {
  showSyncToast("Offline mode enabled.", "pending");
});