// @vitest-environment happy-dom
import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HierarchyDrop } from "../commands/index.js";
import type { DraftSnapshot } from "../../shared/protocol/index.js";
import { EditorStore, type DraftApi } from "../store/index.js";
import { Hierarchy } from "./Hierarchy.js";

/** The panel sends nothing itself, so none of the store's calls are made. */
const unusedApi: DraftApi = {
  sendCommand: () => Promise.reject(new Error("not used")),
  undo: () => Promise.reject(new Error("not used")),
  redo: () => Promise.reject(new Error("not used")),
};

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function placement(
  id: string,
  parent?: string,
  overrides: Partial<LevelPlacement> = {},
): LevelPlacement {
  return {
    id,
    type: "game.crate",
    typeVersion: 1,
    active: true,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    params: {},
    extensions: {},
    ...(parent === undefined ? {} : { parent }),
    ...overrides,
  };
}

function document_(...placements: LevelPlacement[]): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id: "forest",
    metadata: {},
    entities: placements,
    extensions: {},
  };
}

/** A parent, its child listed after a later root, and that root. */
const TREE = document_(
  placement("root", undefined, { name: "Ground" }),
  placement("other"),
  placement("child", "root"),
);

function snapshot(doc: LevelDocument): DraftSnapshot {
  return {
    path: "levels/forest.yage-level.json",
    epoch: "epoch-1",
    document: doc,
    draftRevision: 0,
    diskRevision: "disk-1",
    contentHash: "content-0",
    savedContentHash: "content-0",
    dirty: false,
    history: { undoDepth: 0, redoDepth: 0 },
  };
}

function createHarness(
  doc = TREE,
  options: { editable?: boolean; selection?: string[] } = {},
) {
  const selections: [string, boolean][] = [];
  const drops: [string, HierarchyDrop][] = [];
  const picks: string[] = [];
  const hides: string[] = [];
  const store = new EditorStore({
    api: unusedApi,
    epoch: "epoch-1",
    projectId: "project-1",
    levels: [],
  });
  // The panel reads all three of these from the store, so a test that changes
  // what it draws dispatches rather than re-rendering with other props.
  const load = (next: LevelDocument, selection: readonly string[]): void => {
    store.dispatch({ type: "level-opened", snapshot: snapshot(next) });
    store.dispatch({ type: "selection-changed", ids: [...selection] });
  };
  load(doc, options.selection ?? []);
  // A locked level is the one thing that makes the panel read-only.
  if (options.editable === false) store.lockWrites("stale-project");
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  act(() => {
    root.render(
      <Hierarchy
        store={store}
        onSelect={(id, additive) => selections.push([id, additive])}
        onDrop={(id, drop) => drops.push([id, drop])}
        onPickTarget={(id) => picks.push(id)}
        onToggleHidden={(id) => hides.push(id)}
      />,
    );
  });
  const render = (
    next: LevelDocument = doc,
    selection: readonly string[] = options.selection ?? [],
  ): void => {
    act(() => {
      load(next, selection);
    });
  };
  /** Wait for a target, as the inspector's Pick button does. */
  const waitFor = (types: readonly string[]): void => {
    act(() => {
      store.dispatch({
        type: "pick-started",
        pick: { placementId: "other", field: "door", types },
      });
    });
  };
  return {
    host,
    root,
    store,
    selections,
    drops,
    picks,
    hides,
    render,
    waitFor,
  };
}

function query<T extends Element>(host: HTMLElement, testId: string): T | null {
  return host.querySelector<T>(`[data-testid="${testId}"]`);
}

function fire(element: Element | null, type: string, init?: EventInit): void {
  if (!element) throw new Error(`Nothing to send ${type} to.`);
  act(() => {
    element.dispatchEvent(new Event(type, { bubbles: true, ...init }));
  });
}

function dragTo(host: HTMLElement, id: string, targetId: string): void {
  fire(query(host, `hierarchy-row-${id}`), "dragstart");
  fire(query(host, targetId), "drop");
}

