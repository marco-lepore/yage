// @vitest-environment happy-dom
import type {
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  DiagnosticCode,
  EditorDiagnostic,
} from "../../shared/diagnostics/index.js";
import type { LayerChoice } from "../layers.js";
import type { InspectableType } from "../project/index.js";
import { EditorStore, type DraftApi } from "../store/index.js";
import type {
  AssetListing,
  DraftSnapshot,
} from "../../shared/protocol/index.js";
import { Inspector } from "./Inspector.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const unusedApi: DraftApi = {
  sendCommand: () => Promise.reject(new Error("not used")),
  undo: () => Promise.reject(new Error("not used")),
  redo: () => Promise.reject(new Error("not used")),
};

function placement(
  id: string,
  overrides: Partial<LevelPlacement> = {},
): LevelPlacement {
  return {
    id,
    type: "game.crate",
    typeVersion: 1,
    active: true,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    params: { texture: "sprites/crate.png" },
    extensions: {},
    ...overrides,
  };
}

/** The one fixture placement with a transform worth reading back. */
const NAMED_TRANSFORM: LevelTransform = {
  position: { x: 12, y: -4 },
  rotation: Math.PI / 4,
  scale: { x: 2, y: 0.5 },
};

const DOCUMENT: LevelDocument = {
  format: "yage-level",
  version: 1,
  id: "forest",
  metadata: {},
  entities: [
    placement("crate"),
    placement("moved", { params: { texture: "sprites/moved.png" } }),
    placement("alien", { type: "game.absent" }),
    placement("named", {
      name: "Left crate",
      key: "door",
      transform: NAMED_TRANSFORM,
    }),
    placement("child", { parent: "named" }),
    // Its key is another placement's id, which is legal — the two derive
    // "nick"'s key and "named"'s own key, and those differ.
    placement("nick", { key: "named" }),
    placement("layered", { layer: "canopy" }),
  ],
  extensions: {},
};

function snapshot(): DraftSnapshot {
  return {
    path: "levels/forest.yage-level.json",
    epoch: "epoch-1",
    document: DOCUMENT,
    draftRevision: 0,
    diskRevision: "disk-1",
    contentHash: "content-0",
    savedContentHash: "content-0",
    dirty: false,
    history: { undoDepth: 0, redoDepth: 0 },
  };
}

const CRATE: InspectableType = {
  typeId: "game.crate",
  fields: [
    { name: "texture", kind: "asset", defaultValue: "sprites/crate.png" },
  ],
};

function diagnostic(
  placementId: string,
  code: DiagnosticCode,
  path?: readonly string[],
): EditorDiagnostic {
  return {
    code,
    severity: "error",
    source: "preview",
    message: `${code} at ${placementId}`,
    revision: 1,
    placementId,
    ...(path === undefined ? {} : { path }),
  };
}

/** What the fixture project's asset globs match, for the picker to offer. */
const LISTING: AssetListing = {
  paths: ["sprites/barrel.png", "sprites/CRATE.png", "sounds/thud.wav"],
  truncated: false,
};

interface HarnessOptions {
  readonly editable?: boolean;
  /** What each `listAssets` call answers, by call number. */
  readonly answers?: readonly (() => Promise<AssetListing>)[];
  /** The layers the open level declares. None means no layer control. */
  readonly layers?: readonly LayerChoice[];
}

