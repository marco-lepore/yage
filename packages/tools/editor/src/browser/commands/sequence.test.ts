import { describe, it, expect } from "vitest";
import type { LevelPlacement } from "@yagejs/level/document";
import { emptySequenceWorkspace } from "../../shared/document/index.js";
import { reduceCommand } from "../../shared/commands/index.js";
import { EditorStore } from "../store/index.js";
import { EditorApiClient } from "../api/index.js";
import { sampledDocument } from "../store/sequence.js";
import {
  sequenceIntent,
  cloneSequenceActors,
  sequenceChange,
  newSequenceTrack,
  remapSequenceTrack,
} from "./sequence.js";
const placement = (id: string): LevelPlacement => ({
  id,
  type: "actor",
  typeVersion: 1,
  active: true,
  params: {},
  extensions: {},
  transform: {
    position: { x: 100, y: 50 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  },
});
function state() {
  const store = new EditorStore({
    api: new EditorApiClient({ token: "test" }),
    epoch: "test",
    projectId: "test",
    levels: [],
  });
  const document = emptySequenceWorkspace("demo");
  return {
    ...store.getState(),
    document,
    sequence: {
      frame: 0,
      playing: false,
      loop: false,
      speed: 1,
      width: 960,
      height: 540,
      fit: "stretch" as const,
      events: [],
    },
  };
}
function actors() {
  const s = state();
  const result = reduceCommand(
    s.document,
    sequenceIntent(s, {
      kind: "add-placements",
      commandId: "add",
      inserts: [{ placement: placement("a"), index: 0 }],
    }),
  );
  return { ...s, document: result.document };
}
describe("sequence manipulation through document commands", () => {
  it("adds and deletes complete actors in a single invertible transaction", () => {
    const s = actors();
    expect(Object.values(s.document.bindings)).toEqual(["a"]);
    expect(s.document.sequence.tracks).toHaveLength(5);
    const deleted = reduceCommand(
      s.document,
      sequenceIntent(s, {
        kind: "remove-placements",
        commandId: "delete",
        ids: ["a"],
      }),
    );
    expect(deleted.document.entities).toEqual([]);
    expect(deleted.document.sequence.targets).toEqual({});
    expect(reduceCommand(deleted.document, deleted.inverse).document).toEqual(
      s.document,
    );
  });
  it("keys sampled movement at the cursor with inverse frame mapping, without rewriting base poses", () => {
    const s = actors();
    s.sequence = { ...s.sequence, frame: 60, width: 1920, height: 1080 };
    const p = sampledDocument(s).entities[0]!;
    expect(p.transform.position).toEqual({ x: 200, y: 100 });
    const result = reduceCommand(
      s.document,
      sequenceIntent(s, {
        kind: "set-poses",
        commandId: "move",
        poses: [
          {
            id: "a",
            transform: {
              ...p.transform,
              position: { x: 600, y: 400 },
              rotation: 1,
              scale: { x: 2, y: 3 },
            },
          },
        ],
      }),
    );
    expect(result.document.entities).toEqual(s.document.entities);
    expect(
      result.document.sequence.tracks
        .find((t) => t.property === "position")
        ?.keys.at(-1)?.value,
    ).toEqual({ x: 300, y: 200 });
    expect(
      sampledDocument({ ...s, document: result.document }).entities[0]
        ?.transform,
    ).toEqual({
      position: { x: 600, y: 400 },
      rotation: 1,
      scale: { x: 2, y: 3 },
    });
    expect(reduceCommand(result.document, result.inverse).document).toEqual(
      s.document,
    );
  });
  it("duplicates keys and markers with new identities and the placement offset", () => {
    const s = actors();
    const slot = Object.keys(s.document.sequence.targets)[0]!;
    s.document = {
      ...s.document,
      sequence: {
        ...s.document.sequence,
        events: [
          { id: "cue", frame: 40, target: slot, event: "cue", payload: {} },
        ],
      },
    };
    const b = placement("b");
    const insert = {
      ...b,
      transform: { ...b.transform, position: { x: 150, y: 70 } },
    };
    const result = reduceCommand(
      s.document,
      cloneSequenceActors(
        s,
        {
          kind: "add-placements",
          commandId: "clone",
          inserts: [{ placement: insert, index: 1 }],
        },
        ["a"],
      ),
    );
    expect(result.document.sequence.events).toHaveLength(2);
    const copy = result.document.sequence.tracks.filter(
      (t) => t.target !== slot,
    );
    expect(copy).toHaveLength(5);
    expect(copy.find((t) => t.property === "position")?.keys[0]?.value).toEqual(
      { x: 150, y: 70 },
    );
    expect(
      new Set(
        result.document.sequence.tracks.flatMap((t) => t.keys.map((k) => k.id)),
      ).size,
    ).toBe(10);
    expect(reduceCommand(result.document, result.inverse).document).toEqual(
      s.document,
    );
  });
  it("rejects a stale timeline commit instead of replacing newer edits", () => {
    const s = actors();
    const pending = sequenceChange(s.document, {
      ...s.document.sequence,
      name: "drag",
    });
    expect(() =>
      reduceCommand(
        { ...s.document, sequence: { ...s.document.sequence, name: "newer" } },
        pending,
      ),
    ).toThrow("Sequence changed");
  });
  it("samples world position under an animated parent without scaling the child twice", () => {
    const s = actors();
    const parent = {
      ...placement("parent"),
      transform: {
        position: { x: 40, y: 20 },
        rotation: Math.PI / 2,
        scale: { x: 2, y: 2 },
      },
    };
    s.document = {
      ...s.document,
      entities: [parent, { ...s.document.entities[0]!, parent: "parent" }],
    };
    const child = sampledDocument(s).entities[1]!;
    expect(child.transform.position.x).toBeCloseTo(15);
    expect(child.transform.position.y).toBeCloseTo(-30);
    expect(child.transform.scale).toEqual({ x: 1, y: 1 });
  });
});

describe("sequence coordinate regressions", () => {
  it("inverse maps initial position keys in a resized preview", () => {
    const s = state();
    s.sequence = { ...s.sequence, width: 1920, height: 1080 };
    const p = placement("new");
    const result = reduceCommand(
      s.document,
      sequenceIntent(s, {
        kind: "add-placements",
        commandId: "new",
        inserts: [{ placement: p, index: 0 }],
      }),
    );
    expect(
      sampledDocument({ ...s, document: result.document }).entities[0]
        ?.transform.position,
    ).toEqual(p.transform.position);
  });
  it("inverse maps the baseline of a newly created position track", () => {
    const s = actors();
    s.sequence = { ...s.sequence, width: 1920, height: 1080, frame: 60 };
    s.document = {
      ...s.document,
      sequence: {
        ...s.document.sequence,
        tracks: s.document.sequence.tracks.filter(
          (t) => t.property !== "position",
        ),
      },
    };
    const p = s.document.entities[0]!;
    const result = reduceCommand(
      s.document,
      sequenceIntent(s, {
        kind: "set-poses",
        commandId: "key",
        poses: [
          {
            id: p.id,
            transform: { ...p.transform, position: { x: 300, y: 200 } },
          },
        ],
      }),
    );
    expect(
      sampledDocument({
        ...s,
        document: result.document,
        sequence: { ...s.sequence, frame: 0 },
      }).entities[0]?.transform.position,
    ).toEqual(p.transform.position);
    expect(
      sampledDocument({ ...s, document: result.document }).entities[0]
        ?.transform.position,
    ).toEqual({ x: 300, y: 200 });
  });
  it("reorders sampled actors using authored preconditions without changing their base pose", () => {
    const s = actors();
    s.sequence = { ...s.sequence, width: 1920, height: 1080 };
    s.document = {
      ...s.document,
      entities: [...s.document.entities, placement("b")],
    };
    const sample = sampledDocument(s).entities[0]!;
    const result = reduceCommand(
      s.document,
      sequenceIntent(s, {
        kind: "move-placements",
        commandId: "order",
        moves: [
          {
            id: "a",
            from: { index: 0, transform: sample.transform },
            to: { index: 1, transform: sample.transform },
          },
        ],
      }),
    );
    expect(result.document.entities.map((p) => p.id)).toEqual(["b", "a"]);
    expect(result.document.entities[1]?.transform).toEqual(
      s.document.entities[0]?.transform,
    );
    expect(reduceCommand(result.document, result.inverse).document).toEqual(
      s.document,
    );
  });
  it("reparents at the sampled pose and keys local rotation and scale", () => {
    const s = actors();
    s.sequence = { ...s.sequence, frame: 60 };
    const parent = {
      ...placement("parent"),
      transform: {
        position: { x: 40, y: 20 },
        rotation: Math.PI / 2,
        scale: { x: 2, y: 2 },
      },
    };
    s.document = { ...s.document, entities: [parent, ...s.document.entities] };
    const a = sampledDocument(s).entities[1]!;
    const result = reduceCommand(
      s.document,
      sequenceIntent(s, {
        kind: "move-placements",
        commandId: "parent",
        moves: [
          {
            id: "a",
            from: { index: 1, transform: a.transform },
            to: {
              index: 1,
              parent: "parent",
              transform: {
                position: { x: 15, y: -30 },
                rotation: -Math.PI / 2,
                scale: { x: 0.5, y: 0.5 },
              },
            },
          },
        ],
      }),
    );
    const sampled = sampledDocument({ ...s, document: result.document })
      .entities[1]!;
    expect(sampled.parent).toBe("parent");
    expect(sampled.transform.rotation).toBeCloseTo(-Math.PI / 2);
    expect(sampled.transform.scale).toEqual({ x: 0.5, y: 0.5 });
    expect(sampled.transform.position.x).toBeCloseTo(15);
    expect(sampled.transform.position.y).toBeCloseTo(-30);
    expect(reduceCommand(result.document, result.inverse).document).toEqual(
      s.document,
    );
  });
  it("does not interpret unrelated custom kinds as entity transforms", () => {
    const s = actors();
    const slot = Object.keys(s.document.sequence.targets)[0]!;
    s.document = {
      ...s.document,
      sequence: {
        ...s.document.sequence,
        targets: {
          [slot]: { properties: { position: { kind: "number" } }, events: {} },
        },
        tracks: [
          {
            id: "custom",
            target: slot,
            property: "position",
            keys: [{ id: "custom-key", frame: 0, value: 4, curve: "linear" }],
          },
        ],
      },
    };
    expect(sampledDocument(s).entities[0]?.transform).toEqual(
      s.document.entities[0]?.transform,
    );
  });
});

it("seeds added standard tracks from the sampled pose in a resized frame", () => {
  const s = actors();
  s.sequence = { ...s.sequence, width: 1920, height: 1080 };
  s.document = {
    ...s.document,
    sequence: { ...s.document.sequence, tracks: [] },
  };
  const track = newSequenceTrack(
    s,
    Object.keys(s.document.sequence.targets)[0]!,
    "position",
  );
  expect(track.keys[0]?.value).toEqual({ x: 50, y: 25 });
  expect(
    newSequenceTrack(s, Object.keys(s.document.sequence.targets)[0]!, "scale")
      .keys[0]?.value,
  ).toEqual({ x: 1, y: 1 });
});

it("changes position mapping without moving its preview trajectory", () => {
  const s = actors();
  s.sequence = { ...s.sequence, width: 1920, height: 1080 };
  const track = s.document.sequence.tracks.find(
    (t) => t.property === "position",
  )!;
  const changed = remapSequenceTrack(s, track.id, {
    mode: "anchored",
    anchor: { x: 0.5, y: 1 },
  });
  const doc = {
    ...s.document,
    sequence: {
      ...s.document.sequence,
      tracks: s.document.sequence.tracks.map((t) =>
        t.id === track.id ? changed : t,
      ),
    },
  };
  expect(
    sampledDocument({ ...s, document: doc }).entities[0]?.transform,
  ).toEqual(sampledDocument(s).entities[0]?.transform);
});

it("keeps unbound preview transforms in the same undo as actor keys", () => {
  const s = actors();
  const context = placement("context");
  s.document = { ...s.document, entities: [...s.document.entities, context] };
  const poses = s.document.entities.map((p) => ({
    id: p.id,
    transform: {
      ...p.transform,
      position: { x: 200, y: 80 },
      rotation: 0.5,
      scale: { x: 2, y: 3 },
    },
  }));
  for (const changes of [poses.filter((p) => p.id === "context"), poses]) {
    const result = reduceCommand(
      s.document,
      sequenceIntent(s, {
        kind: "set-poses",
        commandId: "move",
        poses: changes,
      }),
    );
    expect(
      result.document.entities.find((p) => p.id === "context")?.transform,
    ).toEqual(poses[1]?.transform);
    expect(result.document.entities[0]?.transform).toEqual(
      s.document.entities[0]?.transform,
    );
    if (changes.length === 2)
      expect(
        sampledDocument({ ...s, document: result.document }).entities[0]
          ?.transform,
      ).toEqual(poses[0]?.transform);
    expect(reduceCommand(result.document, result.inverse).document).toEqual(
      s.document,
    );
  }
});
