/**
 * Real page turns over a two-page spread. The iOS app can photograph part of
 * the screen (see SnapshotHandler in ios/Aurum/WebViewController.swift); the
 * leaf that turns carries that photo of the old page, so the words turn with
 * the paper while the new pages are already in place underneath.
 */

export type Snapshot = { url: string; width: number; height: number };

type SnapshotBridge = { postMessage: (message: unknown) => Promise<unknown> };

function bridge(): SnapshotBridge | null {
  const w = window as unknown as {
    webkit?: { messageHandlers?: { aurumSnapshot?: SnapshotBridge } };
  };
  return w.webkit?.messageHandlers?.aurumSnapshot ?? null;
}

/** True inside the iOS app, where the screen can be photographed. */
export function canSnapshot() {
  return typeof window !== "undefined" && bridge() !== null;
}

/** A photo of what is on screen inside `el`, or null where unavailable. */
export async function snapshotElement(
  el: HTMLElement,
): Promise<Snapshot | null> {
  const b = bridge();
  if (!b) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  try {
    const url = await b.postMessage({
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
    });
    if (typeof url !== "string" || !url.startsWith("data:image/")) return null;
    return { url, width: r.width, height: r.height };
  } catch {
    return null;
  }
}

export type Flip = {
  /** Turn the leaf; resolves once it has landed and faded away. */
  start: () => Promise<void>;
  /** Remove the leaf at once. */
  cancel: () => void;
};

const FLIP_MS = 620;
const FADE_MS = 140;

function face(style: Partial<CSSStyleDeclaration>) {
  const d = document.createElement("div");
  Object.assign(d.style, {
    position: "absolute",
    inset: "0",
    backfaceVisibility: "hidden",
    webkitBackfaceVisibility: "hidden",
    ...style,
  });
  return d;
}

function photo(snap: Snapshot, offsetX: number): Partial<CSSStyleDeclaration> {
  return {
    backgroundImage: `url("${snap.url}")`,
    backgroundSize: `${snap.width}px ${snap.height}px`,
    backgroundPosition: `${-offsetX}px 0`,
    backgroundRepeat: "no-repeat",
  };
}

/**
 * Lays the photo over the spread so the screen looks unchanged, ready to turn
 * once the new pages have rendered underneath. Forward, the right page turns
 * over onto the left; back, the left page turns over onto the right.
 */
export function prepareSpreadFlip(
  layer: HTMLElement,
  snap: Snapshot,
  dir: "next" | "prev",
  paper: string,
): Flip {
  const half = snap.width / 2;
  layer.replaceChildren();
  layer.style.opacity = "1";
  layer.style.visibility = "visible";

  // The half that stays put until the leaf lands on it.
  const under = face({
    inset: "auto",
    top: "0",
    height: "100%",
    width: "50%",
    left: dir === "next" ? "0" : "50%",
    backfaceVisibility: "visible",
    ...photo(snap, dir === "next" ? 0 : half),
  });

  const leaf = document.createElement("div");
  Object.assign(leaf.style, {
    position: "absolute",
    top: "0",
    left: "50%",
    width: "50%",
    height: "100%",
    transformOrigin: "left center",
    transformStyle: "preserve-3d",
    webkitTransformStyle: "preserve-3d",
    transform: `rotateY(${dir === "next" ? 0 : -180}deg)`,
  });

  // The back of a leaf is plain paper, shaded toward the spine.
  const paperStyle: Partial<CSSStyleDeclaration> = {
    background: `linear-gradient(to right, rgb(0 0 0 / 22%), transparent 18%, transparent 80%, rgb(0 0 0 / 12%)), ${paper}`,
  };
  const front = face(dir === "next" ? photo(snap, half) : paperStyle);
  const back = face({
    transform: "rotateY(180deg)",
    ...(dir === "next" ? paperStyle : photo(snap, 0)),
  });
  // Shading that deepens as the leaf stands up off the page.
  const frontShade = face({
    background:
      "linear-gradient(to right, rgb(0 0 0 / 35%), rgb(0 0 0 / 10%) 40%, rgb(255 255 255 / 6%) 85%, rgb(0 0 0 / 15%))",
    opacity: "0",
  });
  const backShade = face({
    transform: "rotateY(180deg)",
    background:
      "linear-gradient(to left, rgb(0 0 0 / 35%), rgb(0 0 0 / 10%) 40%, rgb(255 255 255 / 6%) 85%, rgb(0 0 0 / 15%))",
    opacity: "0",
  });
  leaf.append(front, frontShade, back, backShade);
  layer.append(under, leaf);

  let done = false;
  const clear = () => {
    done = true;
    layer.replaceChildren();
    layer.style.visibility = "hidden";
    layer.style.opacity = "1";
  };

  return {
    cancel: clear,
    start: async () => {
      if (done) return;
      const easing = "cubic-bezier(0.35, 0.05, 0.25, 1)";
      const from = dir === "next" ? 0 : -180;
      const to = dir === "next" ? -180 : 0;
      const turn = leaf.animate(
        [
          { transform: `rotateY(${from}deg)` },
          { transform: `rotateY(${(from + to) / 2}deg)` },
          { transform: `rotateY(${to}deg)` },
        ],
        { duration: FLIP_MS, easing, fill: "forwards" },
      );
      const shade = { duration: FLIP_MS, easing, fill: "forwards" as const };
      const peak = [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }];
      frontShade.animate(peak, shade);
      backShade.animate(peak, shade);
      try {
        await turn.finished;
        if (done) return;
        await layer.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: FADE_MS,
          fill: "forwards",
        }).finished;
      } catch {
        /* cancelled */
      }
      clear();
    },
  };
}
