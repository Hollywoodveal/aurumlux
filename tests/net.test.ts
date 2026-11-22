import { expect, test } from "bun:test";
import { basicAuth, relayUrl } from "@/lib/net";
import { extensionForType } from "@/lib/importer";
import { DEFAULT_SYNC, syncFileUrl, validateSyncConfig } from "@/lib/sync";

test("relayUrl encodes the target", () => {
  expect(relayUrl("https://a.org/b?c=d&e")).toBe(
    "/api/fetch?url=https%3A%2F%2Fa.org%2Fb%3Fc%3Dd%26e",
  );
});

test("basicAuth handles non-ASCII", () => {
  expect(basicAuth("me", "pässword")).toBe(
    `Basic ${Buffer.from("me:pässword").toString("base64")}`,
  );
});

test("extensionForType maps book types", () => {
  expect(extensionForType("application/epub+zip")).toBe("epub");
  expect(extensionForType("application/pdf; charset=binary")).toBe("pdf");
  expect(extensionForType("application/vnd.comicbook+zip")).toBe("cbz");
  expect(extensionForType("text/plain; charset=utf-8")).toBe("txt");
  expect(extensionForType("text/html")).toBeNull();
});

test("sync file lives inside the folder", () => {
  expect(syncFileUrl("https://dav.example/Aurum/")).toBe(
    "https://dav.example/Aurum/aurum-sync.aurum",
  );
  expect(syncFileUrl("https://dav.example/Aurum")).toBe(
    "https://dav.example/Aurum/aurum-sync.aurum",
  );
});

test("sync config is validated", () => {
  const base = { ...DEFAULT_SYNC, passphrase: "long enough" };
  expect(validateSyncConfig({ ...base, folderUrl: "http://x" })).toMatch(
    /https/,
  );
  expect(
    validateSyncConfig({
      ...base,
      folderUrl: "https://x",
      passphrase: "short",
    }),
  ).toMatch(/passphrase/);
  expect(validateSyncConfig({ ...base, folderUrl: "https://x" })).toBeNull();
});
