import { describe, expect, it } from "vitest";

import { DialogueSession } from "../session.js";
import { createVoiceChannel } from "./voice.js";
import type { ChoiceChannel, PresentedLine, TextChannel } from "../index.js";
import type { DialogueScript } from "../types.js";

/** A controllable text channel: reveal does NOT advance on its own — a test
 *  calls `finishReveal()` to fire the reveal listener, exercising the gate. */
class StubText implements TextChannel {
  readonly presented: PresentedLine[] = [];
  private revealing = false;
  private listener: (() => void) | undefined;
  present(line: PresentedLine): void {
    this.presented.push(line);
    this.revealing = true;
  }
  completeReveal(): void {
    this.finishReveal();
  }
  isRevealComplete(): boolean {
    return !this.revealing;
  }
  isRevealing(): boolean {
    return this.revealing;
  }
  setSpeedMultiplier(): void {}
  setVisible(): void {}
  update(): void {}
  clear(): void {
    this.revealing = false;
  }
  setRevealListener(listener: (() => void) | undefined): void {
    this.listener = listener;
  }
  setBeatListener(): void {}
  finishReveal(): void {
    if (!this.revealing) return;
    this.revealing = false;
    this.listener?.();
  }
}

/** A no-op choice channel — these tests never enter a choice except the one
 *  that checks `present` is NOT fanned out for choice prompts. */
class StubChoices implements ChoiceChannel {
  present(): void {}
  highlight(): void {}
  setVisible(): void {}
  clear(): void {}
}

const oneLine: DialogueScript = {
  id: "one",
  start: "n",
  nodes: { n: { id: "n", steps: [{ kind: "say", text: "hi" }] } },
};

const lastText = (line: PresentedLine | undefined): string =>
  line ? line.text.runs.map((r) => r.text).join("") : "";

