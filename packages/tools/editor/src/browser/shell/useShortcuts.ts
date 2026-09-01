import { useEffect, useRef } from "react";

/** One keyboard binding: which keystroke, and what it runs. */
export interface Shortcut {
  /** Compared against `KeyboardEvent.key`, ignoring case. */
  readonly key: string;
  /** Ctrl on Windows and Linux, Cmd on macOS. Default: neither. */
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly run: () => void;
}

/**
 * Run the editor's shortcuts, from anywhere in the window.
 *
 * They are read on the window rather than on one panel so a shortcut works
 * wherever the developer last clicked — except while a text field owns the
 * event, where every keystroke is the field's. That rule is the reason this is
 * one place and not a handler on each panel.
 *
 * It holds the one-shot commands. A key held to arm a gesture is not one:
 * `Viewport` reads Space on the window itself, because the state it produces
 * belongs to the gesture rather than to a command, and it has to be released
 * and cleared on `blur` as well as pressed.
 *
 * A matched shortcut is the whole meaning of the keystroke: modifiers are
 * compared exactly, so `Cmd`-`Z` and `Cmd`-`Shift`-`Z` cannot both fire, and
 * the browser's own meaning is suppressed.
 */
export function useShortcuts(shortcuts: readonly Shortcut[]): void {
  // The array is rebuilt on every render and its callbacks close over that
  // render's state. Reading it through a ref keeps one listener for the life
  // of the component while still running the current callbacks.
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (ownsTextEntry(event.target)) return;
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      for (const shortcut of latest.current) {
        if (shortcut.key !== key) continue;
        if (mod !== (shortcut.mod ?? false)) continue;
        if (event.shiftKey !== (shortcut.shift ?? false)) continue;
        event.preventDefault();
        shortcut.run();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

/**
 * Whether Space belongs to the focused control rather than to the viewport.
 *
 * A button activates on Space, so arming a pan from one — and defaulting the
 * keystroke away — would leave every control in the shell reachable by Enter
 * and nothing else.
 */
export function ownsSpace(target: EventTarget | null): boolean {
  if (ownsTextEntry(target)) return true;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "BUTTON" ||
    tag === "SUMMARY" ||
    (tag === "A" && target.hasAttribute("href")) ||
    target.getAttribute("role") === "button"
  );
}

/** Whether the keystroke belongs to something the developer is typing into. */
export function ownsTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