describe("Hierarchy", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    harness = createHarness();
  });

  afterEach(() => {
    act(() => {
      harness.root.unmount();
    });
    harness.host.remove();
  });

  it("lists parents above children and roots in document order", () => {
    const rows = [...harness.host.querySelectorAll("[role=treeitem]")];
    expect(
      rows.map((row) => [
        row
          .querySelector("[data-testid^=hierarchy-row-]")
          ?.getAttribute("data-testid"),
        row.getAttribute("aria-level"),
      ]),
    ).toEqual([
      ["hierarchy-row-root", "1"],
      ["hierarchy-row-child", "2"],
      ["hierarchy-row-other", "1"],
    ]);
  });

  it("shows the name when there is one, otherwise the type, and always the id", () => {
    // The trailing glyph is the row's own eye, which every row carries.
    expect(query(harness.host, "hierarchy-row-root")?.textContent).toBe(
      "Groundroot◉",
    );
    expect(query(harness.host, "hierarchy-row-child")?.textContent).toBe(
      "game.cratechild◉",
    );
  });

  it("marks the selected rows", () => {
    harness.render(TREE, ["child"]);

    const rows = [...harness.host.querySelectorAll("[role=treeitem]")];
    expect(rows.map((row) => row.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("selects one row on a click and toggles it with the modifier held", () => {
    const row = query<HTMLElement>(harness.host, "hierarchy-row-child");
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      row?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true }),
      );
    });
    act(() => {
      row?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, metaKey: true }),
      );
    });

    expect(harness.selections).toEqual([
      ["child", false],
      ["child", true],
      ["child", true],
    ]);
  });

  it("chooses a target instead of selecting while a field is waiting", () => {
    harness = createHarness(
      document_(
        placement("root", undefined, { name: "Ground" }),
        placement("child", "root", { type: "game.hinge" }),
        placement("other", undefined, { type: "game.switch" }),
      ),
    );
    harness.waitFor(["game.crate"]);

    const click = (id: string): void => {
      act(() => {
        query<HTMLElement>(harness.host, `hierarchy-row-${id}`)?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
    };
    click("root");
    // A child of a candidate chooses the candidate.
    click("child");
    // A row that cannot be one does nothing at all.
    click("other");

    expect(harness.picks).toEqual(["root", "root"]);
    expect(harness.selections).toEqual([]);
  });

  it("marks the rows no press can choose, and drags none of them", () => {
    harness = createHarness(
      document_(
        placement("root", undefined, { name: "Ground" }),
        placement("other", undefined, { type: "game.switch" }),
      ),
    );
    harness.waitFor(["game.crate"]);

    const rows = [
      ...harness.host.querySelectorAll<HTMLElement>(
        "[data-testid^=hierarchy-row-]",
      ),
    ];
    expect(
      rows.map((row) => [
        row.getAttribute("data-testid"),
        row.className.includes("is-unpickable"),
        // Inline rather than from the stylesheet: an inline opacity beats a
        // rule, so the fade has to be written where the drag's is.
        row.style.opacity,
        row.getAttribute("draggable"),
      ]),
    ).toEqual([
      ["hierarchy-row-root", false, "1", "false"],
      ["hierarchy-row-other", true, "0.4", "false"],
    ]);
  });

  it("says so when there is nothing to list", () => {
    harness.render(document_());

    expect(query(harness.host, "hierarchy")?.textContent).toContain(
      "No placements",
    );
  });

  describe("dragging a row", () => {
    it("offers no targets until a drag starts", () => {
      expect(query(harness.host, "drop-root")).toBeNull();
      expect(query(harness.host, "drop-into-root")).toBeNull();
    });

    it("drops before or after a row, onto a row, or on the root area", () => {
      dragTo(harness.host, "other", "drop-before-root");
      dragTo(harness.host, "other", "drop-after-child");
      dragTo(harness.host, "other", "drop-into-root");
      dragTo(harness.host, "child", "drop-root");

      expect(harness.drops).toEqual([
        ["other", { kind: "before", siblingId: "root" }],
        ["other", { kind: "after", siblingId: "child" }],
        ["other", { kind: "into", parentId: "root" }],
        ["child", { kind: "root" }],
      ]);
    });

    it("offers no target on the dragged row or anything under it", () => {
      fire(query(harness.host, "hierarchy-row-root"), "dragstart");

      // A placement cannot become its own ancestor, so the illegal targets
      // are not there to drop on. The other root still is.
      expect(query(harness.host, "drop-into-root")).toBeNull();
      expect(query(harness.host, "drop-before-root")).toBeNull();
      expect(query(harness.host, "drop-into-child")).toBeNull();
      expect(query(harness.host, "drop-into-other")).not.toBeNull();
      expect(query(harness.host, "drop-root")).not.toBeNull();
    });

    it("says which of the four a release would take", () => {
      fire(query(harness.host, "hierarchy-row-other"), "dragstart");
      const row = query<HTMLElement>(harness.host, "hierarchy-item-child");

      // Three outcomes, three answers, so a release is never a guess about
      // which quarter of a 24-pixel row the pointer is in.
      fire(query(harness.host, "drop-before-child"), "dragover");
      expect(row?.getAttribute("data-drop")).toBe("before");
      fire(query(harness.host, "drop-into-child"), "dragover");
      expect(row?.getAttribute("data-drop")).toBe("into");
      fire(query(harness.host, "drop-after-child"), "dragover");
      expect(row?.getAttribute("data-drop")).toBe("after");
    });

    it("marks the item, which holds the row and everything under it", () => {
      // A drop after a row puts the placement after that row's whole subtree,
      // so a line on the row's own bottom edge would point between the row and
      // its first child. `root` has a child; `child` is where it would land.
      fire(query(harness.host, "hierarchy-row-other"), "dragstart");
      fire(query(harness.host, "drop-after-root"), "dragover");

      const item = query<HTMLElement>(harness.host, "hierarchy-item-root");
      expect(item?.getAttribute("data-drop")).toBe("after");
      // The item contains the row it marks and the subtree drawn under it.
      expect(
        item?.querySelector('[data-testid="hierarchy-row-child"]'),
      ).not.toBeNull();
    });

    it("marks one row at a time", () => {
      fire(query(harness.host, "hierarchy-row-other"), "dragstart");
      fire(query(harness.host, "drop-into-child"), "dragover");
      fire(query(harness.host, "drop-into-root"), "dragover");

      expect(
        query<HTMLElement>(harness.host, "hierarchy-item-child")?.getAttribute(
          "data-drop",
        ),
      ).toBeNull();
      expect(
        query<HTMLElement>(harness.host, "hierarchy-item-root")?.getAttribute(
          "data-drop",
        ),
      ).toBe("into");
    });

    it("unmarks a row the pointer left", () => {
      fire(query(harness.host, "hierarchy-row-other"), "dragstart");
      fire(query(harness.host, "drop-into-child"), "dragover");
      fire(query(harness.host, "drop-into-child"), "dragleave");

      expect(
        query<HTMLElement>(harness.host, "hierarchy-item-child")?.getAttribute(
          "data-drop",
        ),
      ).toBeNull();
    });

    it("answers on the area that makes a placement top-level", () => {
      // The area under the tree answers too, so every target a drag can reach
      // says whether the pointer is on it.
      fire(query(harness.host, "hierarchy-row-child"), "dragstart");
      const area = query<HTMLElement>(harness.host, "drop-root");
      expect(area?.className).not.toContain("is-over");

      fire(area, "dragover");
      expect(
        query<HTMLElement>(harness.host, "drop-root")?.className,
      ).toContain("is-over");

      fire(query(harness.host, "drop-root"), "dragleave");
      expect(
        query<HTMLElement>(harness.host, "drop-root")?.className,
      ).not.toContain("is-over");
    });

    it("clears the mark when the drag ends without a drop", () => {
      fire(query(harness.host, "hierarchy-row-other"), "dragstart");
      fire(query(harness.host, "drop-into-child"), "dragover");
      fire(query(harness.host, "hierarchy-row-other"), "dragend");

      expect(
        query<HTMLElement>(harness.host, "hierarchy-item-child")?.getAttribute(
          "data-drop",
        ),
      ).toBeNull();
    });

    it("clears the targets when the drag ends without a drop", () => {
      fire(query(harness.host, "hierarchy-row-other"), "dragstart");
      fire(query(harness.host, "hierarchy-row-other"), "dragend");

      expect(query(harness.host, "drop-root")).toBeNull();
      expect(harness.drops).toEqual([]);
    });

    it("drags nothing while editing is locked", () => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness(TREE, { editable: false });
      fire(query(harness.host, "hierarchy-row-other"), "dragstart");

      expect(
        query<HTMLElement>(harness.host, "hierarchy-row-other")?.getAttribute(
          "draggable",
        ),
      ).toBe("false");
      expect(query(harness.host, "drop-root")).toBeNull();
    });
  });
});

