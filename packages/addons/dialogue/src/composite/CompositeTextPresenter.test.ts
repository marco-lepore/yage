import { describe, expect, it } from "vitest";
import type { PresentedLine, SpeakerView } from "../core/session.js";
import type { TextPresenter } from "../chrome/DialogueUiAdapter.js";
import { CompositeTextPresenter } from "./CompositeTextPresenter.js";

/** A stub text view recording presents/clears, speed, and visibility. */
class StubView implements TextPresenter {
  presented = 0;
  replaced = 0;
  cleared = 0;
  speedMultiplier = 1;
  visibles: boolean[] = [];
  revealListener?: (() => void) | undefined;
  present(): void {
    this.presented++;
  }
  replaceVisible(): void {
    this.replaced++;
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
  setVisible(v: boolean): void {
    this.visibles.push(v);
  }
  setRevealListener(l: (() => void) | undefined): void {
    this.revealListener = l;
  }
  setBeatListener(): void {}
  update(): void {}
  clear(): void {
    this.cleared++;
  }
  mount(): void {}
  dispose(): void {}
}

const speaker: SpeakerView = { id: "npc", name: "NPC" };

const line = (view?: string, withSpeaker = false): PresentedLine => ({
  text: { runs: [], tokens: [], length: 0 },
  speed: 1,
  ...(view !== undefined ? { view } : {}),
  ...(withSpeaker ? { speaker } : {}),
});

describe("CompositeTextPresenter — routing", () => {
  it("presents on the routed view and clears the other", () => {
    const box = new StubView();
    const bubble = new StubView();
    const c = new CompositeTextPresenter(box, bubble);

    c.present(line()); // no view hint → box
    expect(box.presented).toBe(1);
    expect(bubble.cleared).toBe(1);

    // A bubble view WITH a speaker → bubble (a speakerless line would route to
    // the box by the narrator convention — covered separately).
    c.present(line("bubble", true));
    expect(bubble.presented).toBe(1);
    expect(box.cleared).toBe(1);
  });

  it("routes a speakerless bubble line to the box (narrator convention)", () => {
    const box = new StubView();
    const bubble = new StubView();
    const c = new CompositeTextPresenter(box, bubble);

    c.present(line("bubble")); // bubble view but NO speaker → box
    expect(box.presented).toBe(1);
    expect(bubble.presented).toBe(0);
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

describe("CompositeTextPresenter.replaceVisible", () => {
  it("swaps the text on the view showing the line, and on no other", () => {
    const box = new StubView();
    const bubble = new StubView();
    const composite = new CompositeTextPresenter(box, bubble);

    composite.present(line("bubble", true));
    composite.replaceVisible(line("bubble", true));

    expect(bubble.replaced).toBe(1);
    expect(box.replaced).toBe(0);
    // A replacement is not a new line: nothing is presented or cleared again.
    expect(bubble.presented).toBe(1);
    expect(box.cleared).toBe(1);
  });

  it("does nothing before a line is presented", () => {
    const box = new StubView();
    const bubble = new StubView();
    const composite = new CompositeTextPresenter(box, bubble);

    composite.replaceVisible(line());

    expect(box.replaced).toBe(0);
    expect(bubble.replaced).toBe(0);
  });
});
