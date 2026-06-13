import { describe, expect, it, vi } from "vitest";

import { defineScript } from "./defineScript.js";
import { DialogueSession } from "./session.js";
import type { ChoiceChannel, TextChannel } from "./session.js";

// Minimal channels — enough to play a one-line script headlessly.
class NoopText implements TextChannel {
  onRevealComplete?: () => void;
  present(): void {
    this.onRevealComplete?.();
  }
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
}
class NoopChoices implements ChoiceChannel {
  present(): void {}
  highlight(): void {}
  clear(): void {}
}

describe("defineScript", () => {
  it("is an identity function at runtime (no brand leaks into the object)", () => {
    const raw = {
      id: "s",
      start: "a",
      vars: { greeted: false },
      external: { gold: "number" },
      nodes: { a: { id: "a", steps: [{ kind: "end" }] } },
    } as const;
    const script = defineScript(raw);
    expect(script).toBe(raw);
    expect(Object.keys(script)).toEqual(Object.keys(raw));
  });

  it("drives interpolation + a typed binding end-to-end", () => {
    const onLine = vi.fn();
    const session = new DialogueSession(
      { text: new NoopText(), choices: new NoopChoices() },
      { onLine },
    );
    const script = defineScript({
      id: "typed",
      start: "a",
      vars: { name: "stranger" },
      external: { gold: "number" },
      nodes: {
        a: { id: "a", steps: [{ kind: "say", text: "{name} has {gold} gold." }] },
      },
    });
    // `state` is required (externals) and type-checked; the handle is typed.
    const handle = session.play(script, { state: { gold: () => 7, name: "Mara" } });
    expect(onLine).toHaveBeenCalledWith({
      speaker: undefined,
      text: "Mara has 7 gold.",
    });
    handle.setVar("name", "Mara the Bold");
    expect(handle.getVars().name).toBe("Mara the Bold");
  });

  it("enforces the binding shape at compile time", () => {
    // Compile-time-only assertions: this closure is type-checked but never run
    // (the bad calls would throw at play-time, which is the point — the type
    // system is what should reject them first).
    const typeChecks = (session: DialogueSession): void => {
      const script = defineScript({
        id: "needs-ext",
        start: "a",
        external: { gold: "number" },
        nodes: { a: { id: "a", steps: [{ kind: "end" }] } },
      });

      // @ts-expect-error — a script with externals requires a binding.
      session.play(script);

      // @ts-expect-error — `gold` must be a number (or () => number), not a string.
      session.play(script, { state: { gold: "lots" } });

      // The correct call type-checks.
      session.play(script, { state: { gold: 5 } });
    };

    expect(typeof typeChecks).toBe("function");
  });
});