describe("the hierarchy's eyes", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    harness = createHarness();
  });

  afterEach(() => {
    act(() => {
      harness.root.unmount();
    });
    harness.host.remove();
  });

  function clickEye(id: string): void {
    act(() => {
      query<HTMLElement>(harness.host, `hierarchy-eye-${id}`)?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
  }

  it("toggles one placement and does not select it", () => {
    clickEye("child");

    expect(harness.hides).toEqual(["child"]);
    // The press landed inside a row that selects, and it must not have
    // reached it.
    expect(harness.selections).toEqual([]);
  });

  it("greys a hidden row and everything under it, and still selects", () => {
    act(() => {
      harness.store.dispatch({ type: "hidden-toggled", ids: ["root"] });
    });

    for (const id of ["root", "child"]) {
      const row = query<HTMLElement>(harness.host, `hierarchy-row-${id}`);
      expect(row?.className).toContain("is-hidden");
      // The inline opacity is what a row is faded by: a stylesheet rule for a
      // property the component writes inline would never land.
      expect(row?.style.opacity).toBe("0.4");
    }
    expect(
      query<HTMLElement>(harness.host, "hierarchy-row-other")?.className,
    ).not.toContain("is-hidden");

    act(() => {
      query<HTMLElement>(harness.host, "hierarchy-row-root")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(harness.selections).toEqual([["root", false]]);
  });
});
