import { describe, expect, it, vi } from "vitest";
import {
  createMockScene,
  ErrorBoundary,
  Logger,
  Transform,
} from "@yagejs/core";
import { instantiateLevel, prepareLevel } from "@yagejs/level";
import { attached, catalog, layout, target } from "./fixtures.js";
import type { PlacementCommand, PlacementSnapshot } from "./types.js";

const place = (type: string, x: number, y = 100): PlacementCommand => ({
  kind: "place",
  type,
  target: target(x, y),
});

describe("PlacementLayout", () => {
  it("previews without allocating IDs or spending resources and revalidates at commit", () => {
    let credits = 1;
    const model = layout({
      rules: [
        {
          id: "credits",
          evaluate: () =>
            credits > 0
              ? []
              : [
                  {
                    code: "insufficient-materials",
                    message: "Requires one wood.",
                  },
                ],
        },
      ],
    });
    const listener = vi.fn();
    model.subscribe(listener);
    const command = place("table", 100);
    expect(model.preview(command).ok).toBe(true);
    expect(model.snapshot().objects).toHaveLength(0);
    expect(model.snapshot().nextId).toBe(1);
    credits = 0;
    expect(model.commit(command)).toMatchObject({
      ok: false,
      issues: [{ code: "insufficient-materials", rule: "credits" }],
    });
    expect(listener).toHaveBeenCalledTimes(1);
    credits = 1;
    expect(model.commit(command).ok).toBe(true);
    expect(model.snapshot().objects[0]?.id).toBe("p1");
  });

  it("checks rectangle unions, arbitrary rotation, edge contact and clearance", () => {
    const model = layout();
    expect(model.commit(place("table", 100)).ok).toBe(true);
    expect(model.commit(place("table", 160)).ok).toBe(true);
    expect(
      model
        .preview(place("table", 159))
        .issues.some((i) => i.code === "occupied"),
    ).toBe(true);
    expect(
      model
        .preview({
          kind: "place",
          type: "table",
          target: target(100, 147, Math.PI / 4),
        })
        .issues.some((i) => i.code === "occupied"),
    ).toBe(true);
    expect(
      model.preview({
        kind: "place",
        type: "table",
        target: target(100, 170, Math.PI / 4),
      }).ok,
    ).toBe(true);
    const roomy = layout({
      definitions: {
        ...model.definitions,
        table: { ...model.definitions.table!, clearance: 5 },
      },
    });
    roomy.commit(place("table", 100));
    expect(roomy.preview(place("table", 164)).ok).toBe(false);
    expect(roomy.preview(place("table", 165)).ok).toBe(true);
    expect(
      roomy
        .preview(place("table", 34))
        .issues.some((i) => i.code === "outside-area"),
    ).toBe(true);
    const union = layout({
      definitions: {
        ...model.definitions,
        table: {
          footprint: [
            { x: -30, y: -30, width: 60, height: 10 },
            { x: -30, y: -20, width: 10, height: 50 },
          ],
        },
      },
    });
    union.commit(place("table", 100));
    expect(union.preview(place("wall", 110, 110)).ok).toBe(true);
  });

  it("moves and rotates a parent with all descendants; rejection preserves every pose", () => {
    const model = layout();
    model.commit(place("table", 100));
    model.commit({
      kind: "place",
      type: "wall",
      target: attached("p1", "end"),
    });
    model.commit({
      kind: "place",
      type: "lamp",
      target: attached("p2", "hook"),
    });
    expect(model.snapshot().objects).toHaveLength(3);
    const move = {
      kind: "move",
      id: "p1",
      target: target(200, 200, Math.PI / 2),
    } as const;
    expect(model.preview(move).changes).toHaveLength(3);
    expect(model.worldPose("p2")).toMatchObject({ x: 140, y: 100 });
    expect(model.commit(move).ok).toBe(true);
    expect(model.worldPose("p3").x).toBeCloseTo(200);
    expect(model.worldPose("p3").y).toBeCloseTo(240);
    const saved = model.snapshot();
    expect(model.commit({ ...move, target: target(480) }).ok).toBe(false);
    expect(model.snapshot()).toBe(saved);
  });

  it("validates surface type, fit, capacity and fixed socket position", () => {
    const model = layout();
    model.commit(place("table", 100));
    expect(
      model
        .preview(place("lamp", 200))
        .issues.some((i) => i.code === "surface"),
    ).toBe(true);
    expect(
      model
        .preview({ kind: "place", type: "lamp", target: attached("p1", "end") })
        .issues.some((i) => i.code === "socket-type"),
    ).toBe(true);
    expect(
      model
        .preview({
          kind: "place",
          type: "lamp",
          target: attached("p1", "top", 30),
        })
        .issues.some((i) => i.code === "socket-bounds"),
    ).toBe(true);
    expect(
      model.commit({
        kind: "place",
        type: "lamp",
        target: attached("p1", "top", -12),
      }).ok,
    ).toBe(true);
    expect(
      model.commit({
        kind: "place",
        type: "lamp",
        target: attached("p1", "top", 12),
      }).ok,
    ).toBe(true);
    expect(
      model
        .preview({ kind: "place", type: "lamp", target: attached("p1", "top") })
        .issues.some((i) => i.code === "socket-occupied"),
    ).toBe(true);
    expect(
      model
        .preview({
          kind: "place",
          type: "wall",
          target: attached("p1", "end", 1),
        })
        .issues.some((i) => i.code === "socket-position"),
    ).toBe(true);
  });

  it("refuses dangling and cyclic attachment graphs as structured issues", () => {
    const model = layout();
    model.commit(place("table", 100));
    expect(
      model.preview({ kind: "place", type: "lamp", target: attached("absent") })
        .issues[0]?.code,
    ).toBe("attachment");
    expect(
      model.preview({
        kind: "place",
        type: "lamp",
        target: attached("p1", "constructor"),
      }).issues[0]?.code,
    ).toBe("attachment");
    const result = model.commit({
      kind: "move",
      id: "p1",
      target: attached("p1"),
    });
    expect(result.issues[0]?.code).toBe("attachment");
    expect(model.snapshot().objects[0]?.attachment).toBeUndefined();
  });

  it("requires explicit dependent removal and duplicates a complete subtree atomically", () => {
    const model = layout();
    model.commit(place("table", 100));
    model.commit({ kind: "place", type: "lamp", target: attached("p1") });
    expect(model.commit({ kind: "remove", id: "p1" }).issues[0]?.code).toBe(
      "has-dependents",
    );
    expect(
      model.commit({ kind: "duplicate", id: "p1", target: target(250) }).ok,
    ).toBe(true);
    expect(model.snapshot().objects[3]?.attachment?.parent).toBe("p3");
    expect(model.worldPose("p4").x).toBe(250);
    const before = model.snapshot();
    expect(
      model.commit({ kind: "duplicate", id: "p1", target: target(250) }).ok,
    ).toBe(false);
    expect(model.snapshot()).toBe(before);
    expect(model.commit({ kind: "remove", id: "p1", cascade: true }).ok).toBe(
      true,
    );
    expect(model.snapshot().objects.map((o) => o.id)).toEqual(["p3", "p4"]);
  });

  it("validates both source and destination area permissions, including descendants", () => {
    const base = layout();
    const model = layout({
      areas: {
        room: { ...base.areas.room!, permissions: { move: false } },
        other: { bounds: { x: 500, y: 0, width: 500, height: 400 } },
      },
    });
    model.commit(place("table", 100));
    expect(
      model.commit({
        kind: "move",
        id: "p1",
        target: { area: "other", pose: { x: 600, y: 100, rotation: 0 } },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "permission", area: "room" }],
    });
    const limited = layout({
      areas: { room: { ...base.areas.room!, capacity: 1 } },
    });
    limited.commit(place("table", 100));
    expect(limited.commit(place("table", 300)).issues[0]?.code).toBe(
      "area-capacity",
    );
  });

  it("uses existing parameter schemas and stores named variants and area finishes", () => {
    const model = layout();
    model.commit(place("table", 100));
    expect(model.commit({ kind: "modify", id: "p1", variant: "teal" }).ok).toBe(
      true,
    );
    expect(model.toLevelDocument().entities[0]?.params.color).toBe("teal");
    expect(
      model.commit({ kind: "modify", id: "p1", variant: "unknown" }).issues[0]
        ?.code,
    ).toBe("variant");
    expect(
      model
        .preview({
          kind: "place",
          type: "table",
          params: { color: "unknown" },
          target: target(200),
        })
        .issues.some((i) => i.code.startsWith("level-")),
    ).toBe(true);
    expect(
      model.commit({
        kind: "customize",
        area: "room",
        finishes: { floor: "tile" },
      }).ok,
    ).toBe(true);
    expect(
      model.commit({
        kind: "customize",
        area: "room",
        finishes: { floor: "lava" },
      }).ok,
    ).toBe(false);
    expect(model.snapshot().finishes.room?.floor).toBe("tile");
    expect(
      model.commit({
        kind: "customize",
        area: "room",
        finishes: { constructor: "bad" },
      }).issues[0]?.code,
    ).toBe("finish");
  });

  it("commits batches as one history entry and rejects all edits together", () => {
    const model = layout();
    expect(
      model.commit({
        kind: "batch",
        commands: [place("table", 100), place("table", 110)],
      }).ok,
    ).toBe(false);
    expect(model.snapshot().objects).toHaveLength(0);
    expect(
      model.commit({
        kind: "batch",
        commands: [place("table", 100), place("table", 300)],
      }).ok,
    ).toBe(true);
    expect(model.undo().ok).toBe(true);
    expect(model.snapshot().objects).toHaveLength(0);
    expect(model.redo().ok).toBe(true);
    expect(model.snapshot().objects).toHaveLength(2);
  });

  it("revalidates undo and redo without losing history after a refusal", () => {
    let locked = false;
    const model = layout({
      rules: [
        {
          id: "owner",
          evaluate: () =>
            locked ? [{ code: "locked", message: "Area is locked." }] : [],
        },
      ],
    });
    model.commit(place("table", 100));
    locked = true;
    expect(model.undo().ok).toBe(false);
    expect(model.canUndo).toBe(true);
    locked = false;
    expect(model.undo().ok).toBe(true);
    locked = true;
    expect(model.redo().ok).toBe(false);
    locked = false;
    expect(model.redo().ok).toBe(true);
    model.undo();
    model.commit(place("table", 300));
    expect(model.snapshot().objects[0]?.id).toBe("p2");
    expect(model.canRedo).toBe(false);
  });

  it("restores all durable state atomically and clears transient history", () => {
    const model = layout();
    model.commit(place("table", 100));
    model.commit({ kind: "place", type: "lamp", target: attached("p1") });
    model.commit({
      kind: "customize",
      area: "room",
      finishes: { floor: "tile" },
    });
    const saved = JSON.parse(
      JSON.stringify(model.snapshot()),
    ) as PlacementSnapshot;
    model.commit({ kind: "remove", id: "p1", cascade: true });
    expect(model.restore(saved).ok).toBe(true);
    expect(model.snapshot()).toEqual(saved);
    expect(model.canUndo).toBe(false);
    const invalid = {
      ...saved,
      objects: saved.objects.map((o) => ({
        ...o,
        pose: { x: 900, y: 900, rotation: 0 },
      })),
    };
    expect(model.restore(invalid).ok).toBe(false);
    expect(model.snapshot()).toEqual(saved);
  });

  it("rejects a zero saved ID counter before replacing the current layout", () => {
    const model = layout();
    const empty = model.snapshot();
    model.commit(place("table", 100));
    const before = model.snapshot();
    expect(() => model.restore({ ...empty, nextId: 0 })).toThrow(
      "positive safe integer",
    );
    expect(model.snapshot()).toBe(before);
    expect(model.canUndo).toBe(true);
    expect(model.commit(place("table", 300)).after.objects.at(-1)?.id).toBe(
      "p2",
    );
  });

  it("remaps catalog references within copied subtrees, including definition and variant defaults", () => {
    for (const source of ["params", "definition", "variant"] as const) {
      const base = layout();
      const model = layout({
        definitions: {
          ...base.definitions,
          wall: {
            ...base.definitions.wall!,
            ...(source === "definition" ? { params: { owner: "p1" } } : {}),
            ...(source === "variant"
              ? { variants: { linked: { owner: "p1" } } }
              : {}),
          },
        },
      });
      model.commit(place("table", 100));
      expect(
        model.commit({
          kind: "place",
          type: "wall",
          target: attached("p1", "end"),
          ...(source === "params" ? { params: { owner: "p1" } } : {}),
          ...(source === "variant" ? { variant: "linked" } : {}),
        }).ok,
      ).toBe(true);
      expect(
        model.commit({ kind: "duplicate", id: "p1", target: target(300) }).ok,
      ).toBe(true);
      expect(
        model.toLevelDocument().entities.find((e) => e.id === "p4")?.params
          .owner,
      ).toBe("p3");
      expect(model.commit({ kind: "remove", id: "p1", cascade: true }).ok).toBe(
        true,
      );
      expect(
        prepareLevel(model.toLevelDocument(), catalog).diagnostics,
      ).toEqual([]);
    }
    const external = layout();
    external.commit(place("table", 100));
    external.commit(place("table", 300));
    external.commit({
      kind: "place",
      type: "wall",
      target: attached("p1", "end"),
      params: { owner: "p2" },
    });
    external.commit({ kind: "duplicate", id: "p1", target: target(100, 250) });
    expect(external.toLevelDocument().entities.at(-1)?.params.owner).toBe("p2");
  });

  it("clears a named variant and lets explicit instance parameters override its defaults", () => {
    const model = layout();
    model.commit({
      ...place("table", 100),
      variant: "teal",
    } as PlacementCommand);
    expect(model.toLevelDocument().entities[0]?.params.color).toBe("teal");
    model.commit({ kind: "modify", id: "p1", variant: null });
    expect(model.snapshot().objects[0]?.variant).toBeUndefined();
    expect(model.toLevelDocument().entities[0]?.params.color).toBe("oak");
    model.commit({
      kind: "modify",
      id: "p1",
      variant: "teal",
      params: { color: "oak" },
    });
    expect(model.toLevelDocument().entities[0]?.params.color).toBe("oak");
    model.commit({ kind: "modify", id: "p1", params: {} });
    expect(model.toLevelDocument().entities[0]?.params.color).toBe("teal");
  });

  it("reuses unchanged geometry while reevaluating dynamic policies and invalidates after an edit", () => {
    let locked = false;
    const evaluate = vi.fn(() =>
      locked ? [{ code: "locked", message: "Locked." }] : [],
    );
    const model = layout({ rules: [{ id: "access", evaluate }] });
    const command = {
      kind: "place",
      type: "table",
      target: target(100),
    } as const;
    const first = model.preview(command);
    locked = true;
    const second = model.preview(structuredClone(command));
    expect(second.after).toBe(first.after);
    expect(second.ok).toBe(false);
    expect(model.commit(command).ok).toBe(false);
    locked = false;
    expect(model.commit(place("table", 100)).ok).toBe(true);
    expect(model.preview(command).issues[0]?.code).toBe("occupied");
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it("exports a real level with correctly composed child transforms", () => {
    const model = layout();
    model.commit(place("table", 100));
    model.commit({
      kind: "place",
      type: "wall",
      target: attached("p1", "end"),
    });
    const prepared = prepareLevel(model.toLevelDocument(), catalog);
    expect(prepared.diagnostics).toEqual([]);
    const { scene } = createMockScene();
    const instance = instantiateLevel(scene, prepared, { namespace: "placed" });
    expect(instance.get("p2")?.get(Transform).worldPosition.x).toBe(140);
    instance.dispose();
  });

  it("throws on nonfinite writes and leaves state and history unchanged", () => {
    const model = layout();
    for (const n of [NaN, Infinity, -Infinity])
      expect(() => model.commit(place("table", n))).toThrow("finite number");
    expect(() =>
      model.commit({
        kind: "place",
        type: "table",
        target: target(100),
        params: { number: NaN },
      }),
    ).toThrow("finite number");
    expect(() => layout({ historyLimit: Infinity })).toThrow("safe integer");
    expect(model.snapshot().objects).toHaveLength(0);
  });

  it("owns immutable copies of commands, configuration, snapshots and rule results", () => {
    const model = layout();
    const command = place("table", 100);
    const result = model.commit(command);
    expect(Object.isFrozen(result.after.objects[0]?.pose)).toBe(true);
    expect(() => {
      (result.after.objects[0]!.pose as { x: number }).x = 900;
    }).toThrow();
    expect(model.worldPose("p1").x).toBe(100);
  });

  it("does not freeze caller-owned query data or cache shallow-frozen external snapshots", () => {
    const model = layout();
    model.commit(place("table", 100));
    model.commit({ kind: "place", type: "lamp", target: attached("p1") });
    const snapshot = structuredClone(model.snapshot());
    Object.freeze(snapshot);
    expect(model.worldPose("p2", snapshot).x).toBe(100);
    const child = snapshot.objects[1]!.pose as { x: number };
    child.x = 10;
    expect(model.worldPose("p2", snapshot).x).toBe(110);
    const root = snapshot.objects[0]!.pose as { x: number };
    model.worldPose("p1", snapshot);
    root.x = 120;
    expect(model.worldPose("p2", snapshot).x).toBe(130);
    expect(model.worldPose("p2").x).toBe(100);
    expect(Object.isFrozen(model.worldPose("p2"))).toBe(true);
  });

  it("attributes rule errors, stops dispatch on listener errors and refuses reentrancy", () => {
    const boundary = new ErrorBoundary(new Logger({ output: () => {} }));
    const model = layout({
      errorBoundary: boundary,
      rules: [
        {
          id: "broken",
          evaluate: () => {
            throw new Error("rule failed");
          },
        },
      ],
    });
    expect(() => model.commit(place("table", 100))).toThrow("rule failed");
    expect(boundary.getCallbackErrors()[0]?.kind).toBe("Placement rule broken");
    expect(model.snapshot().objects).toHaveLength(0);
    const good = layout({ errorBoundary: boundary });
    const later = vi.fn();
    good.subscribe(() => {
      throw new Error("listener failed");
    });
    good.subscribe(later);
    expect(() => good.commit(place("table", 100))).toThrow("listener failed");
    expect(later).not.toHaveBeenCalled();
    expect(good.snapshot().objects).toHaveLength(1);
    const nested = layout({ errorBoundary: boundary });
    nested.subscribe(() => nested.commit(place("table", 300)));
    expect(() => nested.commit(place("table", 100))).toThrow("reentrant");
    expect(nested.snapshot().objects).toHaveLength(1);
  });
});
