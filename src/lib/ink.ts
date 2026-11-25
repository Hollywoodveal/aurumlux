/**
 * Apple Pencil ink on the page. Touch the page with the Pencil and you're
 * writing; touch it with a finger and you're back to turning pages. Strokes
 * are saved per book and per page (the page's position in the book), and
 * drawn back whenever that page is on screen.
 *
 * Points are stored as fractions of the page area, with pen pressure, so ink
 * stays put when the screen rotates or the phone unfolds. If you change the
 * text size, pages reflow and ink stays with the page it was written on.
 */
import { getSetting, setSetting } from "./db";

export type Stroke = {
  /** Colour, or "erase" for nothing (strokes are removed instead). */
  c: string;
  /** Flat list of x, y, pressure triples, each 0–1. */
  p: number[];
};
export type InkPages = Record<string, Stroke[]>;

export const INK_COLORS = ["#d6b05c", "#e5484d", "#3e8ed0", "#f2ede4"];

const key = (bookId: string) => `ink:${bookId}`;

export function loadInk(bookId: string) {
  return getSetting<InkPages>(key(bookId), {});
}

export function saveInk(bookId: string, pages: InkPages) {
  return setSetting(key(bookId), pages);
}

/** Distance from a point to a stroke, in page fractions. */
export function strokeDistance(stroke: Stroke, x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i < stroke.p.length; i += 3) {
    const dx = (stroke.p[i] ?? 0) - x;
    const dy = (stroke.p[i + 1] ?? 0) - y;
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

type Options = {
  canvas: HTMLCanvasElement;
  /** The page area ink is measured against. */
  stage: HTMLElement;
  bookId: string;
  /** Where the reader is; ink belongs to this page. */
  pageKey: () => string | null;
  /** Ink mode turned on or off (show or hide the ink tools). */
  onModeChange: (active: boolean) => void;
};

export class InkController {
  private pages: InkPages = {};
  private loaded = false;
  private current: Stroke | null = null;
  private active = false;
  private saveTimer = 0;
  color = INK_COLORS[0] ?? "#d6b05c";
  erasing = false;

  constructor(private o: Options) {
    void loadInk(o.bookId).then((pages) => {
      this.pages = pages ?? {};
      this.loaded = true;
      this.redraw();
    });
    const c = o.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onCanvasDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  destroy() {
    const c = this.o.canvas;
    c.removeEventListener("pointerdown", this.onCanvasDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    window.clearTimeout(this.saveTimer);
    if (this.loaded) void saveInk(this.o.bookId, this.pages);
  }

  get isActive() {
    return this.active;
  }

  setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    this.o.canvas.style.pointerEvents = on ? "auto" : "none";
    // Above the page-turn tap zones while writing.
    this.o.canvas.style.zIndex = on ? "15" : "";
    this.o.onModeChange(on);
  }

  // --- Input -------------------------------------------------------------

  /** Pencil events from inside the book's frame. Returns true if handled. */
  fromFrame = (e: PointerEvent, frame: HTMLElement | null): boolean => {
    if (e.pointerType !== "pen" || !frame) return false;
    e.preventDefault();
    e.stopPropagation();
    const f = frame.getBoundingClientRect();
    this.setActive(true);
    this.begin(f.left + e.clientX, f.top + e.clientY, e.pressure);
    const doc = (e.target as Node | null)?.ownerDocument;
    if (!doc) return true;
    const move = (ev: PointerEvent) => {
      if (ev.pointerType !== "pen") return;
      ev.preventDefault();
      const r = frame.getBoundingClientRect();
      this.extend(r.left + ev.clientX, r.top + ev.clientY, ev.pressure);
    };
    const up = () => {
      doc.removeEventListener("pointermove", move, true);
      doc.removeEventListener("pointerup", up, true);
      doc.removeEventListener("pointercancel", up, true);
      this.end();
    };
    doc.addEventListener("pointermove", move, true);
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", up, true);
    return true;
  };

  /** Pencil on the page edges (outside the frame) also writes. */
  fromStage = (e: PointerEvent): boolean => {
    if (e.pointerType !== "pen" || this.active) return false;
    e.preventDefault();
    e.stopPropagation();
    this.setActive(true);
    // Hand the rest of the stroke to the canvas, now on top.
    try {
      this.o.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable; the canvas still gets later strokes */
    }
    this.begin(e.clientX, e.clientY, e.pressure);
    return true;
  };

  private onCanvasDown = (e: PointerEvent) => {
    if (e.pointerType !== "pen") {
      // A finger means "done writing": go back to turning pages.
      this.setActive(false);
      return;
    }
    e.preventDefault();
    this.o.canvas.setPointerCapture(e.pointerId);
    this.begin(e.clientX, e.clientY, e.pressure);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== "pen" || !this.current) return;
    e.preventDefault();
    // Use every point the Pencil reported, not just one per frame.
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events) this.extend(ev.clientX, ev.clientY, ev.pressure);
  };

  private onUp = () => this.end();

  private toPage(clientX: number, clientY: number) {
    const r = this.o.stage.getBoundingClientRect();
    return [
      (clientX - r.left) / Math.max(1, r.width),
      (clientY - r.top) / Math.max(1, r.height),
    ] as const;
  }

  private begin(clientX: number, clientY: number, pressure: number) {
    const [x, y] = this.toPage(clientX, clientY);
    if (this.erasing) {
      this.eraseAt(x, y);
      this.current = { c: "erase", p: [] };
      return;
    }
    this.current = { c: this.color, p: [x, y, pressure || 0.5] };
  }

  private extend(clientX: number, clientY: number, pressure: number) {
    if (!this.current) return;
    const [x, y] = this.toPage(clientX, clientY);
    if (this.current.c === "erase") {
      this.eraseAt(x, y);
      return;
    }
    this.current.p.push(x, y, pressure || 0.5);
    this.redraw();
  }

  private end() {
    const stroke = this.current;
    this.current = null;
    const pageKey = this.o.pageKey();
    if (!stroke || stroke.c === "erase" || stroke.p.length < 6 || !pageKey)
      return;
    (this.pages[pageKey] ??= []).push(stroke);
    this.redraw();
    this.scheduleSave();
  }

  private eraseAt(x: number, y: number) {
    const pageKey = this.o.pageKey();
    const list = pageKey ? this.pages[pageKey] : undefined;
    if (!list || !pageKey) return;
    const kept = list.filter((s) => strokeDistance(s, x, y) > 0.02);
    if (kept.length === list.length) return;
    this.pages[pageKey] = kept;
    this.redraw();
    this.scheduleSave();
  }

  // --- Editing -----------------------------------------------------------

  undo() {
    const pageKey = this.o.pageKey();
    const list = pageKey ? this.pages[pageKey] : undefined;
    if (!list?.length) return;
    list.pop();
    this.redraw();
    this.scheduleSave();
  }

  clearPage() {
    const pageKey = this.o.pageKey();
    if (!pageKey || !this.pages[pageKey]?.length) return;
    delete this.pages[pageKey];
    this.redraw();
    this.scheduleSave();
  }

  hasInk() {
    const pageKey = this.o.pageKey();
    return Boolean(pageKey && this.pages[pageKey]?.length);
  }

  private scheduleSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(
      () => void saveInk(this.o.bookId, this.pages),
      800,
    );
  }

  // --- Drawing -----------------------------------------------------------

  /** Draws the current page's ink. Call after turning pages or resizing. */
  redraw() {
    const canvas = this.o.canvas;
    const r = this.o.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const pageKey = this.o.pageKey();
    const strokes = [
      ...((pageKey && this.pages[pageKey]) || []),
      ...(this.current && this.current.c !== "erase" ? [this.current] : []),
    ];
    g.lineCap = "round";
    g.lineJoin = "round";
    const base = 2.4 * dpr;
    for (const s of strokes) {
      g.strokeStyle = s.c;
      const pts = s.p;
      for (let i = 3; i < pts.length; i += 3) {
        const pressure = pts[i + 2] ?? 0.5;
        g.lineWidth = base * (0.45 + pressure * 1.1);
        g.beginPath();
        g.moveTo((pts[i - 3] ?? 0) * w, (pts[i - 2] ?? 0) * h);
        g.lineTo((pts[i] ?? 0) * w, (pts[i + 1] ?? 0) * h);
        g.stroke();
      }
    }
  }
}
