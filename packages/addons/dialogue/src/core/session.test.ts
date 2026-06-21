import { afterEach, describe, expect, it, vi } from "vitest";

import { DialogueSession } from "./session.js";
import { MemoryVariableStorage, cells, compose } from "./vars.js";
import { DialoguePlayError } from "./validate.js";
import type {
  AvatarChannel,
  ChoiceChannel,
  ChoiceContext,
  ChromeChannel,
  DialogueChannels,
  PresentedChoice,
  PresentedLine,
  TextChannel,
} from "./session.js";
import type { Command, DialogueScript, SpeakerDef } from "./types.js";

/**
 * A controllable text channel. Reveal does NOT advance on its own — a test
 * calls `finishReveal()` to simulate the typewriter completing, which is how we
 * exercise the Session's reveal-gating (continue caret, afterReveal commands,
 * auto-advance clock) without any renderer.
 */
class StubText implements TextChannel {
  readonly presented: PresentedLine[] = [];
  cleared = 0;
  completeRevealCalls = 0;
  speedMultiplier = 1;
  /** Last value passed to setVisible. */
  visible = false;
  private revealing = false;
  private revealListener?: (() => void) | undefined;

  present(line: PresentedLine): void {
    this.presented.push(line);
    this.revealing = true; // start "typing"; stays revealing until finishReveal()
  }
  completeReveal(): void {
    this.completeRevealCalls += 1;
    this.finishReveal();
  }
  isRevealComplete(): boolean {
    return !this.revealing;
  }
  isRevealing(): boolean {
    return this.revealing;
  }
  setSpeedMultiplier(m: number): void {
    this.speedMultiplier = m;
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
  update(): void {}
  clear(): void {
    this.cleared += 1;
    this.revealing = false;
  }
  setRevealListener(listener: (() => void) | undefined): void {
    this.revealListener = listener;
  }
  /** Test hook: simulate the typewriter finishing the current line. */
  finishReveal(): void {
    if (!this.revealing) return;
    this.revealing = false;
    this.revealListener?.();
  }
  get lastText(): string {
    const last = this.presented[this.presented.length - 1];
    return last ? last.text.runs.map((r) => r.text).join("") : "";
  }
}

class StubChoices implements ChoiceChannel {
  presented: { choices: readonly PresentedChoice[]; context: ChoiceContext | undefined }[] = [];
  highlights: number[] = [];
  cleared = 0;
  /** Recorded setVisible(...) calls. */
  visibles: boolean[] = [];
  onChoiceChosen?: (position: number) => void;
  private owns = false;

