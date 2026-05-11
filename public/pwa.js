let newWorker = null;

function showUpdateToast() {
  if (document.querySelector(".update-toast")) return;

  const toast = document.createElement("div");
  toast.className = "update-toast";
  toast.innerHTML = `
    <div class="update-toast-icon">⬆️</div>
    <div class="update-toast-text">
      <strong>Update Available</strong>
      <span>New version is ready.</span>
    </div>
    <button id="tapUpdateBtn">Tap to Update</button>
  `;

  document.body.appendChild(toast);

  document.getElementById("tapUpdateBtn").addEventListener("click", () => {
    if (newWorker) {
      newWorker.postMessage({ type: "SKIP_WAITING" });
    }
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const registration = await navigator.serviceWorker.register("/service-worker.js");

    registration.addEventListener("updatefound", () => {
      newWorker = registration.installing;

      newWorker.addEventListener("statechange", () => {
        if (
          newWorker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          showUpdateToast();
        }
      });
    });
  });

  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}