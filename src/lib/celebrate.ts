/** Fire a gold-fleck celebration (rendered by <Celebration /> in the root). */
export type CelebrationDetail = { title: string; subtitle?: string };

export const CELEBRATE_EVENT = "aurum:celebrate";

export function celebrate(detail: CelebrationDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail }));
}
