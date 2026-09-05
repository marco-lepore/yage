// @vitest-environment happy-dom
import type {
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftSnapshot } from "../../shared/protocol/index.js";
import { EditorStore, type DraftApi } from "../store/index.js";
import { ControlBar } from "./ControlBar.js";

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

function createHarness(editable = true) {
  const store = new EditorStore({
    api: unusedApi,
    epoch: "epoch-1",
    projectId: "project-1",
    levels: [],
  });
  store.dispatch({ type: "level-opened", snapshot: snapshot() });
  const intents: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  act(() => {
    root.render(
      <ControlBar
        store={store}
        editable={editable}
        onSetName={(id, name) => {
          intents.push(`name ${id}=${name ?? "(none)"}`);
        }}
        onSetPose={(id, transform) => {
          intents.push(`pose ${id} ${poseText(transform)}`);
        }}
        onDraftPose={(id, component, value) => {
          intents.push(`draft ${id}.${component}=${String(value)}`);
        }}
        onCancelPoseDraft={() => {
          intents.push("cancel-draft");
        }}
      />,
    );
  });
  const select = (...ids: string[]): void => {
    act(() => {
      store.dispatch({ type: "selection-changed", ids });
    });
  };
  return { host, root, store, intents, select };
}

/** A whole transform in one line, so a commit can be asserted in one string. */
function poseText(transform: LevelTransform): string {
  return (
    `${String(transform.position.x)},${String(transform.position.y)} ` +
    `r=${String(transform.rotation)} ` +
    `s=${String(transform.scale.x)},${String(transform.scale.y)}`
  );
}

function query<T extends Element>(host: HTMLElement, testId: string): T | null {
  return host.querySelector<T>(`[data-testid="${testId}"]`);
}

function input(host: HTMLElement, testId: string): HTMLInputElement {
  const found = query<HTMLInputElement>(host, testId);
  if (!found) throw new Error(`No ${testId} control rendered.`);
  return found;
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

/**
 * Press an arrow with the modifiers the transform ladder reads: Shift for the
 * coarse unit, Alt for the fine one.
 */
function arrow(
  box: HTMLInputElement,
  name: "ArrowUp" | "ArrowDown",
  modifiers: { shiftKey?: boolean; altKey?: boolean } = {},
): void {
  act(() => {
    box.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      }),
    );
  });
}

/** Drag the word beside a box, which is where a scrub lives. */
function scrub(host: HTMLElement, testId: string, pixels: number): void {
  const label = query<HTMLElement>(host, `${testId}-label`);
  if (!label) throw new Error(`No ${testId} label rendered.`);
  const send = (type: string, clientX: number): void => {
    act(() => {
      label.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          clientX,
        }),
      );
    });
  };
  send("pointerdown", 200);
  send("pointermove", 200 + pixels);
  send("pointerup", 200 + pixels);
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

