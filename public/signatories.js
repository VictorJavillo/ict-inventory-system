/* ==========================================
   SIGNATORIES MANAGEMENT
========================================== */

let signatories = [];
let currentPhotoUrl = null;
let currentSignatureUrl = null;
/* ===============================
   UPLOAD FILE TO SUPABASE
================================ */

async function uploadSignatoryFile(file, folder) {

    if (!file) return null;

    const formData = new FormData();

    formData.append("file", file);
    formData.append("folder", folder);

    const res = await fetch("/api/upload/signatory", {

        method: "POST",

        credentials: "include",

        body: formData

    });

    const data = await res.json();

    if (!res.ok) {

        throw new Error(data.error || "Upload failed.");

    }

    return data.url;

}

/* ELEMENTS */

const tableBody = document.getElementById("signatoriesTableBody");

const statusBox = document.getElementById("signatoriesStatus");

const searchBox = document.getElementById("signatorySearch");

const roleFilter = document.getElementById("roleFilter");

const refreshBtn = document.getElementById("refreshBtn");

/* ===============================
   STATUS
================================ */

function showStatus(message, type = "info") {

    statusBox.textContent = message;

    statusBox.className = `users-status-box ${type}`;

    statusBox.style.display = "block";

}

function hideStatus(){

    statusBox.style.display = "none";

}

/* ===============================
   LOAD
================================ */

async function loadSignatories(){

    showStatus("Loading signatories...");

    try{

        const res = await fetch("/api/signatories",{

            credentials:"include",

            cache:"no-store"

        });

        const data = await res.json();

        if(!res.ok){

            throw new Error(data.error || "Failed to load signatories");

        }

        signatories = data;

        renderSignatories(signatories);

        updateStatistics();

        hideStatus();

    }catch(err){

        console.error(err);

        showStatus(err.message,"error");

    }

}
/* ===============================
   RENDER TABLE
================================ */

