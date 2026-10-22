import { describe, expect, it } from "vitest";
import { emptySequenceWorkspace } from "../../shared/document/index.js";
import { sequenceClipOf } from "./sequence.js";

describe("sequenceClipOf", () => {
  it("builds one clip per stored document", () => {
    const document = emptySequenceWorkspace("test").sequence;
    expect(sequenceClipOf(document)).toBe(sequenceClipOf(document));
    // A new document object is a new clip, even with equal contents.
    expect(sequenceClipOf({ ...document })).not.toBe(sequenceClipOf(document));
  });
});
