/**
 * Problem reports without tracking. Errors are kept on this device only (the
 * last 50, in localStorage), together with iOS crash reports in the app. The
 * reader can share a report from Settings when something goes wrong; nothing
 * is ever sent automatically.
 */
import { callNative, isNativeApp } from "./native";

export type LoggedError = {
  at: number;
  message: string;
  stack?: string;
  where: string;
};

const KEY = "aurum.errors";
const MAX = 50;

export function readErrors(): LoggedError[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as LoggedError[];
  } catch {
    return [];
  }
}

/** Adds an error to the on-device log, skipping repeats of the last one. */
export function logError(message: string, stack?: string) {
  try {
    const list = readErrors();
    const last = list[list.length - 1];
    if (last && last.message === message && Date.now() - last.at < 5000) return;
    const entry: LoggedError = {
      at: Date.now(),
      message: message.slice(0, 500),
      where: location.pathname.replace(/\/read\/[^/]+/, "/read/…"),
    };
    if (stack) entry.stack = stack.slice(0, 2000);
    list.push(entry);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* storage full or unavailable: nothing to do */
  }
}

export function clearErrors() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  if (isNativeApp()) void callNative("clearDiagnostics");
}

let installed = false;
/** Starts recording uncaught errors. Call once at startup. */
export function installErrorLog() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    const err = e.error as Error | undefined;
    logError(err?.message || e.message || "Unknown error", err?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as unknown;
    if (reason instanceof Error) logError(reason.message, reason.stack);
    else logError(String(reason));
  });
}

/** Everything a report contains, as readable JSON text. No book contents. */
export async function buildReport(): Promise<string> {
  const native = isNativeApp()
    ? ((await callNative<string[]>("diagnostics")) ?? [])
    : [];
  return JSON.stringify(
    {
      app: "Aurum",
      createdAt: new Date().toISOString(),
      platform: isNativeApp() ? "iOS app" : "web",
      userAgent: navigator.userAgent,
      screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
      errors: readErrors(),
      iosCrashReports: native.map((text) => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      }),
    },
    null,
    2,
  );
}