function createHarness(editable = true, options: HarnessOptions = {}) {
  const store = new EditorStore({
    api: unusedApi,
    epoch: "epoch-1",
    projectId: "project-1",
  });
  store.dispatch({ type: "level-opened", snapshot: snapshot() });
  const intents: string[] = [];
  let reads = 0;
  const listAssets = (): Promise<AssetListing> => {
    const answer = options.answers?.[reads];
    reads += 1;
    return answer === undefined ? Promise.resolve(LISTING) : answer();
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  const render = (): void => {
    act(() => {
      root.render(
        <Inspector
          store={store}
          editable={editable}
          inspectable={(typeId) =>
            typeId === "game.crate" ? CRATE : undefined
          }
          listAssets={listAssets}
          onSetParam={(id, field, value) => {
            intents.push(`set ${id}.${field}=${value}`);
          }}
          onResetParam={(id, field) => {
            intents.push(`reset ${id}.${field}`);
          }}
          onResetPlacement={(id) => {
            intents.push(`reset-placement ${id}`);
          }}
          onPickTarget={(id, field, types) => {
            intents.push(`pick ${id}.${field} of ${types.join(",")}`);
          }}
          onCancelPick={() => {
            intents.push("cancel-pick");
          }}
          onSetKey={(id, key) => {
            intents.push(`key ${id}=${key ?? "(none)"}`);
          }}
          layerChoices={() => options.layers ?? []}
          layerSorts={(layer) =>
            (options.layers ?? []).some(
              (choice) => choice.name === layer && choice.sorted,
            )
          }
          onSetLayer={(id, layer) => {
            intents.push(`layer ${id}=${layer ?? "(none)"}`);
          }}
          onOrder={(id, direction) => {
            intents.push(`order ${id} ${direction}`);
          }}
        />,
      );
    });
  };
  render();
  const select = (...ids: string[]): void => {
    act(() => {
      store.dispatch({ type: "selection-changed", ids });
    });
  };
  const report = (...diagnostics: EditorDiagnostic[]): void => {
    act(() => {
      store.dispatch({
        type: "diagnostics-replaced",
        source: "preview",
        diagnostics,
      });
    });
  };
  return {
    host,
    root,
    store,
    intents,
    select,
    report,
    reads: () => reads,
  };
}

function query<T extends Element>(host: HTMLElement, testId: string): T | null {
  return host.querySelector<T>(`[data-testid="${testId}"]`);
}

function field(host: HTMLElement): HTMLInputElement {
  return input(host, "field-texture");
}

function input(host: HTMLElement, testId: string): HTMLInputElement {
  const found = query<HTMLInputElement>(host, testId);
  if (!found) throw new Error(`No ${testId} control rendered.`);
  return found;
}

/** Pick an option the way a person does: set the value, then say it changed. */
function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Type into a React-controlled input: set the value the way the DOM does, then say so. */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Press a key, answering whether the field took it over from the browser. */
function key(input: HTMLInputElement, name: string): boolean {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    input.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

function blur(input: HTMLInputElement): void {
  act(() => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function click(host: HTMLElement, testId: string): void {
  const button = query<HTMLButtonElement>(host, testId);
  if (!button) throw new Error(`No ${testId} control rendered.`);
  act(() => {
    button.click();
  });
}

/** Let a resolved `listAssets` reach the field's state. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** The completion rows on screen, in order. */
function options(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[role="option"]')].map(
    (row) => row.textContent ?? "",
  );
}

/**
 * Press the mouse down the way a browser does.
 *
 * A browser moves focus on the mousedown's default action, so a handler that
 * does not refuse the event blurs the box — and the blur commits whatever was
 * typed. Re-creating that here is what makes these tests about the refusal
 * rather than about happy-dom's lack of focus handling.
 */
function pressMouse(target: Element, box: HTMLInputElement, button = 0): void {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  if (!event.defaultPrevented) blur(box);
}

/** Pick a completion row with the primary button. */
function pickRow(host: HTMLElement, box: HTMLInputElement, text: string): void {
  pressMouse(row(host, text), box);
}

function row(host: HTMLElement, text: string): Element {
  const found = [...host.querySelectorAll('[role="option"]')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!found) throw new Error(`No completion row ${text}.`);
  return found;
}

describe("Inspector", () => {
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

  it("renders for exactly one selected placement, and says why not otherwise", () => {
    expect(query(harness.host, "inspector-empty")?.textContent).toBe(
      "Nothing selected",
    );
    harness.select("crate", "moved");
    expect(query(harness.host, "inspector-empty")?.textContent).toBe(
      "2 placements selected",
    );
    expect(query(harness.host, "field-texture")).toBeNull();

    harness.select("crate");
    expect(query(harness.host, "inspector-empty")).toBeNull();
    expect(field(harness.host).value).toBe("sprites/crate.png");
  });

  it("names the placement and its type", () => {
    harness.select("alien");

    const text = query(harness.host, "inspector")?.textContent ?? "";
    expect(text).toContain("alien");
    expect(text).toContain("game.absent");
    expect(text).toContain("not in the project");
    expect(query(harness.host, "field-texture")).toBeNull();
  });

  describe("the asset field", () => {
    it("commits on Enter when the text differs, once", () => {
      harness.select("crate");
      const input = field(harness.host);
      type(input, "sprites/new.png");
      key(input, "Enter");
      // The blur that follows a commit finds nothing left to commit.
      blur(input);

      expect(harness.intents).toEqual(["set crate.texture=sprites/new.png"]);
    });

    it("commits on blur", () => {
      harness.select("crate");
      const input = field(harness.host);
      type(input, "sprites/blurred.png");
      blur(input);

      expect(harness.intents).toEqual([
        "set crate.texture=sprites/blurred.png",
      ]);
    });

    it("commits nothing when the text is what the document holds", () => {
      harness.select("crate");
      const input = field(harness.host);
      type(input, "sprites/other.png");
      type(input, "sprites/crate.png");
      key(input, "Enter");
      blur(input);

      expect(harness.intents).toEqual([]);
    });

    it("puts the document's value back on Escape", async () => {
      harness.select("crate");
      const input = field(harness.host);
      type(input, "sprites/typo.png");
      await settle();

      // Typing opens the completion list, so the first Escape puts the list
      // away and the second puts the text back.
      key(input, "Escape");
      key(input, "Escape");

      expect(input.value).toBe("sprites/crate.png");
      blur(input);
      expect(harness.intents).toEqual([]);
    });

    it("offers a reset only while the value differs from the default", () => {
      harness.select("crate");
      expect(
        query<HTMLButtonElement>(harness.host, "reset-texture")?.disabled,
      ).toBe(true);

      harness.select("moved");
      const reset = query<HTMLButtonElement>(harness.host, "reset-texture");
      expect(reset?.disabled).toBe(false);
      click(harness.host, "reset-texture");
      expect(harness.intents).toEqual(["reset moved.texture"]);
    });

    it("shows a finding at its own field", () => {
      harness.select("crate");
      harness.report(diagnostic("crate", "parameter-invalid", ["texture"]));

      expect(field(harness.host).getAttribute("aria-invalid")).toBe("true");
      expect(
        query(harness.host, "field-texture-diagnostics")?.textContent,
      ).toContain("parameter-invalid at crate");
      expect(query(harness.host, "placement-diagnostics")).toBeNull();
    });

    it("drops an uncommitted draft when the selection moves on", () => {
      harness.select("crate");
      type(field(harness.host), "sprites/half-typed.png");
      harness.select("moved");

      // The field is remounted per placement, so what was typed against
      // "crate" does not appear as "moved"'s value — and is not committed to
      // either.
      expect(field(harness.host).value).toBe("sprites/moved.png");
      harness.select("crate");
      expect(field(harness.host).value).toBe("sprites/crate.png");
      expect(harness.intents).toEqual([]);
    });

    it("writes nothing while editing is locked", () => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness(false);
      harness.select("moved");

      expect(field(harness.host).disabled).toBe(true);
      expect(
        query<HTMLButtonElement>(harness.host, "reset-texture")?.disabled,
      ).toBe(true);
    });
  });

  describe("the asset picker", () => {
    it("reads the project's assets when the list opens and lists them", async () => {
      harness.select("crate");
      click(harness.host, "field-texture-browse");
      await settle();

      expect(harness.reads()).toBe(1);
      expect(options(harness.host)).toEqual([...LISTING.paths]);
    });

    it("commits a picked row once, and nothing else", async () => {
      harness.select("crate");
      click(harness.host, "field-texture-browse");
      await settle();

      pickRow(harness.host, field(harness.host), "sprites/barrel.png");

      expect(harness.intents).toEqual(["set crate.texture=sprites/barrel.png"]);
      expect(query(harness.host, "field-texture-options")).toBeNull();
    });

    it("commits the row and not the filter that narrowed to it", async () => {
      harness.select("crate");
      const box = field(harness.host);
      type(box, "barrel");
      await settle();
      expect(options(harness.host)).toEqual(["sprites/barrel.png"]);

      pickRow(harness.host, box, "sprites/barrel.png");

      expect(harness.intents).toEqual(["set crate.texture=sprites/barrel.png"]);
    });

    it.each([
      ["the toggle", "field-texture-browse", "barrel"],
      [
        "the list, which is where its scrollbar and border are",
        "field-texture-options",
        "barrel",
      ],
      // The note is full panel width under the list, and it is on screen while
      // a read is in flight, when nothing matches, and when the cap cut the
      // rows short — which is exactly when the pointer is in the list.
      ["the note under the list", "field-texture-options-note", "zzz"],
    ])(
      "writes nothing when the mouse goes down on %s",
      async (_name, testId, typed) => {
        harness.select("crate");
        const box = field(harness.host);
        type(box, typed);
        await settle();
        const target = query(harness.host, testId);
        if (!target) throw new Error(`No ${testId} rendered.`);

        pressMouse(target, box);

        expect(harness.intents).toEqual([]);
      },
    );

    it("does not pick a row on a right-click", async () => {
      harness.select("crate");
      const box = field(harness.host);
      click(harness.host, "field-texture-browse");
      await settle();

      pressMouse(row(harness.host, "sprites/barrel.png"), box, 2);

      expect(harness.intents).toEqual([]);
      expect(query(harness.host, "field-texture-options")).not.toBeNull();
    });

    it("narrows on the typed text, ignoring case, and widens again", async () => {
      harness.select("crate");
      const box = field(harness.host);
      type(box, "crate");
      await settle();
      expect(options(harness.host)).toEqual(["sprites/CRATE.png"]);

      type(box, "");
      expect(options(harness.host)).toEqual([...LISTING.paths]);
      expect(harness.intents).toEqual([]);
    });

    it("commits the highlighted row on Enter, and the typed text without one", async () => {
      harness.select("crate");
      const box = field(harness.host);
      click(harness.host, "field-texture-browse");
      await settle();
      key(box, "ArrowDown");
      key(box, "Enter");

      expect(harness.intents).toEqual(["set crate.texture=sprites/barrel.png"]);

      type(box, "sprites/typed.png");
      await settle();
      key(box, "Enter");

      expect(harness.intents).toEqual([
        "set crate.texture=sprites/barrel.png",
        "set crate.texture=sprites/typed.png",
      ]);
    });

    it("leaves ArrowUp to the caret until the list is open", async () => {
      harness.select("crate");
      const box = field(harness.host);

      // Closed, ArrowUp is the box's own jump to the start of a long path.
      expect(key(box, "ArrowUp")).toBe(false);

      click(harness.host, "field-texture-browse");
      await settle();
      expect(key(box, "ArrowUp")).toBe(true);
    });

    it("puts the list away on Escape before it puts the text back", async () => {
      harness.select("crate");
      const box = field(harness.host);
      type(box, "sprites/half.png");
      await settle();
      expect(query(harness.host, "field-texture-options")).not.toBeNull();

      key(box, "Escape");
      expect(query(harness.host, "field-texture-options")).toBeNull();
      expect(box.value).toBe("sprites/half.png");

      key(box, "Escape");
      expect(box.value).toBe("sprites/crate.png");
      expect(harness.intents).toEqual([]);
    });

    it("re-reads on each open and keeps the rows it has while it waits", async () => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      let release = (): void => undefined;
      harness = createHarness(true, {
        answers: [
          () => Promise.resolve(LISTING),
          () =>
            new Promise<AssetListing>((resolve) => {
              release = () => {
                resolve({ paths: ["sprites/new.png"], truncated: false });
              };
            }),
        ],
      });
      harness.select("crate");

      click(harness.host, "field-texture-browse");
      await settle();
      expect(options(harness.host)).toEqual([...LISTING.paths]);

      click(harness.host, "field-texture-browse");
      click(harness.host, "field-texture-browse");
      expect(harness.reads()).toBe(2);
      // The second read has not answered, so the first read's rows are still
      // what the developer sees.
      expect(options(harness.host)).toEqual([...LISTING.paths]);
      expect(
        query(harness.host, "field-texture-options-note")?.textContent,
      ).toBe("Checking for new files…");

      act(() => {
        release();
      });
      await settle();
      expect(options(harness.host)).toEqual(["sprites/new.png"]);
    });

    it("says why it could not read, and still commits typed text", async () => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness(true, {
        answers: [() => Promise.reject(new Error("/assets failed."))],
      });
      harness.select("crate");

      click(harness.host, "field-texture-browse");
      await settle();

      expect(
        query(harness.host, "field-texture-options-note")?.textContent,
      ).toBe("Could not read the project's assets: /assets failed.");

      const box = field(harness.host);
      type(box, "sprites/typed.png");
      await settle();
      key(box, "Enter");
      expect(harness.intents).toEqual(["set crate.texture=sprites/typed.png"]);
    });

    it.each([
      [
        "a project with no assets",
        { paths: [], truncated: false },
        'No files matched. Check the "assets" globs in editor/config.ts.',
      ],
      [
        "a listing the cap cut short",
        { paths: ["sprites/a.png"], truncated: true },
        'Showing the first 1. Narrow the "assets" globs in editor/config.ts.',
      ],
    ])("names the config file for %s", async (_name, listing, note) => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness(true, {
        answers: [() => Promise.resolve(listing)],
      });
      harness.select("crate");

      click(harness.host, "field-texture-browse");
      await settle();

      expect(
        query(harness.host, "field-texture-options-note")?.textContent,
      ).toBe(note);
    });

    it("is offered by the asset box alone", () => {
      harness.select("named");

      for (const testId of [
        "placement-name",
        "placement-key",
        "transform-x",
        "transform-rotation",
      ]) {
        expect(query(harness.host, `${testId}-browse`)).toBeNull();
      }
      expect(options(harness.host)).toEqual([]);
    });

    it("is disabled while editing is locked", () => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness(false);
      harness.select("crate");

      expect(
        query<HTMLButtonElement>(harness.host, "field-texture-browse")
          ?.disabled,
      ).toBe(true);
      click(harness.host, "field-texture-browse");
      expect(harness.reads()).toBe(0);
      expect(query(harness.host, "field-texture-options")).toBeNull();
    });
  });

  describe("resetting every parameter", () => {
    it("is offered for a migration or parameter finding, after a confirmation", () => {
      harness.select("crate");
      harness.report(diagnostic("crate", "migration-failed", []));

      expect(
        query(harness.host, "placement-diagnostics")?.textContent,
      ).toContain("migration-failed at crate");
      click(harness.host, "reset-placement");
      const confirm = query(harness.host, "reset-placement-confirm");
      expect(confirm?.textContent).toContain("will be discarded");
      expect(harness.intents).toEqual([]);

      click(harness.host, "confirm-reset-placement");
      expect(harness.intents).toEqual(["reset-placement crate"]);
      expect(query(harness.host, "reset-placement-confirm")).toBeNull();
    });

    it("is offered for a parameter the declaration no longer has", () => {
      harness.select("crate");
      // A field with no control has nowhere else to hang a repair.
      harness.report(diagnostic("crate", "parameter-invalid", ["sprite"]));

      expect(
        query(harness.host, "placement-diagnostics")?.textContent,
      ).toContain("parameter-invalid at crate");
      expect(query(harness.host, "reset-placement")).not.toBeNull();
    });

    it("withdraws an open confirmation when the finding clears", () => {
      harness.select("crate");
      harness.report(diagnostic("crate", "migration-failed", []));
      click(harness.host, "reset-placement");
      expect(query(harness.host, "reset-placement-confirm")).not.toBeNull();

      // The finding goes away — an edit or an undo fixed it — and then a new
      // one arrives. The offer starts from the button, not from a dialog the
      // developer opened for the earlier finding.
      harness.report();
      expect(query(harness.host, "reset-placement-confirm")).toBeNull();
      harness.report(diagnostic("crate", "parameter-invalid", ["texture"]));
      expect(query(harness.host, "reset-placement-confirm")).toBeNull();
      expect(query(harness.host, "reset-placement")).not.toBeNull();
      expect(harness.intents).toEqual([]);
    });

    it("can be cancelled", () => {
      harness.select("crate");
      harness.report(diagnostic("crate", "parameter-invalid", ["texture"]));
      click(harness.host, "reset-placement");
      click(harness.host, "cancel-reset-placement");

      expect(query(harness.host, "reset-placement-confirm")).toBeNull();
      expect(query(harness.host, "reset-placement")).not.toBeNull();
      expect(harness.intents).toEqual([]);
    });

    it("is not offered for findings defaults cannot repair", () => {
      harness.select("crate");
      harness.report(
        diagnostic("crate", "asset-derivation-failed", []),
        diagnostic("crate", "placement-excluded"),
      );

      expect(
        query(harness.host, "placement-diagnostics")?.textContent,
      ).toContain("asset-derivation-failed at crate");
      expect(query(harness.host, "reset-placement")).toBeNull();
    });

    it("is not offered for a type the catalog does not have", () => {
      harness.select("alien");
      harness.report(diagnostic("alien", "unknown-type", []));

      expect(
        query(harness.host, "placement-diagnostics")?.textContent,
      ).toContain("unknown-type at alien");
      expect(query(harness.host, "reset-placement")).toBeNull();
    });

    it("ignores another placement's findings", () => {
      harness.select("crate");
      harness.report(diagnostic("moved", "migration-failed", []));

      expect(query(harness.host, "placement-diagnostics")).toBeNull();
      expect(query(harness.host, "reset-placement")).toBeNull();
    });
  });

  describe("the draw order section", () => {
    /** The layers the fixture project declares for this level. */
    const LAYERS: readonly LayerChoice[] = [
      { name: "bg", sorted: false },
      { name: "canopy", sorted: true },
    ];

    it("offers no layer control when the level declares no layers", () => {
      harness.select("crate");

      expect(query(harness.host, "placement-layer")).toBeNull();
      expect(query(harness.host, "order-front")).not.toBeNull();
    });

    it("offers the declared layers plus the default, and sends the pick", () => {
      const declared = createHarness(true, { layers: LAYERS });
      declared.select("crate");
      const select = query<HTMLSelectElement>(declared.host, "placement-layer");
      if (!select) throw new Error("No placement-layer control rendered.");

      expect([...select.options].map((option) => option.value)).toEqual([
        "default",
        "bg",
        "canopy",
      ]);
      expect(select.value).toBe("default");

      choose(select, "bg");
      expect(declared.intents).toEqual(["layer crate=bg"]);

      declared.root.unmount();
    });

    it("takes the layer away when the default is picked again", () => {
      const declared = createHarness(true, { layers: LAYERS });
      declared.select("layered");
      const select = query<HTMLSelectElement>(declared.host, "placement-layer");
      if (!select) throw new Error("No placement-layer control rendered.");
      expect(select.value).toBe("canopy");

      choose(select, "default");
      expect(declared.intents).toEqual(["layer layered=(none)"]);

      declared.root.unmount();
    });

    it("sends one ordering intent per control", () => {
      harness.select("crate");

      click(harness.host, "order-front");
      click(harness.host, "order-forward");
      click(harness.host, "order-backward");
      click(harness.host, "order-back");

      expect(harness.intents).toEqual([
        "order crate front",
        "order crate forward",
        "order crate backward",
        "order crate back",
      ]);
    });

    it("switches the ordering off on a layer that sorts, and says why", () => {
      const declared = createHarness(true, { layers: LAYERS });
      declared.select("layered");

      const button = query<HTMLButtonElement>(declared.host, "order-front");
      expect(button?.disabled).toBe(true);
      expect(query(declared.host, "order-sorted-note")?.textContent).toContain(
        "sorts what it draws",
      );

      declared.root.unmount();
    });
  });

  describe("the key section", () => {
    it("is last in the panel, and its box is the last control in it", () => {
      harness.select("named");
      harness.report(diagnostic("named", "migration-failed", []));

      const controls = [
        ...harness.host.querySelectorAll<HTMLElement>(
          '[data-testid="inspector"] input, [data-testid="inspector"] button',
        ),
      ];
      expect(controls.at(-1)?.dataset["testid"]).toBe("placement-key");
    });

    it("shows the scene key a game looks the entity up by", () => {
      harness.select("crate");
      expect(query(harness.host, "scene-key")?.textContent).toBe(
        "<namespace>/crate",
      );

      harness.select("named");
      expect(query(harness.host, "scene-key")?.textContent).toBe(
        "<namespace>/door",
      );
      expect(input(harness.host, "placement-key").placeholder).toBe("named");
    });

    it("commits a key on Enter, and takes it away when the box is emptied", () => {
      harness.select("crate");
      const box = input(harness.host, "placement-key");
      type(box, "spawn");
      key(box, "Enter");

      expect(harness.intents).toEqual(["key crate=spawn"]);

      harness.select("nick");
      const held = input(harness.host, "placement-key");
      type(held, "");
      blur(held);

      expect(harness.intents).toEqual(["key crate=spawn", "key nick=(none)"]);
    });

    it("names the placement already holding a key, and sends nothing", () => {
      harness.select("crate");
      const box = input(harness.host, "placement-key");
      type(box, "door");
      key(box, "Enter");

      expect(box.value).toBe("door");
      expect(box.getAttribute("aria-invalid")).toBe("true");
      expect(query(harness.host, "placement-key-reason")?.textContent).toBe(
        "Placement named already uses that key.",
      );
      expect(harness.intents).toEqual([]);

      type(box, "doorway");
      expect(query(harness.host, "placement-key-reason")).toBeNull();
      key(box, "Enter");
      expect(harness.intents).toEqual(["key crate=doorway"]);
    });

    it("refuses a key that collides with another placement's id", () => {
      harness.select("crate");
      const box = input(harness.host, "placement-key");
      type(box, "moved");
      key(box, "Enter");

      expect(query(harness.host, "placement-key-reason")?.textContent).toBe(
        "Placement moved already uses that key.",
      );
      expect(harness.intents).toEqual([]);
    });

    it("takes the placement's own id as its key", () => {
      harness.select("crate");
      const box = input(harness.host, "placement-key");
      type(box, "crate");
      key(box, "Enter");

      // The scene key it would derive is the one it already derives, so the
      // placement in the way is itself and there is nothing to refuse.
      expect(query(harness.host, "placement-key-reason")).toBeNull();
      expect(harness.intents).toEqual(["key crate=crate"]);
    });

    it("refuses an emptied key whose id another placement already derives", () => {
      harness.select("named");
      const box = input(harness.host, "placement-key");
      type(box, "");
      key(box, "Enter");

      // Emptying it would derive "named", which "nick" holds as its key.
      expect(box.value).toBe("");
      expect(query(harness.host, "placement-key-reason")?.textContent).toBe(
        "Placement nick already uses that key.",
      );
      expect(harness.intents).toEqual([]);
    });

    it("drops an uncommitted draft when the selection moves on", () => {
      harness.select("named");
      type(input(harness.host, "placement-key"), "half");
      harness.select("crate");

      expect(input(harness.host, "placement-key").value).toBe("");
      harness.select("named");
      expect(input(harness.host, "placement-key").value).toBe("door");
      expect(harness.intents).toEqual([]);
    });

    it("puts the document's value back on Escape", () => {
      harness.select("named");
      const box = input(harness.host, "placement-key");
      type(box, "gate");
      key(box, "Escape");

      expect(box.value).toBe("door");
      blur(box);
      expect(harness.intents).toEqual([]);
    });

    it("writes nothing while editing is locked", () => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness(false);
      harness.select("named");

      expect(input(harness.host, "placement-key").disabled).toBe(true);
    });
  });

  it("edits the key of a type the catalog lacks", () => {
    harness.select("alien");

    expect(query(harness.host, "placement-key")).not.toBeNull();
    expect(query(harness.host, "field-texture")).toBeNull();
  });
});