describe("ControlBar", () => {
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

  it("carries the boxes for exactly one selected placement, and says why not otherwise", () => {
    expect(query(harness.host, "control-bar-empty")?.textContent).toBe(
      "Nothing selected",
    );
    harness.select("crate", "moved");
    expect(query(harness.host, "control-bar-empty")?.textContent).toBe(
      "2 placements selected",
    );
    expect(query(harness.host, "transform-x")).toBeNull();

    harness.select("crate");
    expect(query(harness.host, "control-bar-empty")).toBeNull();
    expect(input(harness.host, "transform-x").value).toBe("0");
  });

  it("names and poses a placement whose type the catalog lacks", () => {
    harness.select("alien");

    expect(query(harness.host, "placement-name")).not.toBeNull();
    expect(query(harness.host, "transform-x")).not.toBeNull();
  });

  describe("the name field", () => {
    it("commits on Enter when the text differs, once", () => {
      harness.select("crate");
      const box = input(harness.host, "placement-name");
      type(box, "Left crate");
      key(box, "Enter");
      blur(box);

      expect(harness.intents).toEqual(["name crate=Left crate"]);
    });

    it("commits on blur", () => {
      harness.select("crate");
      const box = input(harness.host, "placement-name");
      type(box, "Blurred");
      blur(box);

      expect(harness.intents).toEqual(["name crate=Blurred"]);
    });

    it("commits nothing when the text is what the document holds", () => {
      harness.select("named");
      const box = input(harness.host, "placement-name");
      type(box, "Something else");
      type(box, "Left crate");
      key(box, "Enter");
      blur(box);

      expect(harness.intents).toEqual([]);
    });

    it("puts the document's value back on Escape", () => {
      harness.select("named");
      const box = input(harness.host, "placement-name");
      type(box, "Typo");
      key(box, "Escape");

      expect(box.value).toBe("Left crate");
      blur(box);
      expect(harness.intents).toEqual([]);
    });

    it("drops an uncommitted draft when the selection moves on", () => {
      harness.select("crate");
      type(input(harness.host, "placement-name"), "Half typed");
      harness.select("named");

      expect(input(harness.host, "placement-name").value).toBe("Left crate");
      harness.select("crate");
      expect(input(harness.host, "placement-name").value).toBe("");
      expect(harness.intents).toEqual([]);
    });

    it("shows the type as the placeholder while there is no name", () => {
      harness.select("crate");

      expect(input(harness.host, "placement-name").placeholder).toBe(
        "game.crate",
      );
    });

    it("takes the name away when the box is emptied", () => {
      harness.select("named");
      const box = input(harness.host, "placement-name");
      type(box, "   ");
      key(box, "Enter");

      expect(harness.intents).toEqual(["name named=(none)"]);
    });

    it("writes nothing while editing is locked", () => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness(false);
      harness.select("named");

      expect(input(harness.host, "placement-name").disabled).toBe(true);
    });
  });

  describe("the transform boxes", () => {
    it("shows the five numbers of the local transform, in order", () => {
      harness.select("named");

      const boxes = [
        ...harness.host.querySelectorAll<HTMLInputElement>(
          '[data-testid="transform-fields"] input',
        ),
      ];
      expect(boxes.map((box) => box.dataset["testid"])).toEqual([
        "transform-x",
        "transform-y",
        "transform-rotation",
        "transform-scale-x",
        "transform-scale-y",
      ]);
      expect(boxes.map((box) => box.value)).toEqual([
        "12",
        "-4",
        "45",
        "2",
        "0.5",
      ]);
    });

    it("shows the drag's numbers while it runs, and the document's after", () => {
      harness.select("named");
      act(() => {
        harness.store.dispatch({
          type: "gesture-started",
          gesture: {
            kind: "translate",
            spin: 0,
            reference: { x: 1, y: 1, kind: "length" },
            constrained: false,
            suspended: false,
            snapFrom: { position: { x: 12, y: -4 }, rotation: 0 },
            ids: ["named"],
            origin: { x: 0, y: 0 },
            current: { x: 0, y: 0 },
            base: new Map([["named", NAMED_TRANSFORM]]),
          },
        });
      });
      // A drag never touches the document, so this is the whole point of the
      // reading: the box moves while `placement.transform` still says 12, -4.
      // The pointer lands the placement on 32, 0, which is on the lattice, so
      // the numbers are the same whether or not the snap rounds them.
      act(() => {
        harness.store.dispatch({
          type: "gesture-moved",
          current: { x: 20, y: 4 },
          spin: 0,
          constrained: false,
          suspended: false,
        });
      });
      expect(input(harness.host, "transform-x").value).toBe("32");
      expect(input(harness.host, "transform-y").value).toBe("0");

      act(() => {
        harness.store.takeGesture();
      });
      expect(input(harness.host, "transform-x").value).toBe("12");
      expect(input(harness.host, "transform-y").value).toBe("-4");
    });

    it("writes a typed angle in degrees and leaves the rest alone", () => {
      harness.select("named");
      const box = input(harness.host, "transform-rotation");
      type(box, "90");
      key(box, "Enter");

      expect(harness.intents).toEqual([
        `pose named 12,-4 r=${String(Math.PI / 2)} s=2,0.5`,
      ]);
    });

    it("writes one coordinate and carries the other four unchanged", () => {
      harness.select("named");
      const box = input(harness.host, "transform-x");
      type(box, "137");
      blur(box);

      expect(harness.intents).toEqual([
        `pose named 137,-4 r=${String(Math.PI / 4)} s=2,0.5`,
      ]);
    });

    it("commits nothing when the number is what the document holds", () => {
      harness.select("named");
      const box = input(harness.host, "transform-x");
      type(box, "99");
      type(box, "12");
      key(box, "Enter");
      blur(box);

      expect(harness.intents).toEqual([]);
    });

    it("drops an uncommitted draft when the selection moves on", () => {
      harness.select("named");
      type(input(harness.host, "transform-x"), "500");
      harness.select("crate");

      expect(input(harness.host, "transform-x").value).toBe("0");
      harness.select("named");
      expect(input(harness.host, "transform-x").value).toBe("12");
      expect(harness.intents).toEqual([]);
    });

    it("keeps text it cannot use, and says why", () => {
      harness.select("named");
      const box = input(harness.host, "transform-x");
      type(box, "abc");
      key(box, "Enter");

      expect(box.value).toBe("abc");
      expect(box.getAttribute("aria-invalid")).toBe("true");
      expect(query(harness.host, "transform-x-reason")?.textContent).toBe(
        "Type a number.",
      );
      expect(harness.intents).toEqual([]);

      // The reason goes as soon as the text it was about does.
      type(box, "40");
      expect(query(harness.host, "transform-x-reason")).toBeNull();
    });

    it("takes a scale of zero, which is where a placement pops in from", () => {
      harness.select("named");
      const box = input(harness.host, "transform-scale-x");
      type(box, "0");
      key(box, "Enter");

      expect(query(harness.host, "transform-scale-x-reason")).toBeNull();
      expect(harness.intents).toEqual([
        `pose named 12,-4 r=${String(Math.PI / 4)} s=0,0.5`,
      ]);
    });

    it("says whose frame the numbers are in, and only when there is one", () => {
      harness.select("child");
      expect(query(harness.host, "transform-frame")?.textContent).toBe(
        "relative to Left crate",
      );

      harness.select("named");
      expect(query(harness.host, "transform-frame")).toBeNull();
    });

    it("puts the document's numbers back on Escape", () => {
      harness.select("named");
      const box = input(harness.host, "transform-y");
      type(box, "500");
      key(box, "Escape");

      expect(box.value).toBe("-4");
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

      expect(input(harness.host, "transform-x").disabled).toBe(true);
    });
  });

  describe("stepping a transform number", () => {
    it("moves a position by one, a grid cell with Shift, and a tenth with Alt", () => {
      harness.select("named");
      const box = input(harness.host, "transform-x");

      arrow(box, "ArrowUp");
      expect(box.value).toBe("13");
      arrow(box, "ArrowUp", { shiftKey: true });
      // The lattice the view holds, which is the default 32.
      expect(box.value).toBe("45");
      arrow(box, "ArrowDown", { altKey: true });
      expect(box.value).toBe("44.9");
    });

    it("moves an angle by a degree, and by 15 with Shift", () => {
      harness.select("named");
      const box = input(harness.host, "transform-rotation");

      arrow(box, "ArrowDown");
      expect(box.value).toBe("44");
      arrow(box, "ArrowUp", { shiftKey: true });
      expect(box.value).toBe("59");
    });

    it("moves a scale by a tenth, and halves and doubles with Shift", () => {
      harness.select("named");
      const box = input(harness.host, "transform-scale-y");

      expect(box.value).toBe("0.5");
      arrow(box, "ArrowUp", { altKey: true });
      expect(box.value).toBe("0.51");
      arrow(box, "ArrowDown", { shiftKey: true });
      expect(box.value).toBe("0.255");
      arrow(box, "ArrowUp", { shiftKey: true });
      expect(box.value).toBe("0.51");
    });

    it("halves and doubles a scale of 1, where adding a whole would land on zero", () => {
      harness.select("named");
      const box = input(harness.host, "transform-scale-x");

      type(box, "1");
      arrow(box, "ArrowDown", { shiftKey: true });
      expect(box.value).toBe("0.5");
      arrow(box, "ArrowUp", { shiftKey: true });
      arrow(box, "ArrowUp", { shiftKey: true });
      expect(box.value).toBe("2");
    });

    it("keeps a mirrored scale mirrored while it halves and doubles", () => {
      harness.select("named");
      const box = input(harness.host, "transform-scale-x");

      type(box, "-1");
      arrow(box, "ArrowUp", { shiftKey: true });
      expect(box.value).toBe("-2");
      arrow(box, "ArrowDown", { shiftKey: true });
      arrow(box, "ArrowDown", { shiftKey: true });
      expect(box.value).toBe("-0.5");
    });

    it("moves a scale by a tenth, zero included", () => {
      harness.select("named");
      const box = input(harness.host, "transform-scale-y");

      expect(box.value).toBe("0.5");

      // 0.1 down from 0.1 is a scale of zero, which is a value: it is what a
      // placement animated in from nothing starts at.
      const other = input(harness.host, "transform-scale-x");
      type(other, "0.1");
      arrow(other, "ArrowDown");
      expect(other.value).toBe("0");
      arrow(other, "ArrowUp");
      expect(other.value).toBe("0.1");
    });

    it("paints each press at once and commits the burst as one edit", () => {
      harness.select("named");
      const box = input(harness.host, "transform-x");

      arrow(box, "ArrowUp");
      arrow(box, "ArrowUp");
      arrow(box, "ArrowUp");
      expect(harness.intents).toEqual([
        "draft named.x=13",
        "draft named.x=14",
        "draft named.x=15",
      ]);

      blur(box);
      expect(harness.intents).toEqual([
        "draft named.x=13",
        "draft named.x=14",
        "draft named.x=15",
        `pose named 15,-4 r=${String(Math.PI / 4)} s=2,0.5`,
      ]);
    });

    it("gives a stepped number up on Escape", () => {
      harness.select("named");
      const box = input(harness.host, "transform-y");

      arrow(box, "ArrowDown");
      key(box, "Escape");

      expect(box.value).toBe("-4");
      expect(harness.intents).toEqual(["draft named.y=-5", "cancel-draft"]);
      blur(box);
      expect(harness.intents).toHaveLength(2);
    });

    it("gives it up when the presses come back to the document's number", () => {
      harness.select("named");
      const box = input(harness.host, "transform-x");

      arrow(box, "ArrowUp");
      arrow(box, "ArrowDown");
      blur(box);

      expect(harness.intents).toEqual([
        "draft named.x=13",
        "draft named.x=12",
        "cancel-draft",
      ]);
    });

    it("drags the label to change the number, and commits on release", () => {
      harness.select("named");

      // Four pixels of travel per step, so twelve is three steps up.
      scrub(harness.host, "transform-x", 12);

      expect(harness.intents).toEqual([
        "draft named.x=13",
        "draft named.x=14",
        "draft named.x=15",
        `pose named 15,-4 r=${String(Math.PI / 4)} s=2,0.5`,
      ]);
    });

    it("steps nothing while editing is locked", () => {
      act(() => {
        harness.root.unmount();
      });
      harness.host.remove();
      harness = createHarness(false);
      harness.select("named");
      const box = input(harness.host, "transform-x");

      arrow(box, "ArrowUp");
      scrub(harness.host, "transform-x", 12);

      expect(box.value).toBe("12");
      expect(harness.intents).toEqual([]);
    });
  });
});