  present(choices: readonly PresentedChoice[], context?: ChoiceContext): void {
    this.presented.push({ choices, context });
  }
  highlight(position: number): void {
    this.highlights.push(position);
  }
  setVisible(visible: boolean): void {
    this.visibles.push(visible);
  }
  clear(): void {
    this.cleared += 1;
  }
  ownsPrompt(): boolean {
    return this.owns;
  }
  setOwnsPrompt(v: boolean): void {
    this.owns = v;
  }
  get lastLabels(): string[] {
    const last = this.presented[this.presented.length - 1];
    return last ? last.choices.map((c) => c.label) : [];
  }
}

class StubAvatar implements AvatarChannel {
  speakers: (SpeakerDef | undefined)[] = [];
  expressions: (string | undefined)[] = [];
  speaking: boolean[] = [];
  visibles: boolean[] = [];
  setSpeaker(speaker: SpeakerDef | undefined): void {
    this.speakers.push(speaker);
  }
  setExpression(expression: string | undefined): void {
    this.expressions.push(expression);
  }
  setSpeaking(speaking: boolean): void {
    this.speaking.push(speaking);
  }
  setVisible(visible: boolean): void {
    this.visibles.push(visible);
  }
  update(): void {}
}

class StubChrome implements ChromeChannel {
  nameplates: { name: string | undefined; color?: number }[] = [];
  continueVisible: boolean[] = [];
  presented: (PresentedLine | undefined)[] = [];
  /** Recorded setVisible(...) calls. */
  visibles: boolean[] = [];
  setNameplate(name: string | undefined, color?: number): void {
    this.nameplates.push({ name, ...(color !== undefined ? { color } : {}) });
  }
  setContinueVisible(visible: boolean): void {
    this.continueVisible.push(visible);
  }
  setVisible(visible: boolean): void {
    this.visibles.push(visible);
  }
  present(line: PresentedLine | undefined): void {
    this.presented.push(line);
  }
  update(): void {}
}

interface Harness {
  readonly session: DialogueSession;
  readonly text: StubText;
  readonly choices: StubChoices;
  readonly avatar: StubAvatar;
  readonly chrome: StubChrome;
}

function makeHarness(
  opts?: ConstructorParameters<typeof DialogueSession>[1],
): Harness {
  const text = new StubText();
  const choices = new StubChoices();
  const avatar = new StubAvatar();
  const chrome = new StubChrome();
  const channels: DialogueChannels = { text, choices, avatar, chrome };
  const session = new DialogueSession(channels, opts);
  return { session, text, choices, avatar, chrome };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The underlying runner steps async (it may `await` blocking commands), so
 * crossing a non-`say` step — branching off a choice, hitting `end`, following
 * a `goto` — lands the next `present()` on the microtask queue. Drain a few
 * turns so a test can assert the settled state.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("DialogueSession — line sequencing & reveal gating", () => {
  const twoLines: DialogueScript = {
    id: "two",
    start: "a",
    nodes: {
      a: {
        id: "a",
        steps: [
          { kind: "say", text: "one" },
          { kind: "say", text: "two" },
        ],
      },
    },
  };

  it("presents the first line and hides the continue caret until reveal completes", async () => {
    const h = makeHarness();
    h.session.play(twoLines);
    expect(h.session.isActive()).toBe(true);
    expect(h.text.lastText).toBe("one");
    // Caret is hidden at present-time (and again by the initial stop()); the
    // important invariant is that it has NOT yet been made visible.
    expect(h.chrome.continueVisible).not.toContain(true);

    h.text.finishReveal();
    // handleRevealComplete awaits afterReveal commands before showing the caret,
    // so flush the microtask queue before asserting the settled state.
    await flush();
    // After reveal: caret shown, avatar stops "speaking".
    expect(h.chrome.continueVisible.at(-1)).toBe(true);
    expect(h.avatar.speaking.at(-1)).toBe(false);
  });

  it("advance() while revealing completes the reveal instead of stepping", () => {
    const h = makeHarness();
    h.session.play(twoLines);
    h.session.advance(); // still typing → completeReveal, NOT next line
    expect(h.text.completeRevealCalls).toBe(1);
    expect(h.text.lastText).toBe("one"); // did not move to "two"
  });

  it("advance() once revealed steps to the next line", async () => {
    const h = makeHarness();
    h.session.play(twoLines);
    h.text.finishReveal();
    h.session.advance();
    await flush();
    expect(h.text.lastText).toBe("two");
  });

  it("advancing off the last line ends the conversation", async () => {
    const ended = vi.fn();
    const h = makeHarness({ onEnded: ended });
    h.session.play(twoLines);
    h.text.finishReveal();
    h.session.advance(); // → "two"
    await flush();
    h.text.finishReveal();
    h.session.advance(); // off the end
    await flush();
    expect(ended).toHaveBeenCalledWith({ scriptId: "two" });
    expect(h.session.isActive()).toBe(false);
  });

  it("emits onStarted / onLine / onEnded with plain (markup-stripped) text", async () => {
    const onStarted = vi.fn();
    const onLine = vi.fn();
    const onEnded = vi.fn();
    const h = makeHarness({ onStarted, onLine, onEnded });
    const script: DialogueScript = {
      id: "events",
      start: "a",
      nodes: {
        a: { id: "a", steps: [{ kind: "say", text: "[b]bold[/b] line" }] },
      },
    };
    h.session.play(script);
    expect(onStarted).toHaveBeenCalledWith({ scriptId: "events" });
    expect(onLine).toHaveBeenCalledWith({ speaker: undefined, text: "bold line" });
    h.text.finishReveal();
    h.session.advance();
    await flush();
    expect(onEnded).toHaveBeenCalledWith({ scriptId: "events" });
  });
});

describe("DialogueSession — auto-advance clock", () => {
  it("auto-advances after autoAdvanceMs once the line is fully revealed", async () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "auto",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "one", autoAdvanceMs: 100 },
            { kind: "say", text: "two" },
          ],
        },
      },
    };
    h.session.play(script);
    // Clock should not tick before reveal completes.
    h.session.update(500);
    expect(h.text.lastText).toBe("one");

    h.text.finishReveal(); // settles reveal; the auto-timer is armed async
    await flush(); // let handleRevealComplete arm the 100ms timer
    h.session.update(60);
    expect(h.text.lastText).toBe("one"); // not yet
    h.session.update(60); // total 120 > 100 → advance
    await flush();
    expect(h.text.lastText).toBe("two");
  });

  const twoPlain: DialogueScript = {
    id: "auto-default",
    start: "a",
    nodes: {
      a: {
        id: "a",
        steps: [
          { kind: "say", text: "one" },
          { kind: "say", text: "two" },
        ],
      },
    },
  };

  it("setAutoAdvance default advances lines that lack their own autoAdvanceMs", async () => {
    const h = makeHarness();
    h.session.setAutoAdvance(100);
    h.session.play(twoPlain);
    h.text.finishReveal();
    await flush();
    h.session.update(60);
    expect(h.text.lastText).toBe("one"); // 60 < 100, still waiting
    h.session.update(60); // 120 > 100 → advance via the default
    await flush();
    expect(h.text.lastText).toBe("two");
  });

  it("a per-line autoAdvanceMs overrides the setAutoAdvance default", async () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "override",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "one", autoAdvanceMs: 50 },
            { kind: "say", text: "two" },
          ],
        },
      },
    };
    h.session.setAutoAdvance(5000); // long default, should be ignored on line one
    h.session.play(script);
    h.text.finishReveal();
    await flush();
    h.session.update(60); // 60 > the per-line 50 → advance
    await flush();
    expect(h.text.lastText).toBe("two");
  });

  it("setAutoAdvance(null) leaves lines waiting for a manual advance", async () => {
    const h = makeHarness();
    h.session.setAutoAdvance(100);
    h.session.setAutoAdvance(null); // turned back off
    h.session.play(twoPlain);
    h.text.finishReveal();
    await flush();
    h.session.update(10_000);
    expect(h.text.lastText).toBe("one"); // never auto-advances
  });

  it("toggling setAutoAdvance on a revealed line arms it immediately", async () => {
    const h = makeHarness();
    h.session.play(twoPlain);
    h.text.finishReveal(); // line one sits revealed, no timer armed
    await flush();
    h.session.update(10_000);
    expect(h.text.lastText).toBe("one"); // still parked (auto off)
    h.session.setAutoAdvance(100); // arm now, mid-line
    h.session.update(120);
    await flush();
    expect(h.text.lastText).toBe("two");
  });
});

