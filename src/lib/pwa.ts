const SW_URL = "/sw.js";

type UpdateListener = () => void;
const updateListeners = new Set<UpdateListener>();
let waitingWorker: ServiceWorker | null = null;
let reloading = false;

/** Subscribe to "a new version is installed and waiting" events. */
export function onSwUpdateAvailable(fn: UpdateListener): () => void {
  updateListeners.add(fn);
  if (waitingWorker) fn();
  return () => updateListeners.delete(fn);
}

function signalUpdate() {
  for (const fn of updateListeners) fn();
}

/** Activate the waiting worker; the page reloads itself once it takes over. */
export function applySwUpdate() {
  waitingWorker?.postMessage({ type: "SKIP_WAITING" });
}

async function unregisterAppWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    regs
      .filter((r) =>
        (r.active?.scriptURL ?? r.installing?.scriptURL ?? "").endsWith(SW_URL),
      )
      .map((r) => r.unregister()),
  );
}

function watchRegistration(reg: ServiceWorkerRegistration) {
  if (reg.waiting && navigator.serviceWorker.controller) {
    waitingWorker = reg.waiting;
    signalUpdate();
  }
  reg.addEventListener("updatefound", () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // "installed" alongside an existing controller means this is an update,
      // not the first install — it sits waiting until the user accepts it.
      if (
        installing.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        waitingWorker = reg.waiting ?? installing;
        signalUpdate();
      }
    });
  });
}

/** Registers the offline app-shell worker only in the real published app. */
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  // `?sw=off` is the escape hatch for debugging a bad cached build; any other
  // value (including `?sw=on`) must leave the worker enabled.
  const refused =
    !import.meta.env.PROD ||
    window.self !== window.top ||
    new URLSearchParams(window.location.search).get("sw") === "off";

  if (refused) {
    void unregisterAppWorkers();
    return;
  }

  // When the waiting worker activates at the user's request, reload once so
  // the new build is what they actually see.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !waitingWorker) return;
    reloading = true;
    window.location.reload();
  });

  void navigator.serviceWorker
    .register(SW_URL, { scope: "/" })
    .then((reg) => {
      watchRegistration(reg);
      // Long-lived home-screen installs can sit open for days: check for a
      // new build hourly and whenever the app returns to the foreground.
      window.setInterval(
        () => void reg.update().catch(() => {}),
        60 * 60 * 1000,
      );
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible")
          void reg.update().catch(() => {});
      });
    })
    .catch(() => {
      /* offline support is best-effort */
    });
}
