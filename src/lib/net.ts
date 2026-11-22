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

export type FetchKind = "catalog" | "book" | "sync";

/**
 * Plain-language explanation for a failed request, with what to do next,
 * instead of a bare status code.
 */
export function friendlyHttpError(
  status: number,
  options: { kind: FetchKind; viaRelay?: boolean; signedIn?: boolean },
): string {
  const { kind, viaRelay = false, signedIn = false } = options;
  const thing =
    kind === "catalog" ? "catalog" : kind === "book" ? "book" : "sync server";
  if (status === 401 || (status === 403 && signedIn))
    return signedIn
      ? `The ${thing} didn't accept that username or password.`
      : `This ${thing} needs you to sign in. Add your username and password.`;
  if (status === 403 || status === 429 || status === 503 || status === 502)
    return viaRelay
      ? `This site blocks downloads through Aurum. Some libraries refuse requests from cloud servers, which is how Aurum reaches sites that don't allow web apps. Open the site in your browser, download the book there, then import it with Add books.`
      : `This site is refusing requests right now. Try again later, or download the book in your browser and import it with Add books.`;
  if (status === 404 || status === 410)
    return `Nothing was found at that address. Check the link — it may have moved.`;
  if (status === 415)
    return kind === "catalog"
      ? `That address is a web page, not a book catalog. Catalog addresses usually end in /opds, .opds or .atom — look for "OPDS" on the site's help page.`
      : `That link isn't a book file Aurum can open (EPUB, PDF, CBZ or TXT).`;
  if (status === 413) return `That file is too large to download.`;
  if (status >= 500)
    return `The site is having trouble right now. Try again in a little while.`;
  return `The ${thing} couldn't be loaded (error ${status}).`;
}
