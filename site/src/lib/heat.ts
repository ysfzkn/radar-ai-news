// The heat strip's keyboard (scripts/heat.ts): pure, so it is tested without a page.
import { arrowStep } from "./search";

/**
 * Where a key press moves the focus among the strip's days with an edition, counted oldest first
 * (0) to newest (count - 1): Right and Down one newer, Left and Up one older, Home the oldest, End
 * the newest, stopping at the ends. Null for any other key or a press with Alt, Ctrl or Meta.
 */
export function heatTarget(
  event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  index: number,
  count: number,
): number | null {
  if (count === 0 || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "Home") return 0;
  if (event.key === "End") return count - 1;
  const step = arrowStep(event);
  if (!step) return null;
  return Math.max(0, Math.min(count - 1, index + step));
}
