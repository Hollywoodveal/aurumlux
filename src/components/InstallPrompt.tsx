import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<unknown> };

const DISMISS_KEY = "aurum:install-dismissed";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/** Home-screen install invitation. Uses the native prompt when the browser offers one. */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<PromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY) === "1") return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as PromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const ua = window.navigator.userAgent;
    const iosSafari = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua);
    const timer = window.setTimeout(() => {
      if (iosSafari) {
        setIosHint(true);
        setShow(true);
      }
    }, 2500);

    const onInstalled = () => setShow(false);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(timer);
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  return (
    <div className="fixed inset-x-3 z-40 bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] mx-auto max-w-md rounded-2xl border border-gold/30 bg-card/95 p-4 shadow-lux backdrop-blur">
      <div className="flex items-start gap-3">
        <div className="rounded-full border border-gold/30 p-2 text-gold">
          {iosHint ? <Share className="size-4" /> : <Download className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-tight text-ivory">Install Aurum</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {iosHint
              ? "Tap Share, then “Add to Home Screen” to read full screen and offline."
              : "Add Aurum to your home screen for full-screen, offline reading."}
          </p>
          {!iosHint ? (
            <button
              type="button"
              onClick={async () => {
                if (!deferred) return;
                await deferred.prompt();
                setShow(false);
              }}
              className="mt-3 rounded-full bg-gradient-gold px-4 py-1.5 text-xs uppercase tracking-[0.16em] text-primary-foreground"
            >
              Install
            </button>
          ) : null}
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss install prompt">
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
