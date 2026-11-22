import { describe, expect, test } from "bun:test";
import { fillTemplate, parseOpds1, parseOpds2 } from "@/lib/opds";

describe("fillTemplate", () => {
  test("fills searchTerms and drops optional params", () => {
    expect(
      fillTemplate(
        "https://x.org/search?q={searchTerms}&p={startPage?}",
        "war & peace",
      ),
    ).toBe("https://x.org/search?q=war%20%26%20peace&p=");
  });
});

describe("parseOpds2", () => {
  const feed = {
    metadata: { title: "Test catalog" },
    links: [
      { rel: "next", href: "page2.json" },
      { rel: "search", href: "/search{?query}", templated: true },
    ],
    navigation: [{ title: "Fiction", href: "/fiction.json" }],
    publications: [
      {
        metadata: {
          identifier: "urn:1",
          title: "Moby-Dick",
          author: [{ name: "Herman Melville" }],
          description: "<p>A <b>whale</b>.</p>",
        },
        images: [{ href: "/covers/1.jpg" }],
        links: [
          {
            rel: "http://opds-spec.org/acquisition/open-access",
            type: "application/epub+zip",
            href: "/books/1.epub",
          },
          {
            rel: "http://opds-spec.org/acquisition/buy",
            type: "application/pdf",
            href: "/buy/1",
          },
          {
            rel: "http://opds-spec.org/acquisition",
            type: "audio/mpeg",
            href: "/a.mp3",
          },
        ],
      },
    ],
  };

  test("reads navigation, publications and links", () => {
    const parsed = parseOpds2(feed, "https://cat.example/root.json");
    expect(parsed.title).toBe("Test catalog");
    expect(parsed.nextUrl).toBe("https://cat.example/page2.json");
    expect(parsed.searchTemplate).toBe("https://cat.example/search{?query}");
    const [nav, pub] = parsed.entries;
    expect(nav?.navigationUrl).toBe("https://cat.example/fiction.json");
    expect(pub?.title).toBe("Moby-Dick");
    expect(pub?.author).toBe("Herman Melville");
    expect(pub?.summary).toBe("A whale .");
    expect(pub?.coverUrl).toBe("https://cat.example/covers/1.jpg");
    expect(pub?.acquisitions).toEqual([
      {
        href: "https://cat.example/books/1.epub",
        type: "application/epub+zip",
        label: "EPUB",
        free: true,
      },
      {
        href: "https://cat.example/buy/1",
        type: "application/pdf",
        label: "PDF",
        free: false,
      },
    ]);
  });
});

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <title>Gutenberg</title>
  <link rel="search" type="application/opensearchdescription+xml" href="/osd.xml"/>
  <link rel="next" href="?start=26"/>
  <entry>
    <id>urn:nav</id><title>Popular</title>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="/popular.opds"/>
  </entry>
  <entry>
    <id>urn:book</id><title>Emma</title>
    <author><name>Jane Austen</name></author>
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" title="EPUB3 (E-readers incl. Send-to-Kindle)" href="/ebooks/158.epub3.images"/>
    <link rel="http://opds-spec.org/image/thumbnail" type="image/png" href="/cache/158.png"/>
  </entry>
</feed>`;

describe.skipIf(typeof DOMParser === "undefined")("parseOpds1", () => {
  test("reads an Atom catalog", () => {
    const f = parseOpds1(ATOM, "https://m.gutenberg.org/ebooks.opds/");
    expect(f.title).toBe("Gutenberg");
    expect(f.searchDescriptionUrl).toBe("https://m.gutenberg.org/osd.xml");
    expect(f.entries[0]?.navigationUrl).toBe(
      "https://m.gutenberg.org/popular.opds",
    );
    expect(f.entries[1]?.acquisitions[0]?.href).toBe(
      "https://m.gutenberg.org/ebooks/158.epub3.images",
    );
  });
});
