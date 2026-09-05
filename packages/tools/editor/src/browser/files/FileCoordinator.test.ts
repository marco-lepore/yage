import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DraftOutcome,
  DraftSnapshot,
} from "../../shared/protocol/index.js";
import { EditorApiClient } from "../api/index.js";
import { CommandController } from "../commands/index.js";
import { EditorStore } from "../store/index.js";
import { FileCoordinator } from "./FileCoordinator.js";

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
  revision: number,
  doc: LevelDocument,
  overrides: Partial<DraftSnapshot> = {},
): DraftSnapshot {
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
    ...overrides,
  };
}

interface Call {
  readonly route: string;
  /** The level the request named, which is how a switch is checked. */
  readonly path: string;
  readonly body: Record<string, unknown> | undefined;
}

/**
 * @param gate Called for every request; a promise it returns holds the answer
 *   until it settles, so a test can choose the order two answers arrive in.
 */
function createHarness(
  saveOutcome?: DraftOutcome,
  openOutcome?: DraftOutcome | ((path: string) => DraftOutcome | undefined),
  gate?: (route: string, path: string) => Promise<void> | undefined,
) {
  const doc = document(placement("crate", 0));
  const calls: Call[] = [];
  const fetchImpl: typeof globalThis.fetch = (url, init) => {
    const route = String(url).split("?")[0] ?? "";
    const path =
      new URL(String(url), "http://editor.invalid").searchParams.get("path") ??
      "";
    const body =
      init?.body === undefined
        ? undefined
        : (JSON.parse(String(init.body)) as Record<string, unknown>);
    calls.push({ route, path, body });

    let answer: unknown;
    if (route.endsWith("/draft/save")) {
      answer = saveOutcome ?? {
        status: "accepted",
        snapshot: snapshot(1, doc, {
          path,
          savedContentHash: "content-1",
          dirty: false,
        }),
      };
    } else if (route.endsWith("/draft/command")) {
      answer = {
        status: "accepted",
        snapshot: snapshot(1, document(placement("crate", 30)), { path }),
      };
    } else {
      // The shape `GET /draft` actually answers: an outcome envelope, the same
      // one `DraftService.snapshot()` returns. It names the level that was
      // asked for, the way the server's does.
      const chosen =
        typeof openOutcome === "function" ? openOutcome(path) : openOutcome;
      answer = chosen ?? {
        status: "accepted",
        snapshot: snapshot(0, doc, { path }),
      };
    }
    const respond = (): Response =>
      new Response(JSON.stringify(answer), { status: 200 });
    const held = gate?.(route, path);
    return held === undefined ? Promise.resolve(respond()) : held.then(respond);
  };

  const api = new EditorApiClient({ token: "t", fetch: fetchImpl });
  const store = new EditorStore({
    api,
    epoch: "epoch-1",
    projectId: "project-1",
    levels: [],
  });
  const commands = new CommandController({
    store,
    preview: {
      applyPoseDraft: () => {},
      viewportCenter: () => undefined,
      freeSpotNear: (point: { x: number; y: number }) => point,
    },
    catalog: () => undefined,
    newId: () => "cmd-1",
  });
  const opened: string[] = [];
  const files = new FileCoordinator({
    api,
    store,
    commands,
    epoch: "epoch-1",
    gamePage: "/game.html",
    openRun: (url) => opened.push(url),
  });
  return { store, commands, files, calls, opened };
}

/**
 * A level-opened landing at an exact point, which is what a pick that finished
 * while another call was waiting at its settle barrier looks like from here.
 * Driving it through `openLevel` would not do: its own barrier is the same one.
 */
function switchedToMeadow(harness: ReturnType<typeof createHarness>): void {
  harness.store.dispatch({
    type: "level-opened",
    snapshot: snapshot(1, document(placement("crate", 0)), {
      path: "levels/meadow.yage-level.json",
    }),
  });
}

