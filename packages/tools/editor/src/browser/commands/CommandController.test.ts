import type { AssetHandle } from "@yagejs/core";
import {
  defineLevelAsset,
  defineParams,
  param,
  type LevelCatalog,
  type LevelCatalogEntry,
} from "@yagejs/level";
import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";
import { beforeEach, describe, expect, it } from "vitest";
import type { DocumentCommand, PoseEdit } from "../../shared/commands/index.js";
import type {
  DraftOutcome,
  DraftSnapshot,
} from "../../shared/protocol/index.js";
import { EditorApiClient } from "../api/index.js";
import { EditorStore, isDirty, type EditorPoint } from "../store/index.js";
import {
  CommandController,
  type GestureModifiers,
} from "./CommandController.js";
import { axisOf, diagonalOf, parentWorld, toWorld, TURN_STEP } from "./pose.js";
import {
  ARM_PIXELS,
  HANDLE_PIXELS,
  UNIFORM_FRACTION,
  handleAt,
} from "../preview/gizmo.js";

function placement(
  id: string,
  x: number,
  parent?: string,
  overrides: Partial<LevelPlacement> = {},
): LevelPlacement {
  return {
    id,
    type: "game.crate",
    typeVersion: 1,
    active: true,
    transform: { position: { x, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    params: {},
    extensions: {},
    ...(parent === undefined ? {} : { parent }),
    ...overrides,
  };
}

function document(...placements: LevelPlacement[]): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id: "forest",
    metadata: {},
    entities: placements,
    extensions: {},
  };
}

function snapshot(revision: number, doc: LevelDocument): DraftSnapshot {
  return {
    path: "levels/forest.yage-level.json",
    epoch: "epoch-1",
    document: doc,
    draftRevision: revision,
    diskRevision: "disk-1",
    contentHash: `content-${String(revision)}`,
    savedContentHash: "content-0",
    dirty: revision > 0,
    history: { undoDepth: 0, redoDepth: 0 },
  };
}

const textureAsset = defineLevelAsset({
  kind: "texture",
  create: (path: string) => ({ type: "texture", path }) as AssetHandle<unknown>,
});

/** One project type with a parameter, and one contributed by a package. */
function catalog(): LevelCatalog {
  const entries: LevelCatalogEntry[] = [
    {
      id: "game.crate",
      declaration: {
        id: "game.crate",
        version: 3,
        params: defineParams({
          texture: param.asset(textureAsset, "sprites/crate.png"),
        }),
      },
      EntityClass: {} as LevelCatalogEntry["EntityClass"],
      source: "project",
    },
    {
      id: "game.switch",
      declaration: {
        id: "game.switch",
        version: 1,
        params: defineParams({
          door: param.entityRef({ types: ["game.crate"] }),
        }),
      },
      EntityClass: {} as LevelCatalogEntry["EntityClass"],
      source: "project",
    },
    {
      id: "renderer.sprite",
      declaration: { id: "renderer.sprite", version: 1 },
      EntityClass: {} as LevelCatalogEntry["EntityClass"],
      source: "package",
      packageName: "@yagejs/renderer",
    },
  ];
  return {
    entries,
    contributions: [],
    get: (typeId) => entries.find((entry) => entry.id === typeId),
  };
}

