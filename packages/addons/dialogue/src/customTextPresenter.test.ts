import { describe, expect, it } from "vitest";

// The contract's acceptance test. This "DOM/headless" text presenter is built
// ONLY from the PUBLIC ROOT entry (`./index.js`): the
// documented `TextChannel` contract + the headless `LineReveal` clock +
// `splitGraphemes` + `parseMarkup`. It imports NOTHING from `./presenters`
// (no pixi) and reaches into NO addon internals. If writing it ever needed an
// internal, the contract — not this fixture — failed.
import {
  LineReveal,
  splitGraphemes,
  parseMarkup,
  type RevealBeat,
  type TextChannel,
  type PresentedLine,
} from "./index.js";

/**
 * A typewriter that reveals into a plain string instead of pixi glyphs — what a
 * DOM overlay or a per-word presenter would do. It maps LineReveal's grapheme
 * cursor onto its own rendering; LineReveal owns reveal timing / pauses / speed /
 * completion, so this stays tiny.
 */
class DomTextPresenter implements TextChannel {
  private readonly reveal: LineReveal;
  private graphemes: string[] = [];
  private revealListener: (() => void) | undefined;
  private beatListener: ((beat: RevealBeat) => void) | undefined;
  /** The "DOM": the substring currently shown. */
  revealed = "";
  visible = true;

  constructor(charsPerSec: number) {
    this.reveal = new LineReveal(charsPerSec);
    this.reveal.setCompletionListener(() => this.revealListener?.());
    // A custom presenter forwards beats straight off the headless clock — no
    // addon internals, just the public LineReveal seam.
    this.reveal.setBeatListener((beat) => this.beatListener?.(beat));
  }

  setRevealListener(listener: (() => void) | undefined): void {
    this.revealListener = listener;
  }

  setBeatListener(listener: ((beat: RevealBeat) => void) | undefined): void {
    this.beatListener = listener;
  }

  present(line: PresentedLine): void {
    const plain = line.text.runs.map((r) => r.text).join("");
    this.graphemes = splitGraphemes(plain);
    this.reveal.begin(line.text, line.speed);
    this.render();
  }

  update(dt: number): void {
    this.reveal.update(dt);
    this.render();
  }

  completeReveal(): void {
    this.reveal.complete();
    this.render();
  }

  isRevealComplete(): boolean {
    return this.reveal.isComplete();
  }
  isRevealing(): boolean {
    return this.reveal.isRevealing();
  }
  setSpeedMultiplier(m: number): void {
    this.reveal.setSpeedMultiplier(m);
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
  clear(): void {
    this.graphemes = [];
    this.revealed = "";
  }

  private render(): void {
    const n = Math.min(this.graphemes.length, Math.floor(this.reveal.revealed));
    this.revealed = this.graphemes.slice(0, n).join("");
  }
}

const present = (p: DomTextPresenter, markup: string, speed = 1): void =>
  p.present({ text: parseMarkup(markup), speed });

describe("a custom text presenter from the documented contract", () => {
  it("reveals grapheme-by-grapheme and reports completion exactly once", () => {
    const p = new DomTextPresenter(1000); // 1 grapheme/ms
    let done = 0;
    p.setRevealListener(() => done++);
    present(p, "Hello");

    p.update(3);
    expect(p.revealed).toBe("Hel");
    expect(done).toBe(0);
    p.update(2);
    expect(p.revealed).toBe("Hello");
    expect(done).toBe(1);
    p.update(10); // no double-fire, no over-reveal
    expect(done).toBe(1);
    expect(p.revealed).toBe("Hello");
  });

  it("honours an inline [pause] without showing past it", () => {
    const p = new DomTextPresenter(1000);
    present(p, "ab[pause=300/]cd");
    p.update(5); // overshoots the pause at 2 → clamps
    expect(p.revealed).toBe("ab");
    p.update(300); // sit out the pause
    p.update(2);
    expect(p.revealed).toBe("abcd");
  });

  it("skip-to-end + the markup is stripped from the revealed text", () => {
    const p = new DomTextPresenter(50);
    let done = 0;
    p.setRevealListener(() => done++);
    present(p, "Bold [b]word[/b] here");
    p.completeReveal();
    expect(p.revealed).toBe("Bold word here"); // tags gone, all shown
    expect(done).toBe(1);
  });

  it("an emoji counts as one grapheme (reveal aligns with what a DOM would show)", () => {
    const p = new DomTextPresenter(1000);
    present(p, "🔥🔥ab");
    p.update(3);
    expect(p.revealed).toBe("🔥🔥a");
  });
});