describe("DialogueSession — i18n & interpolation", () => {
  it("interpolates variables into line text and speaker names", () => {
    const onLine = vi.fn();
    const h = makeHarness({ onLine });
    const hero: SpeakerDef = { id: "hero", name: "{playerName}" };
    const script: DialogueScript = {
      id: "i18n",
      start: "a",
      speakers: { hero },
      nodes: {
        a: { id: "a", steps: [{ kind: "say", speaker: "hero", text: "Hi, I am {playerName}" }] },
      },
    };
    h.session.play(script, { storage: new MemoryVariableStorage({ playerName: "Mara" }) });
    expect(onLine).toHaveBeenCalledWith({ speaker: "Mara", text: "Hi, I am Mara" });
    expect(h.chrome.nameplates.at(-1)).toEqual({ name: "Mara" });
  });

  it("interpolation reads a live storage value at each present (scenario 3)", async () => {
    const onLine = vi.fn();
    const h = makeHarness({ onLine });
    let gold = 5; // the host's game state, behind a cells getter
    const script: DialogueScript = {
      id: "live-gold",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "You have {gold} gold." },
            { kind: "say", text: "Now {gold}." },
          ],
        },
      },
    };
    h.session.play(script, { storage: cells({ gold: () => gold }) });
    expect(onLine).toHaveBeenLastCalledWith({
      speaker: undefined,
      text: "You have 5 gold.",
    });
    gold = 9; // changes between the two presents
    h.text.finishReveal();
    h.session.advance();
    await flush();
    // The already-shown line never re-renders; the NEXT line sees the new value.
    expect(onLine).toHaveBeenLastCalledWith({ speaker: undefined, text: "Now 9." });
  });

  it("a stored value wins over a declared default (seed-if-absent)", () => {
    const onLine = vi.fn();
    const h = makeHarness({ onLine });
    const script: DialogueScript = {
      id: "var-override",
      start: "a",
      declare: { name: "stranger" },
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "Hi, {name}." }] } },
    };
    h.session.play(script, { storage: new MemoryVariableStorage({ name: "Mara" }) });
    expect(onLine).toHaveBeenCalledWith({ speaker: undefined, text: "Hi, Mara." });
  });
});

describe("DialogueSession — choices", () => {
  const choiceScript: DialogueScript = {
    id: "ch",
    start: "a",
    nodes: {
      a: {
        id: "a",
        steps: [
          {
            kind: "choice",
            text: "pick one",
            options: [
              { text: "left", target: "L" },
              { text: "right", target: "R" },
            ],
          },
        ],
      },
      L: { id: "L", steps: [{ kind: "say", text: "went-left" }] },
      R: { id: "R", steps: [{ kind: "say", text: "went-right" }] },
    },
  };

  it("presents resolved choice labels and highlights the first", () => {
    const onChoiceShown = vi.fn();
    const h = makeHarness({ onChoiceShown });
    h.session.play(choiceScript);
    expect(h.session.isChoosing()).toBe(true);
    expect(h.choices.lastLabels).toEqual(["left", "right"]);
    expect(h.choices.highlights.at(-1)).toBe(0);
    expect(onChoiceShown).toHaveBeenCalledWith({ options: ["left", "right"] });
  });

  it("moveSelection wraps and highlights; confirm commits the selected option", async () => {
    const onChoiceMade = vi.fn();
    const h = makeHarness({ onChoiceMade });
    h.session.play(choiceScript);
    h.session.moveSelection(-1); // wraps from 0 → 1 (right)
    expect(h.choices.highlights.at(-1)).toBe(1);
    h.session.confirm();
    expect(onChoiceMade).toHaveBeenCalledWith({ index: 1, text: "right" });
    await flush();
    expect(h.text.lastText).toBe("went-right");
  });

  it("advance() during a choice confirms the current selection", async () => {
    const h = makeHarness();
    h.session.play(choiceScript);
    h.session.advance(); // confirms default selection (0 → left)
    await flush();
    expect(h.text.lastText).toBe("went-left");
  });

  it("choose(optionIndex) commits by original option index", () => {
    const onChoiceMade = vi.fn();
    const h = makeHarness({ onChoiceMade });
    h.session.play(choiceScript);
    h.session.choose(1);
    expect(onChoiceMade).toHaveBeenCalledWith({ index: 1, text: "right" });
  });

  it("a pointer commit via onChoiceChosen routes through the Session", () => {
    const onChoiceMade = vi.fn();
    const h = makeHarness({ onChoiceMade });
    h.session.play(choiceScript);
    // The Session wires the channel's pointer-commit callback in its ctor.
    h.choices.onChoiceChosen?.(1);
    expect(onChoiceMade).toHaveBeenCalledWith({ index: 1, text: "right" });
  });

  it("selectAt highlights by absolute position without wrapping", () => {
    const h = makeHarness();
    h.session.play(choiceScript);
    h.session.selectAt(1);
    expect(h.choices.highlights.at(-1)).toBe(1);
    const before = h.choices.highlights.length;
    h.session.selectAt(99); // out of range → ignored
    h.session.selectAt(1); // same as current → ignored
    expect(h.choices.highlights.length).toBe(before);
  });

  it("when the presenter owns the prompt, the chrome + body text are suppressed", () => {
    const h = makeHarness();
    h.choices.setOwnsPrompt(true);
    h.session.play(choiceScript);
    // The covert setNameplate(undefined) hide-all is gone: the chrome's
    // content is cleared via present(undefined) and it is hidden with an explicit
    // setVisible(false); the body text is cleared, not presented.
    expect(h.chrome.presented.at(-1)).toBeUndefined();
    expect(h.chrome.visibles.at(-1)).toBe(false);
    expect(h.choices.visibles.at(-1)).toBe(true);
    expect(h.text.presented).toHaveLength(0);
    expect(h.text.cleared).toBeGreaterThan(0);
  });
});