function createHarness(initial: LevelDocument) {
  let doc = initial;
  const sent: DocumentCommand[] = [];
  const steps: string[] = [];
  const answers: DraftOutcome[] = [];
  let revision = 0;
  let held: (() => void) | undefined;

  const fetchImpl: typeof globalThis.fetch = async (url, init) => {
    const route = String(url);
    if (route.includes("/draft/undo")) steps.push("undo");
    else if (route.includes("/draft/redo")) steps.push("redo");
    else {
      const body = JSON.parse(String(init?.body)) as {
        command: DocumentCommand;
      };
      sent.push(body.command);
    }
    // Answers are handed out only when the test releases them, so a test can
    // observe the window where a command is sent and not yet accepted.
    if (held) await new Promise<void>((resolve) => (held = resolve));
    const answer = answers.shift() ?? {
      status: "accepted" as const,
      snapshot: snapshot((revision += 1), doc),
    };
    return new Response(JSON.stringify(answer), { status: 200 });
  };

  const store = new EditorStore({
    api: new EditorApiClient({ token: "t", fetch: fetchImpl }),
    epoch: "epoch-1",
    projectId: "project-1",
  });
  store.dispatch({ type: "level-opened", snapshot: snapshot(0, doc) });
  // Off unless a case turns it on: most of these cases are about the pose
  // maths, and a lattice would round every number they assert. `view.test.ts`
  // owns the shipped default.
  store.dispatch({ type: "snap-toggled" });

  const drafts: PoseEdit[][] = [];
  let center: { x: number; y: number } | undefined = { x: 100, y: 50 };
  let built: LevelCatalog | undefined = catalog();
  let counter = 0;

  // What the cascade would step to, when a case wants to prove it is used.
  let cascade: (point: { x: number; y: number }) => {
    x: number;
    y: number;
  } = (point) => point;

  const probed: { x: number; y: number }[] = [];
  const preview = {
    applyPoseDraft(poses: readonly PoseEdit[]) {
      drafts.push([...poses]);
    },
    viewportCenter: () => center,
    freeSpotNear: (point: { x: number; y: number }) => {
      probed.push(point);
      return cascade(point);
    },
  };
  const commands = new CommandController({
    store,
    preview,
    catalog: () => built,
    newId: () => `id-${String((counter += 1))}`,
  });

  return {
    store,
    commands,
    preview,
    sent,
    steps,
    drafts,
    /** Every point the cascade was asked to start from. */
    probed,
    /** The pose commands, which most of these tests are about. */
    get poses(): readonly (readonly PoseEdit[])[] {
      return sent
        .filter((command) => command.kind === "set-poses")
        .map((command) => command.poses);
    },
    /** Put the gestures on a lattice, as the shipped default does. */
    withSnap(step: number): void {
      store.dispatch({ type: "snap-toggled" });
      store.dispatch({ type: "step-changed", step });
    },
    /** Make the cascade step, as a crowded spot would. */
    withCascade(by: { x: number; y: number }): void {
      cascade = (point) => ({ x: point.x + by.x, y: point.y + by.y });
    },
    /** What the server answers with from here on, as another writer would. */
    withDocument(next: LevelDocument): void {
      doc = next;
    },
    withoutCatalog(): void {
      built = undefined;
    },
    withoutView(): void {
      center = undefined;
    },
    hold(): void {
      held = () => {};
    },
    release(): void {
      const resolve = held;
      held = undefined;
      resolve?.();
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("CommandController", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness(document(placement("crate", 0)));
  });

  it("turns a whole drag into one command", async () => {
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 5, y: 0 });
    harness.commands.updateGesture({ x: 25, y: 10 });
    await harness.commands.settleEdits();

    expect(harness.poses).toHaveLength(1);
    expect(harness.poses[0]).toEqual([
      {
        id: "crate",
        transform: {
          position: { x: 25, y: 10 },
          rotation: 0,
          scale: { x: 1, y: 1 },
        },
      },
    ]);
  });

  it("shows every pointer move in the preview before the drag ends", () => {
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 5, y: 0 });
    harness.commands.updateGesture({ x: 9, y: 0 });

    expect(
      harness.drafts.map((draft) => draft[0]?.transform.position.x),
    ).toEqual([5, 9]);
    // Nothing is sent until the drag ends: one drag is one edit.
    expect(harness.sent).toEqual([]);
  });

  it("sends nothing for a drag that did not move", async () => {
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 4, y: 4 } });
    harness.commands.updateGesture({ x: 4, y: 4 });
    await harness.commands.settleEdits();

    expect(harness.sent).toEqual([]);
  });

  it("puts the preview back on the document when a drag is cancelled", () => {
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 40, y: 0 });
    harness.commands.cancelGesture();

    expect(harness.drafts.at(-1)).toEqual([
      {
        id: "crate",
        transform: {
          position: { x: 0, y: 0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
        },
      },
    ]);
    expect(harness.store.getState().gesture).toBeUndefined();
  });

  it("refuses to start a drag while writes are locked", () => {
    harness.store.lockWrites("stale-command");
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });

    expect(harness.store.getState().gesture).toBeUndefined();
  });

  it("ignores a drag on a placement the document does not have", () => {
    harness.commands.beginGesture({ ids: ["ghost"], origin: { x: 0, y: 0 } });

    expect(harness.store.getState().gesture).toBeUndefined();
  });

  it("keeps the running drag when a second pointer goes down", () => {
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 90, y: 90 } });

    // Replacing it would lose the first drag's movement with no command and
    // nothing said, and both pointers would then move one gesture.
    expect(harness.store.getState().gesture?.origin).toEqual({ x: 0, y: 0 });
  });

  it("puts the preview back when the edit is refused at the end of a drag", async () => {
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 55, y: 0 });
    harness.store.lockWrites("stale-command");
    await harness.commands.settleEdits();

    expect(harness.sent).toEqual([]);
    // Without this the preview keeps showing a pose no document holds.
    expect(harness.drafts.at(-1)?.[0]?.transform.position.x).toBe(0);
  });

  describe("settleEdits", () => {
    it("does nothing when there is no drag and nothing in flight", async () => {
      await expect(harness.commands.settleEdits()).resolves.toBeUndefined();
      expect(harness.sent).toEqual([]);
    });

    it("waits for a command that was sent before it was called", async () => {
      harness.hold();
      harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
      harness.commands.updateGesture({ x: 10, y: 0 });
      void harness.commands.settleEdits();
      await settle();

      let settled = false;
      const second = harness.commands.settleEdits().then(() => {
        settled = true;
      });
      await settle();
      expect(settled).toBe(false);
      expect(harness.store.getState().pending).toHaveLength(1);

      harness.release();
      await second;
      expect(harness.store.getState().pending).toEqual([]);
    });
  });

  describe("pose math", () => {
    it("moves a child by the world distance the pointer travelled", async () => {
      const child = placement("child", 0, "parent");
      const parent = placement("parent", 100, undefined, {
        transform: {
          position: { x: 100, y: 0 },
          rotation: Math.PI / 2,
          scale: { x: 2, y: 2 },
        },
      });
      harness = createHarness(document(parent, child));

      harness.commands.beginGesture({ ids: ["child"], origin: { x: 0, y: 0 } });
      harness.commands.updateGesture({ x: 0, y: 20 });
      await harness.commands.settleEdits();

      // The parent turns a quarter turn and doubles: 20 world units along y
      // are 10 local units along x, in the direction the rotation came from.
      const moved = harness.poses[0]?.[0]?.transform.position;
      expect(moved?.x).toBeCloseTo(10);
      expect(moved?.y).toBeCloseTo(0);
    });
  });

  describe("the rotate and scale gestures", () => {
    /** A gizmo on a placement at the world origin, axes unturned. */
    const anchor = { position: { x: 0, y: 0 }, rotation: 0 };

    /** Where the uniform-scale handle sits, optionally pressed `off` pixels short. */
    function uniformGrab(perPixel: number, off = 0): EditorPoint {
      const along = diagonalOf(anchor.rotation);
      const away = ARM_PIXELS * UNIFORM_FRACTION * perPixel + off;
      return { x: along.x * away, y: along.y * away };
    }

    it("holds a box move to one of the placement's own axes", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 0, y: 0 },
        kind: "translate",
        handle: "body",
        anchor,
      });
      // Mostly along x, a little along y. The modifier drops the smaller.
      harness.commands.updateGesture({ x: 30, y: 8 }, { constrained: true });
      await harness.commands.settleEdits();

      expect(harness.poses.at(-1)?.[0]?.transform.position).toEqual({
        x: 30,
        y: 0,
      });
    });

    it("follows the drag when it turns the other way", async () => {
      // Which axis it holds to is decided from where the drag has reached,
      // not from where it set off, so a drag that changes its mind is not
      // stuck on the axis it began along.
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 0, y: 0 },
        kind: "translate",
        handle: "body",
        anchor,
      });
      harness.commands.updateGesture({ x: 30, y: 8 }, { constrained: true });
      harness.commands.updateGesture({ x: 8, y: 30 }, { constrained: true });
      await harness.commands.settleEdits();

      const moved = harness.poses.at(-1)?.[0]?.transform.position;
      expect(moved?.x).toBeCloseTo(0, 12);
      expect(moved?.y).toBeCloseTo(30, 12);
    });

    it("turns to fixed steps while the modifier is held, with no lattice", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 40, y: 0 },
        kind: "rotate",
        handle: "turn",
        anchor,
      });
      // A shade under a quarter turn, which rounds to one.
      const nearly = Math.PI / 2 - TURN_STEP / 4;
      harness.commands.updateGesture(
        { x: Math.cos(nearly) * 40, y: Math.sin(nearly) * 40 },
        { constrained: true },
      );
      await harness.commands.settleEdits();

      expect(harness.poses.at(-1)?.[0]?.transform.rotation).toBeCloseTo(
        Math.PI / 2,
        12,
      );
    });

    it("turns freely while snapping is on and the modifier is not held", async () => {
      harness.withSnap(10);
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 40, y: 0 },
        kind: "rotate",
        handle: "turn",
        anchor,
      });
      const nearly = Math.PI / 2 - TURN_STEP / 4;
      harness.commands.updateGesture({
        x: Math.cos(nearly) * 40,
        y: Math.sin(nearly) * 40,
      });
      await harness.commands.settleEdits();

      // The lattice is a spacing in world units; it has nothing to say about
      // an angle.
      expect(harness.poses.at(-1)?.[0]?.transform.rotation).toBeCloseTo(
        nearly,
        12,
      );
    });

    it("keeps the turn it really made when the modifier goes", async () => {
      // Stepping rounds what is shown, and does not throw away the rest: the
      // angle is back exactly where the pointer is once the key is released.
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 40, y: 0 },
        kind: "rotate",
        handle: "turn",
        anchor,
      });
      const nearly = Math.PI / 2 - TURN_STEP / 4;
      const to = { x: Math.cos(nearly) * 40, y: Math.sin(nearly) * 40 };
      harness.commands.updateGesture(to, { constrained: true });
      harness.commands.updateGesture(to, { constrained: false });
      await harness.commands.settleEdits();

      expect(harness.poses.at(-1)?.[0]?.transform.rotation).toBeCloseTo(
        nearly,
        12,
      );
    });

    it("turns by the angle the pointer swung around the pivot", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 10, y: 0 },
        kind: "rotate",
        handle: "ring",
        anchor,
      });
      // A quarter turn around the pivot, whatever the radius.
      harness.commands.updateGesture({ x: 0, y: 40 });
      await harness.commands.settleEdits();

      const turned = harness.poses.at(-1)?.[0]?.transform;
      expect(turned?.rotation).toBeCloseTo(Math.PI / 2, 12);
      // A turn about the placement's own origin leaves it where it was.
      expect(turned?.position).toEqual({ x: 0, y: 0 });
      expect(turned?.scale).toEqual({ x: 1, y: 1 });
    });

    it("makes a box handle follow the pointer", async () => {
      // The `e` handle of a box whose right side is 40 out from the pivot.
      // Dragging it out another 40 puts that side at 80, which is twice.
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 40, y: 0 },
        kind: "scale",
        handle: "e",
        anchor,
        reference: { x: 40, y: 20, kind: "extent" },
      });
      harness.commands.updateGesture({ x: 80, y: 0 });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform;
      expect(sized?.scale.x).toBeCloseTo(2, 12);
      // An edge handle holds one axis. The other is left alone.
      expect(sized?.scale.y).toBeCloseTo(1, 12);
    });

    it("grows a box handle on the near side when it is dragged away", async () => {
      // The `w` handle sits at negative x, so its reference is negative and
      // dragging further that way has to grow the placement, not shrink it.
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: -40, y: 0 },
        kind: "scale",
        handle: "w",
        anchor,
        reference: { x: -40, y: 20, kind: "extent" },
      });
      harness.commands.updateGesture({ x: -80, y: 0 });
      await harness.commands.settleEdits();

      expect(harness.poses.at(-1)?.[0]?.transform.scale.x).toBeCloseTo(2, 12);
    });

    it("scales both axes of a box corner independently", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 40, y: 20 },
        kind: "scale",
        handle: "se",
        anchor,
        reference: { x: 40, y: 20, kind: "extent" },
      });
      // Twice as wide, half again as tall.
      harness.commands.updateGesture({ x: 80, y: 30 });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform;
      expect(sized?.scale.x).toBeCloseTo(2, 12);
      expect(sized?.scale.y).toBeCloseTo(1.5, 12);
    });

    it("grows a placement scaled to nothing from a box handle", async () => {
      // What multiplying could never do. The handle divides by the side's own
      // offset at a scale of one, so a placement animated in from nothing has
      // a side to drag however small it is drawn.
      harness = createHarness(
        document(
          placement("crate", 0, undefined, {
            transform: {
              position: { x: 0, y: 0 },
              rotation: 0,
              scale: { x: 0, y: 0 },
            },
          }),
        ),
      );
      harness.commands.beginGesture({
        ids: ["crate"],
        // At a scale of zero the side sits on the origin, whatever the artwork
        // is; the reference says where it would sit at a scale of one.
        origin: { x: 0, y: 0 },
        kind: "scale",
        handle: "e",
        anchor,
        reference: { x: 40, y: 20, kind: "extent" },
      });
      harness.commands.updateGesture({ x: 40, y: 0 });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform.scale;
      expect(sized?.x).toBe(1);
      // An edge handle holds one axis; the other is left where it was.
      expect(sized?.y).toBe(0);
    });

    it("keeps the artwork's proportions from a corner held at nothing", async () => {
      // There are no current proportions to keep at a scale of zero, so the
      // ones the developer means are the artwork's: the corner measures
      // against the rectangle at full size, and reaching it is a scale of one
      // on both axes rather than a gesture that does nothing.
      harness = createHarness(
        document(
          placement("crate", 0, undefined, {
            transform: {
              position: { x: 0, y: 0 },
              rotation: 0,
              scale: { x: 0, y: 0 },
            },
          }),
        ),
      );
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 0, y: 0 },
        kind: "scale",
        handle: "se",
        anchor,
        reference: { x: 40, y: 20, kind: "extent" },
      });
      // Out to where the artwork's own corner sits at a scale of one.
      harness.commands.updateGesture({ x: 40, y: 20 }, { constrained: true });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform.scale;
      expect(sized?.x).toBeCloseTo(1, 12);
      expect(sized?.y).toBeCloseTo(1, 12);
    });

    it("keeps the axis that has a scale when the other is at nothing", async () => {
      // Only the zero axis borrows the artwork's unit. The axis that still has
      // a scale keeps its own, so its proportion survives the drag.
      harness = createHarness(
        document(
          placement("crate", 0, undefined, {
            transform: {
              position: { x: 0, y: 0 },
              rotation: 0,
              scale: { x: 0, y: 2 },
            },
          }),
        ),
      );
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 0, y: 40 },
        kind: "scale",
        handle: "se",
        anchor,
        reference: { x: 40, y: 20, kind: "extent" },
      });
      harness.commands.updateGesture({ x: 40, y: 80 }, { constrained: true });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform.scale;
      // One ratio — a whole reference of travel — for both: the x axis counts
      // from an artwork unit of one and the y axis from the two it holds.
      expect(sized?.x).toBeCloseTo(1, 12);
      expect(sized?.y).toBeCloseTo(4, 12);
    });

    it("mirrors the placement when a box handle is dragged through the origin", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 40, y: 0 },
        kind: "scale",
        handle: "e",
        anchor,
        reference: { x: 40, y: 20, kind: "extent" },
      });
      // Past the origin by half the side's own offset.
      harness.commands.updateGesture({ x: -20, y: 0 });
      await harness.commands.settleEdits();

      // Exactly minus a half, not a clamped minimum and not turned positive
      // again: a drag through the point a scale turns about is a mirror.
      expect(harness.poses.at(-1)?.[0]?.transform.scale.x).toBe(-0.5);
    });

    it("writes nothing when a box handle is pressed and released", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 40, y: 0 },
        kind: "scale",
        handle: "e",
        anchor,
        reference: { x: 40, y: 20, kind: "extent" },
      });
      harness.commands.updateGesture({ x: 40, y: 0 });
      await harness.commands.settleEdits();

      expect(harness.sent).toEqual([]);
    });

    it("grows every handle when it is dragged outward with the modifier held", async () => {
      // Every one of the eight, not just the corner whose two signs are both
      // positive: `reference` carries each side in its sign, and a handle on
      // the box's lower side runs backwards if that sign is applied twice.
      const box = { halfX: 40, halfY: 20 };
      const grips = [
        ["nw", -1, -1],
        ["n", 0, -1],
        ["ne", 1, -1],
        ["e", 1, 0],
        ["se", 1, 1],
        ["s", 0, 1],
        ["sw", -1, 1],
        ["w", -1, 0],
      ] as const;

      const grown: Record<string, number> = {};
      for (const [handle, gx, gy] of grips) {
        harness = createHarness(document(placement("crate", 0)));
        const reference = {
          x: gx === 0 ? box.halfX : box.halfX * gx,
          y: gy === 0 ? box.halfY : box.halfY * gy,
          kind: "extent",
        } as const;
        const from = { x: box.halfX * gx, y: box.halfY * gy };
        harness.commands.beginGesture({
          ids: ["crate"],
          origin: from,
          kind: "scale",
          handle,
          anchor,
          reference,
        });
        // Straight out from the pivot, past the handle, by half again.
        harness.commands.updateGesture(
          { x: from.x * 1.5, y: from.y * 1.5 },
          { constrained: true },
        );
        await harness.commands.settleEdits();
        grown[handle] = harness.poses.at(-1)?.[0]?.transform.scale.x ?? 0;
      }

      for (const [handle] of grips) {
        // Outward is bigger. The size differs by handle — a corner measures
        // along its diagonal and a side along one axis — but the direction
        // cannot.
        expect([handle, (grown[handle] ?? 0) > 1]).toEqual([handle, true]);
      }
    });

    it("drives both axes from a side handle while the modifier is held", async () => {
      // A side handle holds one side, and the proportions are kept by taking
      // the factor that side produces to both axes.
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 40, y: 0 },
        kind: "scale",
        handle: "e",
        anchor,
        reference: { x: 40, y: 20, kind: "extent" },
      });
      harness.commands.updateGesture({ x: 80, y: 0 }, { constrained: true });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform;
      expect(sized?.scale.x).toBeCloseTo(2, 12);
      expect(sized?.scale.y).toBeCloseTo(2, 12);
    });

    it("keeps a corner's proportions while the modifier is held", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 40, y: 20 },
        kind: "scale",
        handle: "se",
        anchor,
        reference: { x: 40, y: 20, kind: "extent" },
      });
      // The same drag as above, which on its own would stretch the two axes
      // by different amounts.
      harness.commands.updateGesture({ x: 80, y: 30 }, { constrained: true });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform;
      expect(sized?.scale.x).toBeCloseTo(sized?.scale.y ?? 0, 12);
    });

    it("drops the constraint again when the modifier is let go", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 40, y: 20 },
        kind: "scale",
        handle: "se",
        anchor,
        reference: { x: 40, y: 20, kind: "extent" },
      });
      harness.commands.updateGesture({ x: 80, y: 30 }, { constrained: true });
      harness.commands.updateGesture({ x: 80, y: 30 }, { constrained: false });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform;
      expect(sized?.scale.x).toBeCloseTo(2, 12);
      expect(sized?.scale.y).toBeCloseTo(1.5, 12);
    });

    it("scales uniformly by how much further along the diagonal the pointer got", async () => {
      // Grabbed where the handle actually is: on the diagonal, well off the
      // pivot. A press on the pivot is what the old measure divided by.
      const grab = uniformGrab(1);
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: grab,
        kind: "scale",
        handle: "xy",
        anchor,
        reference: { x: ARM_PIXELS, y: ARM_PIXELS, kind: "length" },
      });
      // Out along the diagonal by one arm's length, which doubles it.
      const along = diagonalOf(0);
      harness.commands.updateGesture({
        x: grab.x + along.x * ARM_PIXELS,
        y: grab.y + along.y * ARM_PIXELS,
      });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform;
      expect(sized?.scale.x).toBeCloseTo(2, 12);
      expect(sized?.scale.y).toBeCloseTo(2, 12);
      expect(sized?.position).toEqual({ x: 0, y: 0 });
    });

    /** The scale a drag of `travel` along `axis` produces from a grab `away` out. */
    async function scaleFrom(
      handle: "x" | "xy",
      away: number,
      travel: number,
    ): Promise<number> {
      harness = createHarness(document(placement("crate", 0)));
      const along = handle === "xy" ? diagonalOf(0) : axisOf(0, "x");
      const grab = { x: along.x * away, y: along.y * away };
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: grab,
        kind: "scale",
        handle,
        anchor,
        reference: { x: ARM_PIXELS, y: ARM_PIXELS, kind: "length" },
      });
      harness.commands.updateGesture({
        x: grab.x + along.x * travel,
        y: grab.y + along.y * travel,
      });
      await harness.commands.settleEdits();
      return harness.poses.at(-1)?.[0]?.transform.scale.x ?? 0;
    }

    it("scales the same wherever along a handle the press landed", async () => {
      // The defect this replaces: both arms begin on the pivot and their whole
      // length is grabbable, so measuring the factor as a ratio of distances
      // from the pivot divided by however many pixels off-centre the press
      // was. A press one pixel out turned a short drag into a factor of 20.
      const uniform = ARM_PIXELS * UNIFORM_FRACTION;
      const cases = await Promise.all([
        scaleFrom("x", 1, 20),
        scaleFrom("x", HANDLE_PIXELS, 20),
        scaleFrom("x", ARM_PIXELS / 2, 20),
        scaleFrom("x", ARM_PIXELS, 20),
        scaleFrom("xy", uniform - HANDLE_PIXELS + 1, 20),
        scaleFrom("xy", uniform, 20),
        scaleFrom("xy", uniform + HANDLE_PIXELS - 1, 20),
      ]);

      for (const factor of cases)
        expect(factor).toBeCloseTo(1 + 20 / ARM_PIXELS, 12);
    });

    it("doubles the placement when a handle is dragged one arm's length", async () => {
      expect(await scaleFrom("x", ARM_PIXELS, ARM_PIXELS)).toBeCloseTo(2, 12);
      expect(await scaleFrom("x", 1, ARM_PIXELS)).toBeCloseTo(2, 12);
    });

    it("writes a finite local scale for a child of a flattened parent", async () => {
      // The parent draws every scale the child could hold at one point, so the
      // viewport can show nothing. The numbers still move: half the artwork's
      // width of pointer travel adds one to the local scale, and the inspector
      // is where the developer watches it.
      harness = createHarness(
        document(
          placement("frame", 0, undefined, {
            transform: {
              position: { x: 0, y: 0 },
              rotation: 0,
              scale: { x: 0, y: 0 },
            },
          }),
          placement("crate", 0, "frame"),
        ),
      );
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 16, y: 0 },
        kind: "scale",
        handle: "e",
        anchor,
        reference: { x: 16, y: 0, kind: "extent" },
      });
      harness.commands.updateGesture({ x: 32, y: 0 });
      await harness.commands.settleEdits();

      const posed = harness.poses.at(-1)?.[0]?.transform;
      expect(posed?.scale.x).toBe(2);
      for (const number of [
        posed?.scale.x,
        posed?.scale.y,
        posed?.position.x,
        posed?.position.y,
        posed?.rotation,
      ]) {
        expect(Number.isFinite(number)).toBe(true);
      }
    });

    it("scales one axis from an axis handle", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 10, y: 0 },
        kind: "scale",
        handle: "x",
        anchor,
        reference: { x: ARM_PIXELS, y: ARM_PIXELS, kind: "length" },
      });
      harness.commands.updateGesture({ x: 20, y: 100 });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform;
      // Only the travel along x counts, so the movement across it is ignored.
      expect(sized?.scale.x).toBeCloseTo(1 + 10 / ARM_PIXELS, 12);
      expect(sized?.scale.y).toBe(1);
    });

    it("does not turn a press and release into an edit", async () => {
      // A gesture that never moved must write nothing at all, so a level
      // already holding an unusual scale is not rewritten by a press.
      harness = createHarness(
        document(
          placement("crate", 0, undefined, {
            transform: {
              position: { x: 0, y: 0 },
              rotation: 0,
              scale: { x: 1e-5, y: 1 },
            },
          }),
        ),
      );
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: ARM_PIXELS, y: 0 },
        kind: "scale",
        handle: "x",
        anchor,
        reference: { x: ARM_PIXELS, y: ARM_PIXELS, kind: "length" },
      });
      harness.commands.updateGesture({ x: ARM_PIXELS, y: 0 });
      await harness.commands.settleEdits();

      expect(harness.sent).toEqual([]);
    });

    it("authors a scale of zero from an arm dragged onto the pivot", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 64, y: 0 },
        kind: "scale",
        handle: "x",
        anchor,
        reference: { x: ARM_PIXELS, y: ARM_PIXELS, kind: "length" },
      });
      // One whole arm length back, which takes a placement at one to nothing.
      harness.commands.updateGesture({ x: 0, y: 0 });

      // Zero is a value: it is what a placement that pops in under an
      // animation starts at, and the same arm brings it back.
      expect(harness.drafts.at(-1)?.[0]?.transform.scale.x).toBe(0);
    });

    it("scales normally from a press on the pivot", async () => {
      // A press on the pivot in scale mode grabs the x arm, not the centre —
      // the arms start there. It has to behave like any other press on that
      // arm rather than being inert or exploding.
      expect(handleAt("scale", anchor, 1, { x: 0, y: 0 })).toBe("x");

      expect(await scaleFrom("x", 0, ARM_PIXELS)).toBeCloseTo(2, 12);
    });

    it("constrains a translate handle to the axis it belongs to", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 0, y: 0 },
        kind: "translate",
        handle: "x",
        anchor,
      });
      harness.commands.updateGesture({ x: 30, y: 70 });
      await harness.commands.settleEdits();

      expect(harness.poses.at(-1)?.[0]?.transform.position).toEqual({
        x: 30,
        y: 0,
      });
    });

    it("turns and scales a child the same under a mirrored, turned parent", async () => {
      // The engine adds rotations and multiplies scales up the chain whatever
      // the signs are, so the local delta is the world delta — this is the
      // case that would break if a parent conversion crept in.
      const child = placement("child", 0, "parent");
      const parent = placement("parent", 100, undefined, {
        transform: {
          position: { x: 100, y: 0 },
          rotation: Math.PI / 3,
          scale: { x: -2, y: 3 },
        },
      });
      harness = createHarness(document(parent, child));

      harness.commands.beginGesture({
        ids: ["child"],
        origin: { x: 10, y: 0 },
        kind: "rotate",
        handle: "ring",
        anchor,
      });
      harness.commands.updateGesture({ x: 0, y: 10 });
      await harness.commands.settleEdits();

      expect(harness.poses.at(-1)?.[0]?.transform.rotation).toBeCloseTo(
        Math.PI / 2,
        12,
      );
    });

    it("turns continuously across the direction it started from", async () => {
      // Two atan2 results subtracted jump by a full turn the moment the
      // pointer crosses the ray opposite the grab. Rendering hides it; the
      // number written to the file does not.
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: -10, y: -1 },
        kind: "rotate",
        handle: "ring",
        anchor,
      });
      harness.commands.updateGesture({ x: -10, y: 1 });
      await harness.commands.settleEdits();

      const turned = harness.poses.at(-1)?.[0]?.transform.rotation ?? 0;
      expect(Math.abs(turned)).toBeLessThan(0.5);
    });

    it("passes a full turn in one drag", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 10, y: 0 },
        kind: "rotate",
        handle: "ring",
        anchor,
      });
      // Five eighths of a turn at a time, twice round.
      for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const at = (step * Math.PI) / 4;
        harness.commands.updateGesture({
          x: Math.cos(at) * 10,
          y: Math.sin(at) * 10,
        });
      }
      await harness.commands.settleEdits();

      expect(harness.poses.at(-1)?.[0]?.transform.rotation).toBeCloseTo(
        (10 * Math.PI) / 4,
        9,
      );
    });

    it("mirrors the placement when an arm is dragged through the pivot", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 64, y: 0 },
        kind: "scale",
        handle: "x",
        anchor,
        reference: { x: ARM_PIXELS, y: ARM_PIXELS, kind: "length" },
      });
      // Through the pivot and out the far side: one and a half arm lengths
      // back from a placement at one.
      harness.commands.updateGesture({ x: -32, y: 0 });
      await harness.commands.settleEdits();

      const sized = harness.poses.at(-1)?.[0]?.transform.scale;
      expect(sized?.x).toBeCloseTo(-0.5, 12);
      expect(sized?.y).toBe(1);
    });

    it("commits a turn that never moved the placement", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 10, y: 0 },
        kind: "rotate",
        handle: "ring",
        anchor,
      });
      harness.commands.updateGesture({ x: 0, y: 10 });
      await harness.commands.settleEdits();

      // Comparing positions alone would call this "nothing changed" and drop
      // the whole gesture.
      expect(harness.sent).toHaveLength(1);
      expect(harness.sent[0]?.kind).toBe("set-poses");
    });

    it("sends nothing for a gesture that ended where it started", async () => {
      harness.commands.beginGesture({
        ids: ["crate"],
        origin: { x: 10, y: 0 },
        kind: "rotate",
        handle: "ring",
        anchor,
      });
      harness.commands.updateGesture({ x: 10, y: 0 });
      await harness.commands.settleEdits();

      expect(harness.sent).toEqual([]);
    });
  });

  describe("createPlacement", () => {
    it("builds a whole placement at the middle of the view", () => {
      harness.commands.createPlacement("game.crate");

      expect(harness.sent).toEqual([
        {
          kind: "add-placements",
          commandId: "id-2",
          inserts: [
            {
              index: 1,
              placement: {
                id: "id-1",
                type: "game.crate",
                // The declaration's version, not the document's: the defaults
                // written here are the ones that version declares.
                typeVersion: 3,
                active: true,
                transform: {
                  position: { x: 100, y: 50 },
                  rotation: 0,
                  scale: { x: 1, y: 1 },
                },
                params: { texture: "sprites/crate.png" },
                extensions: {},
              },
            },
          ],
        },
      ]);
    });

    it("writes every field, because nothing on this side normalizes", () => {
      harness.commands.createPlacement("game.crate");

      // The server commits what its structural check read, which fills in an
      // absent `active`, transform, and params. The browser replays the raw
      // command instead, and the preview draws that projection — so a sparse
      // placement would be drawn dormant and at the origin until the answer
      // came back.
      const created = harness.store.getState().document.entities[1];
      expect(created?.active).toBe(true);
      expect(created?.transform.position).toEqual({ x: 100, y: 50 });
      expect(created?.params).toEqual({ texture: "sprites/crate.png" });
    });

    it("gives a type with no parameters an empty parameter object", () => {
      harness.commands.createPlacement("renderer.sprite");

      expect(harness.store.getState().document.entities[1]?.params).toEqual({});
    });

    it("selects what it created, ready to drag", () => {
      harness.commands.createPlacement("game.crate");

      expect([...harness.store.getState().selection]).toEqual(["id-1"]);
    });

    it("creates nothing for a type the catalog does not have", () => {
      harness.commands.createPlacement("game.absent");

      expect(harness.sent).toEqual([]);
    });

    it("creates nothing before a catalog has built", () => {
      harness.withoutCatalog();
      harness.commands.createPlacement("game.crate");

      expect(harness.sent).toEqual([]);
    });

    it("creates nothing while there is no view to place it in", () => {
      harness.withoutView();
      harness.commands.createPlacement("game.crate");

      // Without a camera there is no world position, and a placement at a
      // guessed one lands somewhere the developer cannot see.
      expect(harness.sent).toEqual([]);
    });

    it("creates nothing while writes are locked", () => {
      harness.store.lockWrites("stale-project");
      harness.commands.createPlacement("game.crate");

      expect(harness.sent).toEqual([]);
    });
  });

  describe("setParam and resetParam", () => {
    beforeEach(() => {
      harness = createHarness(
        document(
          placement("crate", 0, undefined, {
            params: { texture: "sprites/old.png" },
          }),
          placement("bare", 0),
        ),
      );
    });

    it("writes one field with the document's value as its precondition", () => {
      harness.commands.setParam("crate", "texture", "sprites/new.png");

      expect(harness.sent).toEqual([
        {
          kind: "set-values",
          commandId: "id-1",
          edits: [
            {
              placementId: "crate",
              path: ["params", "texture"],
              expected: "sprites/old.png",
              value: "sprites/new.png",
            },
          ],
        },
      ]);
    });

    it("adds a field the placement lacks by replacing the parameter object", () => {
      harness.commands.setParam("bare", "texture", "sprites/new.png");

      // The reducer will not write through a path into a missing property, so
      // the same field-level change goes through the object it belongs to.
      expect(harness.sent[0]).toMatchObject({
        kind: "set-values",
        edits: [
          {
            placementId: "bare",
            path: ["params"],
            expected: {},
            value: { texture: "sprites/new.png" },
          },
        ],
      });
    });

    it("resets a field to the default its declaration gives it", () => {
      harness.commands.resetParam("crate", "texture");

      expect(harness.sent[0]).toMatchObject({
        kind: "set-values",
        edits: [
          {
            placementId: "crate",
            path: ["params", "texture"],
            expected: "sprites/old.png",
            value: "sprites/crate.png",
          },
        ],
      });
    });

    it("resets nothing for a field the declaration does not have", () => {
      harness.commands.resetParam("crate", "tint");

      expect(harness.sent).toEqual([]);
    });

    it("writes nothing for a placement the document does not have", () => {
      harness.commands.setParam("ghost", "texture", "x.png");
      harness.commands.resetParam("ghost", "texture");

      expect(harness.sent).toEqual([]);
    });

    it("writes nothing while writes are locked", () => {
      harness.store.lockWrites("stale-project");
      harness.commands.setParam("crate", "texture", "x.png");
      harness.commands.resetParam("crate", "texture");

      expect(harness.sent).toEqual([]);
    });
  });

  describe("picking a reference target", () => {
    beforeEach(() => {
      harness = createHarness(
        document(
          placement("switch", 0, undefined, { params: { door: null } }),
          placement("crate", 100),
        ),
      );
    });

    it("holds the placement, the field and the accepted types", () => {
      harness.commands.startPick("switch", "door", ["game.crate"]);

      expect(harness.store.getState().pick).toEqual({
        placementId: "switch",
        field: "door",
        types: ["game.crate"],
      });
      expect(harness.sent).toEqual([]);
    });

    it("writes the chosen id into the waiting field and stops waiting", () => {
      harness.commands.startPick("switch", "door", ["game.crate"]);
      harness.commands.pickTarget("crate");

      expect(harness.store.getState().pick).toBeUndefined();
      expect(harness.sent).toEqual([
        {
          kind: "set-values",
          commandId: "id-1",
          edits: [
            {
              placementId: "switch",
              path: ["params", "door"],
              expected: null,
              value: "crate",
            },
          ],
        },
      ]);
    });

    it("writes nothing when no field is waiting", () => {
      harness.commands.pickTarget("crate");

      expect(harness.sent).toEqual([]);
    });

    it("writes nothing when the developer stops waiting", () => {
      harness.commands.startPick("switch", "door", ["game.crate"]);
      harness.commands.cancelPick();

      expect(harness.store.getState().pick).toBeUndefined();
      expect(harness.sent).toEqual([]);
    });
  });

  describe("resetPlacement", () => {
    beforeEach(() => {
      harness = createHarness(
        document(
          placement("crate", 0, undefined, {
            typeVersion: 1,
            params: { sprite: "sprites/old.png" },
          }),
          placement("alien", 0, undefined, { type: "game.absent" }),
        ),
      );
    });

    it("writes fresh defaults and the current type version in one command", () => {
      harness.commands.resetPlacement("crate");

      // One command, so one undo puts both back — the authored parameters and
      // the version they were authored against.
      expect(harness.sent).toEqual([
        {
          kind: "set-values",
          commandId: "id-1",
          edits: [
            {
              placementId: "crate",
              path: ["params"],
              expected: { sprite: "sprites/old.png" },
              value: { texture: "sprites/crate.png" },
            },
            {
              placementId: "crate",
              path: ["typeVersion"],
              expected: 1,
              value: 3,
            },
          ],
        },
      ]);
    });

    it("has nothing to reset a type the catalog does not have to", () => {
      harness.commands.resetPlacement("alien");

      expect(harness.sent).toEqual([]);
    });

    it("resets nothing while writes are locked", () => {
      harness.store.lockWrites("stale-project");
      harness.commands.resetPlacement("crate");

      expect(harness.sent).toEqual([]);
    });
  });

  describe("setName, setKey, and setPose", () => {
    beforeEach(() => {
      harness = createHarness(
        document(
          placement("crate", 0, undefined, {
            name: "Left crate",
            transform: {
              position: { x: 12, y: -4 },
              rotation: Math.PI / 4,
              scale: { x: 2, y: 0.5 },
            },
          }),
          placement("plain", 0),
          placement("keyed", 0, undefined, { key: "door" }),
          placement("layered", 0, undefined, { layer: "props" }),
        ),
      );
    });

    it("labels a placement that has none, with `null` as the precondition", () => {
      harness.commands.setName("plain", "Right crate");

      expect(harness.sent).toEqual([
        {
          kind: "set-values",
          commandId: "id-1",
          edits: [
            {
              placementId: "plain",
              path: ["name"],
              expected: null,
              value: "Right crate",
            },
          ],
        },
      ]);
    });

    it("takes a label away by writing `null`", () => {
      harness.commands.setName("crate", null);

      expect(harness.sent[0]).toMatchObject({
        kind: "set-values",
        edits: [
          {
            placementId: "crate",
            path: ["name"],
            expected: "Left crate",
            value: null,
          },
        ],
      });
    });

    it("gives and takes away the key a game looks the entity up by", () => {
      harness.commands.setKey("plain", "spawn");
      harness.commands.setKey("keyed", null);

      expect(harness.sent).toMatchObject([
        {
          kind: "set-values",
          edits: [
            {
              placementId: "plain",
              path: ["key"],
              expected: null,
              value: "spawn",
            },
          ],
        },
        {
          kind: "set-values",
          edits: [
            {
              placementId: "keyed",
              path: ["key"],
              expected: "door",
              value: null,
            },
          ],
        },
      ]);
    });

    it("gives and takes away the layer the placement's visuals join", () => {
      harness.commands.setLayer("crate", "props");
      harness.commands.setLayer("layered", null);

      expect(harness.sent).toMatchObject([
        {
          kind: "set-values",
          edits: [
            {
              placementId: "crate",
              path: ["layer"],
              expected: null,
              value: "props",
            },
          ],
        },
        {
          kind: "set-values",
          edits: [
            {
              placementId: "layered",
              path: ["layer"],
              expected: "props",
              value: null,
            },
          ],
        },
      ]);
    });

    it("sends nothing for a name or a key already in force", () => {
      harness.commands.setName("crate", "Left crate");
      harness.commands.setName("plain", null);
      harness.commands.setKey("keyed", "door");
      harness.commands.setKey("plain", null);

      expect(harness.sent).toEqual([]);
    });

    it("writes one transform as one command, carrying the rest unchanged", () => {
      harness.commands.setPose("crate", {
        position: { x: 137, y: -4 },
        rotation: Math.PI / 4,
        scale: { x: 2, y: 0.5 },
      });

      expect(harness.sent).toEqual([
        {
          kind: "set-poses",
          commandId: "id-1",
          poses: [
            {
              id: "crate",
              transform: {
                position: { x: 137, y: -4 },
                rotation: Math.PI / 4,
                scale: { x: 2, y: 0.5 },
              },
            },
          ],
        },
      ]);
    });

    it("does not land a typed number on the lattice", () => {
      harness.withSnap(32);

      harness.commands.setPose("crate", {
        position: { x: 137, y: -4 },
        rotation: Math.PI / 4,
        scale: { x: 2, y: 0.5 },
      });

      // Snapping is what a gesture does when the pointer cannot be exact. A
      // typed number already is.
      expect(harness.poses[0]?.[0]?.transform.position).toEqual({
        x: 137,
        y: -4,
      });
    });

    it("sends nothing for the transform the placement already holds", () => {
      harness.commands.setPose("crate", {
        position: { x: 12, y: -4 },
        rotation: Math.PI / 4,
        scale: { x: 2, y: 0.5 },
      });

      expect(harness.sent).toEqual([]);
    });

    it("writes nothing for a placement the document does not have", () => {
      harness.commands.setName("ghost", "x");
      harness.commands.setKey("ghost", "x");
      harness.commands.setPose("ghost", {
        position: { x: 1, y: 1 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      });

      expect(harness.sent).toEqual([]);
    });

    it("writes nothing while writes are locked", () => {
      harness.store.lockWrites("stale-project");
      harness.commands.setName("crate", "Renamed");
      harness.commands.setKey("crate", "spawn");
      harness.commands.setPose("crate", {
        position: { x: 1, y: 1 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      });

      expect(harness.sent).toEqual([]);
    });

    it("reports a key another placement derives, and changes nothing", () => {
      harness.commands.setKey("plain", "crate");

      expect(harness.sent).toEqual([]);
      expect(
        harness.store.getState().diagnostics.get("validation")?.[0],
      ).toMatchObject({ code: "command-dropped" });
      expect(
        harness.store.getState().document.entities[1]?.key,
      ).toBeUndefined();
    });
  });

  describe("a number a field is stepping", () => {
    beforeEach(() => {
      harness = createHarness(
        document(
          placement("crate", 0, undefined, {
            transform: {
              position: { x: 12, y: -4 },
              rotation: Math.PI / 4,
              scale: { x: 2, y: 0.5 },
            },
          }),
        ),
      );
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
    });

    it("paints every press and sends nothing until the settle", () => {
      harness.commands.draftPose("crate", "x", 13);
      harness.commands.draftPose("crate", "x", 14);
      harness.commands.draftPose("crate", "x", 15);

      expect(
        harness.drafts.map((draft) => draft[0]?.transform.position.x),
      ).toEqual([13, 14, 15]);
      expect(harness.sent).toEqual([]);
      expect(harness.store.getState().poseDraft).toEqual({
        id: "crate",
        component: "x",
        value: 15,
      });
    });

    it("makes the level dirty, so nothing leaves the editor without it", () => {
      expect(isDirty(harness.store.getState())).toBe(false);
      harness.commands.draftPose("crate", "x", 13);
      expect(isDirty(harness.store.getState())).toBe(true);
    });

    it("settles a burst as one command and one undo step", async () => {
      harness.commands.draftPose("crate", "rotation", 46);
      harness.commands.draftPose("crate", "rotation", 47);
      await harness.commands.settleEdits();

      expect(harness.poses).toEqual([
        [
          {
            id: "crate",
            transform: {
              position: { x: 12, y: -4 },
              rotation: (47 * Math.PI) / 180,
              scale: { x: 2, y: 0.5 },
            },
          },
        ],
      ]);
      expect(harness.store.getState().poseDraft).toBeUndefined();
    });

    it("composes the settle from the projection, not from where it opened", async () => {
      harness.commands.draftPose("crate", "x", 100);
      // Something else moved the placement underneath the open box. Only the
      // number the field is holding may travel with the settle; a transform
      // captured when the box opened would put the other four back.
      harness.commands.setPose("crate", {
        position: { x: 12, y: 999 },
        rotation: 0,
        scale: { x: 3, y: 3 },
      });
      // `setPose` takes the draft with it, so the field opens another one.
      harness.commands.draftPose("crate", "x", 100);
      await harness.commands.settleEdits();

      expect(harness.poses.at(-1)?.[0]?.transform).toEqual({
        position: { x: 100, y: 999 },
        rotation: 0,
        scale: { x: 3, y: 3 },
      });
    });

    it("is dropped, not written, when the selection moves on", async () => {
      harness.commands.draftPose("crate", "x", 13);
      harness.store.dispatch({ type: "selection-changed", ids: [] });
      await harness.commands.settleEdits();

      expect(harness.sent).toEqual([]);
    });

    it("is dropped when another level is opened", () => {
      harness.commands.draftPose("crate", "x", 13);
      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot(1, document(placement("crate", 0))),
      });

      expect(harness.store.getState().poseDraft).toBeUndefined();
    });

    it("puts the preview back when it is cancelled", () => {
      harness.commands.draftPose("crate", "x", 13);
      harness.commands.cancelPoseDraft();

      expect(harness.drafts.at(-1)?.[0]?.transform.position.x).toBe(12);
      expect(harness.store.getState().poseDraft).toBeUndefined();
      expect(harness.sent).toEqual([]);
    });

    it("settles before an undo, so the burst is on the stack to take back", async () => {
      harness.commands.draftPose("crate", "x", 13);
      await harness.commands.undo();

      expect(harness.sent).toHaveLength(1);
      expect(harness.steps).toEqual(["undo"]);
    });

    it("is taken by the command the box commits, so no settle repeats it", async () => {
      harness.commands.draftPose("crate", "x", 13);
      harness.commands.setPose("crate", {
        position: { x: 13, y: -4 },
        rotation: Math.PI / 4,
        scale: { x: 2, y: 0.5 },
      });

      // The number is the command now. Left in the store it would keep the
      // dirty marker on after a committed edit and be written a second time
      // by the next settle.
      expect(harness.store.getState().poseDraft).toBeUndefined();
      const sent = harness.sent.length;
      await harness.commands.settleEdits();
      expect(harness.sent).toHaveLength(sent);
    });

    it("puts the preview back when a locked settle refuses it", async () => {
      harness.commands.draftPose("crate", "x", 13);
      harness.store.lockWrites("stale-project");
      await harness.commands.settleEdits();

      expect(harness.sent).toEqual([]);
      expect(harness.drafts.at(-1)?.[0]?.transform.position.x).toBe(12);
    });
  });

  describe("movePlacement", () => {
    const turned = {
      position: { x: 10, y: 20 },
      rotation: Math.PI / 2,
      scale: { x: 2, y: -1 },
    };

    beforeEach(() => {
      harness = createHarness(
        document(
          placement("root", 0, undefined, { transform: turned }),
          placement("child", 5, "root"),
          placement("other", 40),
        ),
      );
    });

    /** The single move each of these drags produces. */
    function moves() {
      return harness.sent
        .filter((command) => command.kind === "move-placements")
        .flatMap((command) => command.moves);
    }

    it("brings a placement to the front of its own siblings", () => {
      harness.commands.orderPlacements(["root"], "front");

      expect(moves()[0]).toMatchObject({
        id: "root",
        from: { index: 0 },
        to: { index: 2 },
      });
      expect(moves()[0]?.to.parent).toBeUndefined();
    });

    it("sends a placement to the back of its own siblings", () => {
      harness.commands.orderPlacements(["other"], "back");

      expect(moves()[0]).toMatchObject({ id: "other", to: { index: 0 } });
    });

    it("steps one place at a time", () => {
      harness.commands.orderPlacements(["root"], "forward");

      // "root" and "other" are the two roots; "child" is not a sibling of
      // either, so a step past one sibling lands after "other".
      expect(moves()[0]).toMatchObject({ id: "root", to: { index: 2 } });
    });

    it("orders a child among its siblings and never past its parent", () => {
      harness.commands.orderPlacements(["child"], "front");

      // The only child of "root" has nowhere to go, so nothing is sent.
      expect(harness.sent).toHaveLength(0);
    });

    it("produces nothing at the end it is already at", () => {
      harness.commands.orderPlacements(["other"], "front");
      harness.commands.orderPlacements(["root"], "back");

      expect(harness.sent).toHaveLength(0);
    });

    it("refuses a selection whose members do not share one parent", () => {
      harness.commands.orderPlacements(["child", "other"], "front");

      expect(harness.sent).toHaveLength(0);
    });

    it("reorders before a sibling without touching the transform", () => {
      harness.commands.movePlacements(["other"], {
        kind: "before",
        siblingId: "root",
      });

      const move = moves()[0];
      expect(move).toMatchObject({
        id: "other",
        from: { index: 2 },
        to: { index: 0 },
      });
      expect(move?.from.parent).toBeUndefined();
      expect(move?.to.parent).toBeUndefined();
      // A reorder does no arithmetic, so the destination pose is the source
      // pose exactly — the reducer's inverse compares them by value.
      expect(move?.to.transform).toEqual(move?.from.transform);
      expect(move?.to.transform).toEqual({
        position: { x: 40, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      });
    });

    it("keeps the very transform object on a reorder under a turned parent", () => {
      const first = placement("first", 5, "root");
      harness = createHarness(
        document(
          placement("root", 0, undefined, { transform: turned }),
          first,
          placement("second", 9, "root"),
        ),
      );
      harness.commands.movePlacements(["second"], {
        kind: "before",
        siblingId: "first",
      });

      // Same parent, so no conversion runs: the projected document holds the
      // placement's own transform object, not a recomputed equal of it. Under
      // a rotated parent a round trip through the math would be equal to
      // within rounding and still a different object.
      const moved = harness.store
        .getState()
        .document.entities.find((one) => one.id === "second");
      expect(moved?.transform).toBe(
        harness.store
          .getState()
          .committed.document.entities.find((one) => one.id === "second")
          ?.transform,
      );
      expect(
        harness.store.getState().document.entities.map((e) => e.id),
      ).toEqual(["root", "second", "first"]);
    });

    it("reorders after a sibling and takes the sibling's parent", () => {
      harness.commands.movePlacements(["other"], {
        kind: "after",
        siblingId: "child",
      });

      expect(moves()[0]).toMatchObject({
        id: "other",
        from: { index: 2 },
        // Indices are positions in the document without the moved placement.
        to: { parent: "root", index: 2 },
      });
    });

    it("drops into a parent as its last child, keeping the world pose", () => {
      harness.commands.movePlacements(["other"], {
        kind: "into",
        parentId: "root",
      });

      const move = moves()[0];
      expect(move).toMatchObject({
        id: "other",
        to: { parent: "root", index: 2 },
      });
      // Under a quarter-turned, negatively scaled parent at (10, 20), the
      // local pose that puts it back at world (40, 0): rotate the offset
      // (30, -20) back by -90° → (-20, -30), then divide by the scale.
      const local = move?.to.transform;
      expect(local?.position.x).toBeCloseTo(-10, 9);
      expect(local?.position.y).toBeCloseTo(30, 9);
      expect(local?.rotation).toBeCloseTo(-Math.PI / 2, 9);
      expect(local?.scale.x).toBeCloseTo(0.5, 9);
      expect(local?.scale.y).toBeCloseTo(-1, 9);
    });

    it("clears the parent on a root drop, keeping the world pose", () => {
      harness.commands.movePlacements(["child"], { kind: "root" });

      const move = moves()[0];
      expect(move).toMatchObject({
        id: "child",
        from: { parent: "root", index: 1 },
        to: { index: 2 },
      });
      expect(move?.to.parent).toBeUndefined();
      // Local (5, 0) under the turned parent: scaled → (10, 0), a quarter
      // turn → (0, 10), plus (10, 20).
      const world = move?.to.transform;
      expect(world?.position.x).toBeCloseTo(10, 9);
      expect(world?.position.y).toBeCloseTo(30, 9);
      expect(world?.rotation).toBeCloseTo(Math.PI / 2, 9);
      expect(world?.scale).toEqual({ x: 2, y: -1 });
    });

    it("refuses to make a placement its own descendant's child", () => {
      harness.commands.movePlacements(["root"], {
        kind: "into",
        parentId: "child",
      });
      harness.commands.movePlacements(["root"], {
        kind: "into",
        parentId: "root",
      });
      harness.commands.movePlacements(["root"], {
        kind: "after",
        siblingId: "child",
      });

      expect(moves()).toEqual([]);
      // Refused here, before anything was submitted: the reducer would refuse
      // it too, but that path reports a dropped edit, and there is nothing to
      // report about a drop the UI should never have offered.
      expect(harness.store.getState().diagnostics.get("validation")).toBe(
        undefined,
      );
    });

    it("sends nothing for a drop that changes nothing", () => {
      // Already the last child of root; already the last root.
      harness.commands.movePlacements(["child"], {
        kind: "into",
        parentId: "root",
      });
      harness.commands.movePlacements(["other"], { kind: "root" });

      expect(moves()).toEqual([]);
    });

    it("ignores a drop that names nothing the document has", () => {
      harness.commands.movePlacements(["ghost"], { kind: "root" });
      harness.commands.movePlacements(["other"], {
        kind: "into",
        parentId: "ghost",
      });
      harness.commands.movePlacements(["other"], {
        kind: "before",
        siblingId: "other",
      });

      expect(moves()).toEqual([]);
    });

    it("moves nothing while writes are locked", () => {
      harness.store.lockWrites("stale-project");
      harness.commands.movePlacements(["other"], {
        kind: "into",
        parentId: "root",
      });

      expect(moves()).toEqual([]);
    });
  });

  describe("deletePlacements", () => {
    beforeEach(() => {
      // A child listed above its parent, so one pass over the document in
      // order would miss the grandchild.
      harness = createHarness(
        document(
          placement("grandchild", 0, "child"),
          placement("child", 0, "parent"),
          placement("parent", 0),
          placement("other", 0),
        ),
      );
    });

    it("carries the whole authored subtree, in document order", async () => {
      await harness.commands.deletePlacements(["parent"]);

      expect(harness.sent).toEqual([
        {
          kind: "remove-placements",
          commandId: "id-1",
          ids: ["grandchild", "child", "parent"],
        },
      ]);
    });

    it("leaves a placement outside the subtree alone", async () => {
      await harness.commands.deletePlacements(["child"]);

      expect(harness.store.getState().document.entities.map((one) => one.id))
        // The parent stays, and so does the unrelated placement.
        .toEqual(["parent", "other"]);
    });

    it("drops an id the document no longer holds", async () => {
      await harness.commands.deletePlacements(["other", "gone"]);

      // A stale selection is not an error, and naming the missing id would
      // make the reducer refuse the whole delete.
      expect(harness.sent).toEqual([
        { kind: "remove-placements", commandId: "id-1", ids: ["other"] },
      ]);
    });

    it("sends nothing when nothing named is there", async () => {
      await harness.commands.deletePlacements(["gone"]);

      expect(harness.sent).toEqual([]);
    });

    it("deletes nothing while writes are locked", async () => {
      harness.store.lockWrites("stale-command");
      await harness.commands.deletePlacements(["parent"]);

      expect(harness.sent).toEqual([]);
    });

    it("commits an open drag first, and reports nothing about it", async () => {
      harness.commands.beginGesture({ ids: ["other"], origin: { x: 0, y: 0 } });
      harness.commands.updateGesture({ x: 30, y: 0 });
      await harness.commands.deletePlacements(["other"]);
      await settle();

      // Without settling, the drag ends after the placement has left the
      // projection, and the move it produces is dropped with an error about a
      // placement the developer deliberately deleted.
      expect(harness.sent.map((command) => command.kind)).toEqual([
        "set-poses",
        "remove-placements",
      ]);
      expect(harness.store.getState().diagnostics.size).toBe(0);
    });
  });

  describe("deleting something a placement points at", () => {
    beforeEach(() => {
      harness = createHarness(
        document(
          placement("crate", 0),
          placement("switch", 0, undefined, {
            type: "game.switch",
            params: { door: "crate" },
          }),
          placement("other", 0),
        ),
      );
    });

    it("submits straight away when nothing points into the set", async () => {
      await harness.commands.deletePlacements(["other"]);

      expect(harness.sent).toEqual([
        { kind: "remove-placements", commandId: "id-1", ids: ["other"] },
      ]);
      expect(harness.store.getState().pendingDelete).toBeUndefined();
    });

    it("asks first when something outside the set points into it", async () => {
      await harness.commands.deletePlacements(["crate"]);

      expect(harness.sent).toEqual([]);
      expect(harness.store.getState().pendingDelete).toEqual(["crate"]);
    });

    it("sends the removal the question was about", async () => {
      await harness.commands.deletePlacements(["crate"]);
      await harness.commands.confirmDelete();

      expect(harness.sent).toEqual([
        { kind: "remove-placements", commandId: "id-1", ids: ["crate"] },
      ]);
      expect(harness.store.getState().pendingDelete).toBeUndefined();
    });

    it("removes what the document holds when the answer comes", async () => {
      await harness.commands.deletePlacements(["crate"]);
      // The question is asked in a panel that leaves the rest of the editor
      // working, so a child can land under the removing placement between the
      // question and the answer.
      const kid = placement("kid", 0, "crate");
      harness.withDocument(
        document(
          ...harness.store.getState().document.entities.map((one) => one),
          kid,
        ),
      );
      harness.store.submit({
        kind: "add-placements",
        commandId: "added-later",
        inserts: [{ placement: kid, index: 3 }],
      });
      await harness.commands.confirmDelete();
      await settle();

      // Sending the ids the question captured would leave the child without a
      // parent, which the reducer refuses and which reads as a delete that
      // failed.
      expect(harness.sent.at(-1)).toEqual({
        kind: "remove-placements",
        commandId: "id-1",
        ids: ["crate", "kid"],
      });
    });

    it("leaves the referring id in the document", async () => {
      await harness.commands.deletePlacements(["crate"]);
      await harness.commands.confirmDelete();

      const entities = harness.store.getState().document.entities;
      expect(entities.map((one) => one.id)).toEqual(["switch", "other"]);
      // Left as it was, so one undo puts the whole thing back and preparation
      // reports a missing target in the meantime.
      expect(entities[0]?.params.door).toBe("crate");
    });

    it("sends nothing when the question is dismissed", async () => {
      await harness.commands.deletePlacements(["crate"]);
      harness.store.dispatch({ type: "delete-confirm-dismissed" });
      await harness.commands.confirmDelete();

      expect(harness.sent).toEqual([]);
      expect(harness.store.getState().document.entities).toHaveLength(3);
    });

    it("does not ask about a reference from inside the set", async () => {
      // The switch goes too, so nothing is left pointing at anything.
      await harness.commands.deletePlacements(["crate", "switch"]);

      expect(harness.sent).toEqual([
        {
          kind: "remove-placements",
          commandId: "id-1",
          ids: ["crate", "switch"],
        },
      ]);
    });
  });

  describe("undo and redo", () => {
    it("commits an open drag before asking for an undo", async () => {
      harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
      harness.commands.updateGesture({ x: 30, y: 0 });
      await harness.commands.undo();
      await settle();

      // The drag became a command first. Undoing before it settled would take
      // back the edit before it rather than the one on screen.
      expect(harness.poses).toHaveLength(1);
      expect(harness.steps).toEqual(["undo"]);
    });

    it("waits for a sent command before asking for an undo", async () => {
      harness.hold();
      harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
      harness.commands.updateGesture({ x: 30, y: 0 });
      void harness.commands.settleEdits();
      await settle();

      const undone = harness.commands.undo();
      await settle();
      expect(harness.steps).toEqual([]);

      harness.release();
      await undone;
      await settle();
      expect(harness.steps).toEqual(["undo"]);
    });

    it("asks the other end of the history for a redo", async () => {
      await harness.commands.redo();
      await settle();

      expect(harness.steps).toEqual(["redo"]);
    });

    it("waits for a step the server has not answered", async () => {
      harness.hold();
      harness.store.step("undo");
      await settle();

      let settled = false;
      const barrier = harness.commands.settleEdits().then(() => {
        settled = true;
      });
      await settle();
      // A step is not a command, so `pending` is empty and waiting on commands
      // alone would let a save promote the revision from before the undo.
      expect(harness.store.getState().pending).toEqual([]);
      expect(settled).toBe(false);

      harness.release();
      await barrier;
      expect(settled).toBe(true);
    });
  });
});