describe("a parameter that points at another placement", () => {
  const SWITCH: InspectableType = {
    typeId: "game.switch",
    fields: [
      {
        name: "door",
        kind: "entityRef",
        types: ["game.crate"],
        optional: false,
        defaultValue: null,
      },
      {
        name: "chime",
        kind: "entityRef",
        types: ["game.chime"],
        optional: true,
        defaultValue: null,
      },
    ],
  };

  const REFERENCE_DOCUMENT: LevelDocument = {
    format: "yage-level",
    version: 1,
    id: "forest",
    metadata: {},
    entities: [
      placement("c1", { name: "Left crate" }),
      placement("c2", { key: "right-crate" }),
      // Two crates a person would read the same, so both take their id.
      placement("c3", { name: "Twin" }),
      placement("c4", { name: "Twin" }),
      placement("ch1", { type: "game.chime", params: {} }),
      placement("s1", {
        type: "game.switch",
        params: { door: "c1", chime: null },
      }),
    ],
    extensions: {},
  };

  function referenceHarness(
    held: {
      door?: string | null;
      chime?: string | null;
    },
    editable = true,
  ) {
    const entities = REFERENCE_DOCUMENT.entities.map((one) =>
      one.id === "s1"
        ? {
            ...one,
            params: {
              door: held.door === undefined ? "c1" : held.door,
              chime: held.chime ?? null,
            },
          }
        : one,
    );
    const store = new EditorStore({
      api: unusedApi,
      epoch: "epoch-1",
      projectId: "project-1",
    });
    store.dispatch({
      type: "level-opened",
      snapshot: {
        ...snapshot(),
        document: { ...REFERENCE_DOCUMENT, entities },
      },
    });
    const intents: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <Inspector
          store={store}
          editable={editable}
          inspectable={(typeId) =>
            typeId === "game.switch" ? SWITCH : undefined
          }
          listAssets={() => Promise.resolve(LISTING)}
          onSetParam={(id, field, value) => {
            intents.push(`set ${id}.${field}=${String(value)}`);
          }}
          onResetParam={() => undefined}
          onResetPlacement={() => undefined}
          onPickTarget={(id, field, types) => {
            intents.push(`pick ${id}.${field} of ${types.join(",")}`);
          }}
          onCancelPick={() => {
            intents.push("cancel-pick");
          }}
          onSetKey={() => undefined}
          layerChoices={() => []}
          layerSorts={() => false}
          onSetLayer={() => undefined}
          onOrder={() => undefined}
        />,
      );
    });
    act(() => {
      store.dispatch({ type: "selection-changed", ids: ["s1"] });
    });
    const report = (...diagnostics: EditorDiagnostic[]): void => {
      act(() => {
        store.dispatch({
          type: "diagnostics-replaced",
          source: "preview",
          diagnostics,
        });
      });
    };
    /** Arm the mode for one of this switch's fields, as the button does. */
    const arm = (field: string): void => {
      act(() => {
        store.dispatch({
          type: "pick-started",
          pick: {
            placementId: "s1",
            field,
            types: field === "door" ? ["game.crate"] : ["game.chime"],
          },
        });
      });
    };
    return { host, root, store, intents, report, arm };
  }

  let harness: ReturnType<typeof referenceHarness>;

  afterEach(() => {
    act(() => {
      harness.root.unmount();
    });
    harness.host.remove();
  });

  function control(testId: string): HTMLSelectElement {
    const found = query<HTMLSelectElement>(harness.host, testId);
    if (!found) throw new Error(`No ${testId} control rendered.`);
    return found;
  }

  function labels(select: HTMLSelectElement): string[] {
    return [...select.options].map((option) => option.textContent ?? "");
  }

  it("offers only the placements of an accepted type", () => {
    harness = referenceHarness({});

    // The four crates, and neither the chime nor the switch itself.
    expect(labels(control("field-door"))).toEqual([
      "Left crate",
      "right-crate",
      "Twin (c3)",
      "Twin (c4)",
    ]);
  });

  it("names a placement by its name, else its key, else its id", () => {
    harness = referenceHarness({});

    expect(labels(control("field-chime"))).toEqual(["Choose a target", "ch1"]);
  });

  it("sends the placement id of the target that was picked", () => {
    harness = referenceHarness({});

    choose(control("field-door"), "c2");

    expect(harness.intents).toEqual(["set s1.door=c2"]);
  });

  it("clears an optional reference and offers no Clear for a required one", () => {
    harness = referenceHarness({ chime: "ch1" });

    expect(query(harness.host, "clear-door")).toBeNull();
    const clear = query<HTMLButtonElement>(harness.host, "clear-chime");
    expect(clear?.disabled).toBe(false);
    act(() => {
      clear?.click();
    });

    expect(harness.intents).toEqual(["set s1.chime=null"]);
  });

  it("switches Clear off while nothing is chosen", () => {
    harness = referenceHarness({});

    expect(
      query<HTMLButtonElement>(harness.host, "clear-chime")?.disabled,
    ).toBe(true);
  });

  it("keeps a held id that names no placement, as its own row", () => {
    harness = referenceHarness({ door: "gone" });

    const select = control("field-door");
    expect(select.value).toBe("gone");
    expect(labels(select)[0]).toBe("Missing: gone");
  });

  it("keeps a held id of an unaccepted type, and says so", () => {
    harness = referenceHarness({ door: "ch1" });

    const select = control("field-door");
    expect(select.value).toBe("ch1");
    expect(labels(select)[0]).toBe("Wrong type: ch1");
  });

  it("switches the control off and says why when nothing fits", () => {
    harness = referenceHarness({ chime: null });
    act(() => {
      harness.store.dispatch({
        type: "level-opened",
        snapshot: {
          ...snapshot(),
          document: {
            ...REFERENCE_DOCUMENT,
            entities: [
              placement("s1", {
                type: "game.switch",
                params: { door: null, chime: null },
              }),
            ],
          },
        },
      });
      harness.store.dispatch({ type: "selection-changed", ids: ["s1"] });
    });

    expect(control("field-door").disabled).toBe(true);
    expect(query(harness.host, "field-door-note")?.textContent).toBe(
      "No game.crate in this level.",
    );
  });

  it("shows a finding about the reference under its own field", () => {
    harness = referenceHarness({ door: "gone" });
    harness.report(diagnostic("s1", "reference-missing", ["door"]));

    expect(
      query(harness.host, "field-door-diagnostics")?.textContent,
    ).toContain("reference-missing at s1");
  });

  it("marks the control itself invalid, not only the text under it", () => {
    harness = referenceHarness({ door: "gone" });
    harness.report(diagnostic("s1", "reference-missing", ["door"]));

    // A target that is gone is a finding on every reference, optional or not:
    // an optional slot's empty value is null, never an id pointing at nothing.
    expect(control("field-door").getAttribute("aria-invalid")).toBe("true");
  });

  it("waits for a target when Pick is pressed, and stops on a second press", () => {
    harness = referenceHarness({});
    const pick = query<HTMLButtonElement>(harness.host, "pick-door");
    expect(pick?.getAttribute("aria-pressed")).toBe("false");
    expect(query(harness.host, "field-door-picking")).toBeNull();

    act(() => {
      pick?.click();
    });
    expect(harness.intents).toEqual(["pick s1.door of game.crate"]);

    harness.arm("door");
    expect(
      query<HTMLButtonElement>(harness.host, "pick-door")?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(query(harness.host, "field-door-picking")?.textContent).toContain(
      "Esc cancels",
    );

    act(() => {
      query<HTMLButtonElement>(harness.host, "pick-door")?.click();
    });
    expect(harness.intents).toEqual([
      "pick s1.door of game.crate",
      "cancel-pick",
    ]);
  });

  it("leaves the other field's button unpressed", () => {
    harness = referenceHarness({});
    harness.arm("door");

    expect(
      query<HTMLButtonElement>(harness.host, "pick-chime")?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");
    expect(query(harness.host, "field-chime-picking")).toBeNull();
  });

  it("switches Pick off on a read-only level and when nothing fits", () => {
    harness = referenceHarness({}, false);
    expect(query<HTMLButtonElement>(harness.host, "pick-door")?.disabled).toBe(
      true,
    );

    act(() => {
      harness.root.unmount();
    });
    harness.host.remove();
    harness = referenceHarness({});
    act(() => {
      harness.store.dispatch({
        type: "level-opened",
        snapshot: {
          ...snapshot(),
          document: {
            ...REFERENCE_DOCUMENT,
            entities: [
              placement("s1", {
                type: "game.switch",
                params: { door: null, chime: null },
              }),
            ],
          },
        },
      });
      harness.store.dispatch({ type: "selection-changed", ids: ["s1"] });
    });

    expect(query<HTMLButtonElement>(harness.host, "pick-door")?.disabled).toBe(
      true,
    );
  });

  it("stops waiting when a row is chosen from the list instead", () => {
    harness = referenceHarness({});
    harness.arm("door");

    choose(control("field-door"), "c2");

    expect(harness.intents).toEqual(["cancel-pick", "set s1.door=c2"]);
  });

  it("leaves a reference with no finding unmarked", () => {
    harness = referenceHarness({ door: "d1" });

    expect(control("field-door").getAttribute("aria-invalid")).toBe("false");
  });
});