describe("DialogueSession — commands by timing", () => {
  it("fires `show`-timed commands when the line appears", async () => {
    const onCommand = vi.fn();
    const h = makeHarness();
    const script: DialogueScript = {
      id: "show-cmd",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "say", text: "x", commands: [{ type: "sfx", at: "show" }] }],
        },
      },
    };
    h.session.play(script, { fallbackCommand: onCommand });
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toMatchObject({ type: "sfx" });
  });

  it("defers `afterReveal` commands until the reveal completes", async () => {
    const onCommand = vi.fn();
    const h = makeHarness();
    const script: DialogueScript = {
      id: "after-cmd",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "say", text: "x", commands: [{ type: "boom", at: "afterReveal" }] }],
        },
      },
    };
    h.session.play(script, { fallbackCommand: onCommand });
    await Promise.resolve();
    expect(onCommand).not.toHaveBeenCalled(); // not yet — still revealing
    h.text.finishReveal();
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it("fires `advance`-timed commands as the player leaves the line", async () => {
    const onCommand = vi.fn();
    const h = makeHarness();
    const script: DialogueScript = {
      id: "advance-cmd",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "x", commands: [{ type: "leave", at: "advance" }] },
            { kind: "say", text: "y" },
          ],
        },
      },
    };
    h.session.play(script, { fallbackCommand: onCommand });
    h.text.finishReveal();
    expect(onCommand).not.toHaveBeenCalled();
    h.session.advance();
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: "leave" }),
      expect.objectContaining({ mode: "play" }),
    );
  });

  it("a blocking line-command gates advance until it resolves", async () => {
    let resolveCmd!: () => void;
    const gate = new Promise<void>((r) => (resolveCmd = r));
    const onCommand = vi.fn(() => gate);
    const h = makeHarness();
    const script: DialogueScript = {
      id: "blocking-line",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "one", commands: [{ type: "wait", at: "afterReveal", blocking: true }] },
            { kind: "say", text: "two" },
          ],
        },
      },
    };
    h.session.play(script, { fallbackCommand: onCommand });
    h.text.finishReveal(); // triggers the blocking afterReveal command
    await Promise.resolve();
    // While blocked, advance is ignored (continue caret not yet shown either).
    h.session.advance();
    expect(h.text.lastText).toBe("one");
    resolveCmd();
    await gate;
    await flush();
    // Now the caret is allowed and advancing proceeds.
    h.session.advance();
    await flush();
    expect(h.text.lastText).toBe("two");
  });

  it("routes a built-in `expression` command straight to the avatar", () => {
    const onCommand = vi.fn();
    const h = makeHarness();
    const script: DialogueScript = {
      id: "expr",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [{ type: "expression", value: "happy" }] },
            { kind: "say", text: "x" },
          ],
        },
      },
    };
    // `expression` is a built-in, so no handler is required for it; the fallback
    // is wired only to prove it is NOT reached.
    h.session.play(script, { fallbackCommand: onCommand });
    expect(h.avatar.expressions).toContain("happy");
    expect(onCommand).not.toHaveBeenCalled();
  });
});

describe("DialogueSession — fast-forward & skip", () => {
  it("setFastForward scales the text channel's reveal multiplier", () => {
    const h = makeHarness({ skipMultiplier: 4 });
    const script: DialogueScript = {
      id: "ff",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "x" }] } },
    };
    h.session.play(script);
    h.session.setFastForward(true);
    expect(h.text.speedMultiplier).toBe(4);
    h.session.setFastForward(false);
    expect(h.text.speedMultiplier).toBe(1);
  });

  it("skip() fast-forwards lines until the next choice", async () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "skip",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "one" },
            { kind: "say", text: "two" },
            { kind: "choice", options: [{ text: "ok", target: "b" }] },
          ],
        },
        b: { id: "b", steps: [{ kind: "say", text: "b1" }] },
      },
    };
    h.session.play(script);
    h.session.skip();
    await flush();
    expect(h.session.isChoosing()).toBe(true);
    // Only the first line was ever presented; "two" was skipped.
    expect(h.text.presented.map((l) => l.text.runs.map((r) => r.text).join(""))).toEqual(["one"]);
  });
});

describe("DialogueSession — preview (side-effect-free lookahead)", () => {
  it("returns linear lines, following goto, stopping at a choice", () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "preview",
      start: "a",
      speakers: { npc: { id: "npc", name: "Bee" } },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", speaker: "npc", text: "[b]hi[/b]" },
            { kind: "goto", target: "b" },
          ],
        },
        b: {
          id: "b",
          steps: [
            { kind: "say", text: "second" },
            { kind: "choice", options: [{ text: "x" }] },
          ],
        },
      },
    };
    h.session.play(script);
    const lines = h.session.preview("a");
    expect(lines).toEqual([
      { speaker: "Bee", text: "hi" }, // markup stripped
      { speaker: undefined, text: "second" },
    ]);
  });

  it("follows a conditional command jump using the current var snapshot", () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "preview-cond",
      start: "a",
      declare: { go: true },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [], condition: "go", target: "b" },
            { kind: "say", text: "not-taken" },
          ],
        },
        b: { id: "b", steps: [{ kind: "say", text: "taken" }] },
      },
    };
    h.session.play(script);
    expect(h.session.preview("a").map((l) => l.text)).toEqual(["taken"]);
  });
});

