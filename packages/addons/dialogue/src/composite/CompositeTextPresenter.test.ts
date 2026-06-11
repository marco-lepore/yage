import { describe, expect, it } from "vitest";
import type { PresentedLine } from "../core/session.js";
import type { TextPresenter } from "../chrome/DialogueUiAdapter.js";
import { CompositeTextPresenter } from "./CompositeTextPresenter.js";

/** A stub text view recording presents/clears and the speed multiplier. */
class StubView implements TextPresenter {
  presented = 0;
  cleared = 0;
  speedMultiplier = 1;
  present(): void {
    this.presented++;
  }
  completeReveal(): void {}
  isRevealComplete(): boolean {
    return true;
  }
  isRevealing(): boolean {
    return false;
  }
  setSpeedMultiplier(m: number): void {
    this.speedMultiplier = m;
  }
  update(): void {}
  clear(): void {
    this.cleared++;
  }
  mount(): void {}
  dispose(): void {}
}

const line = (view?: string): PresentedLine => ({
  text: { runs: [], pauses: [], length: 0 },
  speed: 1,
  ...(view !== undefined ? { view } : {}),
});

describe("CompositeTextPresenter — routing", () => {
  it("presents on the routed view and clears the other", () => {
    const box = new StubView();
    const bubble = new StubView();
    const c = new CompositeTextPresenter(box, bubble);

    c.present(line()); // no view hint → box
    expect(box.presented).toBe(1);
    expect(bubble.cleared).toBe(1);

    c.present(line("bubble"));
    expect(bubble.presented).toBe(1);
    expect(box.cleared).toBe(1);
  });
});

describe("CompositeTextPresenter — fast-forward multiplier", () => {
  it("setSpeedMultiplier reaches BOTH sub-views, not just the active one", () => {
    const box = new StubView();
    const bubble = new StubView();
    const c = new CompositeTextPresenter(box, bubble);

    c.present(line()); // box active
    c.setSpeedMultiplier(4);
    expect(box.speedMultiplier).toBe(4);
    // The inactive bubble must not keep a stale multiplier into its next line.
    expect(bubble.speedMultiplier).toBe(4);

    c.setSpeedMultiplier(1);
    expect(box.speedMultiplier).toBe(1);
    expect(bubble.speedMultiplier).toBe(1);
  });
});
