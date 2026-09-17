/**
 * Which Settings sections the reader has collapsed.
 *
 * Stored in localStorage so the shape of the page follows them between visits —
 * someone who only ever uses Backup shouldn't have to scroll past eight other
 * panels every time. Only the collapsed ids are written, so sections added in a
 * later release default to open rather than inheriting a stale preference.
 */

const KEY = "aurum.settingsCollapsed";

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

export function isSectionCollapsed(id: string): boolean {
  return read().has(id);
}

export function setSectionCollapsed(id: string, collapsed: boolean): void {
  if (typeof window === "undefined") return;
  const ids = read();
  if (collapsed) ids.add(id);
  else ids.delete(id);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // Private-browsing quota errors shouldn't break the toggle itself.
  }
}
