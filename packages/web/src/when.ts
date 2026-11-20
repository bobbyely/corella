// The sidebar's sense of time: a short age for each chat ("now", "9 min",
// "Tue") and whether it belongs under Today or Earlier. Pure, so it is tested
// without a clock. Used by Sidebar.tsx; reads and writes nothing.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** True when both times fall on the same local calendar day. */
export function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** How long ago, as short as it can be said: now, 9 min, 3 h, Tue, Nov 12. */
export function shortAge(ts: number, now: number): string {
  const age = now - ts;
  if (age < MINUTE) return "now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min`;
  if (sameDay(ts, now)) return `${Math.floor(age / HOUR)} h`;
  const date = new Date(ts);
  if (age < 6 * DAY) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
