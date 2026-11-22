/**
 * Fetching files from other sites.
 *
 * Aurum asks the site directly first. Most book sites and OPDS catalogs don't
 * send CORS headers, so the browser blocks that request; in that case the
 * request is retried through the app's own relay (`/api/fetch`, a Cloudflare
 * Pages Function), which fetches the file and hands it back from Aurum's origin.
 */

export const RELAY_PATH = "/api/fetch";

export type ExternalResponse = {
  response: Response;
  /** URL the content really came from (after redirects); use it for relative links. */
  finalUrl: string;
  viaRelay: boolean;
};

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export function relayUrl(url: string) {
  return `${RELAY_PATH}?url=${encodeURIComponent(url)}`;
}

export function basicAuth(username: string, password: string) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return `Basic ${btoa(s)}`;
}

export type ExternalInit = {
  accept?: string;
  authorization?: string;
  method?: "GET" | "PUT";
  body?: BodyInit;
  /** Extra headers, e.g. If-Match for safe WebDAV writes. */
  headers?: Record<string, string>;
};

export async function fetchExternal(
  url: string,
  init: ExternalInit = {},
): Promise<ExternalResponse> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { ...init.headers };
  if (init.accept) headers["accept"] = init.accept;
  // Credentialed requests and writes need a CORS preflight most servers fail,
  // so those go straight to the relay.
  if (!init.authorization && method === "GET") {
    try {
      const response = await fetch(url, { headers, cache: "no-store" });
      return { response, finalUrl: response.url || url, viaRelay: false };
    } catch {
      /* blocked by CORS or unreachable: try the relay */
    }
  }
  if (init.authorization) headers["authorization"] = init.authorization;
  let response: Response;
  try {
    response = await fetch(relayUrl(url), {
      method,
      headers,
      cache: "no-store",
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
  } catch {
    throw new NetworkError(
      typeof navigator !== "undefined" && navigator.onLine === false
        ? "You're offline. Connect to the internet and try again."
        : "That site couldn't be reached. Check the link and try again.",
    );
  }
  // No relay (local dev server, or a host without Pages Functions).
  if (response.status === 404 && !response.headers.get("x-final-url")) {
    throw new NetworkError(
      "That site wouldn't hand the file to Aurum. Open the link in your browser, download the book there, then import the file from your device.",
    );
  }
  return {
    response,
    finalUrl: response.headers.get("x-final-url") || url,
    viaRelay: true,
  };
}
