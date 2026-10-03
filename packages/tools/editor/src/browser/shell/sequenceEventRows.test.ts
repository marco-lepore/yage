import { expect, it } from "vitest";
import { sequenceEventRows } from "./sequenceEventRows.js";

it("separates coincident and nearby flags and reuses free rows", () => {
  const markers = [120, 0, 120, 119].map((frame, i) => ({
    id: String(i),
    frame,
    target: "actor",
    event: "cue",
    payload: {},
  }));
  const layout = sequenceEventRows(markers, 120, 600);
  expect(layout.count).toBe(3);
  expect(layout.rows.get("1")).toBe(layout.rows.get("3"));
  expect(new Set(["0", "2", "3"].map((id) => layout.rows.get(id))).size).toBe(
    3,
  );
  expect(markers.map((m) => m.frame)).toEqual([120, 0, 120, 119]);
  expect(sequenceEventRows(markers, 120, 3000).count).toBe(2);
  expect(sequenceEventRows([], 120, 0).count).toBe(1);
});
