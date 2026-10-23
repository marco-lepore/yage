import { describe, it, expect } from "vitest";
import { emptySequenceWorkspace } from "../document/index.js";
import {
  addContractProperty,
  removeContractProperty,
  addContractEvent,
  editPayloadField,
  removeContractEvent,
  removeSequenceKeys,
} from "./authoring.js";
const base = () => ({
  ...emptySequenceWorkspace("test").sequence,
  targets: { actor: { properties: {}, events: {} } },
});
describe("sequence authoring operations", () => {
  it("adds typed properties and removes their tracks together", () => {
    let doc = addContractProperty(base(), "actor", "state", {
      kind: "enum",
      values: ["idle", "walk"],
    });
    doc = {
      ...doc,
      tracks: [
        {
          id: "t",
          target: "actor",
          property: "state",
          keys: [{ id: "k", frame: 0, value: "idle", curve: "hold" }],
        },
      ],
    };
    expect(removeContractProperty(doc, "actor", "state").tracks).toEqual([]);
    expect(() =>
      addContractProperty(doc, "actor", "state", { kind: "number" }),
    ).toThrow("unique");
  });
  it("updates existing event payloads atomically when a field is added or removed", () => {
    let doc = addContractEvent(base(), "actor", "cue");
    doc = {
      ...doc,
      events: [
        { id: "e", frame: 4, target: "actor", event: "cue", payload: {} },
      ],
    };
    doc = editPayloadField(doc, "actor", "cue", "enabled", { kind: "boolean" });
    expect(doc.events[0]?.payload).toEqual({ enabled: true });
    doc = editPayloadField(doc, "actor", "cue", "enabled", undefined);
    expect(doc.events[0]?.payload).toEqual({});
    expect(removeContractEvent(doc, "actor", "cue").events).toEqual([]);
  });
  it("deletes multiple keys together but refuses a selection containing an initial key", () => {
    const doc = {
      ...base(),
      targets: {
        actor: { properties: { n: { kind: "number" as const } }, events: {} },
      },
      tracks: [
        {
          id: "t",
          target: "actor",
          property: "n",
          keys: [0, 10, 20].map((frame) => ({
            id: String(frame),
            frame,
            value: frame,
            curve: "linear" as const,
          })),
        },
      ],
    };
    expect(removeSequenceKeys(doc, ["10", "20"]).tracks[0]?.keys).toHaveLength(
      1,
    );
    expect(() => removeSequenceKeys(doc, ["0", "10"])).toThrow("Frame-zero");
    expect(doc.tracks[0]?.keys).toHaveLength(3);
  });
});
