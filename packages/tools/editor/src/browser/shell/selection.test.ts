import { describe, expect, it } from "vitest";
import { selectedAfter } from "./selection.js";

describe("selectedAfter", () => {
  const selection = new Set(["a", "b"]);

  it("replaces the selection with what was clicked", () => {
    expect(selectedAfter(selection, "c", false)).toEqual(["c"]);
  });

  it("empties it on a click on nothing", () => {
    expect(selectedAfter(selection, null, false)).toEqual([]);
  });

  it("adds and removes with the modifier", () => {
    expect([...selectedAfter(selection, "c", true)].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(selectedAfter(selection, "a", true)).toEqual(["b"]);
  });

  it("is what a hierarchy row uses too, which never passes null", () => {
    // One rule for both places a developer picks placements.
    expect(selectedAfter(new Set(["a"]), "a", true)).toEqual([]);
    expect(selectedAfter(new Set(["a"]), "b", false)).toEqual(["b"]);
  });

  it("leaves the selection alone on a modified click on nothing", () => {
    expect([...selectedAfter(selection, null, true)].sort()).toEqual([
      "a",
      "b",
    ]);
  });
});
