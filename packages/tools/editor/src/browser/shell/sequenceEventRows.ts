import type { SequenceMarker } from "@yagejs-addons/sequence/document";

export const EVENT_FLAG_SIZE = 24;

/** Pack flags into non-overlapping rows without changing marker order or time. */
export function sequenceEventRows(
  markers: readonly SequenceMarker[],
  duration: number,
  width: number,
): { rows: Map<string, number>; count: number } {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const marker of [...markers].sort((a, b) => a.frame - b.frame)) {
    const x = (marker.frame / duration) * width;
    let row = ends.findIndex((end) => end <= x);
    if (row === -1) row = ends.length;
    ends[row] = x + EVENT_FLAG_SIZE;
    rows.set(marker.id, row);
  }
  return { rows, count: Math.max(1, ends.length) };
}
