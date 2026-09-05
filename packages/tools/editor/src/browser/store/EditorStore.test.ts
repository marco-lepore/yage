import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";
import { beforeEach, describe, expect, it } from "vitest";
import type { DocumentCommand } from "../../shared/commands/index.js";
import type {
  DraftOutcome,
  DraftSnapshot,
} from "../../shared/protocol/index.js";
import { EditorApiClient } from "../api/index.js";
import { EditorStore, MAX_REBASES, isDirty } from "./EditorStore.js";
import { MIN_STEP } from "./snap.js";
import type { EditorAction, EditorViewState } from "./types.js";
import {
  DEFAULT_VIEW,
  MAX_ZOOM,
  parseView,
  viewStorageKey,
  type ViewStorage,
} from "./view.js";

/** A storage that keeps what it is given, and can be made to refuse. */
function fakeStorage(): ViewStorage & {
  entries: Map<string, string>;
  fail: boolean;
} {
  const entries = new Map<string, string>();
  return {
    entries,
    fail: false,
    getItem(key) {
      if (this.fail) throw new Error("storage is blocked");
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.fail) throw new Error("storage is blocked");
      entries.set(key, value);
    },
  };
}

/** The view this level's entry holds, as a reload would read it. */
function stored(storage: {
  entries: Map<string, string>;
}): EditorViewState | undefined {
  return parseView(
    storage.entries.get(
      viewStorageKey("project-1", "levels/forest.yage-level.json"),
    ) ?? null,
  );
}