describe("DialogueSession — stop / restart", () => {
  it("stop() clears all channels and resets to idle", () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "stop",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", speaker: "s", text: "x" }] } },
      speakers: { s: { id: "s", name: "S" } },
    };
    h.session.play(script);
    h.session.stop();
    expect(h.session.isActive()).toBe(false);
    expect(h.text.cleared).toBeGreaterThan(0);
    expect(h.choices.cleared).toBeGreaterThan(0);
    expect(h.avatar.speaking.at(-1)).toBe(false);
    expect(h.avatar.speakers.at(-1)).toBeUndefined();
  });

  it("play() abandons an in-flight conversation before starting the new one", () => {
    const h = makeHarness();
    const first: DialogueScript = {
      id: "first",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "first-line" }] } },
    };
    const second: DialogueScript = {
      id: "second",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "second-line" }] } },
    };
    h.session.play(first);
    h.session.play(second);
    expect(h.text.lastText).toBe("second-line");
    expect(h.session.isActive()).toBe(true);
  });
});

describe("DialogueSession — channels without optional avatar/chrome", () => {
  it("works with only the required text + choices channels", async () => {
    const text = new StubText();
    const choices = new StubChoices();
    const session = new DialogueSession({ text, choices });
    const script: DialogueScript = {
      id: "minimal",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "hi" },
            { kind: "choice", options: [{ text: "bye" }] },
          ],
        },
      },
    };
    session.play(script);
    expect(text.lastText).toBe("hi");
    text.finishReveal();
    session.advance();
    await flush();
    expect(session.isChoosing()).toBe(true);
    expect(choices.lastLabels).toEqual(["bye"]);
  });
});

describe("DialogueSession — command-gate races (regressions)", () => {
  /** A gate the test opens, handed out for commands of `type`. */
  function gatedCommand(type: string) {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const onCommand = vi.fn((cmd: Command) =>
      cmd.type === type ? gate : undefined,
    );
    return { onCommand, open, gate };
  }

  it("an afterReveal batch resolving does not drop the gate of an in-flight blocking show command", async () => {
    const { onCommand, open, gate } = gatedCommand("long");
    const h = makeHarness();
    const script: DialogueScript = {
      id: "f02",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "say",
              text: "one",
              commands: [
                { type: "long", at: "show", blocking: true },
                { type: "ping", at: "afterReveal" },
              ],
            },
            { kind: "say", text: "two" },
          ],
        },
      },
    };
    h.session.play(script, { fallbackCommand: onCommand });
    await flush(); // blocking show command now in flight
    h.text.finishReveal(); // afterReveal batch fires and resolves immediately
    await flush();
    h.session.advance(); // must still be gated by the show command
    expect(h.text.lastText).toBe("one");
    open();
    await gate;
    await flush();
    h.session.advance();
    await flush();
    expect(h.text.lastText).toBe("two");
  });

  it("auto-advance is not consumed while a blocking command gates the line (no soft-lock)", async () => {
    const { onCommand, open, gate } = gatedCommand("long");
    const h = makeHarness();
    const script: DialogueScript = {
      id: "f03",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "say",
              text: "one",
              autoAdvanceMs: 50,
              commands: [{ type: "long", at: "show", blocking: true }],
            },
            { kind: "say", text: "two" },
          ],
        },
      },
    };
    h.session.play(script, { fallbackCommand: onCommand });
    await flush();
    h.text.finishReveal(); // arms the 50ms auto-timer; show command still blocking
    await flush();
    h.session.update(100); // timer expires while gated — must not be swallowed
    await flush();
    expect(h.text.lastText).toBe("one");
    open();
    await gate;
    await flush();
    h.session.update(1); // retried once unblocked — fires exactly once
    await flush();
    expect(h.text.lastText).toBe("two");
  });

  it("a second advance during a blocking command step does not re-fire the old line's advance commands", async () => {
    const { onCommand, open, gate } = gatedCommand("wait");
    const h = makeHarness();
    const script: DialogueScript = {
      id: "f04",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "one", commands: [{ type: "give", at: "advance" }] },
            { kind: "command", commands: [{ type: "wait", blocking: true }] },
            { kind: "say", text: "two" },
          ],
        },
      },
    };
    h.session.play(script, { fallbackCommand: onCommand });
    h.text.finishReveal();
    h.session.advance(); // fires "give", steps into the blocking command step
    await flush();
    h.session.advance(); // stale double-advance while the runner awaits "wait"
    await flush();
    const gives = onCommand.mock.calls.filter((c) => c[0].type === "give");
    expect(gives).toHaveLength(1);
    open();
    await gate;
    await flush();
    expect(h.text.lastText).toBe("two");
  });

  it("skip() fires the displayed line's afterReveal + advance batches in skip mode", async () => {
    const onCommand = vi.fn();
    const h = makeHarness();
    const script: DialogueScript = {
      id: "f05",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "say",
              text: "one",
              commands: [
                { type: "leave", at: "advance" },
                { type: "after", at: "afterReveal" },
              ],
            },
            { kind: "say", text: "two", commands: [{ type: "mid" }] },
            { kind: "choice", options: [{ text: "ok" }] },
          ],
        },
      },
    };
    h.session.play(script, { fallbackCommand: onCommand });
    h.session.skip(); // line one still revealing
    // skip() now awaits the current line's two batches before the runner walk,
    // so the chain is deeper than one flush() covers.
    await flush();
    await flush();
    expect(h.session.isChoosing()).toBe(true);
    // Current line's unfired batches first (afterReveal, then advance), then
    // the skipped line's commands — all in skip mode for idempotent handlers.
    expect(onCommand.mock.calls.map((c) => c[0].type)).toEqual([
      "after",
      "leave",
      "mid",
    ]);
    for (const call of onCommand.mock.calls) {
      expect(call[1]).toMatchObject({ mode: "skip" });
    }
    // "two" was never presented.
    expect(h.text.presented).toHaveLength(1);
  });

  it("skip() does not re-fire afterReveal commands already fired by the reveal", async () => {
    const onCommand = vi.fn();
    const h = makeHarness();
    const script: DialogueScript = {
      id: "f05b",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "one", commands: [{ type: "after", at: "afterReveal" }] },
            { kind: "choice", options: [{ text: "ok" }] },
          ],
        },
      },
    };
    h.session.play(script, { fallbackCommand: onCommand });
    h.text.finishReveal(); // fires "after" normally (play mode)
    await flush();
    h.session.skip();
    await flush();
    const afters = onCommand.mock.calls.filter((c) => c[0].type === "after");
    expect(afters).toHaveLength(1);
  });
});

