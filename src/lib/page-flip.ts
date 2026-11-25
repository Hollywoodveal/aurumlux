/**
 * Real page turns. The iOS app can photograph part of the screen (see
 * SnapshotHandler in ios/Aurum/WebViewController.swift); the leaf that turns
 * carries that photo of the old page, so the words turn with the paper while
 * the new page is already in place underneath.
 *
 * The leaf is cut into narrow vertical strips, each hinged to the one before
 * it. Bending the strips a little more toward the free edge makes the paper
 * curl as it lifts, and each strip is shaded by its angle, so the turn reads
 * as a sheet of paper rather than a rigid card.
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

let lastSnapshotError: string | null = null;
/** Why the last photo failed, for diagnosing turns that don't animate. */
export function snapshotError() {
  return lastSnapshotError;
}

/** A photo of what is on screen inside `el`, or null where unavailable. */
export async function snapshotElement(
  el: HTMLElement,
): Promise<Snapshot | null> {
  const b = bridge();
  if (!b) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) {
    lastSnapshotError = "The page area has no size";
    return null;
  }
  try {
    const url = await b.postMessage({
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
    });
    if (typeof url !== "string" || !url.startsWith("data:image/")) {
      lastSnapshotError = "The app returned no image";
      return null;
    }
    lastSnapshotError = null;
    return { url, width: r.width, height: r.height };
  } catch (error) {
    lastSnapshotError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

export type Flip = {
  /** Resolves once the photo is decoded and painted over the page. */
  ready: Promise<void>;
  /** Turn the leaf; resolves once it has landed and the layer is gone. */
  start: () => Promise<void>;
  /** Remove the leaf at once. */
  cancel: () => void;
};

const FLIP_MS = 700;
const STRIPS = 14;
/** How far the free edge curls ahead of the hinge at mid-turn, in degrees. */
const CURL = 75;

function div(style: Record<string, string>) {
  const d = document.createElement("div");
  Object.assign(d.style, style);
  return d;
}

const FACE: Record<string, string> = {
  position: "absolute",
  inset: "0",
  backfaceVisibility: "hidden",
  webkitBackfaceVisibility: "hidden",
};

function photo(snap: Snapshot, offsetX: number): Record<string, string> {
  return {
    backgroundImage: `url("${snap.url}")`,
    backgroundSize: `${snap.width}px ${snap.height}px`,
    backgroundPosition: `${-offsetX}px 0`,
    backgroundRepeat: "no-repeat",
  };
}

/** Smooth start and finish, like a hand lifting and laying down a page. */
export function easeTurn(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * The angle of every strip at time `t` (0–1): the hinge angle first, then
 * each strip's extra bend. Exported for tests.
 */
export function stripAngles(t: number, back: boolean, strips = STRIPS) {
  const e = easeTurn(t);
  const angle = back ? -180 + 180 * e : -180 * e;
  const curl = CURL * Math.sin(Math.PI * e);
  // Forward the free edge leads to the left (more negative); back, right.
  const sign = back ? 1 : -1;
  const out = [angle];
  for (let i = 1; i < strips; i += 1)
    out.push((sign * curl * 2 * i) / (strips * (strips - 1)));
  return out;
}

/**
 * Lays the photo over the page so the screen looks unchanged, ready to turn
 * once the new page has rendered underneath.
 *
 * - `spread`, forward: the right page turns over onto the left.
 * - `spread`, back: the left page turns back over onto the right.
 * - `single`, forward: the page lifts off its left edge and turns away.
 */
export function prepareFlip(
  layer: HTMLElement,
  snap: Snapshot,
  dir: "next" | "prev",
  paper: string,
  mode: "spread" | "single" = "spread",
): Flip {
  const W = snap.width;
  const hinge = mode === "spread" ? W / 2 : 0;
  const leafW = mode === "spread" ? W / 2 : W;
  const s = leafW / STRIPS;
  const back = dir === "prev"; // the leaf starts lying on the left
  layer.replaceChildren();
  layer.style.opacity = "1";
  // Shown in `ready`, once the photo can be painted in one go.
  layer.style.visibility = "hidden";

  // The page that stays put until the leaf lands on it (spreads only).
  if (mode === "spread") {
    layer.append(
      div({
        position: "absolute",
        top: "0",
        height: "100%",
        width: "50%",
        left: back ? "50%" : "0",
        ...photo(snap, back ? hinge : 0),
      }),
    );
  }

  // A soft shadow the lifted leaf casts on the page beneath it.
  const shadow = div({
    position: "absolute",
    top: "0",
    height: "100%",
    left: back ? `${hinge - leafW}px` : `${hinge}px`,
    width: `${leafW}px`,
    pointerEvents: "none",
    background: back
      ? "linear-gradient(to left, rgb(0 0 0 / 35%), rgb(0 0 0 / 0%) 70%)"
      : "linear-gradient(to right, rgb(0 0 0 / 35%), rgb(0 0 0 / 0%) 70%)",
    opacity: "0",
  });
  layer.append(shadow);

  const stripStyle = (first: boolean): Record<string, string> => ({
    position: "absolute",
    top: "0",
    height: "100%",
    left: first ? `${hinge}px` : `${s}px`,
    width: `${s + 0.6}px`, // overlap a hair so no seams show
    transformOrigin: "left center",
    transformStyle: "preserve-3d",
    webkitTransformStyle: "preserve-3d",
  });

  // Paper seen from behind: the theme's page colour with the front's ink
  // showing through faintly, mirrored, as it does on real paper.
  const paperFace = (offsetX: number, rotated: boolean) => {
    const face = div({
      ...FACE,
      ...(rotated ? { transform: "rotateY(180deg)" } : {}),
      background: paper,
    });
    face.append(
      div({
        position: "absolute",
        inset: "0",
        opacity: "0.045",
        transform: "scaleX(-1)",
        ...photo(snap, offsetX),
      }),
    );
    return face;
  };

  const strips: HTMLDivElement[] = [];
  const shades: HTMLDivElement[] = [];
  let parent: HTMLDivElement | null = null;
  for (let i = 0; i < STRIPS; i += 1) {
    const strip = div(stripStyle(i === 0));
    // Where this strip's slice sits on screen: on the right of the hinge
    // while flat (forward), or mirrored onto the left (back).
    const rightX = hinge + i * s;
    const leftX = hinge - (i + 1) * s;
    // Forward: the visible side is the old right page. Back: while the leaf
    // lies on the left, the visible side is the old left page.
    const front = back
      ? paperFace(leftX, false)
      : div({ ...FACE, ...photo(snap, rightX) });
    const rear = back
      ? div({
          ...FACE,
          transform: "rotateY(180deg)",
          ...photo(snap, leftX),
        })
      : paperFace(rightX, true);
    const shade = div({
      position: "absolute",
      inset: "0",
      background: "black",
      opacity: "0",
      pointerEvents: "none",
    });
    strip.append(front, rear, shade);
    if (parent) parent.append(strip);
    else layer.append(strip);
    strips.push(strip);
    shades.push(shade);
    parent = strip;
  }

  const pose = (t: number) => {
    const angles = stripAngles(t, back);
    let total = 0;
    angles.forEach((a, i) => {
      total += a;
      const strip = strips[i];
      const shade = shades[i];
      if (strip) strip.style.transform = `rotateY(${a}deg)`;
      // Darker the more the strip faces away from the light.
      if (shade)
        shade.style.opacity = String(
          Math.abs(Math.sin((total * Math.PI) / 180)) * 0.4,
        );
    });
    shadow.style.opacity = String(Math.sin(Math.PI * easeTurn(t)) * 0.9);
  };
  pose(0);

  let done = false;
  let frame = 0;
  const clear = () => {
    done = true;
    cancelAnimationFrame(frame);
    // A finished fade keeps the layer transparent ("fill: forwards") until
    // it's cancelled, which would hide every later turn.
    for (const animation of layer.getAnimations()) animation.cancel();
    layer.replaceChildren();
    layer.style.visibility = "hidden";
    layer.style.opacity = "1";
  };

  const frame2 = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  const image = new Image();
  image.src = snap.url;
  const ready = image
    .decode()
    .catch(() => undefined)
    .then(() => {
      if (!done) layer.style.visibility = "visible";
      return frame2();
    });

  return {
    ready,
    cancel: clear,
    start: () =>
      new Promise<void>((resolve) => {
        if (done) {
          resolve();
          return;
        }
        const started = performance.now();
        const step = (now: number) => {
          if (done) {
            resolve();
            return;
          }
          const t = Math.min(1, (now - started) / FLIP_MS);
          pose(t);
          if (t < 1) {
            frame = requestAnimationFrame(step);
            return;
          }
          // Landed: fade the photo away to the live page beneath.
          const fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 120,
            fill: "forwards",
          });
          fade.onfinish = () => {
            clear();
            resolve();
          };
        };
        frame = requestAnimationFrame(step);
      }),
  };
}
