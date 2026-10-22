import { describe, expect, it } from "vitest";
import { emptySequenceWorkspace } from "../document/index.js";
import { reduceSequenceCommand } from "./commands.js";

describe("rename-actor", () => {
  const actor = () => {
    const added = reduceSequenceCommand(
      emptySequenceWorkspace("test").sequence,
      {
        kind: "add-actor",
        id: "hero",
        contract: {
          properties: { rotation: { kind: "number" } },
          events: { wave: {} },
        },
        tracks: [
          {
            id: "t",
            target: "hero",
            property: "rotation",
            keys: [{ id: "k", frame: 0, value: 0, curve: "linear" }],
          },
        ],
      },
    );
    return reduceSequenceCommand(added, {
      kind: "set-event",
      event: { id: "e", frame: 0, target: "hero", event: "wave", payload: {} },
    });
  };

  it("renames the slot, its tracks and its markers together", () => {
    const renamed = reduceSequenceCommand(actor(), {
      kind: "rename-actor",
      id: "hero",
      to: "lead",
    });
    expect(Object.keys(renamed.targets)).toEqual(["lead"]);
    expect(renamed.tracks.map((t) => t.target)).toEqual(["lead"]);
    expect(renamed.events.map((e) => e.target)).toEqual(["lead"]);
  });

  it("refuses an unknown slot and an empty or taken name", () => {
    const doc = actor();
    expect(() =>
      reduceSequenceCommand(doc, {
        kind: "rename-actor",
        id: "ghost",
        to: "x",
      }),
    ).toThrow("Unknown actor ghost");
    expect(() =>
      reduceSequenceCommand(doc, { kind: "rename-actor", id: "hero", to: " " }),
    ).toThrow("Choose a unique nonempty actor slot");
  });
});
