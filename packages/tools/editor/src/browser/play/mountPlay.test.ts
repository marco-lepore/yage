// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { defineLevelEntity, defineLevelProject } from "@yagejs/level";
import { mountPlay } from "./mountPlay.js";
import { PlayScene } from "./PlayScene.js";

/** A placement type the catalog accepts, with nothing to draw. */
class Crate {
  static readonly level = defineLevelEntity({ id: "game.crate", version: 1 });
  readonly placed = true;
}

const project = defineLevelProject({ entities: [Crate as never] });

const LEVEL = {
  format: "yage-level" as const,
  version: 1 as const,
  id: "forest",
  metadata: {},
  entities: [],
  extensions: {},
};

function snapshot(document = LEVEL) {
  return {
    path: "levels/forest.yage-level.json",
    epoch: "e1",
    document,
    draftRevision: 0,
    diskRevision: "d1",
    contentHash: "c1",
    savedContentHash: "c1",
    dirty: false,
    history: { undoDepth: 0, redoDepth: 0 },
  };
}

/** An engine that records what it was asked to do and starts nothing. */
function engineStub(loadAll = () => Promise.resolve()) {
  const pushed: unknown[] = [];
  const stopped = { yes: false };
  return {
    pushed,
    stopped,
    engine: {
      use: () => {},
      start: () => Promise.resolve(),
      assets: { loadAll },
      scenes: {
        push: (scene: unknown) => {
          pushed.push(scene);
          return Promise.resolve();
        },
      },
      destroy: () => {
        stopped.yes = true;
        return Promise.resolve();
      },
    },
  };
}

function harnessOf(engine: unknown) {
  return { engine: () => engine, plugins: () => [] };
}

function answering(outcome: unknown): typeof globalThis.fetch {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(outcome),
    } as Response),
  ) as unknown as typeof globalThis.fetch;
}

describe("mountPlay", () => {
  it("says what it needs when no level was named", async () => {
    await expect(
      mountPlay({
        host: document.createElement("div"),
        token: "t",
        project,
        harness: harnessOf(engineStub().engine),
        contributions: [],
      }),
    ).rejects.toThrow(/Open it with the editor's Play control/);
  });

  it("runs the draft the editor is holding", async () => {
    const stub = engineStub();
    vi.stubGlobal(
      "fetch",
      answering({ status: "accepted", snapshot: snapshot() }),
    );

    const handle = await mountPlay({
      host: document.createElement("div"),
      token: "t",
      project,
      harness: harnessOf(stub.engine),
      contributions: [],
      level: "levels/forest.yage-level.json",
    });

    // One scene, and the live one: nothing was written and no file was read,
    // so the level came from the editor's own draft, which is what makes Play
    // show unsaved work.
    expect(stub.pushed).toHaveLength(1);
    expect(stub.pushed[0]).toBeInstanceOf(PlayScene);
    await handle.dispose();
    vi.unstubAllGlobals();
  });

  it("stops the engine when the level will not load", async () => {
    const stub = engineStub(() => Promise.reject(new Error("no such texture")));
    vi.stubGlobal(
      "fetch",
      answering({ status: "accepted", snapshot: snapshot() }),
    );

    await expect(
      mountPlay({
        host: document.createElement("div"),
        token: "t",
        project,
        harness: harnessOf(stub.engine),
        contributions: [],
        level: "levels/forest.yage-level.json",
      }),
    ).rejects.toThrow("no such texture");
    // The caller has no handle to stop it with, so a page showing the failure
    // would otherwise keep a game loop running behind the message.
    expect(stub.stopped.yes).toBe(true);
    vi.unstubAllGlobals();
  });

  it("refuses to run a level the editor could not read", async () => {
    vi.stubGlobal(
      "fetch",
      answering({
        status: "rejected",
        code: "unreadable-level",
        message: "the file is not a level",
      }),
    );

    await expect(
      mountPlay({
        host: document.createElement("div"),
        token: "t",
        project,
        harness: harnessOf(engineStub().engine),
        contributions: [],
        level: "levels/forest.yage-level.json",
      }),
    ).rejects.toThrow("the file is not a level");
    vi.unstubAllGlobals();
  });

  it("refuses a harness that is not one", async () => {
    vi.stubGlobal(
      "fetch",
      answering({ status: "accepted", snapshot: snapshot() }),
    );

    await expect(
      mountPlay({
        host: document.createElement("div"),
        token: "t",
        project,
        harness: { engine: "not a function" },
        contributions: [],
        level: "levels/forest.yage-level.json",
      }),
    ).rejects.toThrow(/not a harness/);
    vi.unstubAllGlobals();
  });
});
