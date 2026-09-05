import { defineParams, param, type LevelCatalog } from "@yagejs/level";
import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";
import { describe, expect, it } from "vitest";
import type {
  DocumentCommand,
  PoseEdit,
  PreviewImpact,
} from "../../shared/commands/index.js";
import type { DraftSnapshot } from "../../shared/protocol/index.js";
import { EditorApiClient } from "../api/index.js";
import { EditorStore, type EditorViewState } from "../store/index.js";
import { connectPreview } from "./connect.js";
import type { PreviewRequest } from "./PreviewCoordinator.js";

function placement(id: string, x: number, parent?: string): LevelPlacement {
  return {
    id,
    type: "game.crate",
    ...(parent === undefined ? {} : { parent }),
    typeVersion: 1,
    active: true,
    transform: { position: { x, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    params: {},
    extensions: {},
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

/** A pose write putting one placement at `x`. */
function move(id: string, x: number): DocumentCommand {
  return {
    kind: "set-poses",
    commandId: `move-${id}`,
    poses: [
      {
        id,
        transform: {
          position: { x, y: 0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
        },
      },
    ],
  };
}

/** A command that keeps the placement set as it is; only its impact matters here. */
function typeVersionEdit(commandId: string): DocumentCommand {
  return {
    kind: "set-values",
    commandId,
    edits: [
      { placementId: "crate", path: ["typeVersion"], expected: 1, value: 2 },
    ],
  };
}

/** A catalog that declares no parameters for any type. */
const catalog = { get: () => undefined } as unknown as LevelCatalog;
/** A catalog whose crate holds a place, which the level decodes through the pose. */
const pointed = {
  get: (typeId: string) =>
    typeId === "game.crate"
      ? {
          declaration: {
            params: defineParams({
              home: param.point({ x: 0, y: 0 }, { relative: true }),
            }),
          },
        }
      : undefined,
} as unknown as LevelCatalog;
/** One declared layer, so a rebuild request can be checked for carrying it. */
const LAYERS = [{ name: "world", order: 10 }];

function createHarness(withCatalog = true, using: LevelCatalog = catalog) {
  const store = new EditorStore({
    api: new EditorApiClient({
      token: "t",
      fetch: () => Promise.reject(new Error("not used")),
    }),
    epoch: "epoch-1",
    projectId: "project-1",
    levels: [],
  });
  const rebuilds: PreviewRequest[] = [];
  const drafts: PoseEdit[][] = [];
  const views: EditorViewState[] = [];
  const stop = connectPreview(
    store,
    () => (withCatalog ? using : undefined),
    {
      requestRebuild: (request) => rebuilds.push(request),
      applyPoseDraft: (poses) => drafts.push([...poses]),
      applyView: (view) => views.push(view),
    },
    () => LAYERS,
  );
  const open = (doc: LevelDocument, revision = 0): void => {
    store.dispatch({ type: "level-opened", snapshot: snapshot(revision, doc) });
  };
  /** A local command, applied the way the store applies one. */
  const apply = (
    command: DocumentCommand,
    impact: PreviewImpact,
    affected: readonly string[] = ["crate"],
  ): void => {
    store.dispatch({ type: "command-applied", command, affected, impact });
  };
  return { store, rebuilds, drafts, views, stop, open, apply };
}

describe("connectPreview", () => {
  it("rebuilds when a level opens", () => {
    const harness = createHarness();
    harness.open(document(placement("crate", 0)));

    expect(harness.rebuilds).toHaveLength(1);
    expect(harness.rebuilds[0]?.document.entities[0]?.id).toBe("crate");
  });

  it("carries the open level's declared layers into every rebuild", () => {
    const harness = createHarness();
    harness.open(document(placement("crate", 0)));

    expect(harness.rebuilds[0]?.layers).toEqual(LAYERS);
  });

  it("rebuilds when the same level is opened again", () => {
    const harness = createHarness();
    harness.open(document(placement("crate", 0)));
    harness.open(document(placement("crate", 40)), 3);

    // Same ids, so the id comparison alone would leave the first document on
    // screen; a re-read draft is whatever the server holds now.
    expect(harness.rebuilds).toHaveLength(2);
    expect(
      harness.rebuilds[1]?.document.entities[0]?.transform.position.x,
    ).toBe(40);
  });

  describe("a local command", () => {
    it("writes the affected poses for a pose impact and does not rebuild", () => {
      const harness = createHarness();
      harness.open(document(placement("crate", 0)));
      harness.apply(
        {
          kind: "set-poses",
          commandId: "c1",
          poses: [
            {
              id: "crate",
              transform: {
                position: { x: 40, y: 0 },
                rotation: 0,
                scale: { x: 1, y: 1 },
              },
            },
          ],
        },
        "pose",
      );

      expect(harness.rebuilds).toHaveLength(1);
      expect(harness.drafts.at(-1)).toEqual([
        {
          id: "crate",
          transform: {
            position: { x: 40, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
          },
        },
      ]);
    });

    it("sets a moved placement up again when it holds a place", () => {
      // A point was decoded through the pose the placement had, so the entity
      // built from it is set up for where the placement used to be.
      const harness = createHarness(true, pointed);
      harness.open(document(placement("crate", 0)));
      harness.apply(move("crate", 40), "pose");

      expect(harness.rebuilds).toHaveLength(2);
      expect(harness.drafts).toEqual([]);
    });

    it("sets a moved parent's children up again when one holds a place", () => {
      const harness = createHarness(true, pointed);
      harness.open(
        document(
          { ...placement("root", 0), type: "game.empty" },
          placement("crate", 10, "root"),
        ),
      );
      harness.apply(move("root", 40), "pose", ["root"]);

      expect(harness.rebuilds).toHaveLength(2);
      expect(harness.drafts).toEqual([]);
    });

    it("rebuilds for a rebuild impact even though the placement set is unchanged", () => {
      const harness = createHarness();
      harness.open(document(placement("crate", 0)));
      harness.apply(typeVersionEdit("c1"), "rebuild");

      // A parameter edit or a reparent keeps every id, so the id comparison
      // alone would leave the old asset or the old runtime parent on screen.
      expect(harness.rebuilds).toHaveLength(2);
      expect(harness.rebuilds[1]?.document.entities[0]?.typeVersion).toBe(2);
      expect(harness.drafts).toEqual([]);
    });

    it("touches nothing for a document-only impact", () => {
      const harness = createHarness();
      harness.open(document(placement("crate", 0)));
      harness.apply(typeVersionEdit("c1"), "document-only");

      expect(harness.rebuilds).toHaveLength(1);
      expect(harness.drafts).toEqual([]);
    });
  });

  it("rebuilds when the set of placements changes", () => {
    const harness = createHarness();
    harness.open(document(placement("crate", 0)));
    harness.store.dispatch({
      type: "command-accepted",
      commandId: "c1",
      snapshot: snapshot(
        1,
        document(placement("crate", 0), placement("barrel", 9)),
      ),
    });

    expect(harness.rebuilds).toHaveLength(2);
  });

  it("re-reads poses when the server accepts a command", () => {
    const harness = createHarness();
    harness.open(document(placement("crate", 0)));
    harness.store.dispatch({
      type: "command-accepted",
      commandId: "c1",
      snapshot: snapshot(1, document(placement("crate", 40))),
    });

    // The accepted document is what the server normalized; the poses are read
    // back from it rather than trusted from the command.
    expect(harness.rebuilds).toHaveLength(1);
    expect(harness.drafts.at(-1)?.[0]?.transform.position.x).toBe(40);
  });

  describe("changes the browser did not author", () => {
    // The browser holds neither the inverse a step replayed nor what a newer
    // draft changed, so it cannot prove a pose write is enough. Each of these
    // rebuilds, whatever the placement set did.
    it("rebuilds after an undo, even one that only rewinds a pose", () => {
      const harness = createHarness();
      harness.open(document(placement("crate", 80)), 1);
      harness.store.dispatch({
        type: "history-stepped",
        snapshot: snapshot(2, document(placement("crate", 0))),
      });

      expect(harness.rebuilds).toHaveLength(2);
      expect(
        harness.rebuilds[1]?.document.entities[0]?.transform.position.x,
      ).toBe(0);
    });

    it("rebuilds once when an undo puts a deleted placement back", () => {
      const harness = createHarness();
      harness.open(document(placement("crate", 0)), 1);
      harness.store.dispatch({
        type: "history-stepped",
        snapshot: snapshot(
          2,
          document(placement("crate", 0), placement("barrel", 9)),
        ),
      });

      expect(harness.rebuilds).toHaveLength(2);
    });

    it("rebuilds after a rebase", () => {
      const harness = createHarness();
      harness.open(document(placement("crate", 0)));
      harness.apply(typeVersionEdit("c1"), "rebuild");
      harness.store.dispatch({
        type: "command-rebased",
        commandId: "c1",
        snapshot: snapshot(1, document(placement("crate", 5))),
      });

      expect(harness.rebuilds).toHaveLength(3);
      // The projection: the newer draft with the pending edit replayed on it.
      const shown = harness.rebuilds[2]?.document.entities[0];
      expect(shown?.transform.position.x).toBe(5);
      expect(shown?.typeVersion).toBe(2);
    });

    it("rebuilds after a drop, from the projection without the dropped edit", () => {
      const harness = createHarness();
      harness.open(document(placement("crate", 0)));
      harness.apply(typeVersionEdit("c1"), "rebuild");
      harness.store.dispatch({
        type: "command-dropped",
        commandId: "c1",
        diagnostic: {
          code: "command-dropped",
          severity: "error",
          source: "validation",
          message: "gone",
          revision: 0,
        },
      });

      expect(harness.rebuilds).toHaveLength(3);
      expect(harness.rebuilds[2]?.document.entities[0]?.typeVersion).toBe(1);
    });
  });

  it("leaves a running drag where the pointer put it", () => {
    const harness = createHarness();
    harness.open(document(placement("crate", 0)));
    harness.store.dispatch({
      type: "gesture-started",
      gesture: {
        kind: "translate",
        spin: 0,
        constrained: false,
        suspended: false,
        snapFrom: { position: { x: 0, y: 0 }, rotation: 0 },
        reference: { x: 64, y: 64, kind: "length" },
        ids: ["crate"],
        origin: { x: 0, y: 0 },
        current: { x: 60, y: 0 },
        base: new Map(),
      },
    });
    const before = harness.drafts.length;
    harness.store.dispatch({
      type: "command-accepted",
      commandId: "earlier",
      snapshot: snapshot(1, document(placement("crate", 0))),
    });

    // The drag's pose lives in the gesture and on the preview's entities, not
    // in the document, so writing document poses now would pull the placement
    // out from under the pointer.
    expect(harness.drafts).toHaveLength(before);
  });

  it("leaves a number a field is stepping where the last press put it", () => {
    const harness = createHarness();
    harness.open(document(placement("crate", 0)));
    harness.store.dispatch({
      type: "pose-drafted",
      draft: { id: "crate", component: "x", value: 40 },
    });
    const before = harness.drafts.length;
    harness.store.dispatch({
      type: "command-accepted",
      commandId: "earlier",
      snapshot: snapshot(1, document(placement("crate", 0))),
    });

    // For the reason a running drag has: the stepped pose is in the store and
    // on the preview's entities, never in the document, so writing document
    // poses now would undraw the last arrow press.
    expect(harness.drafts).toHaveLength(before);
  });

  it("puts a placement back when its pending number is dropped", () => {
    const harness = createHarness();
    harness.open(document(placement("crate", 0), placement("rock", 100)));
    harness.store.dispatch({
      type: "pose-drafted",
      draft: { id: "crate", component: "x", value: 99 },
    });
    const before = harness.drafts.length;
    harness.store.dispatch({ type: "selection-changed", ids: ["rock"] });

    // The reduction that drops the number has no preview, so without this the
    // placement would keep being drawn at a number no document holds and
    // nothing would ever commit.
    expect(harness.drafts).toHaveLength(before + 1);
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
  });

  it("does nothing before a catalog exists", () => {
    const harness = createHarness(false);
    harness.open(document(placement("crate", 0)));

    expect(harness.rebuilds).toEqual([]);
    expect(harness.drafts).toEqual([]);
  });

  it("stops listening when disconnected", () => {
    const harness = createHarness();
    harness.stop();
    harness.open(document(placement("crate", 0)));

    expect(harness.rebuilds).toEqual([]);
  });

  it("moves the camera when the view changes, and rebuilds nothing", () => {
    const harness = createHarness();
    harness.open(document(placement("crate", 0)));
    const rebuilds = harness.rebuilds.length;

    harness.store.dispatch({ type: "view-panned", by: { x: 40, y: 0 } });

    expect(harness.views.at(-1)).toEqual({
      center: { x: 40, y: 0 },
      zoom: 1,
      guides: true,
      snap: true,
      step: 32,
    });
    expect(harness.rebuilds).toHaveLength(rebuilds);
    expect(harness.drafts).toEqual([]);
  });

  it("moves the camera before a catalog exists", () => {
    // The view is browser state; nothing about it needs a catalog, and a
    // camera left behind until one loads would show the wrong part of the
    // world.
    const harness = createHarness(false);
    harness.store.dispatch({ type: "view-panned", by: { x: 40, y: 0 } });

    expect(harness.views.at(-1)?.center).toEqual({ x: 40, y: 0 });
  });

  it("leaves the camera alone when only the document changes", () => {
    const harness = createHarness();
    harness.open(document(placement("crate", 0)));
    const views = harness.views.length;

    harness.open(document(placement("crate", 5)), 1);

    expect(harness.views).toHaveLength(views);
  });
});