describe("copy, paste, and duplicate", () => {
  function added(harness: ReturnType<typeof createHarness>) {
    return harness.sent
      .filter((command) => command.kind === "add-placements")
      .flatMap((command) => command.inserts.map((insert) => insert.placement));
  }

  it("copies without sending a command", () => {
    const harness = createHarness(document(placement("crate", 10)));

    harness.commands.copyPlacements(["crate"]);

    expect(harness.sent).toEqual([]);
    expect(harness.store.getState().clipboard.map((one) => one.id)).toEqual([
      "crate",
    ]);
  });

  it("copies on a level whose writes are locked", () => {
    const harness = createHarness(document(placement("crate", 10)));
    harness.store.lockWrites("stale-command");

    harness.commands.copyPlacements(["crate"]);

    // Copying changes nothing, so there is nothing for a write lock to refuse.
    expect(harness.store.getState().clipboard).toHaveLength(1);
  });

  it("takes the subtree, and holds it by value", () => {
    const harness = createHarness(
      document(placement("root", 0), placement("child", 5, "root")),
    );

    harness.commands.copyPlacements(["root"]);
    void harness.commands.deletePlacements(["root"]);

    // The originals are gone; the clipboard still holds what they were.
    expect(harness.store.getState().clipboard.map((one) => one.id)).toEqual([
      "root",
      "child",
    ]);
  });

  it("pastes the clipboard as new placements at the middle of the view", () => {
    const harness = createHarness(document(placement("crate", 10)));
    harness.commands.copyPlacements(["crate"]);

    harness.commands.pastePlacements();

    const copies = added(harness);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.id).not.toBe("crate");
    // The harness reports the middle of the view at (100, 50).
    expect(copies[0]?.transform.position).toEqual({ x: 100, y: 50 });
  });

  it("selects what a paste created", () => {
    const harness = createHarness(document(placement("crate", 10)));
    harness.commands.copyPlacements(["crate"]);

    harness.commands.pastePlacements();

    const copies = added(harness);
    expect([...harness.store.getState().selection]).toEqual([copies[0]?.id]);
  });

  it("keeps what a copied root's parent contributed to its pose", () => {
    const turned = document(
      placement("root", 0, undefined, {
        transform: {
          position: { x: 0, y: 0 },
          rotation: Math.PI / 2,
          scale: { x: 2, y: 3 },
        },
      }),
      placement("child", 10, "root"),
    );
    const harness = createHarness(turned);

    harness.commands.copyPlacements(["child"]);
    harness.commands.pastePlacements();

    // A paste detaches, and its parent is not on the clipboard, so the pose
    // the parent contributed has to be stored at copy time or it is gone.
    const copy = harness.sent
      .filter((command) => command.kind === "add-placements")
      .flatMap((command) => command.inserts)[0]?.placement;
    expect(copy?.transform.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(copy?.transform.scale).toEqual({ x: 2, y: 3 });
  });

  it("stores a copied root with no parent, since none is coming with it", () => {
    const harness = createHarness(
      document(placement("root", 0), placement("child", 10, "root")),
    );

    harness.commands.copyPlacements(["child"]);

    const held = harness.store.getState().clipboard[0];
    expect(held?.parent).toBeUndefined();
    // Its authored local x was 10 under a root at 0, so the world pose it was
    // drawn at is what the clipboard keeps.
    expect(held?.transform.position).toEqual({ x: 10, y: 0 });
  });

  it("keeps a copied subtree's own links, which do come with it", () => {
    const harness = createHarness(
      document(placement("root", 0), placement("child", 10, "root")),
    );

    harness.commands.copyPlacements(["root"]);

    const held = harness.store.getState().clipboard;
    expect(held[0]?.parent).toBeUndefined();
    // Only the roots detach. A child copied with its parent still names it.
    expect(held[1]?.parent).toBe("root");
  });

  it("pastes the same clipboard more than once", () => {
    const harness = createHarness(document(placement("crate", 10)));
    harness.commands.copyPlacements(["crate"]);

    harness.commands.pastePlacements();
    harness.commands.pastePlacements();

    const copies = added(harness);
    expect(copies).toHaveLength(2);
    expect(copies[0]?.id).not.toBe(copies[1]?.id);
  });

  it("pastes nothing when the clipboard is empty", () => {
    const harness = createHarness(document(placement("crate", 10)));

    harness.commands.pastePlacements();

    expect(harness.sent).toEqual([]);
  });

  it("refuses to paste into a level whose writes are locked", () => {
    const harness = createHarness(document(placement("crate", 10)));
    harness.commands.copyPlacements(["crate"]);
    harness.store.lockWrites("stale-command");

    harness.commands.pastePlacements();

    expect(harness.sent).toEqual([]);
  });

  it("duplicates in place, stepped aside so the copy is visible", () => {
    const harness = createHarness(document(placement("crate", 10)));
    harness.withCascade({ x: 24, y: 24 });

    harness.commands.duplicatePlacements(["crate"]);

    const copies = added(harness);
    expect(copies[0]?.transform.position).toEqual({ x: 34, y: 24 });
  });

  it("duplicates as one command, whatever the subtree holds", () => {
    const harness = createHarness(
      document(placement("root", 0), placement("child", 5, "root")),
    );

    harness.commands.duplicatePlacements(["root"]);

    // One command is one undo step, which is what takes the whole duplicate
    // back rather than half of it.
    const commands = harness.sent.filter(
      (command) => command.kind === "add-placements",
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]?.inserts).toHaveLength(2);
  });

  it("leaves the clipboard alone when it duplicates", () => {
    const harness = createHarness(
      document(placement("one", 0), placement("two", 30)),
    );
    harness.commands.copyPlacements(["one"]);

    harness.commands.duplicatePlacements(["two"]);

    // Duplicating something else must not throw away what was copied.
    expect(harness.store.getState().clipboard.map((entry) => entry.id)).toEqual(
      ["one"],
    );
  });

  it("selects the copied roots, not everything the copy created", () => {
    const harness = createHarness(
      document(placement("root", 0), placement("child", 5, "root")),
    );

    harness.commands.duplicatePlacements(["root"]);

    // Selecting the child as well would put the next drag on both, and moving
    // a parent and its child together moves the child twice.
    expect(harness.store.getState().selection.size).toBe(1);
  });

  it("duplicates nothing for an empty selection", () => {
    const harness = createHarness(document(placement("crate", 10)));

    harness.commands.duplicatePlacements([]);

    expect(harness.sent).toEqual([]);
  });
});

