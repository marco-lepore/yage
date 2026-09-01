// @vitest-environment happy-dom
import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftSnapshot } from "../../shared/protocol/index.js";
import { CommandController } from "../commands/index.js";
import type { PlaceableType } from "../project/index.js";
import { DEFAULT_VIEW, EditorStore, type DraftApi } from "../store/index.js";
import { EditorShell } from "./EditorShell.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** The shell sends nothing itself, so none of the store's calls are made. */
const unusedApi: DraftApi = {
  sendCommand: () => Promise.reject(new Error("not used")),
  undo: () => Promise.reject(new Error("not used")),
  redo: () => Promise.reject(new Error("not used")),
};

// The package type is first on purpose: the Actors panel lifts the project's
// own group to the top, and a fixture in the finished order would pass whether
// or not it did.
const placeables: readonly PlaceableType[] = [
  {
    typeId: "renderer.sprite",
    source: "package",
    packageName: "@yagejs/renderer",
  },
  { typeId: "game.crate", source: "project", thumbnail: "sprites/crate.png" },
];

const crate: LevelPlacement = {
  id: "crate",
  type: "game.crate",
  typeVersion: 1,
  active: true,
  transform: {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  },
  params: {},
  extensions: {},
};

const document_: LevelDocument = {
  format: "yage-level",
  version: 1,
  id: "forest",
  metadata: {},
  entities: [crate],
  extensions: {},
};

/**
 * Two placements, for the shortcuts that read the selection when the key is
 * pressed: moving between two of them leaves the selection non-empty, which is
 * the case the shell does not render for.
 */
const twoPlacements: LevelDocument = {
  ...document_,
  entities: [crate, { ...crate, id: "beam" }],
};

function snapshot(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    path: "levels/forest.yage-level.json",
    epoch: "epoch-1",
    document: document_,
    draftRevision: 0,
    diskRevision: "disk-1",
    contentHash: "content-0",
    savedContentHash: "content-0",
    dirty: false,
    history: { undoDepth: 0, redoDepth: 0 },
    ...overrides,
  };
}

/** What bootstrap listed, alphabetical, the way the server answers it. */
const levels = [
  { path: "levels/forest.yage-level.json", diskRevision: "disk-1" },
  { path: "levels/meadow.yage-level.json", diskRevision: "disk-2" },
] as const;