describe("DialogueSession — confirm latch (regressions)", () => {
  const blockingChoice: DialogueScript = {
    id: "f06",
    start: "a",
    nodes: {
      a: {
        id: "a",
        steps: [
          {
            kind: "choice",
            options: [
              { text: "left", commands: [{ type: "wait", blocking: true }], target: "L" },
              { text: "right", target: "R" },
            ],
          },
        ],
      },
      L: { id: "L", steps: [{ kind: "say", text: "went-left" }] },
      R: { id: "R", steps: [{ kind: "say", text: "went-right" }] },
    },
  };

  it("mashing confirm during a blocking choice command emits onChoiceMade once", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const onCommand = vi.fn((cmd: Command) => (cmd.type === "wait" ? gate : undefined));
    const onChoiceMade = vi.fn();
    const h = makeHarness({ onChoiceMade });
    h.session.play(blockingChoice, { fallbackCommand: onCommand });
    h.session.confirm();
    h.session.confirm(); // mash — mode is still "choosing" while "wait" is awaited
    h.session.moveSelection(1); // must not move the (committed) selection
    h.session.confirm(); // a third mash can't emit a different index either
    await flush();
    expect(onChoiceMade).toHaveBeenCalledTimes(1);
    expect(onChoiceMade).toHaveBeenCalledWith({ index: 0, text: "left" });
    expect(h.choices.highlights).not.toContain(1);
    open();
    await gate;
    await flush();
    expect(h.text.lastText).toBe("went-left");
  });

  it("the latch releases on the next presentation (a later choice still works)", async () => {
    const onChoiceMade = vi.fn();
    const h = makeHarness({ onChoiceMade });
    const script: DialogueScript = {
      id: "f06b",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "choice", options: [{ text: "first" }] },
            { kind: "choice", options: [{ text: "second" }] },
          ],
        },
      },
    };
    h.session.play(script);
    h.session.confirm();
    await flush();
    h.session.confirm();
    await flush();
    expect(onChoiceMade).toHaveBeenCalledTimes(2);
  });
});

describe("DialogueSession — avatar on choices (regression)", () => {
  it("handleChoice drives the avatar with the choice's speaker", async () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "f46",
      start: "a",
      speakers: {
        hero: { id: "hero", name: "Hero" },
        gwen: { id: "gwen", name: "Gwen" },
      },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", speaker: "hero", text: "hi", expression: "happy" },
            { kind: "choice", speaker: "gwen", options: [{ text: "x" }] },
          ],
        },
      },
    };
    h.session.play(script);
    h.text.finishReveal();
    h.session.advance();
    await flush();
    expect(h.session.isChoosing()).toBe(true);
    // The choice's speaker owns the portrait now; the say-line's expression and
    // talk-state must not linger.
    expect(h.avatar.speakers.at(-1)).toMatchObject({ id: "gwen" });
    expect(h.avatar.expressions.at(-1)).toBeUndefined();
    expect(h.avatar.speaking.at(-1)).toBe(false);
  });

  it("a speakerless choice clears the previous speaker's portrait", async () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "f46b",
      start: "a",
      speakers: { hero: { id: "hero", name: "Hero" } },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", speaker: "hero", text: "hi" },
            { kind: "choice", options: [{ text: "x" }] },
          ],
        },
      },
    };
    h.session.play(script);
    h.text.finishReveal();
    h.session.advance();
    await flush();
    expect(h.session.isChoosing()).toBe(true);
    expect(h.avatar.speakers.at(-1)).toBeUndefined();
  });
});

