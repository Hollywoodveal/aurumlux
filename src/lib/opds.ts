/**
 * OPDS catalog support: browse and search public or personal book catalogs
 * (Project Gutenberg, Standard Ebooks, a Calibre content server, Komga, …) and
 * download books from them. Handles OPDS 1.x (Atom XML) and OPDS 2 (JSON).
 */
import { getSetting, setSetting } from "./db";
import { basicAuth, fetchExternal, friendlyHttpError } from "./net";

export type OpdsCatalog = {
  id: string;
  title: string;
  url: string;
  username?: string | undefined;
  password?: string | undefined;
};

export type OpdsAcquisition = {
  href: string;
  type: string;
  /** Human label for the format, e.g. "EPUB" or "EPUB (no images)". */
  label: string;
  /** False for "buy" / "borrow" / DRM links Aurum can't download. */
  free: boolean;
};

export type OpdsEntry = {
  id: string;
  title: string;
  author: string;
  summary: string;
  coverUrl?: string | undefined;
  /** Link to a sub-catalog, for navigation entries. */
  navigationUrl?: string | undefined;
  acquisitions: OpdsAcquisition[];
};

export type OpdsFeed = {
  url: string;
  title: string;
  entries: OpdsEntry[];
  nextUrl?: string | undefined;
  /** Search URL template containing `{searchTerms}`, when the catalog has search. */
  searchTemplate?: string | undefined;
  /** OpenSearch description to resolve into a template, when that's all there is. */
  searchDescriptionUrl?: string | undefined;
};

const CATALOGS_KEY = "opdsCatalogs";

export const DEFAULT_CATALOGS: OpdsCatalog[] = [
  {
    id: "feedbooks",
    title: "Feedbooks",
    url: "https://catalog.feedbooks.com/catalog/index.atom",
  },
];

/** Catalogs people commonly add; shown as suggestions in the add form. */
export const SUGGESTED_CATALOGS: {
  title: string;
  url: string;
  note: string;
}[] = [
  {
    title: "Feedbooks",
    url: "https://catalog.feedbooks.com/catalog/index.atom",
    note: "Free public-domain classics and more",
  },
  {
    title: "Standard Ebooks",
    url: "https://standardebooks.org/feeds/opds",
    note: "Patrons Circle: your email as username, no password",
  },
  {
    title: "Calibre content server",
    url: "https://your-server/opds",
    note: "Needs HTTPS and to be reachable from the internet",
  },
];

/**
 * Free libraries whose books are best downloaded from their website: they
 * don't allow web apps or cloud relays to fetch from them directly.
 */
export const FREE_BOOK_SITES: { title: string; url: string; note: string }[] = [
  {
    title: "Project Gutenberg",
    url: "https://www.gutenberg.org/",
    note: "75,000+ public-domain books",
  },
  {
    title: "Standard Ebooks",
    url: "https://standardebooks.org/ebooks",
    note: "Carefully formatted public-domain classics",
  },
];

/** The first release defaulted to Gutenberg, which blocks the relay. */
const RETIRED_DEFAULT_IDS = new Set(["gutenberg"]);

const ACCEPT =
  "application/atom+xml;profile=opds-catalog, application/opds+json, application/atom+xml;q=0.9, application/json;q=0.8, */*;q=0.5";

const READABLE = /epub|pdf|comicbook\+zip|x-cbz|text\/plain/i;

export async function listCatalogs(): Promise<OpdsCatalog[]> {
  const saved = await getSetting<OpdsCatalog[] | null>(CATALOGS_KEY, null);
  if (!saved) return DEFAULT_CATALOGS;
  if (!saved.some((c) => RETIRED_DEFAULT_IDS.has(c.id))) return saved;
  const kept = saved.filter((c) => !RETIRED_DEFAULT_IDS.has(c.id));
  const next = kept.some((c) => c.id === "feedbooks")
    ? kept
    : [...DEFAULT_CATALOGS, ...kept];
  await setSetting(CATALOGS_KEY, next);
  return next;
}

export async function saveCatalogs(catalogs: OpdsCatalog[]) {
  await setSetting(CATALOGS_KEY, catalogs);
}

export function authFor(catalog: Pick<OpdsCatalog, "username" | "password">) {
  return catalog.username
    ? basicAuth(catalog.username, catalog.password ?? "")
    : undefined;
}

export class OpdsAuthError extends Error {
  constructor() {
    super("This catalog needs a username and password.");
    this.name = "OpdsAuthError";
  }
}