describe("moving several placements at once", () => {
  it("moves the whole selection in one command", () => {
    const harness = createHarness(
      document(placement("a", 0), placement("b", 10), placement("target", 20)),
    );

    harness.commands.movePlacements(["a", "b"], {
      kind: "into",
      parentId: "target",
    });

    const commands = harness.sent.filter(
      (command) => command.kind === "move-placements",
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]?.moves.map((move) => move.id)).toEqual(["a", "b"]);
    expect(
      commands[0]?.moves.every((move) => move.to.parent === "target"),
    ).toBe(true);
  });

  it("moves only the outermost of the selection", () => {
    const harness = createHarness(
      document(
        placement("root", 0),
        placement("child", 5, "root"),
        placement("target", 20),
      ),
    );

    harness.commands.movePlacements(["root", "child"], {
      kind: "into",
      parentId: "target",
    });

    // The child travels with the root. Moving it too would reparent it out of
    // the subtree it belongs to.
    const move = harness.sent.find(
      (command) => command.kind === "move-placements",
    );
    expect(move?.moves.map((entry) => entry.id)).toEqual(["root"]);
  });

  it("gives the moved placements consecutive destinations", () => {
    const harness = createHarness(
      document(placement("a", 0), placement("b", 10), placement("c", 20)),
    );

    harness.commands.movePlacements(["a", "b"], { kind: "root" });

    const move = harness.sent.find(
      (command) => command.kind === "move-placements",
    );
    const indices = move?.moves.map((entry) => entry.to.index);
    expect(indices).toEqual([1, 2]);
  });

  it("refuses a drop inside one of the placements being moved", () => {
    const harness = createHarness(
      document(placement("root", 0), placement("child", 5, "root")),
    );

    harness.commands.movePlacements(["root"], {
      kind: "into",
      parentId: "child",
    });

    expect(harness.sent).toEqual([]);
  });

  it("sends nothing when the drop changes no parent and no order", () => {
    const harness = createHarness(
      document(placement("a", 0), placement("b", 10)),
    );

    harness.commands.movePlacements(["a"], { kind: "before", siblingId: "b" });

    expect(harness.sent).toEqual([]);
  });
});

