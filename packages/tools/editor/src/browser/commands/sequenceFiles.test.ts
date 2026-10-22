import { describe, it, expect } from "vitest";
import { EditorStore } from "../store/index.js";
import { EditorApiClient } from "../api/index.js";
import { CommandController } from "./CommandController.js";
import { emptySequenceWorkspace } from "../../shared/document/index.js";
import { reduceCommand } from "../../shared/commands/index.js";
import type { DocumentCommand } from "../../shared/commands/index.js";
import type { EditorDocument } from "../../shared/document/index.js";
function harness(initial: EditorDocument = emptySequenceWorkspace("test")) {
  const gates: (() => void)[] = [];
  let hold = false;
  let document: EditorDocument = initial,
    revision = 0;
  const sent: DocumentCommand[] = [];
  const snapshot = () => ({
    path: "test.yage-sequence-workspace.json",
    epoch: "test",
    document,
    draftRevision: revision,
    diskRevision: "disk",
    contentHash: String(revision),
    savedContentHash: "0",
    dirty: revision > 0,
    history: { undoDepth: revision, redoDepth: 0 },
  });
  const store = new EditorStore({
    api: new EditorApiClient({
      token: "test",
      fetch: async (_url, init) => {
        const { command } = JSON.parse(String(init?.body)) as {
          command: DocumentCommand;
        };
        sent.push(command);
        if (hold) await new Promise<void>((resolve) => gates.push(resolve));
        document = reduceCommand(document, command).document;
        revision++;
        return new Response(
          JSON.stringify({ status: "accepted", snapshot: snapshot() }),
        );
      },
    }),
    epoch: "test",
    projectId: "test",
    levels: [],
  });
  store.dispatch({ type: "level-opened", snapshot: snapshot() });
  const commands = new CommandController({
    store,
    catalog: () => undefined,
    preview: {
      applyPoseDraft: () => {},
      viewportCenter: () => ({ x: 0, y: 0 }),
      freeSpotNear: (p) => p,
      boundsFor: () => new Map(),
    },
  });
  return {
    store,
    commands,
    sent,
    snapshot,
    gates,
    hold: () => {
      hold = true;
    },
  };
}
describe("sequence file import", () => {
  it("throws a refused import's reason and leaves the document unchanged", async () => {
    const base = emptySequenceWorkspace("test");
    const h = harness({
      ...base,
      entities: [
        {
          id: "a",
          type: "test.actor",
          typeVersion: 1,
          name: "A",
          active: true,
          transform: {
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
          },
          params: {},
          extensions: {},
        },
      ],
      sequence: {
        ...base.sequence,
        targets: { hero: { properties: {}, events: {} } },
      },
      bindings: { hero: "a" },
    });
    const before = h.store.getState().document;
    const clip = {
      ...base.sequence,
      targets: {
        hero: { properties: { opacity: { kind: "color" } }, events: {} },
      },
    };
    await expect(
      h.commands.importSequence(() => Promise.resolve(JSON.stringify(clip))),
    ).rejects.toThrow("hero.opacity is declared as color");
    expect(h.store.getState().document).toBe(before);
    expect(h.sent).toHaveLength(0);
  });
  it("validates before mutation and imports workspace clip data through one command", async () => {
    const h = harness();
    const before = h.store.getState().document;
    await expect(
      h.commands.importSequence(() => Promise.resolve('{"format":"bad"}')),
    ).rejects.toThrow();
    expect(h.store.getState().document).toEqual(before);
    expect(h.sent).toHaveLength(0);
    const imported = emptySequenceWorkspace("imported");
    await h.commands.importSequence(() =>
      Promise.resolve(JSON.stringify(imported)),
    );
    await h.commands.settleEdits();
    expect(h.sent).toHaveLength(1);
    expect(h.store.getState().document.id).toBe("test");
    expect(
      h.store.getState().document.format === "yage-sequence-workspace" &&
        h.store.getState().document,
    ).toMatchObject({ sequence: { name: "imported" } });
  });
  it("refuses a late file read after switching workspaces", async () => {
    const h = harness();
    let resolve!: (text: string) => void;
    let started!: () => void;
    const reading = new Promise<void>((r) => {
      started = r;
    });
    const pending = h.commands.importSequence(() => {
      started();
      return new Promise<string>((r) => {
        resolve = r;
      });
    });
    await reading;
    h.store.dispatch({
      type: "level-opened",
      snapshot: {
        ...h.snapshot(),
        path: "other.json",
        document: emptySequenceWorkspace("other"),
      },
    });
    resolve(JSON.stringify(emptySequenceWorkspace("old").sequence));
    await expect(pending).rejects.toThrow("workspace changed");
    expect(h.sent).toHaveLength(0);
    expect(h.store.getState().document.id).toBe("other");
  });
  it("does not create history for unchanged JSON", async () => {
    const h = harness();
    await h.commands.importSequence(() =>
      Promise.resolve(JSON.stringify(emptySequenceWorkspace("test").sequence)),
    );
    expect(h.sent).toHaveLength(0);
  });
});

describe("sequence async edit barriers", () => {
  it("refuses export while a later command is still unaccepted", async () => {
    const h = harness();
    h.hold();
    h.commands.editSequence({
      kind: "set-settings",
      settings: { name: "first" },
    });
    const exporting = h.commands.exportSequence();
    h.commands.editSequence({
      kind: "set-settings",
      settings: { name: "later" },
    });
    h.gates[0]!();
    await expect(exporting).rejects.toThrow("pending");
    h.gates[1]!();
    await h.commands.settleEdits();
    expect((await h.commands.exportSequence()).sequence.name).toBe("later");
  });
  it("preserves a timeline edit started during an import read", async () => {
    const h = harness();
    let complete!: (text: string) => void, started!: () => void;
    const reading = new Promise<void>((r) => {
      started = r;
    });
    const importing = h.commands.importSequence(() => {
      started();
      return new Promise<string>((r) => {
        complete = r;
      });
    });
    await reading;
    const sequence = emptySequenceWorkspace("test").sequence;
    h.store.dispatch({
      type: "sequence-view",
      patch: {
        draft: { ...sequence, name: "new gesture" },
        draftBase: sequence,
      },
    });
    complete(JSON.stringify({ ...sequence, name: "imported" }));
    await expect(importing).rejects.toThrow("workspace changed");
    expect(h.sent).toHaveLength(0);
    expect(h.store.getState().sequence?.draft?.name).toBe("new gesture");
  });
});