/** Download and parse one page of a catalog. */
export async function fetchFeed(
  url: string,
  authorization?: string,
): Promise<OpdsFeed> {
  const { response, finalUrl, viaRelay } = await fetchExternal(url, {
    accept: ACCEPT,
    ...(authorization ? { authorization } : {}),
  });
  // 401 is a sign-in request; a 403 without credentials is usually a block.
  if (response.status === 401 || (response.status === 403 && authorization))
    throw new OpdsAuthError();
  if (!response.ok)
    throw new Error(
      friendlyHttpError(response.status, {
        kind: "catalog",
        viaRelay,
        signedIn: Boolean(authorization),
      }),
    );
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  const text = await response.text();
  if (type.includes("json") || text.trimStart().startsWith("{"))
    return parseOpds2(JSON.parse(text) as unknown, finalUrl);
  if (type.includes("html") && !text.includes("<feed"))
    throw new Error(friendlyHttpError(415, { kind: "catalog" }));
  return parseOpds1(text, finalUrl);
}

/** Resolve the catalog's search into a feed of results. */
export async function searchFeed(
  feed: OpdsFeed,
  query: string,
  authorization?: string,
): Promise<OpdsFeed> {
  let template = feed.searchTemplate;
  if (!template && feed.searchDescriptionUrl) {
    template = await resolveOpenSearch(
      feed.searchDescriptionUrl,
      authorization,
    );
  }
  if (!template) throw new Error("This catalog doesn't support search.");
  return fetchFeed(fillTemplate(template, query), authorization);
}

export function fillTemplate(template: string, query: string) {
  return template
    .replace(/\{searchTerms\??\}/g, encodeURIComponent(query))
    .replace(/\{[a-zA-Z:]+\?\}/g, "");
}

async function resolveOpenSearch(url: string, authorization?: string) {
  const { response, finalUrl } = await fetchExternal(url, {
    accept: "application/opensearchdescription+xml, */*;q=0.5",
    ...(authorization ? { authorization } : {}),
  });
  if (!response.ok) return undefined;
  const xml = new DOMParser().parseFromString(
    await response.text(),
    "application/xml",
  );
  const urls = [...xml.getElementsByTagNameNS("*", "Url")];
  const best =
    urls.find((u) => /atom|opds/i.test(u.getAttribute("type") ?? "")) ??
    urls[0];
  const template = best?.getAttribute("template");
  return template ? absolute(template, finalUrl) : undefined;
}

function absolute(href: string, base: string) {
  try {
    // Keep `{searchTerms}` readable: URL() would percent-encode the braces.
    return new URL(href, base)
      .toString()
      .replace(/%7B/gi, "{")
      .replace(/%7D/gi, "}");
  } catch {
    return href;
  }
}

function formatLabel(type: string, title: string | null) {
  const t = type.toLowerCase();
  const base = t.includes("epub")
    ? "EPUB"
    : t.includes("pdf")
      ? "PDF"
      : t.includes("comicbook") || t.includes("cbz")
        ? "CBZ"
        : t.includes("text/plain")
          ? "TXT"
          : (t.split("/").pop() ?? "File").toUpperCase();
  const extra = title?.trim();
  return extra && !extra.toUpperCase().startsWith(base)
    ? `${base} · ${extra}`
    : extra || base;
}

// ---------------------------------------------------------------------------
// OPDS 1.x (Atom)

function kids(el: Element, name: string) {
  return [...el.children].filter((c) => c.localName === name);
}

function text(el: Element, name: string) {
  return kids(el, name)[0]?.textContent?.trim() ?? "";
}