describe("transforming several placements", () => {
  /** Two placements a hundred apart on the x axis, and the midpoint between. */
  function pair(): ReturnType<typeof createHarness> {
    return createHarness(
      document(placement("left", 0), placement("right", 100)),
    );
  }

  const MIDDLE = { x: 50, y: 0 };
  const AT_MIDDLE = { position: MIDDLE, rotation: 0 };

  /** A quarter turn about the pivot, driven from the pointer. */
  function turnAQuarter(
    harness: ReturnType<typeof createHarness>,
    ids: readonly string[],
    pivot: EditorPoint | undefined,
  ): void {
    harness.commands.beginGesture({
      ids,
      kind: "rotate",
      origin: { x: 150, y: 0 },
      anchor: AT_MIDDLE,
      ...(pivot === undefined ? {} : { pivot }),
    });
    // Round to the quarter turn in two steps, since the turn accumulates from
    // where the pointer was rather than from the origin.
    harness.commands.updateGesture({ x: 50, y: 70 });
    harness.commands.updateGesture({ x: 50, y: 100 });
  }

  it("orbits both placements about a shared pivot, and turns both", async () => {
    const harness = pair();

    turnAQuarter(harness, ["left", "right"], MIDDLE);
    await harness.commands.settleEdits();

    const poses = harness.poses[0] ?? [];
    const by = new Map(poses.map((pose) => [pose.id, pose.transform]));
    // A quarter turn clockwise about (50, 0): the left one swings to below the
    // pivot and the right one above it, both a hundred apart still.
    expect(by.get("left")?.position.x).toBeCloseTo(50, 9);
    expect(by.get("left")?.position.y).toBeCloseTo(-50, 9);
    expect(by.get("right")?.position.x).toBeCloseTo(50, 9);
    expect(by.get("right")?.position.y).toBeCloseTo(50, 9);
    expect(by.get("left")?.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(by.get("right")?.rotation).toBeCloseTo(Math.PI / 2, 9);
  });

  it("turns both in place when each keeps its own origin", async () => {
    const harness = pair();

    // The `individual` pivot reaches the gesture as no pivot at all.
    turnAQuarter(harness, ["left", "right"], undefined);
    await harness.commands.settleEdits();

    const poses = harness.poses[0] ?? [];
    for (const pose of poses) {
      expect(pose.transform.rotation).toBeCloseTo(Math.PI / 2, 9);
    }
    expect(poses.map((pose) => pose.transform.position)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("acts on a parent once, never on it and its own child", async () => {
    const harness = createHarness(
      document(placement("crate", 0), placement("lid", 30, "crate")),
    );

    turnAQuarter(harness, ["crate", "lid"], MIDDLE);
    await harness.commands.settleEdits();

    // The child travels with its parent, so a gesture that also moved it would
    // turn it twice and land it somewhere the pointer never went.
    const poses = harness.poses[0] ?? [];
    expect(poses.map((pose) => pose.id)).toEqual(["crate"]);
  });

  it("sends one command for a gesture over five placements", async () => {
    const many = createHarness(
      document(
        placement("a", 0),
        placement("b", 20),
        placement("c", 40),
        placement("d", 60),
        placement("e", 80),
      ),
    );

    turnAQuarter(many, ["a", "b", "c", "d", "e"], MIDDLE);
    await many.commands.settleEdits();

    expect(many.sent).toHaveLength(1);
    const sent = many.sent[0];
    expect(sent?.kind).toBe("set-poses");
    expect(sent?.kind === "set-poses" ? sent.poses : []).toHaveLength(5);
  });

  it("turns a single selection without touching its position", async () => {
    const harness = pair();

    // No pivot, which is what one placement under the default gets: the turn
    // never touches the position and never goes out through world space.
    harness.commands.beginGesture({
      ids: ["right"],
      kind: "rotate",
      origin: { x: 200, y: 0 },
      anchor: { position: { x: 100, y: 0 }, rotation: 0 },
    });
    harness.commands.updateGesture({ x: 100, y: 100 });
    await harness.commands.settleEdits();

    expect(harness.poses[0]).toEqual([
      {
        id: "right",
        transform: {
          position: { x: 100, y: 0 },
          rotation: Math.PI / 2,
          scale: { x: 1, y: 1 },
        },
      },
    ]);
  });

  it("sends nothing for a press and release on a handle that never moved", async () => {
    // The pivot path takes the pose out to world space and back, and under a
    // turned, scaled parent that trip does not return the numbers it left
    // with. `settleEdits` compares exactly, so without a short circuit a click
    // would send a command, take an undo entry, and write a rounding.
    const harness = createHarness(
      document(
        placement("crate", 0, undefined, {
          transform: {
            position: { x: 20, y: -40 },
            rotation: 0.7,
            scale: { x: 1.3, y: 0.6 },
          },
        }),
        placement("lid", 30, "crate"),
      ),
    );

    harness.commands.beginGesture({
      ids: ["lid"],
      kind: "rotate",
      origin: { x: 150, y: 0 },
      anchor: AT_MIDDLE,
      pivot: MIDDLE,
    });
    await harness.commands.settleEdits();

    harness.commands.beginGesture({
      ids: ["lid"],
      kind: "scale",
      handle: "x",
      origin: { x: 150, y: 0 },
      anchor: AT_MIDDLE,
      reference: { x: 50, y: 50, kind: "length" },
      pivot: MIDDLE,
    });
    await harness.commands.settleEdits();

    expect(harness.sent).toEqual([]);
  });

  it("sends nothing for a stepped turn too small to reach the next step", async () => {
    // The other route into the same short circuit: the pointer moved, but the
    // placement's world angle is already on a step and a few degrees round
    // back to it. The guard reads the rounded angle, so this is still a
    // gesture that did not move.
    const harness = createHarness(
      document(
        placement("crate", 0, undefined, {
          transform: {
            position: { x: 20, y: -40 },
            rotation: TURN_STEP * 3,
            scale: { x: 1.3, y: 0.6 },
          },
        }),
        placement("lid", 30, "crate"),
      ),
    );

    harness.commands.beginGesture({
      ids: ["lid"],
      kind: "rotate",
      origin: { x: 150, y: 0 },
      anchor: AT_MIDDLE,
      pivot: MIDDLE,
    });
    // About four degrees round the pivot at (50, 0), well under half a step.
    harness.commands.updateGesture({ x: 149.8, y: 7 }, { constrained: true });
    await harness.commands.settleEdits();

    expect(harness.sent).toEqual([]);
  });

  it("spreads placements from a shared pivot when it scales them", async () => {
    const harness = pair();

    harness.commands.beginGesture({
      ids: ["left", "right"],
      kind: "scale",
      handle: "x",
      origin: { x: 100, y: 0 },
      anchor: AT_MIDDLE,
      reference: { x: 50, y: 50, kind: "length" },
      pivot: MIDDLE,
    });
    // One reference along x, so the factor is two.
    harness.commands.updateGesture({ x: 150, y: 0 });
    await harness.commands.settleEdits();

    const by = new Map(
      (harness.poses[0] ?? []).map((pose) => [pose.id, pose.transform]),
    );
    // Twice as far from the pivot, and twice as wide.
    expect(by.get("left")?.position.x).toBeCloseTo(-50, 9);
    expect(by.get("right")?.position.x).toBeCloseTo(150, 9);
    expect(by.get("left")?.scale).toEqual({ x: 2, y: 1 });
  });

  it("keeps a child's authored transform relative to its parent", async () => {
    // The parent is not in the gesture, so the child alone orbits a pivot in
    // world space and what is written is still relative to the parent.
    const harness = createHarness(
      document(
        placement("crate", 100, undefined, {
          transform: {
            position: { x: 100, y: 0 },
            rotation: Math.PI / 2,
            scale: { x: 1, y: 1 },
          },
        }),
        placement("lid", 30, "crate"),
      ),
    );

    turnAQuarter(harness, ["lid"], MIDDLE);
    await harness.commands.settleEdits();

    // The child's world pose orbited a quarter turn about (50, 0); its
    // authored pose is that expressed in a parent already turned a quarter.
    const lid = (harness.poses[0] ?? [])[0]?.transform;
    expect(lid?.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(lid?.position.x).toBeCloseTo(50, 9);
    expect(lid?.position.y).toBeCloseTo(80, 9);
  });
});

describe("snapping", () => {
  /** A placement at a world point, off any sensible lattice. */
  function at(id: string, x: number, y: number): LevelPlacement {
    return placement(id, x, undefined, {
      transform: { position: { x, y }, rotation: 0, scale: { x: 1, y: 1 } },
    });
  }

  function moved(harness: ReturnType<typeof createHarness>) {
    return harness.poses.at(-1)?.[0]?.transform.position;
  }

  it("lands on the lattice rather than moving in lattice-sized steps", async () => {
    const harness = createHarness(document(at("crate", 14, 26)));
    harness.withSnap(10);

    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 3, y: 3 });
    await harness.commands.settleEdits();

    // The pointer travelled to (17, 29), which is nearest (20, 30). Rounding
    // the delta instead would round (3, 3) to nothing and leave (14, 26).
    expect(moved(harness)).toEqual({ x: 20, y: 30 });
  });

  it("leaves the drag alone while the suspend modifier is held", async () => {
    const harness = createHarness(document(at("crate", 14, 26)));
    harness.withSnap(10);

    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 3, y: 3 }, { suspended: true });
    await harness.commands.settleEdits();

    expect(moved(harness)).toEqual({ x: 17, y: 29 });
  });

  it("takes the suspend modifier up and drops it part-way through a drag", () => {
    const harness = createHarness(document(at("crate", 14, 26)));
    harness.withSnap(10);

    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 3, y: 3 });
    harness.commands.updateGesture({ x: 3, y: 3 }, { suspended: true });
    harness.commands.updateGesture({ x: 3, y: 3 });

    expect(harness.drafts.map((draft) => draft[0]?.transform.position)).toEqual(
      [
        { x: 20, y: 30 },
        { x: 17, y: 29 },
        { x: 20, y: 30 },
      ],
    );
  });

  it("redraws an open drag when the snap is switched part-way through", async () => {
    const harness = createHarness(document(at("crate", 14, 26)));
    harness.withSnap(10);

    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 3, y: 3 });
    // The switch is thrown with the pointer still down and never moved again,
    // so only the redraw can put the preview on the pose the release writes.
    harness.store.dispatch({ type: "snap-toggled" });
    harness.commands.redrawGesture();
    await harness.commands.settleEdits();

    const drawn = harness.drafts.at(-1)?.[0]?.transform.position;
    expect(drawn).toEqual({ x: 17, y: 29 });
    expect(harness.poses[0]?.[0]?.transform.position).toEqual(drawn);
  });

  it("moves a multi-selection rigidly behind its active placement", async () => {
    const harness = createHarness(
      document(at("a", 3, 3), at("b", 43, 3), at("c", 87, 3)),
    );
    harness.withSnap(10);

    // `c` is last in the selection, so it is the one that lands on the grid.
    harness.commands.beginGesture({
      ids: ["a", "b", "c"],
      origin: { x: 0, y: 0 },
    });
    harness.commands.updateGesture({ x: 6, y: 2 });
    await harness.commands.settleEdits();

    const by = new Map(
      (harness.poses[0] ?? []).map((pose) => [
        pose.id,
        pose.transform.position,
      ]),
    );
    // `c` went to (93, 5), nearest (90, 10): a correction of (-3, 5) on the
    // raw (6, 2), which every placement takes.
    expect(by.get("c")).toEqual({ x: 90, y: 10 });
    expect(by.get("a")).toEqual({ x: 6, y: 10 });
    expect(by.get("b")).toEqual({ x: 46, y: 10 });
  });

  it("snaps a child in world space, not in its parent's frame", async () => {
    const parent = placement("crate", 0, undefined, {
      transform: {
        position: { x: 17, y: -9 },
        rotation: Math.PI / 6,
        scale: { x: 2, y: 3 },
      },
    });
    const child: LevelPlacement = {
      ...placement("lid", 0, "crate"),
      transform: {
        position: { x: 4, y: 7 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
    };
    const harness = createHarness(document(parent, child));
    harness.withSnap(10);

    harness.commands.beginGesture({ ids: ["lid"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 13, y: 4 });
    await harness.commands.settleEdits();

    const local = harness.poses.at(-1)?.[0]?.transform;
    if (!local) throw new Error("The drag sent no pose.");
    const world = toWorld(
      local,
      parentWorld(harness.store.getState().document, "crate"),
    );
    // Adding the correction to the local delta instead lands off the lattice,
    // because the parent turns and stretches whatever it is given.
    expect(world.position.x / 10).toBeCloseTo(
      Math.round(world.position.x / 10),
      9,
    );
    expect(world.position.y / 10).toBeCloseTo(
      Math.round(world.position.y / 10),
      9,
    );
  });

  it("sends nothing for a press and release that never moved", async () => {
    const harness = createHarness(document(at("crate", 14, 26)));
    harness.withSnap(10);

    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 0, y: 0 });
    await harness.commands.settleEdits();

    // The correction alone would drag an off-grid placement onto the grid on a
    // click that moved nothing.
    expect(harness.sent).toEqual([]);
  });

  it("rounds only the coordinate a world-axis handle controls", async () => {
    const harness = createHarness(document(at("crate", 14, 26)));
    harness.withSnap(10);

    harness.commands.beginGesture({
      ids: ["crate"],
      origin: { x: 0, y: 0 },
      handle: "x",
      anchor: { position: { x: 14, y: 26 }, rotation: 0 },
    });
    harness.commands.updateGesture({ x: 3, y: 40 });
    await harness.commands.settleEdits();

    expect(moved(harness)).toEqual({ x: 20, y: 26 });
  });

  it("stays on a turned placement's own axis and reaches the nearest point on it", async () => {
    const harness = createHarness(document(at("crate", 14, 26)));
    harness.withSnap(10);
    const rotation = Math.PI / 6;
    const axis = axisOf(rotation, "x");

    harness.commands.beginGesture({
      ids: ["crate"],
      origin: { x: 0, y: 0 },
      handle: "x",
      anchor: { position: { x: 14, y: 26 }, rotation },
    });
    harness.commands.updateGesture({ x: 30, y: 5 });
    await harness.commands.settleEdits();

    const to = moved(harness);
    if (!to) throw new Error("The drag sent no pose.");
    // Exactly on the line through the start along the axis.
    const off = (to.x - 14) * -axis.y + (to.y - 26) * axis.x;
    expect(off).toBeCloseTo(0, 12);
    // And at the point on that line nearest the lattice point the held move
    // reached: (38.67, 40.24) along the axis, whose nearest lattice point is
    // (40, 40).
    const target = { x: 40, y: 40 };
    const reach = (target.x - 14) * axis.x + (target.y - 26) * axis.y;
    expect(to.x).toBeCloseTo(14 + axis.x * reach, 9);
    expect(to.y).toBeCloseTo(26 + axis.y * reach, 9);
  });

  it("lands the side a box handle holds on the lattice", async () => {
    const harness = createHarness(document(placement("crate", 0)));
    harness.withSnap(10);

    // The `e` handle of a box whose right side is 40 out from the pivot,
    // dragged to 63. The side lands on 60, which is a factor of 1.5 rather
    // than the 1.575 the pointer asked for.
    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "scale",
      handle: "e",
      origin: { x: 40, y: 0 },
      anchor: { position: { x: 0, y: 0 }, rotation: 0 },
      reference: { x: 40, y: 20, kind: "extent" },
    });
    harness.commands.updateGesture({ x: 63, y: 0 });
    await harness.commands.settleEdits();

    const sized = harness.poses.at(-1)?.[0]?.transform.scale;
    expect(sized?.x).toBeCloseTo(1.5, 12);
    // The axis the handle leaves is not landed on anything.
    expect(sized?.y).toBeCloseTo(1, 12);
  });

  it("lands a corner along its own direction and keeps its proportions", async () => {
    const harness = createHarness(document(placement("crate", 0)));
    harness.withSnap(10);

    // The `se` corner of a box 40 by 25, dragged east to (63, 25). The corner
    // travels the line from the pivot through itself, so it lands as far along
    // that line as the nearest lattice point, (60, 40), reaches — near that
    // point rather than on it, because the line does not pass through it.
    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "scale",
      handle: "se",
      origin: { x: 40, y: 25 },
      anchor: { position: { x: 0, y: 0 }, rotation: 0 },
      reference: { x: 40, y: 25, kind: "extent" },
    });
    harness.commands.updateGesture({ x: 63, y: 25 }, { constrained: true });
    await harness.commands.settleEdits();

    const out = Math.hypot(40, 25);
    const along = { x: 40 / out, y: 25 / out };
    const landed = (60 * along.x + 40 * along.y) / out;
    const sized = harness.poses.at(-1)?.[0]?.transform.scale;
    expect(sized?.x).toBeCloseTo(landed, 12);
    expect(sized?.y).toBeCloseTo(landed, 12);
    // Not the 1.5 that landing the same drag along the placement's x axis
    // would give: a corner is held to its own direction, not to an axis.
    expect(sized?.x).not.toBeCloseTo(1.5, 2);
  });

  it("lands a shrinking drag on the lattice", async () => {
    const harness = createHarness(document(placement("crate", 0)));
    harness.withSnap(10);

    // The same box's right side, 40 out, pulled in to 33. The side lands on
    // 30, three cells rather than the 3.3 the pointer asked for.
    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "scale",
      handle: "e",
      origin: { x: 40, y: 0 },
      anchor: { position: { x: 0, y: 0 }, rotation: 0 },
      reference: { x: 40, y: 20, kind: "extent" },
    });
    harness.commands.updateGesture({ x: 33, y: 0 });
    await harness.commands.settleEdits();

    expect(harness.poses.at(-1)?.[0]?.transform.scale.x).toBeCloseTo(0.75, 12);
  });

  it("lands the side on the origin, at a scale of zero", async () => {
    const harness = createHarness(document(placement("crate", 0)));
    harness.withSnap(32);

    // A placement one cell wide on the default step: its right side is 32 out
    // and the only lattice lines are the origin's own and the side's own. The
    // origin is where the scale turns about, so a side landing there is a
    // scale of exactly zero — the value a placement that pops in starts at.
    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "scale",
      handle: "e",
      origin: { x: 32, y: 0 },
      anchor: { position: { x: 0, y: 0 }, rotation: 0 },
      reference: { x: 32, y: 32, kind: "extent" },
    });
    harness.commands.updateGesture({ x: 10, y: 0 });
    await harness.commands.settleEdits();

    expect(harness.poses.at(-1)?.[0]?.transform.scale.x).toBe(0);
  });

  it("lands the side behind the origin, mirrored", async () => {
    const harness = createHarness(document(placement("crate", 0)));
    harness.withSnap(32);

    // The same handle carried past the origin: the nearest lattice line is now
    // one cell the other side of it, which is the placement mirrored at its
    // own size rather than something to refuse.
    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "scale",
      handle: "e",
      origin: { x: 32, y: 0 },
      anchor: { position: { x: 0, y: 0 }, rotation: 0 },
      reference: { x: 32, y: 32, kind: "extent" },
    });
    harness.commands.updateGesture({ x: -26, y: 0 });
    await harness.commands.settleEdits();

    expect(harness.poses.at(-1)?.[0]?.transform.scale.x).toBe(-1);
  });

  it("lands a constrained corner on the origin, at a scale of zero", async () => {
    const harness = createHarness(document(placement("crate", 0)));
    harness.withSnap(32);

    // The `se` corner of a box 40 by 25, dragged with the modifier held to a
    // fifth of the way out. The nearest lattice point to where the corner then
    // sits is the origin's own, so both axes land on zero together and the
    // proportions are kept all the way down. The constrained branch has its
    // own call into the settle closure, and only this case drives a landing on
    // the origin through it.
    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "scale",
      handle: "se",
      origin: { x: 40, y: 25 },
      anchor: { position: { x: 0, y: 0 }, rotation: 0 },
      reference: { x: 40, y: 25, kind: "extent" },
    });
    harness.commands.updateGesture({ x: 8, y: 5 }, { constrained: true });
    await harness.commands.settleEdits();

    const proportional = harness.poses.at(-1)?.[0]?.transform.scale;
    expect(proportional?.x).toBe(0);
    expect(proportional?.y).toBe(0);
  });

  it("lands a handle on the far side of the pivot outwards", async () => {
    const harness = createHarness(document(placement("crate", 0)));
    harness.withSnap(10);

    // The `w` handle: its reference is negative, and dragging it further west
    // grows the placement. The side reaches -63 and lands on -60, a factor of
    // 1.5 — the sign belongs to the side, not to the factor.
    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "scale",
      handle: "w",
      origin: { x: -40, y: 0 },
      anchor: { position: { x: 0, y: 0 }, rotation: 0 },
      reference: { x: -40, y: -20, kind: "extent" },
    });
    harness.commands.updateGesture({ x: -63, y: 0 });
    await harness.commands.settleEdits();

    expect(harness.poses.at(-1)?.[0]?.transform.scale.x).toBeCloseTo(1.5, 12);
  });

  it("sends nothing for a press and release on a box handle whose side is off the lattice", async () => {
    const harness = createHarness(document(placement("crate", 0)));
    harness.withSnap(10);

    // The side sits at 43, which no lattice line passes through. A press and
    // release must still author nothing: the landing alone would resize the
    // placement on a gesture that never moved.
    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "scale",
      handle: "e",
      origin: { x: 43, y: 0 },
      anchor: { position: { x: 0, y: 0 }, rotation: 0 },
      reference: { x: 43, y: 20, kind: "extent" },
    });
    harness.commands.updateGesture({ x: 43, y: 0 });
    await harness.commands.settleEdits();

    expect(harness.poses).toEqual([]);
  });

  it("rounds a turned placement's side along the placement's own axis", async () => {
    const harness = createHarness(document(placement("crate", 0)));
    harness.withSnap(10);
    const rotation = Math.PI / 6;
    const axis = axisOf(rotation, "x");
    const along = (away: number) => ({ x: axis.x * away, y: axis.y * away });

    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "scale",
      handle: "e",
      origin: along(40),
      anchor: { position: { x: 0, y: 0 }, rotation },
      reference: { x: 40, y: 20, kind: "extent" },
    });
    harness.commands.updateGesture(along(63));
    await harness.commands.settleEdits();

    // A `LevelTransform` holds no shear, so a turned placement's side cannot
    // be put on a world grid line and keep the placement's shape. The side
    // reaches (54.56, 31.5); the nearest lattice point is (50, 30), and the
    // side lands as far along its own axis as that point is.
    const reached = 50 * axis.x + 30 * axis.y;
    const sized = harness.poses.at(-1)?.[0]?.transform.scale;
    expect(sized?.x).toBeCloseTo(reached / 40, 12);
    expect(sized?.x).not.toBeCloseTo(1.575, 3);
  });

  it("leaves the side where the pointer put it while the suspend modifier is held", async () => {
    const harness = createHarness(document(placement("crate", 0)));
    harness.withSnap(10);

    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "scale",
      handle: "e",
      origin: { x: 40, y: 0 },
      anchor: { position: { x: 0, y: 0 }, rotation: 0 },
      reference: { x: 40, y: 20, kind: "extent" },
    });
    harness.commands.updateGesture({ x: 63, y: 0 }, { suspended: true });
    await harness.commands.settleEdits();

    expect(harness.poses.at(-1)?.[0]?.transform.scale.x).toBeCloseTo(1.575, 12);
  });

  it("leaves a Scale tool arm alone, whatever the lattice says", async () => {
    const anchor = { position: { x: 0, y: 0 }, rotation: 0 };
    const factors: number[] = [];
    for (const snapping of [false, true]) {
      const harness = createHarness(document(placement("crate", 0)));
      if (snapping) harness.withSnap(10);
      harness.commands.beginGesture({
        ids: ["crate"],
        kind: "scale",
        handle: "x",
        origin: { x: 0, y: 0 },
        anchor,
        reference: { x: 50, y: 50, kind: "length" },
      });
      harness.commands.updateGesture({ x: 23, y: 0 });
      await harness.commands.settleEdits();
      factors.push(harness.poses.at(-1)?.[0]?.transform.scale.x ?? 0);
    }

    // An arm holds no side of the placement: it measures against its own drawn
    // length, which is a screen distance, so there is nothing on the lattice
    // for it to land.
    expect(factors[0]).toBeCloseTo(1.46, 12);
    expect(factors[1]).toBe(factors[0]);
  });

  it("puts a created placement on the lattice before the cascade", () => {
    const harness = createHarness(document());
    harness.withSnap(32);

    harness.commands.createPlacement("game.crate");

    // The harness reports the middle of the view at (100, 50).
    expect(harness.probed).toEqual([{ x: 96, y: 64 }]);
  });

  it("puts a paste and a duplicate on the lattice, and keeps every other copy's offset", () => {
    const harness = createHarness(
      document(placement("root", 14), placement("child", 26, "root")),
    );
    // A step the middle of the view is not already on, so the assertion below
    // fails if the paste stops snapping.
    harness.withSnap(32);
    harness.commands.copyPlacements(["root"]);

    harness.commands.pastePlacements();
    harness.commands.duplicatePlacements(["root"]);

    // A paste probes from the middle of the view, a duplicate from the source.
    expect(harness.probed).toEqual([
      { x: 96, y: 64 },
      { x: 0, y: 0 },
    ]);
    const copies = harness.sent
      .filter((command) => command.kind === "add-placements")
      .flatMap((command) => command.inserts.map((insert) => insert.placement));
    const roots = copies.filter((one) => one.parent === undefined);
    // Both roots land where the cascade left them, and the child keeps the
    // 26 units it sat from its root.
    expect(roots.map((one) => one.transform.position)).toEqual([
      { x: 96, y: 64 },
      { x: 0, y: 0 },
    ]);
    for (const copy of copies.filter((one) => one.parent !== undefined)) {
      expect(copy.transform.position).toEqual({ x: 26, y: 0 });
    }
  });

  it("leaves creation, paste, and duplication where they were with snapping off", () => {
    const harness = createHarness(
      document(placement("root", 14), placement("child", 26, "root")),
    );
    harness.commands.copyPlacements(["root"]);

    harness.commands.createPlacement("game.crate");
    harness.commands.pastePlacements();
    harness.commands.duplicatePlacements(["root"]);

    expect(harness.probed).toEqual([
      { x: 100, y: 50 },
      { x: 100, y: 50 },
      { x: 14, y: 0 },
    ]);
  });
});

