import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Share, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { isIosBrowser, isStandalone } from "@/lib/pwa";
import { requestPersistentStorage } from "@/lib/storage";

const SNOOZE_KEY = "aurum:storage-card-snoozed-until";
const SNOOZE_MS = 7 * 86_400_000;

/**
 * Warns when the library could be wiped by the browser.
 *
 * Safari deletes a website's saved data after about a week of browsing
 * without visiting it, unless the site is on the Home Screen. Other browsers
 * may evict data under storage pressure unless persistent storage is granted.
 */
export function StorageSafetyCard() {
  const [mode, setMode] = useState<"ios" | "persist" | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now()) return;
    } catch {
      /* storage unavailable */
    }
    if (isIosBrowser()) {
      setMode("ios");
      return;
    }
    void navigator.storage
      ?.persisted?.()
      .then((ok) => {
        if (!ok) setMode("persist");
      })
      .catch(() => undefined);
  }, []);

  if (!mode) return null;

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      /* ignore */
    }
    setMode(null);
  };

  return (
    <section
      aria-label="Keep your books safe"
      className="relative mt-5 rounded-2xl border border-gold/35 bg-gold/[0.06] p-4"
    >
      <button
        type="button"
        onClick={snooze}
        aria-label="Remind me later"
        className="absolute right-3 top-3 text-muted-foreground"
      >
        <X className="size-4" />
      </button>
      <div className="flex gap-3 pr-6">
        <div className="mt-0.5 h-fit shrink-0 self-start rounded-full border border-gold/40 p-2 text-gold">
          <ShieldCheck className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="font-display text-lg leading-tight text-ivory">
            Keep your books safe
          </p>
          {mode === "ios" ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Safari can delete this site&apos;s saved books and notes if you
              don&apos;t visit for about a week. Add Aurum to your Home Screen
              to keep them: tap{" "}
              <Share className="inline size-3.5 align-[-2px] text-gold" />{" "}
              <span className="text-ivory">Share</span>, then{" "}
              <span className="text-ivory">Add to Home Screen</span>, and open
              Aurum from there. The Home Screen app keeps its own library, so
              first save a{" "}
              <Link
                to="/settings"
                search={{ tab: "sync" }}
                className="text-gold underline"
              >
                full backup
              </Link>{" "}
              here and restore it in the app.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Your browser may clear saved data when the device is low on
                space. Ask it to keep your library, or install Aurum from the
                browser menu.
              </p>
              <button
                type="button"
                onClick={async () => {
                  const ok = await requestPersistentStorage();
                  if (ok) {
                    toast.success("Your library is protected");
                    setMode(null);
                  } else {
                    toast.info(
                      "Your browser declined — installing Aurum usually fixes this",
                    );
                  }
                }}
                className="mt-3 rounded-full bg-gradient-gold px-4 py-1.5 text-xs uppercase tracking-[0.16em] text-primary-foreground"
              >
                Keep my library
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