function createHarness(
  runnable = true,
  types = placeables,
  listed: readonly { path: string; diskRevision: string }[] = levels,
) {
  const store = new EditorStore({
    api: unusedApi,
    epoch: "epoch-1",
    projectId: "project-1",
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
  const intents: string[] = [];
  const framed: string[][] = [];
  // The shell's job is to call the right intent; what each one produces is the
  // controller's own tests.
  commands.createPlacement = (typeId) => intents.push(`create ${typeId}`);
  commands.copyPlacements = (ids) => intents.push(`copy ${ids.join(",")}`);
  commands.pastePlacements = () => intents.push("paste");
  commands.duplicatePlacements = (ids) =>
    intents.push(`duplicate ${ids.join(",")}`);
  commands.deletePlacements = (ids) => {
    intents.push(`delete ${ids.join(",")}`);
    return Promise.resolve();
  };
  commands.undo = () => {
    intents.push("undo");
    return Promise.resolve();
  };
  commands.redo = () => {
    intents.push("redo");
    return Promise.resolve();
  };
  commands.movePlacements = (ids, drop) => {
    intents.push(`move ${ids.join(",")} ${JSON.stringify(drop)}`);
  };
  commands.setParam = (id, field, value) => {
    intents.push(`set ${id}.${field}=${JSON.stringify(value)}`);
  };
  commands.resetParam = (id, field) => {
    intents.push(`reset ${id}.${field}`);
  };
  commands.resetPlacement = (id) => {
    intents.push(`reset-placement ${id}`);
  };
  commands.setName = (id, name) => {
    intents.push(`name ${id}=${name ?? "(none)"}`);
  };
  commands.setKey = (id, key) => {
    intents.push(`key ${id}=${key ?? "(none)"}`);
  };
  commands.setPose = (id, transform) => {
    intents.push(`pose ${id} x=${String(transform.position.x)}`);
  };
  commands.redrawGesture = () => intents.push("redraw");
  // The Actors panel reads what it can place on each of its own renders, and
  // it is not memoized — so this counts every render of the shell as well as
  // its own.
  let actorsRenders = 0;
  const saves: number[] = [];
  const runs: number[] = [];
  const plays: number[] = [];
  const opens: string[] = [];
  const host = document.createElement("div");
  const canvasHost = document.createElement("div");
  canvasHost.id = "canvas-host";
  document.body.append(host);

  const root: Root = createRoot(host);
  act(() => {
    root.render(
      <EditorShell
        store={store}
        commands={commands}
        files={{
          runnable,
          openLevel: (path) => {
            opens.push(path);
            return Promise.resolve();
          },
          save: () => {
            saves.push(1);
            return Promise.resolve();
          },
          run: () => {
            runs.push(1);
            return Promise.resolve();
          },
          play: () => {
            plays.push(1);
            return Promise.resolve();
          },
        }}
        preview={{
          hitTest: () => null,
          screenToWorld: (point) => point,
          gizmoAt: () => null,
          gizmoNear: () => false,
          markAt: () => null,
          placementsWithin: () => [],
          frameSelection: (ids) => framed.push([...ids]),
        }}
        canvasHost={canvasHost}
        placeables={() => {
          actorsRenders += 1;
          return types;
        }}
        inspectable={(typeId) =>
          typeId === "game.crate"
            ? {
                typeId,
                fields: [
                  {
                    name: "texture",
                    kind: "asset",
                    defaultValue: "sprites/crate.png",
                  },
                ],
              }
            : undefined
        }
        listAssets={() =>
          Promise.resolve({ paths: ["sprites/crate.png"], truncated: false })
        }
        levels={listed}
      />,
    );
  });

  return {
    actorsRenders: () => actorsRenders,
    store,
    host,
    root,
    saves,
    runs,
    plays,
    opens,
    intents,
    framed,
    canvasHost,
  };
}

function click(host: HTMLElement, testId: string): void {
  const button = query<HTMLButtonElement>(host, testId);
  if (!button) throw new Error(`No ${testId} control rendered.`);
  act(() => {
    button.click();
  });
}

function query<T extends Element>(host: HTMLElement, testId: string): T | null {
  return host.querySelector<T>(`[data-testid="${testId}"]`);
}

/** Pick an option the way a pointer or the keyboard does. */
function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/**
 * Which gizmo the toolbar says is live, of which there is exactly one. The
 * other toggles in the bar are not tools.
 */
function pressed(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[aria-pressed="true"]')]
    .map((element) => element.getAttribute("data-testid") ?? "")
    .filter((id) => id.startsWith("tool-"));
}

describe("EditorShell", () => {
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

  it("says no level is open before one is", () => {
    expect(harness.host.textContent).toContain("No level open");
    expect(query<HTMLButtonElement>(harness.host, "save-level")?.disabled).toBe(
      true,
    );
  });

  it("places the element the engine draws into", () => {
    expect(query(harness.host, "yage-editor-viewport")?.firstElementChild).toBe(
      harness.canvasHost,
    );
  });

  it("shows the open level and keeps save off while it is clean", () => {
    act(() => {
      harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
    });

    expect(harness.host.textContent).toContain("levels/forest.yage-level.json");
    expect(query(harness.host, "dirty-marker")).toBeNull();
    expect(query<HTMLButtonElement>(harness.host, "save-level")?.disabled).toBe(
      true,
    );
  });

  it("offers to save once the draft differs from the file", () => {
    act(() => {
      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot({ contentHash: "content-9", dirty: true }),
      });
    });

    expect(query(harness.host, "dirty-marker")).not.toBeNull();
    const save = query<HTMLButtonElement>(harness.host, "save-level");
    expect(save?.disabled).toBe(false);

    act(() => {
      save?.click();
    });
    expect(harness.saves).toHaveLength(1);
  });

  it("shows why editing stopped and refuses to save", () => {
    act(() => {
      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot({ contentHash: "content-9", dirty: true }),
      });
      harness.store.lockWrites("stale-project");
    });

    expect(query(harness.host, "write-lock")?.textContent).toContain(
      "stale-project",
    );
    expect(query<HTMLButtonElement>(harness.host, "save-level")?.disabled).toBe(
      true,
    );
  });

  it("runs the open level, clean or not", () => {
    act(() => {
      harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
    });
    const run = query<HTMLButtonElement>(harness.host, "run-level");
    expect(run?.disabled).toBe(false);

    act(() => {
      run?.click();
    });
    expect(harness.runs).toHaveLength(1);
  });

  it("stops offering a run once editing is locked", () => {
    act(() => {
      harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
      harness.store.lockWrites("stale-command");
    });

    // Run saves before it opens anything, and a locked draft is one that
    // cannot be saved.
    expect(query<HTMLButtonElement>(harness.host, "run-level")?.disabled).toBe(
      true,
    );
  });

  it("has no run control when the project named no game page", () => {
    act(() => {
      harness.root.unmount();
    });
    harness.host.remove();
    harness = createHarness(false);
    act(() => {
      harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
    });

    expect(query(harness.host, "run-level")).toBeNull();
  });

  it("lists what went wrong", () => {
    act(() => {
      harness.store.dispatch({
        type: "diagnostics-replaced",
        source: "preview",
        diagnostics: [
          {
            code: "placement-excluded",
            severity: "error",
            source: "preview",
            message: 'Placement "crate" could not be built.',
            revision: 1,
            placementId: "crate",
          },
        ],
      });
    });

    expect(query(harness.host, "diagnostics")?.textContent).toContain(
      "could not be built",
    );
  });

  describe("the Actors strip", () => {
    function open(): void {
      act(() => {
        harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
      });
    }

    /** Open the strip, which starts closed so the viewport keeps the height. */
    function expand(): void {
      click(harness.host, "actors-toggle");
    }

    it("starts closed, and its header opens and closes it", () => {
      open();
      const header = () =>
        query<HTMLButtonElement>(harness.host, "actors-toggle");
      expect(header()?.getAttribute("aria-expanded")).toBe("false");
      expect(query(harness.host, "place-game.crate")).toBeNull();
      // Closed it still says what it is, and Tab reaches the button that
      // opens it.
      expect(header()?.textContent).toContain("Actors");

      expand();
      expect(header()?.getAttribute("aria-expanded")).toBe("true");
      expect(query(harness.host, "place-game.crate")).not.toBeNull();

      expand();
      expect(query(harness.host, "place-game.crate")).toBeNull();
    });

    it("lists a project type and a package's, and says which package", () => {
      open();
      expand();

      const actors = query(harness.host, "actors");
      expect(actors?.textContent).toContain("game.crate");
      expect(actors?.textContent).toContain("renderer.sprite");
      // The contributing package is what tells a developer where a type they
      // did not declare came from.
      expect(actors?.textContent).toContain("@yagejs/renderer");
    });

    it("puts the project's own types first, under their own heading", () => {
      open();
      expand();
      const headings = [
        ...harness.host.querySelectorAll(".ye-actors__group"),
      ].map((element) => element.textContent);

      // A project that adds a tilemap and a renderer otherwise reads as one
      // list in whatever order the catalog was built in.
      expect(headings).toEqual(["This project", "@yagejs/renderer"]);
    });

    it("groups a package that named itself nowhere", () => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness(true, [
        { typeId: "mystery.thing", source: "package" },
      ]);
      act(() => {
        harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
      });
      expand();

      expect(query(harness.host, "actors")?.textContent).toContain(
        "Other packages",
      );
      expect(query(harness.host, "place-mystery.thing")).not.toBeNull();
    });

    it("shows a type's texture default as its picture", () => {
      open();
      expand();

      const image = query<HTMLImageElement>(harness.host, "thumb-game.crate");
      // The authored path, unchanged: it is the address the running level
      // fetches, so the panel asks for the same one.
      expect(image?.getAttribute("src")).toBe("sprites/crate.png");
      // Decorative — the type id is already beside it.
      expect(image?.alt).toBe("");
    });

    it("shows an empty frame for a type with no texture", () => {
      open();
      expand();

      const mark = query(harness.host, "thumb-renderer.sprite");
      expect(mark?.tagName).toBe("SPAN");
      expect(mark?.className).toContain("ye-actors__thumb--none");
    });

    it("falls back to the empty frame when the picture cannot be fetched", () => {
      open();
      expand();
      const image = query<HTMLImageElement>(harness.host, "thumb-game.crate");
      act(() => {
        image?.dispatchEvent(new Event("error"));
      });

      // A default can name a file the project no longer has, and a broken
      // image glyph says nothing a developer can act on.
      expect(query(harness.host, "thumb-game.crate")?.tagName).toBe("SPAN");
    });

    it("carries the whole type id on the entry", () => {
      open();
      expand();

      // The name is cut with an ellipsis when the id is longer than the
      // entry, so hovering it is the only way to read the rest of it.
      expect(
        query(harness.host, "place-game.crate")?.getAttribute("title"),
      ).toBe("game.crate");
    });

    it("places the type that was clicked", () => {
      open();
      expand();
      click(harness.host, "place-game.crate");

      expect(harness.intents).toEqual(["create game.crate"]);
    });

    it("places nothing before a level is open", () => {
      expand();

      expect(
        query<HTMLButtonElement>(harness.host, "place-game.crate")?.disabled,
      ).toBe(true);
    });

    it("places nothing while editing is locked", () => {
      open();
      expand();
      act(() => {
        harness.store.lockWrites("stale-project");
      });

      expect(
        query<HTMLButtonElement>(harness.host, "place-game.crate")?.disabled,
      ).toBe(true);
    });

    it("says so when the project declares nothing placeable", () => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness(true, []);
      expand();

      expect(query(harness.host, "actors")?.textContent).toContain(
        "Nothing to place",
      );
    });
  });

  describe("the authoring controls", () => {
    function open(overrides: Partial<DraftSnapshot> = {}): void {
      act(() => {
        harness.store.dispatch({
          type: "level-opened",
          snapshot: snapshot(overrides),
        });
      });
    }

    it("deletes what is selected", () => {
      open();
      act(() => {
        harness.store.dispatch({
          type: "selection-changed",
          ids: ["crate"],
        });
      });
      click(harness.host, "delete-selection");

      expect(harness.intents).toEqual(["delete crate"]);
    });

    it("offers no delete while nothing is selected", () => {
      open();

      expect(
        query<HTMLButtonElement>(harness.host, "delete-selection")?.disabled,
      ).toBe(true);
    });

    it("reads what undo and redo can do from the history, not the revision", () => {
      // A revision well past zero with an empty history: an undo control that
      // inferred availability from edits having happened would be enabled.
      open({ draftRevision: 7, history: { undoDepth: 0, redoDepth: 0 } });

      expect(query<HTMLButtonElement>(harness.host, "undo")?.disabled).toBe(
        true,
      );
      expect(query<HTMLButtonElement>(harness.host, "redo")?.disabled).toBe(
        true,
      );
    });

    it("offers undo and redo for the depths the server reported", () => {
      open({ history: { undoDepth: 2, redoDepth: 1 } });
      click(harness.host, "undo");
      click(harness.host, "redo");

      expect(harness.intents).toEqual(["undo", "redo"]);
    });

    it("offers neither while editing is locked", () => {
      open({ history: { undoDepth: 2, redoDepth: 1 } });
      act(() => {
        harness.store.lockWrites("stale-command");
      });

      expect(query<HTMLButtonElement>(harness.host, "undo")?.disabled).toBe(
        true,
      );
      expect(query<HTMLButtonElement>(harness.host, "redo")?.disabled).toBe(
        true,
      );
    });
  });

  describe("the hierarchy and inspector, wired to the store and controller", () => {
    function open(): void {
      act(() => {
        harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
      });
    }

    it("selects the row that was clicked", () => {
      open();
      click(harness.host, "hierarchy-row-crate");

      expect([...harness.store.getState().selection]).toEqual(["crate"]);
    });

    it("hands a drop to the controller as a move intent", () => {
      open();
      const row = query<HTMLElement>(harness.host, "hierarchy-row-crate");
      act(() => {
        row?.dispatchEvent(new Event("dragstart", { bubbles: true }));
      });
      const target = query<HTMLElement>(harness.host, "drop-root");
      act(() => {
        target?.dispatchEvent(new Event("drop", { bubbles: true }));
      });

      expect(harness.intents).toEqual(['move crate {"kind":"root"}']);
    });

    it("hands a committed field to the controller as a set intent", () => {
      open();
      act(() => {
        harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      });
      const input = query<HTMLInputElement>(harness.host, "field-texture");
      if (!input) throw new Error("No texture field rendered.");
      act(() => {
        setValue(input, "sprites/new.png");
      });
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });

      expect(harness.intents).toEqual(['set crate.texture="sprites/new.png"']);
    });

    it("hands the name, the key, and a typed transform to the controller", () => {
      open();
      act(() => {
        harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      });
      const commit = (testId: string, text: string): void => {
        const box = query<HTMLInputElement>(harness.host, testId);
        if (!box) throw new Error(`No ${testId} control rendered.`);
        act(() => {
          setValue(box, text);
        });
        act(() => {
          box.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          );
        });
      };

      commit("placement-name", "Left crate");
      commit("placement-key", "door");
      commit("transform-x", "137");

      expect(harness.intents).toEqual([
        "name crate=Left crate",
        "key crate=door",
        "pose crate x=137",
      ]);
    });

    it("hands the two resets to the controller", () => {
      open();
      act(() => {
        harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
        harness.store.dispatch({
          type: "diagnostics-replaced",
          source: "preview",
          diagnostics: [
            {
              code: "migration-failed",
              severity: "error",
              source: "preview",
              message: "no migration from 1 to 2",
              revision: 1,
              placementId: "crate",
              path: [],
            },
          ],
        });
      });
      click(harness.host, "reset-texture");
      click(harness.host, "reset-placement");
      click(harness.host, "confirm-reset-placement");

      expect(harness.intents).toEqual([
        "reset crate.texture",
        "reset-placement crate",
      ]);
    });
  });

  describe("toolbar", () => {
    it("says which gizmo is live", () => {
      expect(pressed(harness.host)).toEqual(["tool-translate"]);

      click(harness.host, "tool-rotate");

      expect(harness.store.getState().tool).toBe("rotate");
      expect(pressed(harness.host)).toEqual(["tool-rotate"]);
    });

    it("follows the keyboard, which the buttons also name", () => {
      press("r");

      expect(pressed(harness.host)).toEqual(["tool-scale"]);
      // The button carries the key it shares, so the two are one control
      // rather than two ways of doing the same thing that can disagree.
      expect(query(harness.host, "tool-scale")?.textContent).toContain("R");
    });

    it("offers the box gizmo as a fourth choice, on its own key", () => {
      press("t");

      expect(harness.store.getState().tool).toBe("box");
      expect(pressed(harness.host)).toEqual(["tool-box"]);
      expect(query(harness.host, "tool-box")?.textContent).toContain(
        "Transform",
      );
    });

    it("offers the pivot and the axes, starting on what a single selection does", () => {
      // Active and Local together are exactly the behaviour a lone placement
      // has always had, so both toggles are additive from where they start.
      expect(
        query(harness.host, "pivot-active")?.getAttribute("aria-pressed"),
      ).toBe("true");
      expect(
        query(harness.host, "axes-local")?.getAttribute("aria-pressed"),
      ).toBe("true");

      click(harness.host, "pivot-center");
      click(harness.host, "axes-world");

      expect(harness.store.getState().pivot).toBe("center");
      expect(harness.store.getState().axes).toBe("world");
      expect(
        query(harness.host, "pivot-active")?.getAttribute("aria-pressed"),
      ).toBe("false");
      expect(
        query(harness.host, "pivot-center")?.getAttribute("aria-pressed"),
      ).toBe("true");
    });

    it("keeps the pivot and the axes apart from the tool", () => {
      // Picking a tool must not disturb what that tool works about.
      click(harness.host, "pivot-individual");

      click(harness.host, "tool-rotate");

      expect(harness.store.getState().pivot).toBe("individual");
      expect(
        query(harness.host, "pivot-individual")?.getAttribute("aria-pressed"),
      ).toBe("true");
    });

    it("shows the reference guides, and switches them from the key", () => {
      const button = query(harness.host, "toggle-guides");
      expect(button?.getAttribute("aria-pressed")).toBe("true");

      press("g");

      expect(harness.store.getState().view.guides).toBe(false);
      expect(
        query(harness.host, "toggle-guides")?.getAttribute("aria-pressed"),
      ).toBe("false");
    });

    it("switches the guides from the button as well", () => {
      click(harness.host, "toggle-guides");

      expect(harness.store.getState().view.guides).toBe(false);

      click(harness.host, "toggle-guides");

      expect(harness.store.getState().view.guides).toBe(true);
    });

    it("shows snapping, and switches it from the key and the button", () => {
      expect(
        query(harness.host, "toggle-snap")?.getAttribute("aria-pressed"),
      ).toBe("true");

      press("s");

      expect(harness.store.getState().view.snap).toBe(false);
      expect(
        query(harness.host, "toggle-snap")?.getAttribute("aria-pressed"),
      ).toBe("false");

      click(harness.host, "toggle-snap");

      expect(harness.store.getState().view.snap).toBe(true);
    });

    it("resizes the lattice from the step field, on the way out", () => {
      const field = query<HTMLInputElement>(harness.host, "grid-step");
      if (!field) throw new Error("The step field did not render.");
      expect(field.value).toBe("32");

      act(() => {
        setValue(field, "6");
      });
      // Half-typed. Committing here would redraw the grid at 6 on the way to
      // 64.
      expect(harness.store.getState().view.step).toBe(32);

      act(() => {
        setValue(field, "64");
      });
      press("Enter", { target: field });

      expect(harness.store.getState().view.step).toBe(64);
    });

    it("keeps a step the grid cannot use, and says why", () => {
      const field = query<HTMLInputElement>(harness.host, "grid-step");
      if (!field) throw new Error("The step field did not render.");

      act(() => {
        setValue(field, "0");
      });
      press("Enter", { target: field });

      expect(field.value).toBe("0");
      expect(harness.store.getState().view.step).toBe(32);
      expect(query(harness.host, "grid-step-reason")?.textContent).toBe(
        "A number from 1 to 10000.",
      );
      expect(harness.intents).toEqual([]);
    });

    it("keeps a step outside the bounds rather than moving it inside them", () => {
      const field = query<HTMLInputElement>(harness.host, "grid-step");
      if (!field) throw new Error("The step field did not render.");

      // The store clamps to 1-10000, so committing either of these would put
      // a number back in the box that nobody typed.
      for (const outside of ["0.5", "50000"]) {
        act(() => {
          setValue(field, outside);
        });
        press("Enter", { target: field });

        expect(field.value).toBe(outside);
        expect(harness.store.getState().view.step).toBe(32);
        expect(query(harness.host, "grid-step-reason")?.textContent).toBe(
          "A number from 1 to 10000.",
        );
      }
      expect(harness.intents).toEqual([]);
    });

    it("dispatches nothing for the step already in force", () => {
      const field = query<HTMLInputElement>(harness.host, "grid-step");
      if (!field) throw new Error("The step field did not render.");

      act(() => {
        setValue(field, "64");
      });
      act(() => {
        setValue(field, "32");
      });
      press("Enter", { target: field });

      // Nothing changed, so nothing is redrawn — a gesture under the pointer
      // keeps the pose it was showing.
      expect(harness.intents).toEqual([]);
    });

    it("redraws an open drag whenever the lattice changes under it", () => {
      const field = query<HTMLInputElement>(harness.host, "grid-step");
      if (!field) throw new Error("The step field did not render.");

      press("s");
      click(harness.host, "toggle-snap");
      act(() => {
        setValue(field, "64");
      });
      press("Enter", { target: field });

      // A drag reads the lattice as it stands at each move, so all three
      // routes have to put the preview back on what a release would write.
      expect(harness.intents.filter((one) => one === "redraw")).toHaveLength(3);
    });

    it("doubles and halves the step from the arrows, within the bounds", () => {
      const field = query<HTMLInputElement>(harness.host, "grid-step");
      if (!field) throw new Error("The step field did not render.");

      // The lattice takes no history entry, so each press lands at once
      // rather than waiting for the box to be left.
      press("ArrowUp", { target: field });
      expect(harness.store.getState().view.step).toBe(64);
      press("ArrowUp", { target: field });
      expect(harness.store.getState().view.step).toBe(128);
      press("ArrowDown", { target: field });
      press("ArrowDown", { target: field });
      press("ArrowDown", { target: field });
      expect(harness.store.getState().view.step).toBe(16);
      expect(field.value).toBe("16");

      // The floor holds: halving 1 would leave the grid below a pixel.
      for (let taken = 0; taken < 5; taken += 1) {
        press("ArrowDown", { target: field });
      }
      expect(harness.store.getState().view.step).toBe(1);
    });

    it("keeps a keystroke typed into the step field away from the shortcuts", () => {
      const field = query<HTMLInputElement>(harness.host, "grid-step");
      if (!field) throw new Error("The step field did not render.");

      press("s", { target: field });

      // `s` switches snapping everywhere else; inside the field it is a
      // character.
      expect(harness.store.getState().view.snap).toBe(true);
    });

    it("leaves the guides alone when the view is reset", () => {
      press("g");
      act(() => {
        harness.store.dispatch({ type: "view-panned", by: { x: 40, y: 0 } });
      });

      press("f", { shift: true });

      const view = harness.store.getState().view;
      expect(view.center).toEqual({ x: 0, y: 0 });
      // A reset is about where the developer is looking. Turning the guides
      // back on would undo a choice they made about what the viewport draws.
      expect(view.guides).toBe(false);
    });

    it("offers Select first, on its own key", () => {
      press("q");

      expect(harness.store.getState().tool).toBe("select");
      expect(pressed(harness.host)).toEqual(["tool-select"]);
      expect(query(harness.host, "tool-select")?.textContent).toContain(
        "Select",
      );
    });

    it("starts on Move, so the box gizmo is opt-in", () => {
      expect(harness.store.getState().tool).toBe("translate");
    });

    it("switches tools while the level is read-only", () => {
      act(() => {
        harness.store.dispatch({
          type: "level-opened",
          snapshot: snapshot(),
        });
        harness.store.lockWrites("stale-command");
      });

      click(harness.host, "tool-rotate");

      // Choosing a gizmo is not an edit. The gesture is what refuses.
      expect(harness.store.getState().tool).toBe("rotate");
    });

    it("hands the keyboard back after a pointer click, from every button", () => {
      // `Viewport` skips Space while a button has focus, because a button
      // activates on Space. A button that keeps focus turns the next Space
      // press into that button again instead of a pan — on Undo or Delete,
      // that is a second edit rather than nothing. The rule belongs to every
      // button, so this walks all of them rather than naming three.
      act(() => {
        harness.store.dispatch({
          type: "level-opened",
          snapshot: snapshot({ history: { undoDepth: 2, redoDepth: 1 } }),
        });
        harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      });

      const buttons = [
        ...harness.host.querySelectorAll<HTMLButtonElement>("button"),
      ].filter((button) => !button.disabled);
      // The three tools, Undo, Redo, Delete, Save, Run, and the Actors panel.
      expect(buttons.length).toBeGreaterThan(8);

      for (const button of buttons) {
        act(() => {
          button.focus();
          button.dispatchEvent(
            new MouseEvent("click", { bubbles: true, detail: 1 }),
          );
        });
        expect({
          button: button.getAttribute("data-testid"),
          keptFocus: document.activeElement === button,
        }).toEqual({
          button: button.getAttribute("data-testid"),
          keptFocus: false,
        });
      }
    });

    it("hands the keyboard back after a pointer click", () => {
      // `Viewport` skips Space while a button has focus, because a button
      // activates on Space. A tool button holding focus would leave
      // Space-to-pan doing nothing until the developer clicked elsewhere.
      const button = query<HTMLButtonElement>(harness.host, "tool-rotate");
      if (!button) throw new Error("The toolbar rendered no rotate button.");

      act(() => {
        button.focus();
        button.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 1 }),
        );
      });

      expect(document.activeElement).not.toBe(button);
    });

    it("keeps the focus a keyboard put there", () => {
      const button = query<HTMLButtonElement>(harness.host, "tool-scale");
      if (!button) throw new Error("The toolbar rendered no scale button.");

      act(() => {
        button.focus();
        // Enter and Space on a focused button report no clicks.
        button.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 0 }),
        );
      });

      expect(harness.store.getState().tool).toBe("scale");
      expect(document.activeElement).toBe(button);
    });
  });

  describe("shortcuts", () => {
    it("picks each gizmo with its own key", () => {
      press("e");
      expect(harness.store.getState().tool).toBe("rotate");
      press("r");
      expect(harness.store.getState().tool).toBe("scale");
      press("w");
      expect(harness.store.getState().tool).toBe("translate");
    });

    it("still reads W, E, and R while a toolbar button has focus", () => {
      const button = query<HTMLButtonElement>(harness.host, "tool-rotate");
      if (!button) throw new Error("The toolbar rendered no rotate button.");
      button.focus();

      press("r", { target: button });

      expect(harness.store.getState().tool).toBe("scale");
    });

    function open(overrides: Partial<DraftSnapshot> = {}): void {
      act(() => {
        harness.store.dispatch({
          type: "level-opened",
          snapshot: snapshot(overrides),
        });
      });
    }

    it("frames the selection on F", () => {
      open();
      act(() => {
        harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      });

      expect(press("f")).toBe(true);
      expect(harness.framed).toEqual([["crate"]]);
    });

    it("frames what is selected when F is pressed, not at the last render", () => {
      open({ document: twoPlacements });
      // Each dispatch on its own: the shell renders for the first, which takes
      // the selection from empty to one, and not for the second, which leaves
      // it at one. A handler holding the render's selection would frame the
      // crate.
      act(() => {
        harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      });
      act(() => {
        harness.store.dispatch({ type: "selection-changed", ids: ["beam"] });
      });

      expect(press("f")).toBe(true);
      expect(harness.framed).toEqual([["beam"]]);
    });

    it("resets the view on Shift-F", () => {
      open();
      act(() => {
        harness.store.dispatch({ type: "view-panned", by: { x: 90, y: 90 } });
      });

      expect(press("F", { shift: true })).toBe(true);
      expect(harness.store.getState().view).toEqual(DEFAULT_VIEW);
      // Shift-F is its own shortcut: framing must not also have run.
      expect(harness.framed).toEqual([]);
    });

    it("undoes and redoes on the modifier chords", () => {
      open({ history: { undoDepth: 2, redoDepth: 1 } });

      press("z", { mod: true });
      press("z", { mod: true, shift: true });

      expect(harness.intents).toEqual(["undo", "redo"]);
    });

    it("does not undo past what the server holds", () => {
      open({ history: { undoDepth: 0, redoDepth: 0 } });

      press("z", { mod: true });
      press("z", { mod: true, shift: true });

      expect(harness.intents).toEqual([]);
    });

    it("does not undo while editing is locked", () => {
      open({ history: { undoDepth: 2, redoDepth: 1 } });
      act(() => {
        harness.store.lockWrites("stale-command");
      });

      press("z", { mod: true });

      expect(harness.intents).toEqual([]);
    });

    it("leaves a keystroke a text field owns alone", () => {
      open();
      act(() => {
        harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      });
      const field = query<HTMLInputElement>(harness.host, "field-texture");
      if (!field) throw new Error("The inspector rendered no field.");

      expect(press("f", { target: field })).toBe(false);
      expect(harness.framed).toEqual([]);
    });
  });
});

