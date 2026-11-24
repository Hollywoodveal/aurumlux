/**
 * Splits books into shelf rows that fit the shelf's width, so a wide screen
 * (an unfolded phone, a tablet) fills each shelf instead of leaving a gap.
 * Before the shelf has been measured (width 0) it falls back to `fallback`
 * books per row.
 */
export function packShelves<T>(
  items: T[],
  available: number,
  widthOf: (item: T) => number,
  gap: number,
  fallback = 12,
): T[][] {
  const rows: T[][] = [];
  if (available <= 0) {
    for (let i = 0; i < items.length; i += fallback)
      rows.push(items.slice(i, i + fallback));
    return rows;
  }
  let row: T[] = [];
  let used = 0;
  for (const item of items) {
    const w = widthOf(item);
    const next = row.length ? used + gap + w : w;
    if (row.length && next > available) {
      rows.push(row);
      row = [item];
      used = w;
    } else {
      row.push(item);
      used = next;
    }
  }
  if (row.length) rows.push(row);
  return rows;
}
