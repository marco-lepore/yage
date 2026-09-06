// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorStore, type DraftApi } from "../store/index.js";
import { useEditorSlice, useEditorState } from "./useEditorSlice.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** Nothing here sends, so none of the store's calls are made. */
const unusedApi: DraftApi = {
  sendCommand: () => Promise.reject(new Error("not used")),
  undo: () => Promise.reject(new Error("not used")),
  redo: () => Promise.reject(new Error("not used")),
};

function createStore(): EditorStore {
  return new EditorStore({
    api: unusedApi,
    epoch: "epoch-1",
    projectId: "project-1",
    levels: [],
  });
}

describe("useEditorSlice", () => {
  let root: Root | undefined;
  let host: HTMLElement;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host.remove();
  });

  /** Renders one slice and counts how often it was asked to. */
  function mount(
    store: EditorStore,
    read: (store: EditorStore) => string,
  ): () => number {
    let renders = 0;
    function Probe(): React.JSX.Element {
      const shown = read(store);
      renders += 1;
      return <span data-testid="shown">{shown}</span>;
    }
    root = createRoot(host);
    act(() => {
      root?.render(<Probe />);
    });
    return () => renders;
  }

  it("does not render again for an action its slice does not see", () => {
    const store = createStore();
    const renders = mount(store, (held) =>
      useEditorSlice(held, (state) => state.tool),
    );
    const before = renders();

    act(() => {
      store.dispatch({ type: "selection-changed", ids: ["crate"] });
      store.dispatch({ type: "view-panned", by: { x: 10, y: 4 } });
      store.dispatch({ type: "guides-toggled" });
    });

    expect(renders()).toBe(before);
  });

  it("renders again when its slice changes, and not when it is re-set", () => {
    const store = createStore();
    const renders = mount(store, (held) =>
      useEditorSlice(held, (state) => state.tool),
    );
    const before = renders();

    act(() => {
      store.dispatch({ type: "tool-changed", tool: "rotate" });
    });

    expect(host.textContent).toBe("rotate");
    expect(renders()).toBe(before + 1);

    act(() => {
      store.dispatch({ type: "tool-changed", tool: "rotate" });
    });

    expect(renders()).toBe(before + 1);
  });

  it("renders for every action when the whole state is read", () => {
    const store = createStore();
    const renders = mount(store, (held) => useEditorState(held).tool);
    const before = renders();

    act(() => {
      store.dispatch({ type: "selection-changed", ids: ["crate"] });
    });

    expect(renders()).toBe(before + 1);
  });
});