describe("FileCoordinator", () => {
  let harness: ReturnType<typeof createHarness>;
  /** Holds one gated request until `release` is called. */
  let held: Promise<void>;
  let release: () => void;

  beforeEach(() => {
    harness = createHarness();
    release = (): void => {};
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
  });

  it("opens a level from one snapshot", async () => {
    await harness.files.openLevel("levels/forest.yage-level.json");

    const state = harness.store.getState();
    expect(state.file?.path).toBe("levels/forest.yage-level.json");
    expect(state.committed.draftRevision).toBe(0);
  });

  it("commits an open drag before it saves", async () => {
    await harness.files.openLevel("levels/forest.yage-level.json");
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 30, y: 0 });

    await harness.files.save();

    const routes = harness.calls.map((call) => call.route);
    expect(routes[1]).toContain("/draft/command");
    expect(routes[2]).toContain("/draft/save");
    // The save addresses the revision the accepted drag produced, not the one
    // that was current when the pointer went down.
    expect(harness.calls[2]?.body).toMatchObject({
      expectedDraftRevision: 1,
      expectedDiskRevision: "disk-1",
    });
  });

  it("marks the file saved when the server accepts", async () => {
    await harness.files.openLevel("levels/forest.yage-level.json");
    await harness.files.save();

    const state = harness.store.getState();
    expect(state.file?.savedContentHash).toBe("content-1");
    expect(state.diagnostics.get("file")).toBeUndefined();
  });

  it("reports a save the file on disk moved under", async () => {
    harness = createHarness({
      status: "rejected",
      code: "stale-disk",
      message: "The file changed on disk.",
    });
    await harness.files.openLevel("levels/forest.yage-level.json");
    await harness.files.save();

    expect(harness.store.getState().diagnostics.get("file")?.[0]?.message).toBe(
      "The file changed on disk.",
    );
  });

  it("does not save while writes are locked", async () => {
    await harness.files.openLevel("levels/forest.yage-level.json");
    harness.store.lockWrites("stale-command");
    await harness.files.save();

    expect(harness.calls.map((call) => call.route)).toHaveLength(1);
  });

  it("reports a level the server will not open and leaves the editor alone", async () => {
    harness = createHarness(undefined, {
      status: "rejected",
      code: "missing-file",
      message: "No level file at levels/gone.yage-level.json.",
    });
    await harness.files.openLevel("levels/gone.yage-level.json");

    const state = harness.store.getState();
    expect(state.file).toBeUndefined();
    expect(state.diagnostics.get("file")?.[0]?.message).toBe(
      "No level file at levels/gone.yage-level.json.",
    );
    // The document is still the empty one, not an envelope read as a document.
    expect(state.document.entities).toEqual([]);
  });

  it("settles an open drag and writes the file before running", async () => {
    await harness.files.openLevel("levels/forest.yage-level.json");
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 30, y: 0 });

    await harness.files.run();

    // The game reads the file, so the drag has to reach it: committed as a
    // command, then written to disk, before the page opens.
    expect(harness.calls[1]?.route).toContain("/draft/command");
    expect(
      harness.calls.some((call) => call.route.endsWith("/draft/save")),
    ).toBe(true);
    // Relative, so the browser resolves it against the editor page, which the
    // dev server serves at the project's Vite base. One parameter, naming the
    // file: the game fetches it the way it would fetch any level.
    expect(harness.opened).toEqual([
      "game.html?level=levels%2Fforest.yage-level.json",
    ]);
  });

  it("opens the play page on the level, without writing anything", async () => {
    await harness.files.openLevel("levels/forest.yage-level.json");
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 30, y: 0 });

    await harness.files.play();

    // Play runs the draft, so nothing reaches the disk. The drag is still
    // settled, because the draft has to hold it before the page reads it.
    expect(
      harness.calls.some((call) => call.route.endsWith("/draft/save")),
    ).toBe(false);
    expect(harness.opened).toEqual([
      "play.html?level=levels%2Fforest.yage-level.json",
    ]);
  });

  it("plays a level even when the project named no game page", async () => {
    const files = new FileCoordinator({
      api: new EditorApiClient({ token: "t" }),
      store: harness.store,
      commands: harness.commands,
      epoch: "epoch-1",
      openRun: (url) => harness.opened.push(url),
    });
    await harness.files.openLevel("levels/forest.yage-level.json");

    await files.play();

    // The play page is the editor's own, so it needs nothing from the project.
    expect(harness.opened).toEqual([
      "play.html?level=levels%2Fforest.yage-level.json",
    ]);
  });

  it("resolves a nested game page against the editor page", async () => {
    const files = new FileCoordinator({
      api: new EditorApiClient({ token: "t" }),
      store: harness.store,
      commands: harness.commands,
      epoch: "epoch-1",
      gamePage: "/play/game.html",
      openRun: (url) => harness.opened.push(url),
    });
    await harness.files.openLevel("levels/forest.yage-level.json");

    await files.run();

    // No leading slash: under a Vite base every project page lives below it,
    // and a root-absolute URL would address the server root instead.
    expect(harness.opened[0]).toMatch(/^play\/game\.html\?/);
  });

  it("keeps a game page's own query and fragment", async () => {
    const files = new FileCoordinator({
      api: new EditorApiClient({ token: "t" }),
      store: harness.store,
      commands: harness.commands,
      epoch: "epoch-1",
      gamePage: "/play.html?mode=debug#start",
      openRun: (url) => harness.opened.push(url),
    });
    await harness.files.openLevel("levels/forest.yage-level.json");

    await files.run();

    expect(harness.opened[0]).toBe(
      "play.html?mode=debug&level=levels%2Fforest.yage-level.json#start",
    );
  });

  it("does not run while writes are locked", async () => {
    await harness.files.openLevel("levels/forest.yage-level.json");
    harness.store.lockWrites("stale-command");

    await harness.files.run();

    expect(harness.opened).toEqual([]);
  });

  it("has no run when the project named no game page", async () => {
    const files = new FileCoordinator({
      api: new EditorApiClient({ token: "t" }),
      store: harness.store,
      commands: harness.commands,
      epoch: "epoch-1",
      openRun: (url) => harness.opened.push(url),
    });
    await harness.files.openLevel("levels/forest.yage-level.json");

    await files.run();

    expect(files.runnable).toBe(false);
    expect(harness.opened).toEqual([]);
  });

  it("refuses a second save while the first is in flight", async () => {
    await harness.files.openLevel("levels/forest.yage-level.json");
    const first = harness.files.save();
    const second = harness.files.save();
    await Promise.all([first, second]);

    const saves = harness.calls.filter((call) =>
      call.route.endsWith("/draft/save"),
    );
    // A second request would carry the disk revision the first is replacing,
    // and come back refused as a change made outside the editor.
    expect(saves).toHaveLength(1);
  });
  it("commits an open drag into the level it leaves before it switches", async () => {
    await harness.files.openLevel("levels/forest.yage-level.json");
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 30, y: 0 });

    await harness.files.openLevel("levels/meadow.yage-level.json");

    // The drag lands in the level it was made in, and only then is the new
    // level read.
    expect(harness.calls[1]?.route).toContain("/draft/command");
    expect(harness.calls[1]?.path).toBe("levels/forest.yage-level.json");
    expect(harness.calls[2]?.path).toBe("levels/meadow.yage-level.json");
    expect(harness.store.getState().file?.path).toBe(
      "levels/meadow.yage-level.json",
    );
  });

  it("waits for a command already in flight before it reads the new level", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness = createHarness(undefined, undefined, (route) =>
      route.endsWith("/draft/command") ? held : undefined,
    );
    await harness.files.openLevel("levels/forest.yage-level.json");
    harness.store.submit({
      kind: "set-poses",
      commandId: "cmd-2",
      poses: [
        {
          id: "crate",
          transform: {
            position: { x: 64, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
          },
        },
      ],
    });

    const switching = harness.files.openLevel("levels/meadow.yage-level.json");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reads = (): Call[] =>
      harness.calls.filter((call) => call.route.endsWith("/draft"));
    // One read: the level that was already open. The switch is still waiting.
    expect(reads()).toHaveLength(1);

    release();
    await switching;
    expect(reads()).toHaveLength(2);
    expect(harness.store.getState().file?.path).toBe(
      "levels/meadow.yage-level.json",
    );
  });

  it("lands on the last level picked when two opens are in flight", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness = createHarness(undefined, undefined, (route, path) =>
      route.endsWith("/draft") && path.includes("forest") ? held : undefined,
    );

    const first = harness.files.openLevel("levels/forest.yage-level.json");
    const second = harness.files.openLevel("levels/meadow.yage-level.json");
    await second;
    release();
    await first;

    // The slower first read answers last, and is discarded: the editor is on
    // the level that was picked last.
    expect(harness.store.getState().file?.path).toBe(
      "levels/meadow.yage-level.json",
    );
  });

  it("stays on the level it had when the new one is refused", async () => {
    harness = createHarness(undefined, (path) =>
      path.includes("gone")
        ? {
            status: "rejected",
            code: "missing-file",
            message: "No level file at levels/gone.yage-level.json.",
          }
        : undefined,
    );
    await harness.files.openLevel("levels/forest.yage-level.json");

    await harness.files.openLevel("levels/gone.yage-level.json");

    const state = harness.store.getState();
    expect(state.file?.path).toBe("levels/forest.yage-level.json");
    expect(state.diagnostics.get("file")?.[0]?.message).toBe(
      "No level file at levels/gone.yage-level.json.",
    );
  });

  it("stays on the level it had when the read does not reach the server", async () => {
    harness = createHarness(undefined, undefined, (route, path) =>
      route.endsWith("/draft") && path.includes("meadow")
        ? Promise.reject(new Error("offline"))
        : undefined,
    );
    await harness.files.openLevel("levels/forest.yage-level.json");

    await harness.files.openLevel("levels/meadow.yage-level.json");

    const state = harness.store.getState();
    expect(state.file?.path).toBe("levels/forest.yage-level.json");
    expect(state.diagnostics.get("file")?.[0]?.message).toBe(
      "Could not open levels/meadow.yage-level.json.",
    );
  });

  it("discards a read that lands after a newer level opened", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness = createHarness(undefined, undefined, (route, path) =>
      route.endsWith("/draft") && path.includes("forest") ? held : undefined,
    );

    const first = harness.files.openLevel("levels/forest.yage-level.json");
    // Past the settle barrier and waiting on its read, so the second open is
    // discarded after the fetch rather than at the barrier.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.files.openLevel("levels/meadow.yage-level.json");
    release();
    await first;

    expect(
      harness.calls
        .filter((call) => call.route.endsWith("/draft"))
        .map((call) => call.path),
    ).toEqual([
      "levels/forest.yage-level.json",
      "levels/meadow.yage-level.json",
    ]);
    expect(harness.store.getState().file?.path).toBe(
      "levels/meadow.yage-level.json",
    );
  });

  it("says nothing about a read that failed after a newer level opened", async () => {
    let fail = (): void => {};
    const held = new Promise<void>((_resolve, reject) => {
      fail = () => {
        reject(new Error("offline"));
      };
    });
    harness = createHarness(undefined, undefined, (route, path) =>
      route.endsWith("/draft") && path.includes("forest") ? held : undefined,
    );

    const first = harness.files.openLevel("levels/forest.yage-level.json");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.files.openLevel("levels/meadow.yage-level.json");
    fail();
    await first;

    // A banner under the meadow level about a forest read nobody is waiting
    // for is worse than silence.
    const state = harness.store.getState();
    expect(state.file?.path).toBe("levels/meadow.yage-level.json");
    expect(state.diagnostics.get("file")).toBeUndefined();
  });

  it("leaves the level picked while the editor was still starting", async () => {
    const picked = harness.files.openLevel("levels/meadow.yage-level.json");

    // What the composition root calls once the preview is up. The pick came
    // first even though it lands second, and the default must not revert it.
    await harness.files.openInitialLevel("levels/forest.yage-level.json");
    await picked;

    expect(harness.calls.map((call) => call.path)).toEqual([
      "levels/meadow.yage-level.json",
    ]);
    expect(harness.store.getState().file?.path).toBe(
      "levels/meadow.yage-level.json",
    );
  });

  it("opens the level the editor starts on when nothing was picked", async () => {
    await harness.files.openInitialLevel("levels/forest.yage-level.json");

    expect(harness.store.getState().file?.path).toBe(
      "levels/forest.yage-level.json",
    );
  });

  it("reads only the newest of two levels opened together", async () => {
    // Both are past `openLevel`'s counter before either clears the settle
    // barrier, so the first has nothing to read for: the level it would ask
    // about is not the one the editor is opening.
    const first = harness.files.openLevel("levels/forest.yage-level.json");
    const second = harness.files.openLevel("levels/meadow.yage-level.json");
    await Promise.all([first, second]);

    expect(harness.calls.map((call) => call.path)).toEqual([
      "levels/meadow.yage-level.json",
    ]);
    expect(harness.store.getState().file?.path).toBe(
      "levels/meadow.yage-level.json",
    );
  });

  it("does not save a level picked while the run was at its barrier", async () => {
    harness = createHarness(undefined, undefined, (route) =>
      route.endsWith("/draft/command") ? held : undefined,
    );
    await harness.files.openLevel("levels/forest.yage-level.json");
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 30, y: 0 });

    const running = harness.files.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    switchedToMeadow(harness);
    release();
    await running;

    // Run was pressed on the forest level, so the meadow level is not what it
    // writes — nothing is.
    expect(
      harness.calls.filter((call) => call.route.endsWith("/draft/save")),
    ).toEqual([]);
    expect(harness.opened).toEqual([]);
  });

  it("does not play a level picked while the play was at its barrier", async () => {
    harness = createHarness(undefined, undefined, (route) =>
      route.endsWith("/draft/command") ? held : undefined,
    );
    await harness.files.openLevel("levels/forest.yage-level.json");
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 30, y: 0 });

    const playing = harness.files.play();
    await new Promise((resolve) => setTimeout(resolve, 0));
    switchedToMeadow(harness);
    release();
    await playing;

    expect(harness.opened).toEqual([]);
  });

  it("does not run a level picked while the save was in flight", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness = createHarness(undefined, undefined, (route) =>
      route.endsWith("/draft/save") ? held : undefined,
    );
    await harness.files.openLevel("levels/forest.yage-level.json");
    harness.commands.beginGesture({ ids: ["crate"], origin: { x: 0, y: 0 } });
    harness.commands.updateGesture({ x: 30, y: 0 });

    const running = harness.files.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.files.openLevel("levels/meadow.yage-level.json");
    release();
    await running;

    // The forest level was written, which is what Run was pressed for; the
    // game page is not opened on the meadow level, which nothing saved.
    const saves = harness.calls.filter((call) =>
      call.route.endsWith("/draft/save"),
    );
    expect(saves.map((call) => call.path)).toEqual([
      "levels/forest.yage-level.json",
    ]);
    expect(harness.opened).toEqual([]);
    expect(harness.store.getState().file?.path).toBe(
      "levels/meadow.yage-level.json",
    );
  });
});

