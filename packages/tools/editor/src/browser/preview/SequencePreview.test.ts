import { describe, it, expect } from "vitest";
import { ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import { EditorStore } from "../store/index.js";
import { EditorApiClient } from "../api/index.js";
import { emptySequenceWorkspace } from "../../shared/document/index.js";
import { SequencePreview } from "./SequencePreview.js";
function harness() {
  const store = new EditorStore({
    api: new EditorApiClient({ token: "test" }),
    epoch: "test",
    projectId: "test",
    levels: [],
  });
  const doc = emptySequenceWorkspace("preview");
  store.dispatch({
    type: "level-opened",
    snapshot: {
      path: "a.yage-sequence-workspace.json",
      epoch: "test",
      document: {
        ...doc,
        sequence: {
          ...doc.sequence,
          fps: 10,
          duration: 10,
          targets: { actor: { properties: {}, events: { cue: {} } } },
          events: [
            {
              id: "start",
              target: "actor",
              event: "cue",
              frame: 0,
              payload: {},
            },
            {
              id: "middle",
              target: "actor",
              event: "cue",
              frame: 5,
              payload: {},
            },
          ],
        },
      },
      draftRevision: 0,
      diskRevision: "disk",
      contentHash: "hash",
      savedContentHash: "hash",
      dirty: false,
      history: { undoDepth: 0, redoDepth: 0 },
    },
  });
  return {
    store,
    preview: new SequencePreview(
      store,
      new ErrorBoundary(new Logger({ level: LogLevel.None })),
    ),
  };
}
describe("dormant sequence playback", () => {
  it("logs markers on play, stays silent on seek, and resumes without replaying frame zero", () => {
    const { store, preview } = harness();
    store.dispatch({ type: "sequence-view", patch: { frame: 3 } });
    preview.advance(0.1);
    expect(store.getState().sequence?.events).toEqual([]);
    store.dispatch({ type: "sequence-view", patch: { playing: true } });
    preview.advance(0.1);
    expect(store.getState().sequence?.frame).toBe(4);
    expect(store.getState().sequence?.events).toEqual([]);
    preview.advance(0.1);
    expect(store.getState().sequence?.events.map((e) => e.id)).toEqual([
      "middle",
    ]);
    store.dispatch({ type: "sequence-view", patch: { playing: false } });
    preview.advance(0);
    store.dispatch({ type: "sequence-view", patch: { playing: true } });
    preview.advance(0.1);
    expect(store.getState().sequence?.events.map((e) => e.id)).toEqual([
      "middle",
    ]);
  });
  it("replays a completed sequence from zero and logs every loop boundary", () => {
    const { store, preview } = harness();
    store.dispatch({
      type: "sequence-view",
      patch: { frame: 10, playing: true, loop: true },
    });
    preview.advance(1);
    expect(store.getState().sequence?.events.map((e) => e.id)).toEqual([
      "start",
      "middle",
      "start",
    ]);
  });
});