describe("the plain parameter kinds", () => {
  const SLIME: InspectableType = {
    typeId: "game.slime",
    fields: [
      {
        name: "speed",
        kind: "number",
        optional: false,
        min: 5,
        max: 200,
        step: 5,
        defaultValue: 40,
      },
      {
        name: "coins",
        kind: "integer",
        optional: false,
        min: 0,
        defaultValue: 3,
      },
      { name: "locked", kind: "boolean", optional: false, defaultValue: true },
      { name: "awake", kind: "boolean", optional: true, defaultValue: false },
      { name: "title", kind: "string", optional: false, defaultValue: "Slime" },
      {
        name: "notes",
        kind: "string",
        optional: true,
        multiline: true,
        defaultValue: "",
      },
      {
        name: "facing",
        kind: "select",
        optional: false,
        options: ["left", "right"],
        defaultValue: "left",
      },
      {
        name: "mood",
        kind: "select",
        optional: true,
        options: ["calm", "angry"],
        defaultValue: "calm",
      },
    ],
  };

  const AUTHORED = {
    speed: 40,
    coins: 3,
    locked: true,
    awake: null,
    title: "Slime",
    notes: null,
    facing: "left",
    mood: null,
  };

  function plainHarness(held: Record<string, unknown> = {}, editable = true) {
    const store = new EditorStore({
      api: unusedApi,
      epoch: "epoch-1",
      projectId: "project-1",
    });
    store.dispatch({
      type: "level-opened",
      snapshot: {
        ...snapshot(),
        document: {
          ...DOCUMENT,
          entities: [
            placement("s1", {
              type: "game.slime",
              params: { ...AUTHORED, ...held } as LevelPlacement["params"],
            }),
          ],
        },
      },
    });
    const intents: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <Inspector
          store={store}
          editable={editable}
          inspectable={(typeId) =>
            typeId === "game.slime" ? SLIME : undefined
          }
          listAssets={() => Promise.resolve(LISTING)}
          onSetParam={(id, field, value) => {
            // Stringified as JSON, so a typed 50 and a typed "50" read apart.
            intents.push(`set ${id}.${field}=${JSON.stringify(value)}`);
          }}
          onResetParam={() => undefined}
          onResetPlacement={() => undefined}
          onPickTarget={() => undefined}
          onCancelPick={() => undefined}
          onSetKey={() => undefined}
          layerChoices={() => []}
          layerSorts={() => false}
          onSetLayer={() => undefined}
          onOrder={() => undefined}
        />,
      );
    });
    act(() => {
      store.dispatch({ type: "selection-changed", ids: ["s1"] });
    });
    const report = (...diagnostics: EditorDiagnostic[]): void => {
      act(() => {
        store.dispatch({
          type: "diagnostics-replaced",
          source: "preview",
          diagnostics,
        });
      });
    };
    return { host, root, intents, report };
  }

  let harness: ReturnType<typeof plainHarness>;

  afterEach(() => {
    act(() => {
      harness.root.unmount();
    });
    harness.host.remove();
  });

  function control<T extends Element>(testId: string): T {
    const found = query<T>(harness.host, testId);
    if (!found) throw new Error(`No ${testId} control rendered.`);
    return found;
  }

  it("renders a control of its own for every kind", () => {
    harness = plainHarness();

    expect(control("field-speed").tagName).toBe("INPUT");
    expect(control("field-coins").tagName).toBe("INPUT");
    expect(control<HTMLInputElement>("field-locked").type).toBe("checkbox");
    expect(control("field-title").tagName).toBe("INPUT");
    expect(control("field-notes").tagName).toBe("TEXTAREA");
    expect(control("field-facing").tagName).toBe("SELECT");
  });

  it("shows what the placement holds", () => {
    harness = plainHarness({ speed: 65, title: "Big slime" });

    expect(control<HTMLInputElement>("field-speed").value).toBe("65");
    expect(control<HTMLInputElement>("field-title").value).toBe("Big slime");
    expect(control<HTMLInputElement>("field-locked").checked).toBe(true);
    expect(control<HTMLSelectElement>("field-facing").value).toBe("left");
  });

  it("commits a typed number as a number", () => {
    harness = plainHarness();
    const box = control<HTMLInputElement>("field-speed");

    type(box, "65");
    key(box, "Enter");

    expect(harness.intents).toEqual(["set s1.speed=65"]);
  });

  it("commits typed text as text", () => {
    harness = plainHarness();
    const box = control<HTMLInputElement>("field-title");

    type(box, "Big slime");
    blur(box);

    expect(harness.intents).toEqual(['set s1.title="Big slime"']);
  });

  it("keeps an out-of-range number in the box and sends nothing", () => {
    harness = plainHarness();
    const box = control<HTMLInputElement>("field-speed");

    type(box, "999");
    key(box, "Enter");

    expect(harness.intents).toEqual([]);
    expect(box.value).toBe("999");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(query(harness.host, "field-speed-reason")?.textContent).toBe(
      "Type 200 or less.",
    );
  });

  it("keeps a fraction out of a whole-number field", () => {
    harness = plainHarness();
    const box = control<HTMLInputElement>("field-coins");

    type(box, "2.5");
    key(box, "Enter");

    expect(harness.intents).toEqual([]);
    expect(query(harness.host, "field-coins-reason")?.textContent).toBe(
      "Type a whole number.",
    );

    type(box, "2");
    key(box, "Enter");

    expect(harness.intents).toEqual(["set s1.coins=2"]);
  });

  it("steps a number by its declared step and a whole number by one", () => {
    harness = plainHarness();
    const speed = control<HTMLInputElement>("field-speed");
    key(speed, "ArrowUp");
    expect(speed.value).toBe("45");

    const coins = control<HTMLInputElement>("field-coins");
    key(coins, "ArrowDown");
    expect(coins.value).toBe("2");
  });

  it("holds a step inside the range the field declared", () => {
    harness = plainHarness({ speed: 198 });
    const speed = control<HTMLInputElement>("field-speed");

    key(speed, "ArrowUp");

    expect(speed.value).toBe("200");
  });

  it("toggles a switch", () => {
    harness = plainHarness();
    const box = control<HTMLInputElement>("field-locked");

    act(() => {
      box.click();
    });

    expect(harness.intents).toEqual(["set s1.locked=false"]);
  });

  it("draws an optional switch that holds nothing as neither on nor off", () => {
    harness = plainHarness();

    // A cleared switch is not the same value as an unticked one, and the box
    // says so rather than reading as false.
    expect(control<HTMLInputElement>("field-awake").indeterminate).toBe(true);
    expect(control<HTMLInputElement>("field-locked").indeterminate).toBe(false);

    act(() => {
      control<HTMLInputElement>("field-awake").click();
    });

    expect(harness.intents).toEqual(["set s1.awake=true"]);
  });

  it("lists a choice's values with the held one chosen", () => {
    harness = plainHarness({ facing: "right" });
    const list = control<HTMLSelectElement>("field-facing");

    expect([...list.options].map((option) => option.value)).toEqual([
      "left",
      "right",
    ]);
    expect(list.value).toBe("right");

    choose(list, "left");

    expect(harness.intents).toEqual(['set s1.facing="left"']);
  });

  it("keeps a held choice the list no longer offers, as its own row", () => {
    harness = plainHarness({ facing: "up" });
    const list = control<HTMLSelectElement>("field-facing");

    expect([...list.options].map((option) => option.textContent)).toEqual([
      "Not offered: up",
      "left",
      "right",
    ]);
    expect(list.value).toBe("up");
  });

  it("offers Clear only on an optional field, and sends nothing at all", () => {
    harness = plainHarness({ mood: "angry", notes: "hello", awake: true });

    expect(query(harness.host, "clear-facing")).toBeNull();
    expect(query(harness.host, "clear-speed")).toBeNull();
    click(harness.host, "clear-mood");
    click(harness.host, "clear-notes");
    click(harness.host, "clear-awake");

    expect(harness.intents).toEqual([
      "set s1.mood=null",
      "set s1.notes=null",
      "set s1.awake=null",
    ]);
  });

  it("switches Clear off while the field already holds nothing", () => {
    harness = plainHarness();

    expect(query<HTMLButtonElement>(harness.host, "clear-mood")?.disabled).toBe(
      true,
    );
    expect(
      query<HTMLButtonElement>(harness.host, "clear-notes")?.disabled,
    ).toBe(true);
  });

  it("shows a finding under the field it is about, and marks the control", () => {
    harness = plainHarness();
    harness.report(diagnostic("s1", "parameter-invalid", ["speed"]));

    expect(
      query(harness.host, "field-speed-diagnostics")?.textContent,
    ).toContain("parameter-invalid at s1");
    expect(control("field-speed").getAttribute("aria-invalid")).toBe("true");
    expect(query(harness.host, "field-title-diagnostics")).toBeNull();
  });

  it("switches every control off on a level that cannot be edited", () => {
    harness = plainHarness({}, false);

    expect(control<HTMLInputElement>("field-speed").disabled).toBe(true);
    expect(control<HTMLInputElement>("field-locked").disabled).toBe(true);
    expect(control<HTMLSelectElement>("field-facing").disabled).toBe(true);
    expect(query<HTMLButtonElement>(harness.host, "clear-mood")?.disabled).toBe(
      true,
    );
  });
});