/**
 * A coordinator whose level-file routes answer what the test queued. `GET
 * /draft` answers a snapshot of the level it was asked for, the way the server
 * does, so a delete that opens the next level lands on that one.
 */
function createFileHarness(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetchImpl: typeof globalThis.fetch = (url, init) => {
    const route = String(url).split("?")[0] ?? "";
    const path =
      new URL(String(url), "http://editor.invalid").searchParams.get("path") ??
      "";
    calls.push({
      route,
      path,
      body:
        init?.body === undefined
          ? undefined
          : (JSON.parse(String(init.body)) as Record<string, unknown>),
    });
    const queued = Object.entries(answers).find(([suffix]) =>
      route.endsWith(suffix),
    )?.[1];
    const answer = queued ?? {
      status: "accepted",
      snapshot: snapshot(0, document(placement("crate", 0)), { path }),
    };
    return Promise.resolve(
      new Response(JSON.stringify(answer), { status: 200 }),
    );
  };
  const api = new EditorApiClient({ token: "t", fetch: fetchImpl });
  const store = new EditorStore({
    api,
    epoch: "epoch-1",
    projectId: "project-1",
    levels: [
      { path: "levels/forest.yage-level.json", diskRevision: "disk-1" },
      { path: "levels/meadow.yage-level.json", diskRevision: "disk-2" },
    ],
  });
  const commands = new CommandController({
    store,
    preview: {
      applyPoseDraft: () => {},
      viewportCenter: () => undefined,
      freeSpotNear: (point: { x: number; y: number }) => point,
    },
    catalog: () => undefined,
  });
  const files = new FileCoordinator({
    api,
    store,
    commands,
    epoch: "epoch-1",
  });
  return { store, files, calls };
}