function renderSignatories(data) {

    if (!data.length) {

        tableBody.innerHTML = `
            <tr>
                <td colspan="9">
                    <div style="padding:40px;text-align:center;color:#9aa4b2;">
                        No signatories found.
                    </div>
                </td>
            </tr>
        `;

        document.getElementById("signatoriesFooter").textContent =
            "Showing 0 signatories";

        return;
    }

    tableBody.innerHTML = data.map((row, index) => `

        <tr>

            <td>

                <img
                    src="${row.photo_url || 'images/default-avatar.png'}"
                    style="
                        width:50px;
                        height:50px;
                        border-radius:50%;
                        object-fit:cover;
                    ">

            </td>

            <td>

                ${
                    row.signature_url
                    ? `<img src="${row.signature_url}"
                        style="
                            width:110px;
                            height:45px;
                            object-fit:contain;
                        ">`
                    : "—"
                }

            </td>

            <td>${row.fullname}</td>

            <td>${row.rank || "—"}</td>

            <td>${row.position || "—"}</td>

            <td>${row.office || "—"}</td>

            <td>

                <span class="role-badge">

                    ${row.role}

                </span>

            </td>

            <td>

                <span class="
                    status-badge
                    ${row.active ? "status-active" : "status-inactive"}
                ">

                    <span class="status-dot"></span>

                    ${row.active ? "ACTIVE" : "INACTIVE"}

                </span>

            </td>

            <td>

                <button
                    class="btn-primary btn-sm"
                    onclick="editSignatory(${row.id})">

                    Edit

                </button>

                <button
                    class="btn-danger-sm"
                    onclick="deleteSignatory(${row.id})">

                    Delete

                </button>

            </td>

        </tr>

    `).join("");

    document.getElementById("signatoriesFooter").textContent =
        `Showing ${data.length} signator${data.length > 1 ? "ies" : "y"}`;

}

/* ===============================
   DASHBOARD CARDS
================================ */

function updateStatistics(){

    document.getElementById("totalSignatories").textContent =
        signatories.length;

    document.getElementById("activeSignatories").textContent =
        signatories.filter(s => s.active).length;

    document.getElementById("preparedCount").textContent =
        signatories.filter(s => s.role === "Prepared By").length;

    document.getElementById("checkedCount").textContent =
        signatories.filter(s => s.role === "Checked By").length;

}

/* ===============================
   SEARCH
================================ */

function filterSignatories(){

    const keyword = searchBox.value.toLowerCase();

    const role = roleFilter.value;

    const filtered = signatories.filter(item=>{

        const text = [

            item.fullname,

            item.rank,

            item.position,

            item.office,

            item.role

        ].join(" ").toLowerCase();

        const keywordMatch =
            !keyword || text.includes(keyword);

        const roleMatch =
            role === "all" || item.role === role;

        return keywordMatch && roleMatch;

    });

    renderSignatories(filtered);

}

/* ===============================
   EVENTS
================================ */

searchBox.addEventListener("input",filterSignatories);

roleFilter.addEventListener("change",filterSignatories);

refreshBtn.addEventListener("click",loadSignatories);

/* ===============================
   START
================================ */

loadSignatories();
/* ===============================
   SAVE SIGNATORY
================================ */

const signatoryForm = document.getElementById("signatoryForm");

signatoryForm.addEventListener("submit", async (e) => {

    e.preventDefault();

   const photoFile =
    document.getElementById("photoFile").files[0];

const signatureFile =
    document.getElementById("signatureFile").files[0];

const photo_url = photoFile
    ? await uploadSignatoryFile(photoFile, "photos")
    : currentPhotoUrl;

const signature_url = signatureFile
    ? await uploadSignatoryFile(signatureFile, "signatures")
    : currentSignatureUrl;

const payload = {

    fullname: document.getElementById("fullname").value.trim(),

    rank: document.getElementById("rank").value.trim(),

    position: document.getElementById("position").value.trim(),

    office: document.getElementById("office").value.trim(),

    role: document.getElementById("role").value,

    active: document.getElementById("active").value === "true",

    photo_url,

    signature_url

};

    try {

        const signatoryId = document.getElementById("signatoryId").value;

const url = signatoryId
    ? `/api/signatories/${signatoryId}`
    : "/api/signatories";

const method = signatoryId
    ? "PUT"
    : "POST";

const res = await fetch(url, {
    method,
    headers: {
        "Content-Type": "application/json"
    },
    credentials: "include",
    body: JSON.stringify(payload)
});

        const data = await res.json();

        if (!res.ok) {

            throw new Error(data.error || "Failed to save signatory");

        }

        alert("Signatory saved successfully.");

        closeSignatoryModal();

        loadSignatories();

    } catch (err) {

        alert(err.message);

    }

});
function openAddSignatoryModal() {

    currentPhotoUrl = null;
    currentSignatureUrl = null;

    document.getElementById("modalTitle").textContent =
        "Add Signatory";

    document.getElementById("signatoryForm").reset();

    document.getElementById("signatoryId").value = "";

    document.getElementById("photoPreview").src =
        "images/default-avatar.png";

    document.getElementById("signaturePreview").src =
        "images/signature-placeholder.png";

    document.getElementById("signatoryModal").style.display =
        "flex";

}

function closeSignatoryModal() {

    document.getElementById("signatoryModal").style.display =
        "none";

}
/* ===============================
   EDIT SIGNATORY
================================ */

function editSignatory(id) {

    const row = signatories.find(s => s.id == id);
    

    if (!row) return;
    currentPhotoUrl = row.photo_url || null;
    currentSignatureUrl = row.signature_url || null;
document.getElementById("photoPreview").src =
    currentPhotoUrl || "images/default-avatar.png";

document.getElementById("signaturePreview").src =
    currentSignatureUrl || "images/signature-placeholder.png";

    document.getElementById("modalTitle").textContent = "Edit Signatory";

    document.getElementById("signatoryId").value = row.id;

    document.getElementById("fullname").value = row.fullname || "";

    document.getElementById("rank").value = row.rank || "";

    document.getElementById("position").value = row.position || "";

    document.getElementById("office").value = row.office || "";

    document.getElementById("role").value = row.role || "Prepared By";

    document.getElementById("active").value =
        row.active ? "true" : "false";

    document.getElementById("photoPreview").src =
        row.photo_url || "images/default-avatar.png";

    document.getElementById("signaturePreview").src =
        row.signature_url || "";

    document.getElementById("signatoryModal").style.display = "flex";

}
/* ===============================
   DELETE SIGNATORY
================================ */

async function deleteSignatory(id) {

    const row = signatories.find(s => s.id == id);

    if (!row) return;

    const ok = confirm(
        `Delete signatory "${row.fullname}"?`
    );

    if (!ok) return;

    try {

        const res = await fetch(`/api/signatories/${id}`, {

            method: "DELETE",

            credentials: "include"

        });

        const data = await res.json();

        if (!res.ok) {

            throw new Error(
                data.error || "Failed to delete signatory."
            );

        }

        alert("Signatory deleted successfully.");

        loadSignatories();

    } catch (err) {

        alert(err.message);

    }

}
/* ===============================
   PHOTO PREVIEW
================================ */

const photoFile = document.getElementById("photoFile");

if (photoFile) {

    photoFile.addEventListener("change", e => {

        const file = e.target.files[0];

        if (!file) return;

        document.getElementById("photoPreview").src =
            URL.createObjectURL(file);

    });

}

/* ===============================
   SIGNATURE PREVIEW
================================ */

const signatureFile = document.getElementById("signatureFile");

if (signatureFile) {

    signatureFile.addEventListener("change", e => {

        const file = e.target.files[0];

        if (!file) return;

        document.getElementById("signaturePreview").src =
            URL.createObjectURL(file);

    });

}
