let deferredPrompt;

document.addEventListener("DOMContentLoaded", () => {
  registerServiceWorker();
  createPwaInstallPopup();
  createOfflineBanner();
  createPwaSplash();
  listenOnlineStatus();
  checkForAppUpdates();
});

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js")
      .then(reg => {
        console.log("PWA service worker ready");

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateToast();
            }
          });
        });
      })
      .catch(err => console.log("Service worker error:", err));
  }
}

function createPwaInstallPopup() {
  const box = document.createElement("div");
  box.id = "pwaInstallBox";
  box.innerHTML = `
    <div class="pwa-install-card">
      <div class="pwa-install-icon">📱</div>
      <div>
        <strong>Install ICT Inventory</strong>
        <p>Use this system like a real mobile app.</p>
      </div>
      <button id="pwaInstallBtn">Install</button>
      <button id="pwaCloseBtn">×</button>
    </div>
  `;
  document.body.appendChild(box);

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredPrompt = e;
    box.classList.add("show");
  });

  document.getElementById("pwaInstallBtn").onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    box.classList.remove("show");
  };

  document.getElementById("pwaCloseBtn").onclick = () => {
    box.classList.remove("show");
  };
}

function createOfflineBanner() {
  const banner = document.createElement("div");
  banner.id = "offlineBanner";
  banner.textContent = "Offline Mode — saved pages are still available";
  document.body.appendChild(banner);
}

function listenOnlineStatus() {
  const banner = document.getElementById("offlineBanner");

  function updateStatus() {
    if (!navigator.onLine) {
      banner.classList.add("show");
    } else {
      banner.classList.remove("show");
    }
  }

  window.addEventListener("online", updateStatus);
  window.addEventListener("offline", updateStatus);
  updateStatus();
}

function createPwaSplash() {
  const splash = document.createElement("div");
  splash.id = "pwaSplash";
  splash.innerHTML = `
    <div class="pwa-splash-logo">ICT</div>
    <div class="pwa-splash-title">ICT Inventory System</div>
    <div class="pwa-splash-sub">Loading secure workspace...</div>
  `;
  document.body.appendChild(splash);

  setTimeout(() => {
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 450);
  }, 700);
}

function checkForAppUpdates() {
  if (!("serviceWorker" in navigator)) return;

  setInterval(() => {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg) reg.update();
    });
  }, 1000 * 60 * 10);
}

function showUpdateToast() {
  const toast = document.createElement("div");
  toast.className = "pwa-update-toast";
  toast.innerHTML = `
    <span>New app update available</span>
    <button onclick="location.reload()">Refresh</button>
  `;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 100);
}