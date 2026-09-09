// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { FeedbackLauncher } from "./FeedbackLauncher.js";
import { resolveShortcuts } from "../../shared/shortcuts.js";
import type { FeedbackShortcuts } from "../../shared/shortcuts.js";

const launchers: FeedbackLauncher[] = [];
afterEach(() => {
  for (const launcher of launchers.splice(0)) launcher.destroy();
  document.body.replaceChildren();
});
function key(
  code: string,
  options: KeyboardEventInit = {},
  target: EventTarget = window,
  type = "keydown",
): KeyboardEvent {
  const event = new KeyboardEvent(type, {
    code,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}
function setup(
  shortcuts: boolean | FeedbackShortcuts = true,
  open?: () => void,
) {
  let opened = 0,
    toggled = 0;
  let frames = 0;
  const launcher = new FeedbackLauncher(
    {
      open: () => {
        opened++;
        open?.();
      },
      toggleFreeze: () => ++toggled % 2 === 1,
      canStep: () => toggled % 2 === 1,
      step: (count) => {
        frames += count;
      },
    },
    resolveShortcuts(shortcuts),
  );
  launchers.push(launcher);
  return { launcher, counts: () => [opened, toggled], frames: () => frames };
}
it("retains defaults and overrides only the specified action", () => {
  const state = setup({ feedback: { code: "KeyK", ctrl: true, shift: true } });
  expect(key("F8").defaultPrevented).toBe(false);
  key("KeyK", { ctrlKey: true });
  key("KeyK", { ctrlKey: true, shiftKey: true, altKey: true });
  expect(state.counts()).toEqual([0, 0]);
  expect(key("KeyK", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(
    true,
  );
  key("KeyK", {}, window, "keyup");
  key("F9");
  expect(state.counts()).toEqual([1, 1]);
  expect(state.launcher.element.querySelector("button")?.title).toBe(
    "Leave feedback (Ctrl+Shift+K)",
  );
  expect(state.launcher.element.querySelectorAll("button")[1]?.title).toBe(
    "Freeze / resume (F9)",
  );
});
it("supports individual and global disabling while keeping buttons usable", () => {
  const first = setup({ feedback: false });
  expect(key("F8").defaultPrevented).toBe(false);
  key("F9");
  key("F9", {}, window, "keyup");
  first.launcher.element.querySelector("button")!.click();
  expect(first.counts()).toEqual([1, 1]);
  first.launcher.destroy();
  const disabled = setup(false);
  expect(key("F8").defaultPrevented).toBe(false);
  expect(key("F9").defaultPrevented).toBe(false);
  expect(disabled.counts()).toEqual([0, 0]);
});
it("suppresses repeat and the matching release after focus or modifiers change", () => {
  const dialog = document.createElement("dialog");
  const state = setup({ feedback: { code: "KeyK", meta: true } }, () => {
    dialog.open = true;
    document.body.append(dialog);
  });
  key("KeyK", { metaKey: true });
  expect(key("KeyK", { repeat: true }).defaultPrevented).toBe(true);
  expect(key("KeyK", {}, dialog, "keyup").defaultPrevented).toBe(true);
  expect(state.counts()).toEqual([1, 0]);
  expect(key("KeyK", { metaKey: true }, dialog).defaultPrevented).toBe(false);
  dialog.remove();
  state.launcher.destroy();
  expect(key("KeyK", { metaKey: true }).defaultPrevented).toBe(false);
});
it("ignores editable targets, composing input, and open dialogs", () => {
  const state = setup({ feedback: { code: "KeyK" } });
  const input = document.createElement("input");
  document.body.append(input);
  expect(key("KeyK", {}, input).defaultPrevented).toBe(false);
  expect(key("KeyK", { isComposing: true }).defaultPrevented).toBe(false);
  const dialog = document.createElement("dialog");
  dialog.open = true;
  document.body.append(dialog);
  expect(key("KeyK").defaultPrevented).toBe(false);
  expect(state.counts()).toEqual([0, 0]);
});
it("rejects conflicting or malformed bindings and copies caller configuration", () => {
  expect(() => resolveShortcuts({ feedback: { code: "F9" } })).toThrow(
    "different bindings",
  );
  expect(() => resolveShortcuts({ freeze: { code: "" } })).toThrow(
    "KeyboardEvent.code",
  );
  expect(() => resolveShortcuts({ freeze: { code: "ShiftLeft" } })).toThrow(
    "KeyboardEvent.code",
  );
  const options = { feedback: { code: "KeyK" } };
  const resolved = resolveShortcuts(options);
  options.feedback.code = "KeyQ";
  expect(resolved.feedback && resolved.feedback.code).toBe("KeyK");
});

it("rebinds frame stepping and enables it only while frozen outside dialogs", () => {
  const state = setup({
    stepFrame: { code: "Period" },
    stepTenFrames: { code: "Period", shift: true },
  });
  expect(key("Period").defaultPrevented).toBe(true);
  key("Period", {}, window, "keyup");
  expect(state.frames()).toBe(0);
  key("F9");
  key("F9", {}, window, "keyup");
  expect(state.launcher.element.querySelectorAll("button")[2]?.disabled).toBe(
    false,
  );
  key("Period");
  key("Period", {}, window, "keyup");
  key("Period", { shiftKey: true });
  key("Period", {}, window, "keyup");
  expect(state.frames()).toBe(11);
  expect(key("F10").defaultPrevented).toBe(false);
  const dialog = document.createElement("dialog");
  dialog.open = true;
  document.body.append(dialog);
  key("Period");
  expect(state.frames()).toBe(11);
});
