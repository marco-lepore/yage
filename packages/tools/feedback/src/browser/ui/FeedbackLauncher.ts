/** Compact DOM controls and shortcuts; no engine or network access. */
export class FeedbackLauncher {
  readonly element = document.createElement("nav");
  private readonly feedback = document.createElement("button");
  private readonly freeze = document.createElement("button");
  private readonly keyboard = (event: KeyboardEvent): void => {
    if (
      !this.shortcuts ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !["F8", "F9"].includes(event.code) ||
      document.querySelector("dialog[open]") ||
      (event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)))
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== "keydown" || event.repeat) return;
    if (event.code === "F8") this.open();
    else this.toggle();
  };
  constructor(
    private readonly open: () => void,
    private readonly toggleFreeze: () => boolean,
    private readonly shortcuts: boolean,
  ) {
    this.element.className = "yage-feedback-launch";
    this.element.setAttribute("aria-label", "Feedback controls");
    this.feedback.textContent = "Leave feedback";
    this.feedback.title = shortcuts ? "Leave feedback (F8)" : "Leave feedback";
    this.freeze.textContent = "Freeze / resume";
    this.freeze.title = shortcuts ? "Freeze / resume (F9)" : "Freeze / resume";
    this.feedback.onclick = open;
    this.freeze.onclick = () => this.toggle();
    this.element.append(this.feedback, this.freeze);
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
    document.body.append(this.element);
  }
  private toggle(): void {
    try {
      this.freeze.setAttribute("aria-pressed", String(this.toggleFreeze()));
      this.reset();
    } catch (error) {
      this.error(error);
    }
  }
  error(error: unknown): void {
    this.feedback.textContent =
      error instanceof Error ? error.message : String(error);
  }
  reset(): void {
    this.feedback.textContent = "Leave feedback";
  }
  focus(): void {
    this.feedback.focus();
  }
  destroy(): void {
    window.removeEventListener("keydown", this.keyboard, true);
    window.removeEventListener("keyup", this.keyboard, true);
    this.element.remove();
  }
}
