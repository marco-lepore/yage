import { describe, it, expect } from "vitest";
import { parseSequence } from "@yagejs-addons/sequence/document";
import type { SequenceProperty } from "@yagejs-addons/sequence/document";
import { emptySequenceWorkspace } from "../document/index.js";
import { initialSequenceTrack } from "./defaults.js";
describe("contract-based initial tracks", () => {
  for (const definition of [
    { kind: "number" },
    { kind: "vector" },
    { kind: "position" },
    { kind: "color" },
    { kind: "boolean" },
    { kind: "enum", values: ["idle", "walk"] },
  ] satisfies SequenceProperty[]) {
    it(`creates a valid ${definition.kind} track`, () => {
      const doc = emptySequenceWorkspace("test").sequence;
      const track = initialSequenceTrack(
        "track",
        "key",
        "actor",
        "value",
        definition,
      );
      expect(() =>
        parseSequence({
          ...doc,
          targets: { actor: { properties: { value: definition }, events: {} } },
          tracks: [track],
        }),
      ).not.toThrow();
    });
  }
});
