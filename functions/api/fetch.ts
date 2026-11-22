/**
 * Same-origin fetch relay (Cloudflare Pages Function, served at /api/fetch).
 *
 * Browsers only let Aurum read a file from another site when that site sends
 * CORS headers, and most book sites and OPDS catalogs don't. When a direct
 * download fails, the app retries through this relay, which fetches the file
 * from Cloudflare's edge and hands it back from Aurum's own origin.
 *
 * It also carries WebDAV reads and writes for optional sync (GET/PUT of the
 * encrypted sync file), since most WebDAV servers don't send CORS headers.
 *
 * It's deliberately narrow: only requests from pages on this site, only
 * book / catalog / image / sync-file content, size limits, and nothing is
 * logged or stored.
 */

type Context = { request: Request };

const ALLOWED_TYPES =
  /^(application\/(epub\+zip|pdf|zip|x-zip-compressed|vnd\.comicbook\+zip|x-cbz|octet-stream|atom\+xml|xml|opds\+json|json|opensearchdescription\+xml|xhtml\+xml)|text\/(plain|xml)|image\/)/i;
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function fail(status: number, message: string) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Only pages on this site may use the relay. */
function fromThisSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  // Browsers without Fetch Metadata: fall back to the Referer (the app sends
  // it to its own origin only; see Referrer-Policy in _headers).
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function targetUrl(request: Request): URL | Response {
  const target = new URL(request.url).searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return fail(400, "Missing or invalid url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return fail(400, "Only http(s) links can be fetched");
  return url;
}

/** Write the encrypted sync file to the reader's WebDAV folder. */
export async function onRequestPut({ request }: Context): Promise<Response> {
  if (!fromThisSite(request)) return fail(403, "Not allowed");
  const url = targetUrl(request);
  if (url instanceof Response) return url;
  if (!url.pathname.endsWith(".aurum"))
    return fail(400, "Only Aurum sync files can be written");
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_UPLOAD_BYTES)
    return fail(413, "Sync file too large");

  const headers = new Headers({
    "user-agent": "Aurum/1.0 (+https://aurumlux.pages.dev)",
    "content-type": "application/octet-stream",
  });
  for (const name of ["authorization", "if-match", "if-none-match"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), { method: "PUT", headers, body });
  } catch {
    return fail(502, "The sync server couldn't be reached");
  }
  const out = new Headers({
    "cache-control": "no-store",
    "x-final-url": upstream.url || url.toString(),
  });
  const etag = upstream.headers.get("etag");
  if (etag) out.set("etag", etag);
  return new Response(null, { status: upstream.status, headers: out });
}

export async function onRequestGet({ request }: Context): Promise<Response> {
  // Anything not from our own pages is refused, so the relay can't be used as
  // an open proxy by other sites.
  if (!fromThisSite(request)) return fail(403, "Not allowed");
  const url = targetUrl(request);
  if (url instanceof Response) return url;

  const headers = new Headers({
    "user-agent": "Aurum/1.0 (+https://aurumlux.pages.dev)",
    accept: request.headers.get("accept") ?? "*/*",
  });
  for (const name of ["authorization", "if-none-match"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), { headers, redirect: "follow" });
  } catch {
    return fail(502, "That site couldn't be reached");
  }

  const type =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  if (upstream.ok && !ALLOWED_TYPES.test(type))
    return fail(415, "That link isn't a book, catalog or image");
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return fail(413, "That file is too large");

  const out = new Headers({
    "content-type": type,
    "cache-control": "no-store",
    // Lets the app resolve relative catalog links after redirects.
    "x-final-url": upstream.url || url.toString(),
  });
  for (const name of ["content-length", "content-disposition", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  if (upstream.status === 401) {
    const challenge = upstream.headers.get("www-authenticate");
    // Pass the realm on, but not as a challenge, so the browser doesn't pop up
    // its own sign-in box; the app asks for credentials itself.
    if (challenge) out.set("x-auth-challenge", challenge);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