/**
 * Press a key on the window, the way a shortcut is read. Returns whether the
 * browser's own meaning for it was suppressed.
 */
function press(
  key: string,
  options: { mod?: boolean; shift?: boolean; target?: HTMLElement } = {},
): boolean {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ctrlKey: options.mod ?? false,
    shiftKey: options.shift ?? false,
  });
  act(() => {
    (options.target ?? window).dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** Type into a React-controlled input: set the value the way the DOM does, then say so. */
function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("copy, paste, and duplicate", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    harness = createHarness();
    act(() => {
      harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
    });
  });

  afterEach(() => {
    act(() => {
      harness.root.unmount();
    });
  });

  it("copies the selection", () => {
    press("c", { mod: true });

    expect(harness.intents).toContain("copy crate");
  });

  it("copies even while writes are locked", () => {
    act(() => {
      harness.store.lockWrites("stale-command");
    });

    press("c", { mod: true });

    expect(harness.intents).toContain("copy crate");
  });

  it("copies and duplicates what is selected when the key is pressed", () => {
    // The selection moves between two placements without the shell rendering,
    // since it stays non-empty. A handler holding the render's selection would
    // send the crate for both.
    act(() => {
      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot({ document: twoPlacements }),
      });
    });
    act(() => {
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
    });
    act(() => {
      harness.store.dispatch({ type: "selection-changed", ids: ["beam"] });
    });

    press("c", { mod: true });
    press("d", { mod: true });

    expect(harness.intents).toContain("copy beam");
    expect(harness.intents).toContain("duplicate beam");
  });

  it("pastes and duplicates", () => {
    press("v", { mod: true });
    press("d", { mod: true });

    expect(harness.intents).toContain("paste");
    expect(harness.intents).toContain("duplicate crate");
  });

  it("neither pastes nor duplicates while writes are locked", () => {
    act(() => {
      harness.store.lockWrites("stale-command");
    });

    press("v", { mod: true });
    press("d", { mod: true });

    expect(harness.intents).not.toContain("paste");
    expect(harness.intents).not.toContain("duplicate crate");
  });
});
describe("the level picker", () => {
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

  function picker(): HTMLSelectElement {
    const select = query<HTMLSelectElement>(harness.host, "level-picker");
    if (!select) throw new Error("No level picker rendered.");
    return select;
  }

  it("lists every level the server found, with the open one showing", () => {
    act(() => {
      harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
    });

    const select = picker();
    // The levels and nothing else: the placeholder is gone once a level is
    // open, so the list holds no row anyone can pick and land nowhere.
    expect([...select.options].map((option) => option.value)).toEqual([
      "levels/forest.yage-level.json",
      "levels/meadow.yage-level.json",
    ]);
    expect(select.value).toBe("levels/forest.yage-level.json");
  });

  it("opens the level that was chosen", () => {
    act(() => {
      harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
    });

    choose(picker(), "levels/meadow.yage-level.json");

    expect(harness.opens).toEqual(["levels/meadow.yage-level.json"]);
  });

  it("gives the keyboard back once a level is chosen", () => {
    act(() => {
      harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
    });
    const select = picker();
    select.focus();

    choose(select, "levels/meadow.yage-level.json");

    // `ownsTextEntry` counts a select, so a focused one would swallow every
    // single-letter shortcut the shell has.
    expect(globalThis.document.activeElement).not.toBe(select);
    expect(harness.opens).toEqual(["levels/meadow.yage-level.json"]);
  });

  it("says so and offers nothing when the project has no levels", () => {
    act(() => {
      harness.root.unmount();
    });
    harness.host.remove();
    harness = createHarness(true, placeables, []);

    const select = picker();
    expect(select.disabled).toBe(true);
    expect(select.textContent).toContain("No levels found");
  });

  it("selects the placeholder before a level is open", () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness();

      const select = picker();
      expect(select.value).toBe("");
      expect(select.options[0]?.textContent).toBe("No level open");
      // Shown, and never a level anyone can go back to.
      expect(select.options[0]?.disabled).toBe(true);
      // React warns when a controlled select holds a value no option carries.
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
    }
  });

  it("keeps the badge and the three actions beside it", () => {
    act(() => {
      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot({ contentHash: "content-1", dirty: true }),
      });
    });

    expect(query(harness.host, "dirty-marker")?.textContent).toBe("unsaved");
    expect(query<HTMLButtonElement>(harness.host, "save-level")?.disabled).toBe(
      false,
    );
    expect(query(harness.host, "play-level")).not.toBeNull();
    expect(query(harness.host, "run-level")?.textContent).toBe("Save and Run");
  });
});