describe("a parameter holding a pair of numbers", () => {
  const SLIME: InspectableType = {
    typeId: "game.slime",
    fields: [
      {
        name: "drift",
        kind: "vec2",
        optional: false,
        defaultValue: { x: 12, y: -4 },
      },
      {
        name: "patrolEnd",
        kind: "point",
        optional: false,
        relative: true,
        defaultValue: { x: 120, y: 0 },
      },
      {
        name: "home",
        kind: "point",
        optional: true,
        relative: false,
        defaultValue: { x: 0, y: 0 },
      },
    ],
  };

  const AUTHORED = {
    drift: { x: 12, y: -4 },
    patrolEnd: { x: 120, y: 0 },
    home: null,
  };

  function pairHarness(held: Record<string, unknown> = {}) {
    const store = new EditorStore({
      api: unusedApi,
      epoch: "epoch-1",
      projectId: "project-1",
    });
    store.dispatch({
      type: "level-opened",
      snapshot: {
        ...snapshot(),
        document: {
          ...DOCUMENT,
          entities: [
            placement("s1", {
              type: "game.slime",
              params: { ...AUTHORED, ...held } as LevelPlacement["params"],
            }),
          ],
        },
      },
    });
    // Off, so the drag case asserts where the pointer went rather than where a
    // lattice rounded it. The lattice has its own cases in the preview.
    store.dispatch({ type: "snap-toggled" });
    const intents: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <Inspector
          store={store}
          editable
          inspectable={(typeId) =>
            typeId === "game.slime" ? SLIME : undefined
          }
          listAssets={() => Promise.resolve(LISTING)}
          onSetParam={(id, field, value) => {
            intents.push(`set ${id}.${field}=${JSON.stringify(value)}`);
          }}
          onResetParam={() => undefined}
          onResetPlacement={() => undefined}
          onPickTarget={() => undefined}
          onCancelPick={() => undefined}
          onSetKey={() => undefined}
          layerChoices={() => []}
          layerSorts={() => false}
          onSetLayer={() => undefined}
          onOrder={() => undefined}
        />,
      );
    });
    act(() => {
      store.dispatch({ type: "selection-changed", ids: ["s1"] });
    });
    return { host, root, store, intents };
  }

  let harness: ReturnType<typeof pairHarness>;

  afterEach(() => {
    act(() => {
      harness.root.unmount();
    });
    harness.host.remove();
  });

  function box(testId: string): HTMLInputElement {
    return input(harness.host, testId);
  }

  it("draws one box per member of both kinds", () => {
    harness = pairHarness();

    expect(box("field-drift-x").value).toBe("12");
    expect(box("field-drift-y").value).toBe("-4");
    expect(box("field-patrolEnd-x").value).toBe("120");
    expect(box("field-patrolEnd-y").value).toBe("0");
  });

  it("commits the whole value when one box is typed into", () => {
    harness = pairHarness();

    type(box("field-patrolEnd-x"), "160");
    blur(box("field-patrolEnd-x"));

    expect(harness.intents).toEqual(['set s1.patrolEnd={"x":160,"y":0}']);
  });

  it("refuses an entry that is not a number and writes nothing", () => {
    harness = pairHarness();

    type(box("field-drift-y"), "over there");
    blur(box("field-drift-y"));

    expect(harness.intents).toEqual([]);
    expect(harness.host.textContent).toContain("Type a number.");
  });

  it("takes the other member from the default when the field holds nothing", () => {
    harness = pairHarness();

    expect(box("field-home-x").value).toBe("");
    expect(box("field-home-x").placeholder).toBe("None");

    type(box("field-home-x"), "48");
    blur(box("field-home-x"));

    expect(harness.intents).toEqual(['set s1.home={"x":48,"y":0}']);
  });

  it("empties an optional pair through Clear, and offers none for a required one", () => {
    harness = pairHarness({ home: { x: 3, y: 4 } });

    click(harness.host, "clear-home");

    expect(harness.intents).toEqual(["set s1.home=null"]);
    expect(query(harness.host, "clear-patrolEnd")).toBeNull();
  });

  it("steps one box by the arrow keys", () => {
    harness = pairHarness();

    expect(key(box("field-drift-x"), "ArrowUp")).toBe(true);
    blur(box("field-drift-x"));

    expect(harness.intents).toEqual(['set s1.drift={"x":13,"y":-4}']);
  });

  it("follows the handle while its value is being dragged", () => {
    harness = pairHarness();
    act(() => {
      harness.store.dispatch({
        type: "param-drag-started",
        drag: {
          id: "s1",
          field: "patrolEnd",
          kind: "point",
          grip: "body",
          relative: true,
          from: { x: 120, y: 0 },
          origin: { x: 120, y: 0 },
          current: { x: 120, y: 0 },
          constrained: false,
          suspended: false,
        },
      });
    });
    act(() => {
      harness.store.dispatch({
        type: "param-drag-moved",
        current: { x: 150, y: 20 },
        constrained: false,
        suspended: false,
      });
    });

    expect(box("field-patrolEnd-x").value).toBe("150");
    expect(box("field-patrolEnd-y").value).toBe("20");
    // Nothing is written until the release settles it.
    expect(harness.intents).toEqual([]);
  });
});
