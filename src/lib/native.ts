/**
 * Talks to the iOS app around the web app (ios/Aurum/NativeBridge.swift).
 * In a normal browser every call is a no-op, so features can call these
 * freely and fall back to the web version.
 */

export type NativeCapabilities = {
  haptics?: boolean;
  dictionary?: boolean;
  speech?: boolean;
  widgets?: boolean;
  spotlight?: boolean;
  icloud?: boolean;
  ai?: boolean;
  translate?: boolean;
  hinge?: boolean;
  platform?: string;
};

export type NativeEvent =
  | { type: "openFiles"; files: { id: string; name: string; url: string }[] }
  | { type: "continueReading" }
  | { type: "openBook"; id: string; annotationId?: string }
  | { type: "navigate"; to: string }
  | {
      type: "hinge";
      status: "closed" | "partiallyOpen" | "fullyOpen" | "unknown" | "none";
      angle: number;
    }
  | {
      type: "speech";
      kind: "start" | "word" | "drained" | "paused" | "resumed" | "stopped";
      id?: number;
      start?: number;
      length?: number;
    };

type Handler = { postMessage: (message: unknown) => Promise<unknown> };

function handler(): Handler | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    webkit?: { messageHandlers?: { aurum?: Handler } };
  };
  return w.webkit?.messageHandlers?.aurum ?? null;
}

/** True inside the iOS app. */
export function isNativeApp() {
  return handler() !== null;
}

/** Calls the app; resolves null in a browser or if the app reports an error. */
export async function callNative<T = unknown>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T | null> {
  const h = handler();
  if (!h) return null;
  try {
    return (await h.postMessage({ ...body, action })) as T;
  } catch (error) {
    console.warn(`Native ${action} failed`, error);
    return null;
  }
}

/** Like callNative, but rejects with the app's error message. */
export async function callNativeStrict<T = unknown>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const h = handler();
  if (!h) throw new Error("Only available in the Aurum app");
  return (await h.postMessage({ ...body, action })) as T;
}

const listeners = new Set<(event: NativeEvent) => void>();
let capabilities: NativeCapabilities = {};
let readyPromise: Promise<NativeCapabilities> | null = null;

/**
 * Starts receiving events from the app and tells it the page is ready (it
 * holds events until then). Safe to call more than once.
 */
export function connectNative(): Promise<NativeCapabilities> {
  if (readyPromise) return readyPromise;
  if (!handler()) return (readyPromise = Promise.resolve({}));
  (
    window as unknown as {
      __aurumNative?: { receive: (e: NativeEvent) => void };
    }
  ).__aurumNative = {
    receive: (event) => {
      if (event.type === "hinge") lastHinge = event;
      for (const fn of listeners) {
        try {
          fn(event);
        } catch (error) {
          console.error(error);
        }
      }
    },
  };
  readyPromise = callNative<NativeCapabilities>("ready").then((c) => {
    capabilities = c ?? {};
    return capabilities;
  });
  return readyPromise;
}

export function nativeCapabilities(): NativeCapabilities {
  return capabilities;
}

/** True when the app offers a capability (after connectNative resolved). */
export function hasNative(cap: keyof NativeCapabilities) {
  return isNativeApp() && Boolean(capabilities[cap]);
}

let lastHinge: Extract<NativeEvent, { type: "hinge" }> | null = null;
/** The iPhone Duo's latest hinge report, if any. */
export function currentHinge() {
  return lastHinge;
}

export function onNativeEvent(fn: (event: NativeEvent) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A soft tap from the iPhone's Taptic Engine (a page turn, by default). */
export function haptic(
  style: "light" | "medium" | "selection" | "success" = "light",
) {
  if (!isNativeApp()) return;
  void callNative("haptic", { style });
}