function placement(id: string, x: number): LevelPlacement {
  return {
    id,
    type: "game.crate",
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

function snapshot(
  draftRevision: number,
  doc: LevelDocument,
  overrides: Partial<DraftSnapshot> = {},
): DraftSnapshot {
  return {
    path: "levels/forest.yage-level.json",
    epoch: "epoch-1",
    document: doc,
    draftRevision,
    diskRevision: "disk-1",
    contentHash: `content-${String(draftRevision)}`,
    savedContentHash: "content-0",
    dirty: draftRevision > 0,
    history: { undoDepth: 0, redoDepth: 0 },
    ...overrides,
  };
}

function moveCommand(
  commandId: string,
  id: string,
  x: number,
): DocumentCommand {
  return {
    kind: "set-poses",
    commandId,
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

interface CommandCall {
  readonly expectedDraftRevision: number;
  /** The route's last segment: a command's id, or `undo` / `redo`. */
  readonly commandId: string;
}

/**
 * The store driven through the real API client, so the outcome decoding under
 * test is the one the editor ships rather than a hand-written stand-in.
 */
function createHarness(storage?: ViewStorage): {
  store: EditorStore;
  calls: CommandCall[];
  answer(outcome: DraftOutcome | "network-failure"): void;
} {
  const calls: CommandCall[] = [];
  const answers: Array<DraftOutcome | "network-failure"> = [];
  const fetchImpl: typeof globalThis.fetch = (url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      expectedDraftRevision: number;
      command?: DocumentCommand;
    };
    const route = String(url);
    const step = route.includes("/draft/undo")
      ? "undo"
      : route.includes("/draft/redo")
        ? "redo"
        : undefined;
    const commandId = step ?? body.command?.commandId ?? "?";
    calls.push({
      expectedDraftRevision: body.expectedDraftRevision,
      commandId,
    });
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error(`No answer queued for ${commandId}.`);
    }
    if (answer === "network-failure") {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    return Promise.resolve(
      new Response(JSON.stringify(answer), { status: 200 }),
    );
  };

  const api = new EditorApiClient({ token: "token", fetch: fetchImpl });
  return {
    store: new EditorStore({
      api,
      epoch: "epoch-1",
      projectId: "project-1",
      storage,
    }),
    calls,
    answer(outcome) {
      answers.push(outcome);
    },
  };
}

/**
 * Lets every queued promise settle, including a rebase's re-send. Each round
 * trip spans several turns of the queue — the fetch, its JSON, the dispatch —
 * so this yields to the task queue rather than draining microtasks alone.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("EditorStore", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
    harness.store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document(placement("crate", 0))),
    });
  });

  it("opens a level into the committed state and the projection", () => {
    const state = harness.store.getState();
    expect(state.committed.draftRevision).toBe(0);
    expect(state.document.entities[0]?.transform.position.x).toBe(0);
    expect(state.file?.path).toBe("levels/forest.yage-level.json");
    expect(isDirty(state)).toBe(false);
  });

  it("applies a command before the server has answered", () => {
    harness.answer({
      status: "accepted",
      snapshot: snapshot(1, document(placement("crate", 40))),
    });
    harness.store.submit(moveCommand("c1", "crate", 40));

    const state = harness.store.getState();
    expect(state.document.entities[0]?.transform.position.x).toBe(40);
    expect(state.committed.document.entities[0]?.transform.position.x).toBe(0);
    expect(state.pending).toHaveLength(1);
    expect(isDirty(state)).toBe(true);
  });

  it("puts the reduction's preview impact on the applied action", async () => {
    const actions: EditorAction[] = [];
    harness.store.subscribe((_state, action) => actions.push(action));
    harness.answer({
      status: "accepted",
      snapshot: snapshot(2, document(placement("crate", 0))),
    });
    harness.store.submit({
      kind: "set-values",
      commandId: "c-values",
      edits: [
        {
          placementId: "crate",
          path: ["typeVersion"],
          expected: 1,
          value: 2,
        },
      ],
    });

    // The preview reads the impact off the action; nothing else says whether
    // the projection needs a rebuild or a pose write.
    const applied = actions.find((action) => action.type === "command-applied");
    expect(applied).toMatchObject({
      type: "command-applied",
      affected: ["crate"],
      impact: "rebuild",
    });
    await settle();
  });

  it("reports a pose write as a pose impact", () => {
    const actions: EditorAction[] = [];
    harness.store.subscribe((_state, action) => actions.push(action));
    harness.answer({
      status: "accepted",
      snapshot: snapshot(1, document(placement("crate", 40))),
    });
    harness.store.submit(moveCommand("c-pose", "crate", 40));

    expect(actions.at(-1)).toMatchObject({
      type: "command-applied",
      impact: "pose",
    });
  });

  it("commits the accepted snapshot and clears the command", async () => {
    harness.answer({
      status: "accepted",
      snapshot: snapshot(1, document(placement("crate", 40))),
    });
    harness.store.submit(moveCommand("c1", "crate", 40));
    await settle();

    const state = harness.store.getState();
    expect(state.pending).toEqual([]);
    expect(state.committed.draftRevision).toBe(1);
    expect(state.document.entities[0]?.transform.position.x).toBe(40);
  });

  it("rebases a stale command onto the newer revision and re-sends it", async () => {
    harness.answer({
      status: "stale",
      snapshot: snapshot(1, document(placement("crate", 40))),
    });
    harness.answer({
      status: "accepted",
      snapshot: snapshot(2, document(placement("crate", 90))),
    });
    harness.store.submit(moveCommand("c2", "crate", 90));
    await settle();

    expect(harness.calls).toEqual([
      { expectedDraftRevision: 0, commandId: "c2" },
      { expectedDraftRevision: 1, commandId: "c2" },
    ]);
    expect(harness.store.getState().committed.draftRevision).toBe(2);
    expect(harness.store.getState().pending).toEqual([]);
  });

  it("drops a command after three rebases, locks writes, and reports it", async () => {
    for (let revision = 1; revision <= MAX_REBASES + 1; revision += 1) {
      harness.answer({
        status: "stale",
        snapshot: snapshot(revision, document(placement("crate", revision))),
      });
    }
    harness.store.submit(moveCommand("c3", "crate", 500));
    await settle();

    expect(harness.calls).toHaveLength(MAX_REBASES + 1);
    const state = harness.store.getState();
    expect(state.pending).toEqual([]);
    expect(state.writesLocked).toEqual(["stale-command"]);
    expect(state.diagnostics.get("validation")?.[0]?.code).toBe(
      "command-dropped",
    );
    // The last snapshot is still adopted: the browser shows the draft the
    // server has, not the edit it gave up on.
    expect(state.document.entities[0]?.transform.position.x).toBe(
      MAX_REBASES + 1,
    );
  });

  it("ignores a stale answer for a command that is already gone", async () => {
    harness.answer({
      status: "stale",
      snapshot: snapshot(1, document(placement("crate", 5))),
    });
    harness.store.submit(moveCommand("c11", "crate", 40));
    // The command leaves the pending set before its answer lands.
    harness.store.dispatch({
      type: "command-dropped",
      commandId: "c11",
      diagnostic: {
        code: "command-dropped",
        severity: "error",
        source: "validation",
        message: "gone",
        revision: 0,
      },
    });
    await settle();

    expect(harness.calls).toHaveLength(1);
    expect(harness.store.getState().committed.draftRevision).toBe(0);
  });

  it("holds one lock per reason", () => {
    harness.store.lockWrites("stale-command");
    harness.store.lockWrites("stale-command");
    harness.store.lockWrites("stale-project");

    expect(harness.store.getState().writesLocked).toEqual([
      "stale-command",
      "stale-project",
    ]);
  });

  it("ignores a pointer move when no drag is running", () => {
    harness.store.dispatch({
      type: "gesture-moved",
      spin: 0,
      constrained: false,
      suspended: false,
      current: { x: 5, y: 5 },
    });

    expect(harness.store.getState().gesture).toBeUndefined();
  });

  it("refuses a command while writes are locked", () => {
    harness.store.lockWrites("stale-project");
    harness.store.submit(moveCommand("c4", "crate", 10));

    expect(harness.calls).toEqual([]);
    expect(harness.store.getState().pending).toEqual([]);
  });

  it("keeps the newer committed revision when answers arrive out of order", async () => {
    harness.answer({
      status: "accepted",
      snapshot: snapshot(5, document(placement("crate", 50))),
    });
    harness.store.submit(moveCommand("c5", "crate", 50));
    await settle();

    harness.store.dispatch({
      type: "command-accepted",
      commandId: "stragler",
      snapshot: snapshot(2, document(placement("crate", 20))),
    });

    const state = harness.store.getState();
    expect(state.committed.draftRevision).toBe(5);
    expect(state.document.entities[0]?.transform.position.x).toBe(50);
  });

  it("stops re-sending a command the newer draft made impossible", async () => {
    harness.answer({
      status: "stale",
      // The crate is gone from the draft, so the pending move cannot replay
      // and the rebase discards it.
      snapshot: snapshot(1, document(placement("barrel", 0))),
    });
    harness.store.submit(moveCommand("c6", "crate", 70));
    await settle();

    const state = harness.store.getState();
    // One request, not two: re-sending would ask the server for an edit the
    // browser has already discarded, and its refusal would be reported as a
    // failure the user cannot act on.
    expect(harness.calls).toEqual([
      { expectedDraftRevision: 0, commandId: "c6" },
    ]);
    expect(state.pending).toEqual([]);
    expect(state.document.entities.map((entity) => entity.id)).toEqual([
      "barrel",
    ]);
    expect(state.diagnostics.get("server")).toBeUndefined();
  });

  it("reports a rejected command and stops sending it", async () => {
    harness.answer({
      status: "rejected",
      code: "structurally-invalid",
      message: "Scale must not be zero.",
    });
    harness.store.submit(moveCommand("c8", "crate", 10));
    await settle();

    const state = harness.store.getState();
    expect(harness.calls).toHaveLength(1);
    expect(state.pending).toEqual([]);
    expect(state.diagnostics.get("server")?.[0]?.message).toBe(
      "Scale must not be zero.",
    );
    // The optimistic edit is rolled back with it.
    expect(state.document.entities[0]?.transform.position.x).toBe(0);
  });

  it("reports a command the server never received", async () => {
    harness.answer("network-failure");
    harness.store.submit(moveCommand("c9", "crate", 10));
    await settle();

    const state = harness.store.getState();
    expect(state.pending).toEqual([]);
    expect(state.diagnostics.get("server")?.[0]?.code).toBe("server-rejected");
  });

  it("refuses a command against a placement the document does not have", () => {
    harness.store.submit(moveCommand("c10", "ghost", 10));

    expect(harness.calls).toEqual([]);
    expect(harness.store.getState().diagnostics.get("validation")).toHaveLength(
      1,
    );
  });

  describe("awaitResolved", () => {
    it("resolves immediately when nothing it names is pending", async () => {
      await expect(harness.store.awaitResolved(["never-sent"])).resolves.toBe(
        undefined,
      );
    });

    it("waits for the named command and ignores later ones", async () => {
      harness.answer({
        status: "accepted",
        snapshot: snapshot(1, document(placement("crate", 40))),
      });
      harness.store.submit(moveCommand("first", "crate", 40));
      const settled = harness.store.awaitResolved(["first"]);

      let done = false;
      void settled.then(() => {
        done = true;
      });
      expect(done).toBe(false);

      await settle();
      // A command submitted after the wait started must not extend it.
      harness.answer({
        status: "accepted",
        snapshot: snapshot(2, document(placement("crate", 80))),
      });
      harness.store.submit(moveCommand("second", "crate", 80));
      await settled;
      expect(harness.store.getState().pending).toHaveLength(1);
    });

    it("resolves when the command is dropped rather than accepted", async () => {
      for (let revision = 1; revision <= MAX_REBASES + 1; revision += 1) {
        harness.answer({
          status: "stale",
          snapshot: snapshot(revision, document(placement("crate", 0))),
        });
      }
      harness.store.submit(moveCommand("doomed", "crate", 500));
      await harness.store.awaitResolved(["doomed"]);

      expect(harness.store.getState().writesLocked).toEqual(["stale-command"]);
    });
  });

  describe("gestures and selection", () => {
    it("returns the gesture once and clears it", () => {
      const gesture = {
        kind: "translate" as const,
        spin: 0,
        constrained: false,
        suspended: false,
        snapFrom: { position: { x: 0, y: 0 }, rotation: 0 },
        reference: { x: 64, y: 64, kind: "length" as const },
        ids: ["crate"],
        origin: { x: 0, y: 0 },
        current: { x: 10, y: 0 },
        base: new Map(),
      };
      harness.store.dispatch({ type: "gesture-started", gesture });

      expect(harness.store.takeGesture()).toBe(gesture);
      expect(harness.store.takeGesture()).toBeUndefined();
      expect(harness.store.getState().gesture).toBeUndefined();
    });

    it("counts an open gesture as unsaved work", () => {
      harness.store.dispatch({
        type: "gesture-started",
        gesture: {
          kind: "translate",
          spin: 0,
          constrained: false,
          suspended: false,
          snapFrom: { position: { x: 0, y: 0 }, rotation: 0 },
          reference: { x: 64, y: 64, kind: "length" as const },
          ids: ["crate"],
          origin: { x: 0, y: 0 },
          current: { x: 10, y: 0 },
          base: new Map(),
        },
      });

      expect(isDirty(harness.store.getState())).toBe(true);
    });

    it("drops selected ids the committed document no longer has", () => {
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "barrel"],
      });
      harness.store.dispatch({
        type: "command-accepted",
        commandId: "none",
        snapshot: snapshot(1, document(placement("crate", 0))),
      });

      expect([...harness.store.getState().selection]).toEqual(["crate"]);
    });
  });

  describe("hiding placements", () => {
    it("hides what is named and shows it again", () => {
      harness.store.dispatch({
        type: "hidden-toggled",
        ids: ["crate", "barrel"],
      });
      expect([...harness.store.getState().hidden]).toEqual(["crate", "barrel"]);

      harness.store.dispatch({ type: "hidden-toggled", ids: ["crate"] });
      expect([...harness.store.getState().hidden]).toEqual(["barrel"]);
    });

    it("replaces the whole set, which is what isolating does", () => {
      harness.store.dispatch({ type: "hidden-toggled", ids: ["crate"] });
      harness.store.dispatch({ type: "hidden-set", ids: ["barrel", "torch"] });

      expect([...harness.store.getState().hidden]).toEqual(["barrel", "torch"]);
    });

    it("clears the set, and answers the same state when it is already empty", () => {
      harness.store.dispatch({ type: "hidden-toggled", ids: ["crate"] });
      harness.store.dispatch({ type: "hidden-cleared" });
      const cleared = harness.store.getState();
      expect(cleared.hidden.size).toBe(0);

      harness.store.dispatch({ type: "hidden-cleared" });
      expect(harness.store.getState()).toBe(cleared);
    });

    it("is not unsaved work", () => {
      harness.store.dispatch({ type: "hidden-toggled", ids: ["crate"] });

      expect(isDirty(harness.store.getState())).toBe(false);
    });

    it("drops hidden ids the committed document no longer has", () => {
      harness.store.dispatch({
        type: "hidden-toggled",
        ids: ["crate", "barrel"],
      });
      harness.store.dispatch({
        type: "command-accepted",
        commandId: "none",
        snapshot: snapshot(1, document(placement("crate", 0))),
      });

      expect([...harness.store.getState().hidden]).toEqual(["crate"]);
    });
  });

  describe("a reference field waiting for a target", () => {
    const pick = { placementId: "crate", field: "door", types: ["game.crate"] };

    it("holds one, and clears it once", () => {
      harness.store.dispatch({ type: "pick-started", pick });
      expect(harness.store.getState().pick).toEqual(pick);

      harness.store.dispatch({ type: "pick-ended" });
      const cleared = harness.store.getState();
      expect(cleared.pick).toBeUndefined();

      harness.store.dispatch({ type: "pick-ended" });
      expect(harness.store.getState()).toBe(cleared);
    });

    it("is not unsaved work", () => {
      harness.store.dispatch({ type: "pick-started", pick });

      expect(isDirty(harness.store.getState())).toBe(false);
    });

    it("stops waiting unless the holder stays the whole selection", () => {
      harness.store.dispatch({ type: "pick-started", pick });
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      expect(harness.store.getState().pick).toEqual(pick);

      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "barrel"],
      });
      expect(harness.store.getState().pick).toBeUndefined();

      harness.store.dispatch({ type: "pick-started", pick });
      harness.store.dispatch({ type: "selection-changed", ids: ["barrel"] });
      expect(harness.store.getState().pick).toBeUndefined();
    });

    it("stops waiting when a snapshot no longer holds the holder", () => {
      harness.store.dispatch({ type: "pick-started", pick });
      harness.store.dispatch({
        type: "command-accepted",
        commandId: "none",
        snapshot: snapshot(1, document(placement("crate", 0))),
      });
      expect(harness.store.getState().pick).toEqual(pick);

      harness.store.dispatch({
        type: "command-accepted",
        commandId: "none",
        snapshot: snapshot(2, document(placement("barrel", 0))),
      });
      expect(harness.store.getState().pick).toBeUndefined();
    });
  });

  describe("the history", () => {
    it("mirrors the depths every snapshot carries", async () => {
      expect(harness.store.getState().history).toEqual({
        undoDepth: 0,
        redoDepth: 0,
      });

      harness.answer({
        status: "accepted",
        snapshot: snapshot(1, document(placement("crate", 40)), {
          history: { undoDepth: 1, redoDepth: 0 },
        }),
      });
      harness.store.submit(moveCommand("c1", "crate", 40));
      await harness.store.awaitResolved(["c1"]);

      expect(harness.store.getState().history).toEqual({
        undoDepth: 1,
        redoDepth: 0,
      });
    });

    it("withdraws an open delete question when a level is opened", () => {
      // The answer is about placements of the level being left, so it means
      // nothing in the one being entered.
      harness.store.dispatch({
        type: "delete-confirm-requested",
        ids: ["crate"],
      });
      expect(harness.store.getState().pendingDelete).toEqual(["crate"]);

      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document(placement("crate", 0))),
      });

      expect(harness.store.getState().pendingDelete).toBeUndefined();
    });

    it("sends an undo against the committed revision and adopts the answer", async () => {
      harness.answer({
        status: "accepted",
        snapshot: snapshot(4, document(placement("crate", 0)), {
          history: { undoDepth: 0, redoDepth: 1 },
        }),
      });
      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot(3, document(placement("crate", 40)), {
          history: { undoDepth: 1, redoDepth: 0 },
        }),
      });
      harness.store.step("undo");
      await settle();

      expect(harness.calls).toEqual([
        { expectedDraftRevision: 3, commandId: "undo" },
      ]);
      const state = harness.store.getState();
      expect(state.committed.draftRevision).toBe(4);
      expect(state.document.entities[0]?.transform.position.x).toBe(0);
      expect(state.history).toEqual({ undoDepth: 0, redoDepth: 1 });
    });

    it("takes an empty stack as an answer, not an error", async () => {
      // The server accepts an undo with nothing to undo at the revision it was
      // sent against, so nothing moves and nothing is reported.
      harness.answer({
        status: "accepted",
        snapshot: snapshot(0, document(placement("crate", 0))),
      });
      harness.store.step("undo");
      await settle();

      const state = harness.store.getState();
      expect(state.committed.draftRevision).toBe(0);
      expect(state.diagnostics.size).toBe(0);
    });

    it("never puts a step in the pending list", async () => {
      harness.answer({
        status: "accepted",
        snapshot: snapshot(1, document(placement("crate", 0))),
      });
      harness.store.step("undo");

      // `pending` is keyed by command id, and an inverse carries the id of the
      // command it undoes — a step in there would collide with it.
      expect(harness.store.getState().pending).toEqual([]);
      await settle();
      expect(harness.store.getState().pending).toEqual([]);
    });

    it("re-sends against the newer revision when it loses a race", async () => {
      harness.answer({
        status: "stale",
        snapshot: snapshot(5, document(placement("crate", 20)), {
          history: { undoDepth: 2, redoDepth: 0 },
        }),
      });
      harness.answer({
        status: "accepted",
        snapshot: snapshot(6, document(placement("crate", 0)), {
          history: { undoDepth: 1, redoDepth: 1 },
        }),
      });
      harness.store.step("undo");
      await settle();

      // The entry it lost with is still on the stack, so the second attempt
      // has something to spend.
      expect(harness.calls).toEqual([
        { expectedDraftRevision: 0, commandId: "undo" },
        { expectedDraftRevision: 5, commandId: "undo" },
      ]);
      expect(harness.store.getState().committed.draftRevision).toBe(6);
    });

    it("does not re-send a step into the level it was issued against", async () => {
      harness.answer({
        status: "stale",
        snapshot: snapshot(5, document(placement("crate", 20))),
      });
      harness.store.step("undo");
      // The developer picks another level while the answer is in flight.
      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot(2, document(placement("crate", 0)), {
          path: "levels/meadow.yage-level.json",
        }),
      });
      await settle();

      // A re-send would carry the meadow revision to the forest level, undo a
      // step there, and have its answer refused as foreign — an edit nothing
      // on screen could explain.
      expect(harness.calls).toEqual([
        { expectedDraftRevision: 0, commandId: "undo" },
      ]);
      expect(harness.store.getState().committed.draftRevision).toBe(2);
    });

    it("gives up after the same budget a command gets", async () => {
      for (let revision = 1; revision <= MAX_REBASES + 1; revision += 1) {
        harness.answer({
          status: "stale",
          snapshot: snapshot(revision, document(placement("crate", 0))),
        });
      }
      harness.store.step("undo");
      await settle();

      // One send plus MAX_REBASES re-sends, the same count the command path
      // spends before it drops an edit.
      expect(harness.calls).toHaveLength(MAX_REBASES + 1);
      expect(
        harness.store.getState().diagnostics.get("validation")?.[0]?.message,
      ).toContain("could not reach a current revision");
      // Nothing was lost, so nothing is locked: the edit the undo would have
      // taken back is still in the draft.
      expect(harness.store.getState().writesLocked).toEqual([]);
    });

    it("reports a refusal and shows what the server is holding", async () => {
      harness.answer({
        status: "rejected",
        code: "epoch-mismatch",
        message: "The editor server restarted.",
        snapshot: snapshot(2, document(placement("crate", 7)), {
          history: { undoDepth: 3, redoDepth: 0 },
        }),
      });
      harness.store.step("redo");
      await settle();

      expect(harness.store.getState().diagnostics.get("server")?.[0]).toEqual(
        expect.objectContaining({ message: "The editor server restarted." }),
      );
      expect(harness.store.getState().history).toEqual({
        undoDepth: 3,
        redoDepth: 0,
      });
    });

    it("reports a transport failure", async () => {
      harness.answer("network-failure");
      harness.store.step("undo");
      await settle();

      expect(harness.store.getState().diagnostics.get("server")).toHaveLength(
        1,
      );
    });

    it("sends nothing while writes are locked", async () => {
      harness.store.lockWrites("stale-project");
      harness.store.step("undo");
      await settle();

      expect(harness.calls).toEqual([]);
    });

    it("sends nothing before a level is open", async () => {
      const fresh = createHarness();
      fresh.store.step("undo");
      await settle();

      expect(fresh.calls).toEqual([]);
    });
  });

  describe("the view", () => {
    it("starts at the default and moves on a pan", () => {
      expect(harness.store.getState().view).toEqual(DEFAULT_VIEW);

      harness.store.dispatch({ type: "view-panned", by: { x: 30, y: -10 } });

      expect(harness.store.getState().view).toEqual({
        ...DEFAULT_VIEW,
        center: { x: 30, y: -10 },
      });
    });

    it("sends no command and dirties nothing when it moves", async () => {
      const before = harness.store.getState().document;
      harness.store.dispatch({ type: "view-panned", by: { x: 30, y: -10 } });
      harness.store.dispatch({
        type: "view-zoomed",
        factor: 2,
        anchor: { x: 5, y: 5 },
      });
      await settle();

      expect(harness.calls).toEqual([]);
      expect(harness.store.getState().document).toBe(before);
      expect(harness.store.getState().pending).toEqual([]);
      expect(isDirty(harness.store.getState())).toBe(false);
    });

    it("stores each level's view under its own key", () => {
      const storage = fakeStorage();
      const store = createHarness(storage).store;
      store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document(), { path: "levels/forest.json" }),
      });
      store.dispatch({ type: "view-panned", by: { x: 100, y: 0 } });
      // The grid is part of the view, so it switches with the level too: a
      // tile-based level and a free-form one want different lattices.
      store.dispatch({ type: "snap-toggled" });
      store.dispatch({ type: "step-changed", step: 64 });
      store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document(), { path: "levels/cave.json" }),
      });

      // Opening the second level restores its own view, which is nothing yet.
      expect(store.getState().view).toEqual(DEFAULT_VIEW);
      expect([...storage.entries.keys()]).toEqual([
        viewStorageKey("project-1", "levels/forest.json"),
      ]);

      // Going back brings the whole view with it, camera and grid alike.
      store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document(), { path: "levels/forest.json" }),
      });
      expect(store.getState().view).toEqual({
        ...DEFAULT_VIEW,
        center: { x: 100, y: 0 },
        snap: !DEFAULT_VIEW.snap,
        step: 64,
      });
    });

    it("opens a level with nothing remembered zoomed to fit the pane", () => {
      const store = createHarness(fakeStorage()).store;
      store.dispatch({
        type: "viewport-measured",
        viewport: {
          pane: { width: 480, height: 300 },
          design: { width: 960, height: 600 },
        },
      });

      store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });

      expect(store.getState().view).toEqual({ ...DEFAULT_VIEW, zoom: 0.5 });
    });

    it("frames the level the first measurement arrives for, and no later one", () => {
      const store = createHarness(fakeStorage()).store;
      // The pane is measured after the shell mounts, so a level can open
      // before there is anything to derive a zoom from.
      store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });
      expect(store.getState().view).toEqual(DEFAULT_VIEW);

      store.dispatch({
        type: "viewport-measured",
        viewport: {
          pane: { width: 480, height: 300 },
          design: { width: 960, height: 600 },
        },
      });
      expect(store.getState().view).toEqual({ ...DEFAULT_VIEW, zoom: 0.5 });

      // A later measurement is a pane that changed size, which moves the view
      // rather than reframing it. This one leaves it alone.
      store.dispatch({
        type: "viewport-measured",
        viewport: {
          pane: { width: 960, height: 600 },
          design: { width: 960, height: 600 },
        },
      });
      expect(store.getState().view).toEqual({ ...DEFAULT_VIEW, zoom: 0.5 });
    });

    it("leaves a view the developer moved where they put it", () => {
      const store = createHarness(fakeStorage()).store;
      store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });
      store.dispatch({ type: "view-panned", by: { x: 12, y: 34 } });

      store.dispatch({
        type: "viewport-measured",
        viewport: {
          pane: { width: 480, height: 300 },
          design: { width: 960, height: 600 },
        },
      });

      expect(store.getState().view).toEqual({
        ...DEFAULT_VIEW,
        center: { x: 12, y: 34 },
      });
    });

    it("does not write a pane measurement back as the level's view", () => {
      const storage = fakeStorage();
      const store = createHarness(storage).store;
      store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });
      store.dispatch({
        type: "viewport-measured",
        viewport: {
          pane: { width: 480, height: 300 },
          design: { width: 960, height: 600 },
        },
      });

      // Nothing stored: the pane belongs to this window, not to the level, so
      // a second window with its own shape opens framed to its own.
      expect([...storage.entries.keys()]).toEqual([]);
    });

    it("restores the view a level was last edited from", () => {
      const storage = fakeStorage();
      const first = createHarness(storage).store;
      first.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });
      first.dispatch({ type: "view-panned", by: { x: 12, y: 34 } });

      // A reload: a new store over the same storage, opening the same level.
      const second = createHarness(storage).store;
      second.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });

      expect(second.getState().view).toEqual({
        ...DEFAULT_VIEW,
        center: { x: 12, y: 34 },
      });
    });

    it("remembers the guides with the rest of the view", () => {
      const storage = fakeStorage();
      const first = createHarness(storage).store;
      first.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });
      first.dispatch({ type: "guides-toggled" });

      const second = createHarness(storage).store;
      second.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });

      expect(second.getState().view.guides).toBe(false);
    });

    it("switches snapping and resizes the lattice, changing nothing else", () => {
      harness.store.dispatch({ type: "snap-toggled" });

      expect(harness.store.getState().view).toEqual({
        ...DEFAULT_VIEW,
        snap: false,
      });

      harness.store.dispatch({ type: "step-changed", step: 64 });

      expect(harness.store.getState().view).toEqual({
        ...DEFAULT_VIEW,
        snap: false,
        step: 64,
      });
    });

    it("clamps a step from outside the bounds", () => {
      harness.store.dispatch({ type: "step-changed", step: 0.1 });

      expect(harness.store.getState().view.step).toBe(MIN_STEP);
    });

    it("remembers the snap and the step with the rest of the view", () => {
      const storage = fakeStorage();
      const first = createHarness(storage).store;
      first.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });
      // Each action is checked before the next one runs: a later view action
      // writes the whole view and would hide whether this one is a view action
      // at all, which is what puts the setting in storage.
      first.dispatch({ type: "snap-toggled" });
      expect(stored(storage)?.snap).toBe(false);
      first.dispatch({ type: "step-changed", step: 16 });
      expect(stored(storage)?.step).toBe(16);

      const second = createHarness(storage).store;
      second.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });

      expect(second.getState().view).toEqual({
        ...DEFAULT_VIEW,
        snap: false,
        step: 16,
      });
    });

    it("sends no command and dirties nothing when the guides are switched", () => {
      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });
      const before = harness.store.getState();

      harness.store.dispatch({ type: "guides-toggled" });

      const after = harness.store.getState();
      expect(after.document).toBe(before.document);
      expect(after.pending).toEqual([]);
      expect(isDirty(after)).toBe(isDirty(before));
    });

    it("publishes the restored view with the level, in one notification", () => {
      const storage = fakeStorage();
      const first = createHarness(storage).store;
      first.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });
      first.dispatch({ type: "view-panned", by: { x: 12, y: 34 } });

      const second = createHarness(storage).store;
      const seen: {
        path: string | undefined;
        center: { x: number; y: number };
      }[] = [];
      second.subscribe((state) => {
        seen.push({ path: state.file?.path, center: state.view.center });
      });
      second.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });

      expect(seen).toEqual([
        { path: "levels/forest.yage-level.json", center: { x: 12, y: 34 } },
      ]);
    });

    it("keeps editing when storage refuses, and stops asking it", () => {
      const storage = fakeStorage();
      const store = createHarness(storage).store;
      store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });
      storage.fail = true;

      store.dispatch({ type: "view-panned", by: { x: 5, y: 5 } });
      storage.fail = false;
      store.dispatch({ type: "view-panned", by: { x: 5, y: 5 } });

      expect(store.getState().view.center).toEqual({ x: 10, y: 10 });
      expect(storage.entries.size).toBe(0);
    });

    it("stops asking storage that refuses the read too", () => {
      const storage = fakeStorage();
      const store = createHarness(storage).store;
      storage.fail = true;

      // The read is the first call a level open makes, so a page that blocks
      // storage entirely fails here rather than on the first pan.
      store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });
      storage.fail = false;
      store.dispatch({ type: "view-panned", by: { x: 5, y: 5 } });

      expect(store.getState().view.center).toEqual({ x: 5, y: 5 });
      expect(storage.entries.size).toBe(0);
    });

    it("clamps a framed view that asks for more zoom than there is", () => {
      harness.store.dispatch({
        type: "view-changed",
        view: { ...DEFAULT_VIEW, center: { x: 4, y: 4 }, zoom: 666 },
      });

      // `framedView` does not clamp, and framing a one-unit placement in an
      // 800-pixel viewport asks for roughly this.
      expect(harness.store.getState().view).toEqual({
        ...DEFAULT_VIEW,
        center: { x: 4, y: 4 },
        zoom: MAX_ZOOM,
      });
    });

    it("starts fresh when the page has no storage", () => {
      harness.store.dispatch({ type: "view-panned", by: { x: 5, y: 5 } });
      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot(0, document()),
      });

      expect(harness.store.getState().view).toEqual(DEFAULT_VIEW);
    });
  });
});

describe("the clipboard", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it("holds what was copied, and replaces it on the next copy", () => {
    harness.store.dispatch({
      type: "placements-copied",
      placements: [placement("one", 0)],
    });
    harness.store.dispatch({
      type: "placements-copied",
      placements: [placement("two", 0)],
    });

    expect(harness.store.getState().clipboard.map((one) => one.id)).toEqual([
      "two",
    ]);
  });

  it("outlives the level it was copied from", () => {
    harness.store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document()),
    });
    harness.store.dispatch({
      type: "placements-copied",
      placements: [placement("one", 0)],
    });

    harness.store.dispatch({
      type: "level-opened",
      snapshot: snapshot(1, document()),
    });

    // Copying in one level and pasting into another is the reason it is held
    // by value rather than by id.
    expect(harness.store.getState().clipboard.map((one) => one.id)).toEqual([
      "one",
    ]);
  });

  it("makes nothing dirty and sends no command", () => {
    harness.store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document()),
    });
    const before = harness.store.getState();

    harness.store.dispatch({
      type: "placements-copied",
      placements: [placement("one", 0)],
    });

    const after = harness.store.getState();
    expect(after.document).toBe(before.document);
    expect(after.pending).toEqual([]);
    expect(isDirty(after)).toBe(isDirty(before));
  });
});

describe("the marquee", () => {
  const started = {
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    additive: false,
    base: ["kept"],
  } as const;

  it("follows the pointer and remembers what it started from", () => {
    const harness = createHarness();
    harness.store.dispatch({ type: "marquee-started", marquee: started });

    harness.store.dispatch({
      type: "marquee-moved",
      to: { x: 40, y: 20 },
      additive: true,
    });

    expect(harness.store.getState().marquee).toEqual({
      from: { x: 0, y: 0 },
      to: { x: 40, y: 20 },
      additive: true,
      base: ["kept"],
    });
  });

  it("is gone once it ends", () => {
    const harness = createHarness();
    harness.store.dispatch({ type: "marquee-started", marquee: started });

    harness.store.dispatch({ type: "marquee-ended" });

    expect(harness.store.getState().marquee).toBeUndefined();
  });

  it("ignores a move with no marquee running", () => {
    const harness = createHarness();

    harness.store.dispatch({
      type: "marquee-moved",
      to: { x: 1, y: 1 },
      additive: false,
    });

    expect(harness.store.getState().marquee).toBeUndefined();
  });

  it("sends no command and dirties nothing", () => {
    const harness = createHarness();
    harness.store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document()),
    });
    const before = harness.store.getState();

    harness.store.dispatch({ type: "marquee-started", marquee: started });
    harness.store.dispatch({
      type: "marquee-moved",
      to: { x: 5, y: 5 },
      additive: false,
    });
    harness.store.dispatch({ type: "marquee-ended" });

    const after = harness.store.getState();
    expect(after.document).toBe(before.document);
    expect(after.pending).toEqual([]);
    expect(isDirty(after)).toBe(isDirty(before));
  });
});
describe("switching levels", () => {
  const gesture = {
    kind: "translate" as const,
    spin: 0,
    constrained: false,
    suspended: false,
    snapFrom: { position: { x: 0, y: 0 }, rotation: 0 },
    reference: { x: 64, y: 64, kind: "length" as const },
    ids: ["crate"],
    origin: { x: 0, y: 0 },
    current: { x: 10, y: 0 },
    base: new Map(),
  };
  const meadow = { path: "levels/meadow.yage-level.json" };

  function opened(): EditorStore {
    const store = createHarness().store;
    store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document(placement("crate", 0))),
    });
    return store;
  }

  it("clears a gesture and a marquee the level being left owned", () => {
    const store = opened();
    store.dispatch({ type: "gesture-started", gesture });
    store.dispatch({
      type: "marquee-started",
      marquee: {
        from: { x: 0, y: 0 },
        to: { x: 0, y: 0 },
        additive: false,
        base: ["crate"],
      },
    });

    store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document(), meadow),
    });

    const state = store.getState();
    // Both hold ids from the document being left: a leaked gesture would make
    // the new level read as unsaved, and a leaked marquee would refuse every
    // press in it.
    expect(state.gesture).toBeUndefined();
    expect(state.marquee).toBeUndefined();
    expect(isDirty(state)).toBe(false);
  });

  it("shows everything the level being left had hidden", () => {
    const store = opened();
    store.dispatch({ type: "hidden-toggled", ids: ["crate"] });

    store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document(), meadow),
    });

    expect(store.getState().hidden.size).toBe(0);
  });

  it("stops waiting for a reference target the level being left held", () => {
    const store = opened();
    store.dispatch({
      type: "pick-started",
      pick: { placementId: "crate", field: "door", types: ["game.crate"] },
    });

    store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document(), meadow),
    });

    expect(store.getState().pick).toBeUndefined();
  });

  it("keeps the clipboard and how the developer is working", () => {
    const store = opened();
    store.dispatch({
      type: "placements-copied",
      placements: [placement("crate", 0)],
    });
    store.dispatch({ type: "tool-changed", tool: "rotate" });
    store.dispatch({ type: "pivot-changed", pivot: "center" });
    store.dispatch({ type: "axes-changed", axes: "world" });

    store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document(), meadow),
    });

    const state = store.getState();
    // Copying in one level and pasting in another is the point of a clipboard
    // that outlives the level.
    expect(state.clipboard).toHaveLength(1);
    expect(state.tool).toBe("rotate");
    expect(state.pivot).toBe("center");
    expect(state.axes).toBe("world");
  });

  it("keeps the project's problems and drops the level's", () => {
    const store = opened();
    for (const source of [
      "catalog",
      "file",
      "server",
      "validation",
      "preview",
    ] as const) {
      store.dispatch({
        type: "diagnostics-replaced",
        source,
        diagnostics: [
          {
            code: "server-rejected",
            severity: "error",
            source,
            message: `${source} went wrong`,
            revision: 0,
          },
        ],
      });
    }

    store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document(), meadow),
    });

    const diagnostics = store.getState().diagnostics;
    // `catalog` is raised about the project's declarations and is still true.
    expect([...diagnostics.keys()]).toEqual(["catalog"]);
  });

  it("keeps a write lock", () => {
    const store = opened();
    store.lockWrites("stale-project");

    store.dispatch({
      type: "level-opened",
      snapshot: snapshot(0, document(), meadow),
    });

    // The project is stale for every level in it.
    expect(store.getState().writesLocked).toEqual(["stale-project"]);
  });

  it("refuses a save answer about the level that was left", () => {
    const store = opened();
    store.dispatch({
      type: "level-opened",
      snapshot: snapshot(3, document(), meadow),
    });

    store.dispatch({
      type: "saved",
      snapshot: snapshot(1, document(placement("crate", 0)), {
        savedContentHash: "content-1",
        history: { undoDepth: 7, redoDepth: 0 },
      }),
    });

    const state = store.getState();
    // Adopting it would put the file bar on one level and the document on
    // another, and the next save would address the wrong file.
    expect(state.file?.path).toBe(meadow.path);
    expect(state.committed.draftRevision).toBe(3);
    expect(state.history.undoDepth).toBe(0);
  });

  it("still adopts a save answer about the level on screen", () => {
    const store = opened();

    store.dispatch({
      type: "saved",
      snapshot: snapshot(1, document(placement("crate", 0)), {
        savedContentHash: "content-1",
        history: { undoDepth: 7, redoDepth: 0 },
      }),
    });

    const state = store.getState();
    expect(state.file?.savedContentHash).toBe("content-1");
    expect(state.history.undoDepth).toBe(7);
  });

  it("refuses a command answer about the level that was left", () => {
    const store = opened();
    store.dispatch({
      type: "level-opened",
      snapshot: snapshot(3, document(), meadow),
    });

    store.dispatch({
      type: "command-accepted",
      commandId: "cmd-1",
      snapshot: snapshot(9, document(placement("crate", 99))),
    });

    const state = store.getState();
    expect(state.file?.path).toBe(meadow.path);
    expect(state.committed.draftRevision).toBe(3);
    expect(state.document.entities).toEqual([]);
  });

  it("refuses a history answer about the level that was left", () => {
    const store = opened();
    store.dispatch({
      type: "level-opened",
      snapshot: snapshot(3, document(), meadow),
    });

    store.dispatch({
      type: "history-stepped",
      snapshot: snapshot(9, document(placement("crate", 99)), {
        history: { undoDepth: 4, redoDepth: 1 },
      }),
    });

    const state = store.getState();
    expect(state.file?.path).toBe(meadow.path);
    expect(state.committed.draftRevision).toBe(3);
    expect(state.history).toEqual({ undoDepth: 0, redoDepth: 0 });
  });
});