describe("stepping a turn", () => {
  const degrees = (value: number) => (value * Math.PI) / 180;

  /** A crate already standing at an angle no step would have left it on. */
  function askew(): ReturnType<typeof document> {
    return document(
      placement("crate", 0, undefined, {
        transform: {
          position: { x: 0, y: 0 },
          rotation: degrees(7),
          scale: { x: 1, y: 1 },
        },
      }),
    );
  }

  /** A rotate drag of `by` degrees about the world origin. */
  function turn(
    harness: ReturnType<typeof createHarness>,
    by: number,
    modifiers: GestureModifiers,
  ): void {
    harness.commands.beginGesture({
      ids: ["crate"],
      kind: "rotate",
      origin: { x: 40, y: 0 },
      anchor: { position: { x: 0, y: 0 }, rotation: 0 },
    });
    harness.commands.updateGesture(
      { x: Math.cos(degrees(by)) * 40, y: Math.sin(degrees(by)) * 40 },
      modifiers,
    );
  }

  it("lands on a whole number of steps rather than stepping the turn itself", async () => {
    const harness = createHarness(askew());

    // Twenty degrees round, which puts the placement at 27 and lands on 30.
    // Rounding the turn instead would step 20 to 15 and leave it at 22.
    turn(harness, 20, { constrained: true });
    await harness.commands.settleEdits();

    const turnedTo = harness.poses.at(-1)?.[0]?.transform.rotation ?? 0;
    expect(turnedTo).toBeCloseTo(degrees(30), 12);
    expect(turnedTo / TURN_STEP).toBeCloseTo(2, 12);
  });

  it("keeps the step while the suspend modifier is held", async () => {
    const harness = createHarness(askew());
    harness.withSnap(10);

    // Alt lets a gesture off the lattice. The step is the modifier's own
    // behaviour and not the lattice's, so it stays.
    turn(harness, 20, { constrained: true, suspended: true });
    await harness.commands.settleEdits();

    expect(harness.poses.at(-1)?.[0]?.transform.rotation).toBeCloseTo(
      degrees(30),
      12,
    );
  });

  it("leaves the turn free when the modifier is not held", async () => {
    const harness = createHarness(askew());
    harness.withSnap(10);

    turn(harness, 20, {});
    await harness.commands.settleEdits();

    expect(harness.poses.at(-1)?.[0]?.transform.rotation).toBeCloseTo(
      degrees(27),
      12,
    );
  });
});