/** The runner steps async across non-say boundaries / awaited reveal-complete;
 *  drain a few microtask turns before asserting the settled state. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("DialogueSession — extra channels", () => {
  it("a shop channel reacts to a command and the host reads the result via the handle", () => {
    // The `buy` type needs a registered handler to validate; the consequence
    // (mutating state) lives in the CHANNEL's command hook — rules in (the
    // no-op handler), consequences out (the channel's ctx.setVar).
    const session = new DialogueSession(
      { text: new StubText(), choices: new StubChoices() },
      { commands: { buy: () => {} } },
    );
    const sold: string[] = [];
    session.addChannel({
      command(command, ctx) {
        if (command.type === "buy") {
          sold.push(String(command.item));
          ctx.setVar("owns_sword", true); // write-only ctx
        }
      },
    });

    const handle = session.play({
      id: "shop",
      start: "n",
      nodes: {
        n: {
          id: "n",
          steps: [
            { kind: "command", commands: [{ type: "buy", item: "sword" }] },
            { kind: "say", text: "Pleasure doing business." },
          ],
        },
      },
    });

    expect(sold).toEqual(["sword"]);
    // The host reads game state back through the handle, NOT the command ctx.
    expect(handle.getVars()).toMatchObject({ owns_sword: true });
  });

  it("a registered voice channel holds auto-advance until its clip ends, then advances once", async () => {
    const text = new StubText();
    let autoAdvances = 0;
    const session = new DialogueSession(
      { text, choices: new StubChoices() },
      { onAutoAdvance: () => autoAdvances++ },
    );
    let endClip: (() => void) | undefined;
    let startedId: string | undefined;
    session.addChannel(
      createVoiceChannel({
        play: (id, onEnded) => {
          startedId = id;
          endClip = onEnded;
          return { stop: () => {} };
        },
      }),
    );
    session.setAutoAdvance(100); // auto-advance 100ms after a line reveals

    session.play({
      id: "v",
      start: "n",
      nodes: {
        n: {
          id: "n",
          steps: [
            { kind: "say", text: "Listen close.", voice: "vo_1" },
            { kind: "say", text: "Done." },
          ],
        },
      },
    });

    expect(startedId).toBe("vo_1"); // present fanned out → the clip started
    text.finishReveal(); // arms the auto-timer on the TEXT reveal
    await flush();
    session.update(0.5); // well past 0.1s…
    expect(autoAdvances).toBe(0); // …but the voice gate freezes the clock

    endClip?.(); // the clip ends → the gate releases (count-on-aggregate)
    session.update(0.15); // the armed clock now counts down
    expect(autoAdvances).toBe(1);
  });

  it("the voice liveness cap force-releases the gate end-to-end, so a wedged clip can't soft-lock auto-advance", async () => {
    const text = new StubText();
    let autoAdvances = 0;
    const session = new DialogueSession(
      { text, choices: new StubChoices() },
      { onAutoAdvance: () => autoAdvances++ },
    );
    const errors: string[] = [];
    session.addChannel(
      createVoiceChannel({
        play: () => ({ stop: () => {} }), // wedged: onEnded is NEVER called
        livenessMs: 200,
        onError: (message) => errors.push(message),
      }),
    );
    session.setAutoAdvance(50);

    session.play({
      id: "v",
      start: "n",
      nodes: {
        n: {
          id: "n",
          steps: [
            { kind: "say", text: "Wedged voice.", voice: "vo_stuck" },
            { kind: "say", text: "Freed." },
          ],
        },
      },
    });

    text.finishReveal(); // arms the auto-timer on the text reveal
    await flush();
    session.update(0.1); // 100ms, under the 200ms budget → the wedged voice still gates
    expect(autoAdvances).toBe(0);
    expect(errors).toHaveLength(0);

    session.update(0.15); // 250ms total > budget → liveness trips through the session
    expect(errors).toHaveLength(1); // reported once
    expect(autoAdvances).toBe(1); // …and auto-advance proceeds (no soft-lock)
  });

  it("a pure observer (no isRevealComplete) never gates auto-advance", async () => {
    const text = new StubText();
    let autoAdvances = 0;
    const session = new DialogueSession(
      { text, choices: new StubChoices() },
      { onAutoAdvance: () => autoAdvances++ },
    );
    const seen: string[] = [];
    session.addChannel({ present: (line) => seen.push(lastText(line)) });
    session.setAutoAdvance(50);

    session.play({
      id: "o",
      start: "n",
      nodes: {
        n: { id: "n", steps: [{ kind: "say", text: "Only line." }, { kind: "end" }] },
      },
    });

    expect(seen).toEqual(["Only line."]); // present fanned out for the say line
    text.finishReveal();
    await flush();
    session.update(0.05);
    expect(autoAdvances).toBe(1); // an observer without the method never blocks
  });

  it("present fans out for say lines only — not choice prompts", () => {
    const session = new DialogueSession({
      text: new StubText(),
      choices: new StubChoices(),
    });
    const presents: PresentedLine[] = [];
    session.addChannel({ present: (line) => presents.push(line) });

    session.play({
      id: "c",
      start: "n",
      nodes: {
        n: {
          id: "n",
          steps: [{ kind: "choice", text: "Pick:", options: [{ text: "ok" }] }],
        },
      },
    });

    expect(presents).toHaveLength(0);
  });

  it("clears extras on an explicit stop", () => {
    const session = new DialogueSession({
      text: new StubText(),
      choices: new StubChoices(),
    });
    session.play(oneLine); // the play()-internal stop runs before we register
    let clears = 0;
    session.addChannel({ clear: () => clears++ });
    session.stop();
    expect(clears).toBe(1);
  });

  it("clears extras when the conversation ends", async () => {
    const text = new StubText();
    const session = new DialogueSession({ text, choices: new StubChoices() });
    session.play(oneLine);
    let clears = 0;
    session.addChannel({ clear: () => clears++ });
    text.finishReveal();
    session.advance(); // off the only line → end
    await flush();
    expect(clears).toBe(1);
  });

  it("catches up setVisible/setPaused on register, with no present replay", () => {
    const session = new DialogueSession({
      text: new StubText(),
      choices: new StubChoices(),
    });
    session.setHidden(true);
    session.setPaused(true);
    session.play(oneLine); // a line is on screen

    const events: string[] = [];
    session.addChannel({
      present: () => events.push("present"),
      setVisible: (v) => events.push(`visible:${v}`),
      setPaused: (p) => events.push(`paused:${p}`),
    });

    // The host levers are caught up; the on-screen line is NOT replayed (which
    // would restart a voice clip).
    expect(events).toEqual(["visible:false", "paused:true"]);
  });

  it("fans setVisible/setPaused out to registered extras", () => {
    const session = new DialogueSession({
      text: new StubText(),
      choices: new StubChoices(),
    });
    const events: string[] = [];
    session.addChannel({
      setVisible: (v) => events.push(`visible:${v}`),
      setPaused: (p) => events.push(`paused:${p}`),
    });
    session.play(oneLine);
    events.length = 0; // ignore the register catch-up + play visibility
    session.setHidden(true);
    session.setPaused(true);
    expect(events).toEqual(["visible:false", "paused:true"]);
  });

  it("fans completeReveal out when the player skips the typewriter (advance while revealing)", () => {
    const session = new DialogueSession({
      text: new StubText(),
      choices: new StubChoices(),
    });
    let completes = 0;
    session.addChannel({ completeReveal: () => completes++ });
    session.play(oneLine); // revealing
    session.advance(); // still typing → completeReveal, not a step
    expect(completes).toBe(1);
  });

  it("fans completeReveal out on skip()", () => {
    const session = new DialogueSession({
      text: new StubText(),
      choices: new StubChoices(),
    });
    let completes = 0;
    session.addChannel({ completeReveal: () => completes++ });
    session.play(oneLine);
    session.skip();
    expect(completes).toBe(1);
  });

  it("fans update(dt) out to extras after the pause guard (and freezes while paused)", () => {
    const session = new DialogueSession({
      text: new StubText(),
      choices: new StubChoices(),
    });
    let ticks = 0;
    session.addChannel({ update: () => ticks++ });
    session.play(oneLine);
    session.update(0.016);
    expect(ticks).toBe(1);
    session.setPaused(true);
    session.update(0.016); // frozen: the pause guard returns before the extras tick
    expect(ticks).toBe(1);
  });

  it("a throwing channel hook is routed to onError, never thrown", () => {
    const errors: unknown[] = [];
    const session = new DialogueSession(
      { text: new StubText(), choices: new StubChoices() },
      { onError: (_message, error) => errors.push(error) },
    );
    session.addChannel({
      present: () => {
        throw new Error("boom");
      },
    });
    expect(() => session.play(oneLine)).not.toThrow();
    expect(errors).toHaveLength(1);
  });

  it("the disposer unregisters the channel and calls dispose()", () => {
    const session = new DialogueSession({
      text: new StubText(),
      choices: new StubChoices(),
    });
    let presents = 0;
    let disposed = 0;
    const dispose = session.addChannel({
      present: () => presents++,
      dispose: () => disposed++,
    });
    session.play(oneLine);
    expect(presents).toBe(1);

    dispose();
    expect(disposed).toBe(1);

    dispose(); // idempotent — a second call must not double-dispose
    expect(disposed).toBe(1);

    session.play(oneLine); // re-play → the disposed channel is gone
    expect(presents).toBe(1);
  });

  it("revealComplete fans out the presented line after the reveal finishes", async () => {
    const text = new StubText();
    const session = new DialogueSession({ text, choices: new StubChoices() });
    const completed: string[] = [];
    session.addChannel({ revealComplete: (line) => completed.push(lastText(line)) });
    session.play(oneLine);
    expect(completed).toHaveLength(0); // not yet revealed
    text.finishReveal();
    await flush();
    expect(completed).toEqual(["hi"]);
  });
});
