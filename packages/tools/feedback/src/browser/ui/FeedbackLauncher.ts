import { shortcutLabel, shortcutActions } from "../../shared/shortcuts.js";
import type { ResolvedFeedbackShortcuts } from "../../shared/shortcuts.js";

export interface FeedbackLauncherActions {
  open(): void;
  toggleFreeze(): boolean;
  canStep(): boolean;
  step(frames: 1 | 10): void;
}

/** Compact DOM controls and shortcuts; no engine or network access. */
export class FeedbackLauncher {
  readonly element = document.createElement("nav");
  private readonly feedback = document.createElement("button");
  private readonly freeze = document.createElement("button");
  private readonly stepFrame = document.createElement("button");
  private readonly stepTenFrames = document.createElement("button");
  private readonly timer: number;
  private readonly sync = (): void => {
    const disabled =
      !!document.querySelector("dialog[open]") || !this.actions.canStep();
    this.stepFrame.disabled = disabled;
    this.stepTenFrames.disabled = disabled;
  };
  private readonly consumed = new Set<string>();
  private readonly blur = (): void => {
    this.consumed.clear();
  };
  private readonly keyboard = (event: KeyboardEvent): void => {
    if (this.consumed.has(event.code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "keyup") this.consumed.delete(event.code);
      return;
    }
    if (
      event.type !== "keydown" ||
      event.repeat ||
      event.isComposing ||
      document.querySelector("dialog[open]") ||
      (event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)))
    )
      return;
    const action = shortcutActions.find((key) => {
      const binding = this.shortcuts[key];
      return (
        binding &&
        event.code === binding.code &&
        event.ctrlKey === binding.ctrl &&
        event.altKey === binding.alt &&
        event.shiftKey === binding.shift &&
        event.metaKey === binding.meta
      );
    });
    if (!action) return;
    this.consumed.add(event.code);
    event.preventDefault();
    event.stopImmediatePropagation();
    if (action === "feedback") this.actions.open();
    else if (action === "freeze") this.toggle();
    else if (this.actions.canStep()) this.step(action === "stepFrame" ? 1 : 10);
  };
  constructor(
    private readonly actions: FeedbackLauncherActions,
    private readonly shortcuts: ResolvedFeedbackShortcuts,
    galleryUrl?: string,
  ) {
    this.element.className = "yage-feedback-launch";
    this.element.setAttribute("aria-label", "Feedback controls");
    this.feedback.textContent = "Leave feedback";
    const feedbackKey = shortcutLabel(shortcuts.feedback);
    this.feedback.title = feedbackKey
      ? `Leave feedback (${feedbackKey})`
      : "Leave feedback";
    this.freeze.textContent = "Freeze / resume";
    const freezeKey = shortcutLabel(shortcuts.freeze);
    this.freeze.title = freezeKey
      ? `Freeze / resume (${freezeKey})`
      : "Freeze / resume";
    this.feedback.onclick = () => this.actions.open();
    this.freeze.onclick = () => this.toggle();
    this.stepFrame.textContent = "+1 frame";
    this.stepTenFrames.textContent = "+10 frames";
    for (const [button, binding] of [
      [this.stepFrame, shortcuts.stepFrame],
      [this.stepTenFrames, shortcuts.stepTenFrames],
    ] as const) {
      const label = shortcutLabel(binding);
      button.title = label
        ? `${button.textContent} (${label})`
        : (button.textContent ?? "");
    }
    this.stepFrame.onclick = () => this.step(1);
    this.stepTenFrames.onclick = () => this.step(10);
    this.element.append(
      this.feedback,
      this.freeze,
      this.stepFrame,
      this.stepTenFrames,
    );
    if (galleryUrl) {
      const gallery = document.createElement("button");
      gallery.textContent = "Feedback gallery";
      gallery.onclick = () => {
        window.open(galleryUrl, "_blank", "noopener,noreferrer");
      };
      this.element.append(gallery);
    }
    for (const type of [
      "keydown",
      "keyup",
      "pointerdown",
      "pointerup",
      "click",
    ])
      this.element.addEventListener(type, (event) => event.stopPropagation());
    window.addEventListener("keydown", this.keyboard, true);
    window.addEventListener("keyup", this.keyboard, true);
    window.addEventListener("blur", this.blur);
    document.body.append(this.element);
    this.sync();
    // Query the host because other debug tools can change clock ownership.
    this.timer = window.setInterval(this.sync, 200);
  }
  private toggle(): void {
    try {
      this.freeze.setAttribute(
        "aria-pressed",
        String(this.actions.toggleFreeze()),
      );
      this.reset();
    } catch (error) {
      this.error(error);
    }
  }
  private step(frames: 1 | 10): void {
    try {
      if (document.querySelector("dialog[open]")) return;
      this.actions.step(frames);
      this.reset();
    } catch (error) {
      this.error(error);
    }
    this.sync();
  }
  error(error: unknown): void {
    this.feedback.textContent =
      error instanceof Error ? error.message : String(error);
  }
  reset(): void {
    this.feedback.textContent = "Leave feedback";
    this.sync();
  }
  focus(): void {
    this.feedback.focus();
  }
  destroy(): void {
    window.removeEventListener("keydown", this.keyboard, true);
    window.removeEventListener("keyup", this.keyboard, true);
    window.removeEventListener("blur", this.blur);
    this.consumed.clear();
    window.clearInterval(this.timer);
    this.element.remove();
  }
}
