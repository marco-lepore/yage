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
});
