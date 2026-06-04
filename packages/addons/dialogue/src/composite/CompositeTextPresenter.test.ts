import { describe, expect, it } from "vitest";
import type { PresentedLine } from "../core/session.js";
import type { TextPresenter } from "../chrome/DialogueUiAdapter.js";
import { CompositeTextPresenter } from "./CompositeTextPresenter.js";

/** A stub text view with a fixed term + pointer space, recording hover calls. */
class StubView implements TextPresenter {
  hovered: string | undefined = "<unset>";
  constructor(
    readonly pointerSpace: "screen" | "world",
    private readonly term: string | undefined,
  ) {}
  present(): void {}
  completeReveal(): void {}
  isRevealComplete(): boolean {
    return true;
  }
  isRevealing(): boolean {
    return false;
  }
  setSpeedMultiplier(): void {}
  update(): void {}
  clear(): void {}
  mount(): void {}
  dispose(): void {}
  termAtPoint(): string | undefined {
    return this.term;
  }
  setHoveredTerm(id: string | undefined): void {
    this.hovered = id;
  }
}

const line = (view?: string): PresentedLine => ({
  text: { runs: [], pauses: [], length: 0 },
  speed: 1,
  ...(view !== undefined ? { view } : {}),
});

describe("CompositeTextPresenter — term seam forwards to the active view", () => {
  it("routes termAtPoint / pointerSpace / setHoveredTerm to whichever view is showing", () => {
    const box = new StubView("screen", "mana");
    const bubble = new StubView("world", "glow");
    const c = new CompositeTextPresenter(box, bubble);

    // No line presented yet → nothing active.
    expect(c.termAtPoint(0, 0)).toBeUndefined();
    expect(c.pointerSpace).toBe("screen");

    // A box line (no view hint) → the box view is active.
    c.present(line());
    expect(c.termAtPoint(0, 0)).toBe("mana");
    expect(c.pointerSpace).toBe("screen");
    c.setHoveredTerm("mana");
    expect(box.hovered).toBe("mana");

    // A bubble line → the bubble view is active; the seam follows it.
    c.present(line("bubble"));
    expect(c.termAtPoint(0, 0)).toBe("glow");
    expect(c.pointerSpace).toBe("world");
    c.setHoveredTerm(undefined);
    expect(bubble.hovered).toBeUndefined();
  });
});
