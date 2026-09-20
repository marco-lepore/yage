import { describe, expect, it } from "vitest";
import type { UIInputCaptureElement } from "./focus/input-capture.js";
import type {
  FocusNeighbors,
  PointerFocusMode,
  UIFocusInputOptions,
  UIFocusOutlineBox,
  UIFocusScopeOptions,
  UIFocusStyle,
} from "./index.js";
import * as ui from "./index.js";

/** The focus values a game reaches for through the package entry point. */
const FOCUS_EXPORTS = [
  "FocusState",
  "UIFocusScope",
  "UIFocusStack",
  "UIFocusStackKey",
  "UIFocusSystem",
  "captureFocusInput",
  "isCapturingInput",
];

/** An element reduced to the identity the capture record is keyed by. */
function makeHolder(): UIInputCaptureElement {
  return {
    confirmCapture: () => {},
    cancelCapture: () => {},
    releaseCapture: () => {},
  } as unknown as UIInputCaptureElement;
}

describe("@yagejs/ui entry point", () => {
  it("answers whether an element holds its scope's input", () => {
    const holder = makeHolder();
    expect(ui.isCapturingInput(holder)).toBe(false);

    ui.captureFocusInput(holder, true);
    expect(ui.isCapturingInput(holder)).toBe(true);

    ui.captureFocusInput(holder, false);
    expect(ui.isCapturingInput(holder)).toBe(false);
  });

  it("keeps the missing-stack warning inside the package", () => {
    expect("warnMissingFocusStack" in ui).toBe(false);
  });

  it("carries every focus value on the barrel", () => {
    const exported = Object.keys(ui);
    const missing = FOCUS_EXPORTS.filter((name) => !exported.includes(name));

    expect(missing).toEqual([]);
  });

  it("carries every focus type on the barrel", () => {
    // The annotations are the check; `tsconfig.contract.json` evaluates them.
    const style: UIFocusStyle = { color: 0x8ab4ff, width: 2, radius: 4 };
    const box: UIFocusOutlineBox = { x: 0, y: 0, width: 96, height: 24 };
    const neighbors: FocusNeighbors = { up: "load", down: null };
    const pointerFocus: PointerFocusMode = "hover";
    const input: UIFocusInputOptions = { confirm: ["submit", "padSouth"] };
    const options: UIFocusScopeOptions = { input, pointerFocus, modal: false };

    expect(Object.keys(options)).toEqual(["input", "pointerFocus", "modal"]);
    expect(style.width).toBe(2);
    expect(box.height).toBe(24);
    expect(neighbors.down).toBeNull();
  });
});
