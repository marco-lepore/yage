import { describe, expect, it } from "vitest";
import {
  emptySequenceWorkspace,
  formatEditorDocument,
  readEditorDocument,
} from "./index.js";
describe("sequence workspace files", () => {
  it("round trips clip and preview data through the shared codec", () => {
    const doc = emptySequenceWorkspace("entrance");
    const decoded = readEditorDocument(formatEditorDocument(doc));
    expect(decoded).toEqual({ ok: true, document: doc });
  });
  it("rejects bad clips before a document can enter a draft", () => {
    const doc = emptySequenceWorkspace("entrance");
    expect(
      readEditorDocument({
        ...doc,
        sequence: { ...doc.sequence, fps: Infinity },
      }).ok,
    ).toBe(false);
    expect(
      readEditorDocument({ ...doc, bindings: { missing: "actor" } }).ok,
    ).toBe(false);
  });
  it("refuses a bound actor whose previewed property has another kind", () => {
    const doc = emptySequenceWorkspace("entrance");
    const sequence = {
      ...doc.sequence,
      targets: {
        hero: { properties: { opacity: { kind: "color" } }, events: {} },
      },
    };
    expect(
      readEditorDocument({ ...doc, sequence, bindings: { hero: "a" } }),
    ).toEqual({
      ok: false,
      errors: [
        {
          path: "sequence",
          message:
            "hero.opacity is declared as color, but the transform and " +
            "visual targets provide it as number",
        },
      ],
    });
    // An unbound slot has no preview, so its contract is the game's to bind.
    expect(readEditorDocument({ ...doc, sequence }).ok).toBe(true);
  });
});