describe("DialogueSession — handle & play-time validation", () => {
  it("play() returns a handle that reads and writes variables", () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "handle",
      start: "a",
      declare: { gold: 0 },
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } },
    };
    const handle = h.session.play(script);
    expect(handle.getVars()).toEqual({ gold: 0 });
    handle.setVar("gold", 42);
    expect(handle.getVars()).toEqual({ gold: 42 });
  });

  it("a stale handle no-ops after the conversation is replaced", () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "stale",
      start: "a",
      declare: { n: 1 },
      // A fresh storage per play so the persistent default store isn't shared
      // between the two conversations (which would make `setVar` visible).
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "x" }] } },
    };
    const first = h.session.play(script, { storage: new MemoryVariableStorage() });
    h.session.play(script, { storage: new MemoryVariableStorage() }); // bumps generation
    first.setVar("n", 99); // stale → no-op
    expect(first.getVars()).toEqual({}); // stale → empty snapshot
  });

  it("a stale blocking command's ctx.setVar does not mutate the storage after replace", async () => {
    // The skill-check seam under a generation race (PR-A1 checklist): a slow
    // blocking command captured before the conversation is replaced must not
    // write through when it finally resolves. ctx.setVar and handle.setVar share
    // the same generation-guarded storage view, so the guard covers both.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const storage = new MemoryVariableStorage();
    const h = makeHarness({
      storage,
      commands: {
        slow: async (_cmd, ctx) => {
          await gate;
          ctx.setVar("touched", true); // fires AFTER the conversation is replaced
        },
      },
    });
    const script: DialogueScript = {
      id: "race",
      start: "a",
      declare: { touched: false },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [{ type: "slow", blocking: true }] },
            { kind: "say", text: "after" },
          ],
        },
      },
    };
    h.session.play(script); // parks in the blocking command, awaiting the gate
    await flush();
    // Replace with a trivial conversation — stop() bumps the generation.
    h.session.play({
      id: "other",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "new" }] } },
    });
    release(); // resolve the abandoned command; its ctx.setVar must no-op
    await flush();
    expect(storage.get("touched")).toBe(false);
  });

  it("rejects a read name that nothing provides", () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "missing-read",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "{gold}" }] } },
    };
    expect(() => h.session.play(script)).toThrow(/reads "gold"/);
  });

  it("rejects an unhandled (non-built-in) command type", () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "unhandled",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [{ type: "give-item" }] },
            { kind: "say", text: "x" },
          ],
        },
      },
    };
    expect(() => h.session.play(script)).toThrow(/no handler for command type/);
  });

  it("a play() that fails validation leaves the running conversation intact", async () => {
    const h = makeHarness();
    const alpha: DialogueScript = {
      id: "alpha",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "alpha" }] } },
    };
    h.session.play(alpha);
    await flush();
    expect(h.session.isActive()).toBe(true);
    expect(h.text.lastText).toBe("alpha");

    // A second play() whose script reads an unprovided name must throw — and,
    // because validation now runs before stop(), it must NOT abandon `alpha`.
    const invalid: DialogueScript = {
      id: "bad",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "{ghost}" }] } },
    };
    const clearsBefore = h.text.cleared;
    expect(() => h.session.play(invalid)).toThrow(/reads "ghost"/);
    expect(h.session.isActive()).toBe(true); // alpha still running
    expect(h.text.lastText).toBe("alpha");
    expect(h.text.cleared).toBe(clearsBefore); // nothing was torn down
  });

  it("a seed the storage can't accept throws a DialoguePlayError, atomically", async () => {
    const h = makeHarness();
    const alpha: DialogueScript = {
      id: "alpha",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "alpha" }] } },
    };
    h.session.play(alpha);
    await flush();
    expect(h.session.isActive()).toBe(true);

    // A pure read-only cells() storage with no writable slot for the declared
    // default — seeding `greeted` must fail cleanly, not as a raw error.
    const readonly = cells({ hp: () => 10 });
    const needsSeed: DialogueScript = {
      id: "needs-seed",
      start: "a",
      declare: { greeted: false },
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } },
    };
    expect(() => h.session.play(needsSeed, { storage: readonly })).toThrow(DialoguePlayError);
    expect(() => h.session.play(needsSeed, { storage: readonly })).toThrow(
      /seed declared default "greeted"/,
    );
    // The failed seed ran before stop(), so alpha is untouched.
    expect(h.session.isActive()).toBe(true);
    expect(h.text.lastText).toBe("alpha");
  });
});