function stripTags(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseOpds1(xmlText: string, baseUrl: string): OpdsFeed {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  if (xml.getElementsByTagName("parsererror").length > 0)
    throw new Error("That link isn't a readable OPDS catalog.");
  const feed = xml.documentElement;
  if (feed.localName !== "feed")
    throw new Error("That link isn't an OPDS catalog.");

  const result: OpdsFeed = {
    url: baseUrl,
    title: text(feed, "title") || "Catalog",
    entries: [],
  };

  for (const link of kids(feed, "link")) {
    const rel = link.getAttribute("rel") ?? "";
    const type = link.getAttribute("type") ?? "";
    const href = link.getAttribute("href");
    if (!href) continue;
    if (rel === "next") result.nextUrl = absolute(href, baseUrl);
    if (rel === "search") {
      if (href.includes("{searchTerms"))
        result.searchTemplate = absolute(href, baseUrl);
      else if (type.includes("opensearchdescription"))
        result.searchDescriptionUrl = absolute(href, baseUrl);
    }
  }

  kids(feed, "entry").forEach((entry, i) => {
    const authors = kids(entry, "author")
      .map((a) => text(a, "name"))
      .filter(Boolean);
    const summary = stripTags(text(entry, "summary") || text(entry, "content"));
    const item: OpdsEntry = {
      id: text(entry, "id") || `${baseUrl}#${i}`,
      title: text(entry, "title") || "Untitled",
      author: authors.join(", "),
      summary: summary.length > 400 ? `${summary.slice(0, 397)}…` : summary,
      acquisitions: [],
    };
    let thumb: string | undefined;
    for (const link of kids(entry, "link")) {
      const rel = link.getAttribute("rel") ?? "";
      const type = link.getAttribute("type") ?? "";
      const raw = link.getAttribute("href");
      if (!raw) continue;
      const href = absolute(raw, baseUrl);
      if (rel.startsWith("http://opds-spec.org/acquisition")) {
        if (!READABLE.test(type)) continue;
        const free =
          !/acquisition\/(buy|borrow|subscribe|sample)/.test(rel) &&
          !/drm/i.test(type);
        item.acquisitions.push({
          href,
          type,
          label: formatLabel(type, link.getAttribute("title")),
          free,
        });
      } else if (
        rel === "http://opds-spec.org/image/thumbnail" ||
        rel === "http://opds-spec.org/thumbnail"
      ) {
        thumb = href;
      } else if (
        rel === "http://opds-spec.org/image" ||
        rel === "http://opds-spec.org/cover"
      ) {
        item.coverUrl ??= href;
      } else if (
        /atom\+xml|opds/.test(type) &&
        !item.navigationUrl &&
        rel !== "alternate" &&
        rel !== "self"
      ) {
        item.navigationUrl = href;
      }
    }
    // Thumbnails are lighter on a phone; fall back to the full cover.
    if (thumb) item.coverUrl = thumb;
    if (item.acquisitions.length > 0) delete item.navigationUrl;
    result.entries.push(item);
  });
  return result;
}

// ---------------------------------------------------------------------------
// OPDS 2 (JSON)

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function names(v: unknown): string {
  if (typeof v === "string") return v;
  if (isObj(v)) return str(v["name"]);
  return arr(v).map(names).filter(Boolean).join(", ");
}

function localized(v: unknown): string {
  if (typeof v === "string") return v;
  if (isObj(v)) return str(Object.values(v)[0]);
  return "";
}

export function parseOpds2(data: unknown, baseUrl: string): OpdsFeed {
  if (!isObj(data)) throw new Error("That link isn't an OPDS catalog.");
  const meta = isObj(data["metadata"]) ? data["metadata"] : {};
  const result: OpdsFeed = {
    url: baseUrl,
    title: localized(meta["title"]) || "Catalog",
    entries: [],
  };
  for (const l of arr(data["links"])) {
    if (!isObj(l)) continue;
    const rel = arr(l["rel"]).concat(l["rel"]).map(str);
    const href = str(l["href"]);
    if (!href) continue;
    if (rel.includes("next")) result.nextUrl = absolute(href, baseUrl);
    if (rel.includes("search")) {
      if (href.includes("{searchTerms") || l["templated"] === true)
        result.searchTemplate = absolute(href, baseUrl);
      else result.searchDescriptionUrl = absolute(href, baseUrl);
    }
  }

  const navigation = [
    ...arr(data["navigation"]),
    ...arr(data["groups"]).flatMap((g) =>
      isObj(g) ? arr(g["navigation"]) : [],
    ),
  ];
  navigation.forEach((n, i) => {
    if (!isObj(n) || !str(n["href"])) return;
    result.entries.push({
      id: `${baseUrl}#nav${i}`,
      title: str(n["title"]) || "Untitled",
      author: "",
      summary: "",
      navigationUrl: absolute(str(n["href"]), baseUrl),
      acquisitions: [],
    });
  });

  const publications = [
    ...arr(data["publications"]),
    ...arr(data["groups"]).flatMap((g) =>
      isObj(g) ? arr(g["publications"]) : [],
    ),
  ];
  publications.forEach((p, i) => {
    if (!isObj(p)) return;
    const m = isObj(p["metadata"]) ? p["metadata"] : {};
    const images = arr(p["images"]).filter(isObj);
    const image = images[0];
    const summary = stripTags(str(m["description"]));
    const entry: OpdsEntry = {
      id: str(m["identifier"]) || `${baseUrl}#pub${i}`,
      title: localized(m["title"]) || "Untitled",
      author: names(m["author"]),
      summary: summary.length > 400 ? `${summary.slice(0, 397)}…` : summary,
      coverUrl: image ? absolute(str(image["href"]), baseUrl) : undefined,
      acquisitions: [],
    };
    for (const l of arr(p["links"])) {
      if (!isObj(l)) continue;
      const rel = arr(l["rel"]).concat(l["rel"]).map(str);
      const type = str(l["type"]);
      const href = str(l["href"]);
      if (!href || !rel.some((r) => r.includes("acquisition"))) continue;
      if (!READABLE.test(type)) continue;
      entry.acquisitions.push({
        href: absolute(href, baseUrl),
        type,
        label: formatLabel(type, str(l["title"]) || null),
        free:
          !rel.some((r) =>
            /acquisition\/(buy|borrow|subscribe|sample)/.test(r),
          ) && !/drm/i.test(type),
      });
    }
    result.entries.push(entry);
  });
  return result;
}