describe("what a drag re-renders", () => {
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

  /** A translate of the fixture placement, ready to be moved. */
  const drag = {
    type: "gesture-started",
    gesture: {
      kind: "translate",
      spin: 0,
      reference: { x: 1, y: 1, kind: "length" },
      constrained: false,
      suspended: false,
      snapFrom: { position: { x: 0, y: 0 }, rotation: 0 },
      ids: ["crate"],
      origin: { x: 0, y: 0 },
      current: { x: 0, y: 0 },
      base: new Map([
        [
          "crate",
          {
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
          },
        ],
      ]),
    },
  } as const;

  it("leaves the panels alone while the pointer moves", () => {
    act(() => {
      harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      harness.store.dispatch(drag);
    });
    const before = harness.actorsRenders();

    act(() => {
      for (let step = 1; step <= 10; step += 1) {
        harness.store.dispatch({
          type: "gesture-moved",
          current: { x: step * 32, y: 0 },
          spin: 0,
          constrained: false,
          suspended: false,
        });
      }
    });

    // Ten pointer moves, and the panel that lists what can be placed drew
    // none of them. The hierarchy is the same story one panel over: it reads
    // the document, the selection and whether the level is writable, and a
    // move touches none of the three.
    expect(harness.actorsRenders()).toBe(before);
    // The control bar does follow the drag, which is what makes the split
    // worth having rather than a way to draw stale numbers.
    expect(query<HTMLInputElement>(harness.host, "transform-x")?.value).toBe(
      "320",
    );
  });

  it("draws the hierarchy again when the document changes under it", () => {
    act(() => {
      harness.store.dispatch({ type: "level-opened", snapshot: snapshot() });
    });

    expect(query(harness.host, "hierarchy-row-crate")).not.toBeNull();

    act(() => {
      harness.store.dispatch({
        type: "level-opened",
        snapshot: snapshot({
          document: { ...document_, entities: [] },
          draftRevision: 1,
        }),
      });
    });

    expect(query(harness.host, "hierarchy-row-crate")).toBeNull();
  });
});