describe("level files", () => {
  const created = {
    status: "created",
    level: { path: "levels/cave.yage-level.json", diskRevision: "disk-3" },
    snapshot: snapshot(0, document(), {
      path: "levels/cave.yage-level.json",
      dirty: false,
    }),
  };

  it("creates a level, lists it in path order, and opens it in one request", async () => {
    const harness = createFileHarness({ "/levels/create": created });

    await harness.files.createLevel("levels/cave.yage-level.json", "cave");

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.body).toEqual({
      epoch: "epoch-1",
      levelId: "cave",
    });
    expect(harness.store.getState().levels.map((one) => one.path)).toEqual([
      "levels/cave.yage-level.json",
      "levels/forest.yage-level.json",
      "levels/meadow.yage-level.json",
    ]);
    expect(harness.store.getState().file?.path).toBe(
      "levels/cave.yage-level.json",
    );
  });

  it("names the level it copies", async () => {
    const harness = createFileHarness({ "/levels/duplicate": created });

    await harness.files.duplicateLevel(
      "levels/forest.yage-level.json",
      "levels/cave.yage-level.json",
      "cave",
    );

    expect(harness.calls[0]?.body).toEqual({
      epoch: "epoch-1",
      levelId: "cave",
      sourcePath: "levels/forest.yage-level.json",
    });
    expect(harness.store.getState().file?.path).toBe(
      "levels/cave.yage-level.json",
    );
  });

  it("reports a refused create and opens nothing", async () => {
    const harness = createFileHarness({
      "/levels/create": {
        status: "refused",
        reason: "exists",
        message: '"levels/cave.yage-level.json" already exists.',
      },
    });
    await harness.files.openLevel("levels/forest.yage-level.json");

    await harness.files.createLevel("levels/cave.yage-level.json", "cave");

    expect(harness.store.getState().file?.path).toBe(
      "levels/forest.yage-level.json",
    );
    expect(harness.store.getState().levels).toHaveLength(2);
    expect(
      harness.store.getState().diagnostics.get("file")?.[0]?.message,
    ).toContain("already exists");
  });

  it("opens the level that takes the deleted one's place", async () => {
    const harness = createFileHarness({
      "/levels/delete": {
        status: "deleted",
        levels: [{ path: "levels/meadow.yage-level.json", diskRevision: "d2" }],
      },
    });
    await harness.files.openLevel("levels/forest.yage-level.json");

    await harness.files.deleteLevel("levels/forest.yage-level.json");

    expect(harness.store.getState().levels.map((one) => one.path)).toEqual([
      "levels/meadow.yage-level.json",
    ]);
    expect(harness.store.getState().file?.path).toBe(
      "levels/meadow.yage-level.json",
    );
  });

  it("leaves nothing open when the level deleted was the last one", async () => {
    const harness = createFileHarness({
      "/levels/delete": { status: "deleted", levels: [] },
    });
    await harness.files.openLevel("levels/forest.yage-level.json");

    await harness.files.deleteLevel("levels/forest.yage-level.json");

    expect(harness.store.getState().file).toBeUndefined();
    expect(harness.store.getState().document.entities).toEqual([]);
  });

  it("keeps the open level when another one is deleted", async () => {
    const harness = createFileHarness({
      "/levels/delete": {
        status: "deleted",
        levels: [{ path: "levels/forest.yage-level.json", diskRevision: "d1" }],
      },
    });
    await harness.files.openLevel("levels/forest.yage-level.json");

    await harness.files.deleteLevel("levels/meadow.yage-level.json");

    expect(harness.store.getState().file?.path).toBe(
      "levels/forest.yage-level.json",
    );
    // One open and one delete: nothing was reopened.
    expect(harness.calls).toHaveLength(2);
  });
});