describe("DialogueSession — storage model", () => {
  // Scenario 1: a choice gated on an item the player is granted mid-conversation.
  it("a give-item command grants a key a later choice gate reads (scenario 1)", async () => {
    const inventory = new Set<string>();
    const h = makeHarness({
      functions: { has_item: (id) => inventory.has(String(id)) },
      commands: { "give-item": (cmd) => void inventory.add(String(cmd.id)) },
    });
    const gate = {
      kind: "call" as const,
      fn: "has_item",
      args: [{ kind: "literal" as const, value: "rusty-key" }],
    };
    const script: DialogueScript = {
      id: "key-gate",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [{ type: "give-item", id: "rusty-key" }] },
            {
              kind: "choice",
              options: [
                { text: "Hand over the rusty key", target: "give", condition: gate },
                { text: "Say nothing", target: "none" },
              ],
            },
          ],
        },
        give: { id: "give", steps: [{ kind: "say", text: "handed-over" }] },
        none: { id: "none", steps: [{ kind: "say", text: "said-nothing" }] },
      },
    };
    h.session.play(script);
    await flush();
    // Both options are reachable — the key was granted by the earlier command.
    expect(h.choices.lastLabels).toEqual(["Hand over the rusty key", "Say nothing"]);
    h.session.choose(0);
    await flush();
    expect(h.text.lastText).toBe("handed-over");
  });

  // Scenario 2: a blocking skill-check writes a var the next node branches on.
  it("a blocking skill-check ctx.setVar drives the next branch (scenario 2)", async () => {
    const h = makeHarness({
      commands: {
        "skill-check": (_cmd, ctx) => {
          ctx.setVar("passed", true);
        },
      },
    });
    const script: DialogueScript = {
      id: "skill",
      start: "a",
      declare: { passed: false },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [{ type: "skill-check", stat: "strength", blocking: true }] },
            { kind: "command", commands: [], condition: "passed", target: "win" },
            { kind: "say", text: "lose" },
          ],
        },
        win: { id: "win", steps: [{ kind: "say", text: "win" }] },
      },
    };
    h.session.play(script);
    await flush();
    expect(h.text.lastText).toBe("win");
  });

  it("persists variables across plays on the same session", () => {
    const h = makeHarness();
    const bump: DialogueScript = {
      id: "bump",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "command",
              commands: [
                {
                  type: "set",
                  var: "count",
                  value: {
                    kind: "binary",
                    op: "+",
                    left: { kind: "varRef", name: "count" },
                    right: { kind: "literal", value: 1 },
                  },
                },
              ],
            },
            { kind: "say", text: "x" },
          ],
        },
      },
    };
    // Seed `count` once via a declared default, then increment across plays.
    const seeded: DialogueScript = { ...bump, declare: { count: 0 } };
    const a = h.session.play(seeded);
    expect(a.getVars().count).toBe(1);
    const b = h.session.play(seeded); // seed-if-absent: NOT reset to 0
    expect(b.getVars().count).toBe(2);
  });

  // The cycling-NPC counter: talk to the same NPC repeatedly, dialogue changes.
  it("a cycling NPC reads a persistent counter to change its line", async () => {
    const h = makeHarness();
    const incr = {
      kind: "binary" as const,
      op: "+" as const,
      left: { kind: "varRef" as const, name: "timesTalked" },
      right: { kind: "literal" as const, value: 1 },
    };
    const script: DialogueScript = {
      id: "npc",
      start: "a",
      declare: { timesTalked: 0 },
      nodes: {
        a: {
          id: "a",
          steps: [
            // Increment on entry, then gate on the (now-persisted) prior count.
            { kind: "command", commands: [{ type: "set", var: "timesTalked", value: incr }] },
            { kind: "command", commands: [], condition: { var: "timesTalked", op: ">", value: 1 }, target: "again" },
            { kind: "say", text: "first-meeting" },
          ],
        },
        again: { id: "again", steps: [{ kind: "say", text: "we-meet-again" }] },
      },
    };
    h.session.play(script);
    await flush();
    expect(h.text.lastText).toBe("first-meeting"); // timesTalked: 0 → 1
    h.session.play(script); // talk again — counter persisted (seed-if-absent skips)
    await flush();
    expect(h.text.lastText).toBe("we-meet-again"); // timesTalked: 1 → 2
  });

  it("a two-way cells accessor lets a `set` expression write through to game state", async () => {
    let gold = 100; // the game owns this; the cell binds it two-way
    const onLine = vi.fn();
    const h = makeHarness({
      onLine,
      storage: compose(
        cells({ gold: { get: () => gold, set: (v) => (gold = Number(v)) } }),
        new MemoryVariableStorage(),
      ),
    });
    const script: DialogueScript = {
      id: "spend",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "command",
              commands: [
                {
                  type: "set",
                  var: "gold",
                  value: {
                    kind: "binary",
                    op: "-",
                    left: { kind: "varRef", name: "gold" },
                    right: { kind: "literal", value: 50 },
                  },
                },
              ],
            },
            { kind: "say", text: "You have {gold} gold." },
          ],
        },
      },
    };
    h.session.play(script);
    await flush();
    expect(gold).toBe(50); // written through the cells setter
    expect(onLine).toHaveBeenLastCalledWith({ speaker: undefined, text: "You have 50 gold." });
  });

  it("a read-only `set` in an option's commands is reported, not a wedge", async () => {
    // Greptile's choose() dead-lock: a `set` to a getter-only cell inside an
    // option's commands used to throw out of the un-awaited choose() chain and
    // freeze the choosing state. Now it's caught + reported, and the choice
    // still branches.
    const errors: string[] = [];
    const h = makeHarness({
      storage: cells({ hp: () => 10 }),
      onError: (msg) => errors.push(msg),
    });
    const script: DialogueScript = {
      id: "ro-choice",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "choice",
              options: [
                { text: "poke", target: "next", commands: [{ type: "set", var: "hp", value: 5 }] },
              ],
            },
          ],
        },
        next: { id: "next", steps: [{ kind: "say", text: "after" }] },
      },
    };
    h.session.play(script);
    await flush();
    h.session.choose(0);
    await flush();
    expect(h.text.lastText).toBe("after"); // branched instead of freezing
    expect(errors.some((m) => /read-only/.test(m))).toBe(true);
  });

  it("an expression condition combines storage reads and a function call", async () => {
    let rude = false;
    const h = makeHarness({
      functions: { afford: (cost) => 100 >= Number(cost) },
      storage: cells({ rude: () => rude }),
    });
    const script: DialogueScript = {
      id: "expr-cond",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "command",
              commands: [],
              // afford(50) and not rude
              condition: {
                kind: "binary",
                op: "and",
                left: { kind: "call", fn: "afford", args: [{ kind: "literal", value: 50 }] },
                right: { kind: "unary", op: "not", operand: { kind: "varRef", name: "rude" } },
              },
              target: "ok",
            },
            { kind: "say", text: "no" },
          ],
        },
        ok: { id: "ok", steps: [{ kind: "say", text: "yes" }] },
      },
    };
    h.session.play(script);
    await flush();
    expect(h.text.lastText).toBe("yes");
    rude = true;
    h.session.play(script); // re-evaluate with rude flipped
    await flush();
    expect(h.text.lastText).toBe("no");
  });
});
