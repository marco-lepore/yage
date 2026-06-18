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
      declare: { greeted: false },
      nodes: { a: { id: "a", steps: [{ kind: "end" }] } },
    } as const;
    const script = defineScript(raw);
    expect(script).toBe(raw);
    expect(Object.keys(script)).toEqual(Object.keys(raw));
  });

  it("drives interpolation + a typed handle end-to-end (content-only play)", () => {
    const onLine = vi.fn();
    const session = new DialogueSession(
      { text: new NoopText(), choices: new NoopChoices() },
      { onLine },
    );
    const script = defineScript({
      id: "typed",
      start: "a",
      declare: { name: "stranger" },
      nodes: {
        a: { id: "a", steps: [{ kind: "say", text: "{name} greets you." }] },
      },
    });
    // play(script) is content-only — storage is installed on the session; the
    // declared default `name` seeds it, and the handle is typed to keyof declare.
    const handle = session.play(script);
    expect(onLine).toHaveBeenCalledWith({
      speaker: undefined,
      text: "stranger greets you.",
    });
    handle.setVar("name", "Mara");
    expect(handle.getVars().name).toBe("Mara");
  });

  it("types the handle to the declared variables (compile-time)", () => {
    // Compile-time-only assertions: this closure is type-checked but never run.
    const typeChecks = (session: DialogueSession): void => {
      const script = defineScript({
        id: "typed",
        start: "a",
        declare: { greeted: false, gold: 0 },
        nodes: { a: { id: "a", steps: [{ kind: "end" }] } },
      });

      const handle = session.play(script);
      handle.setVar("greeted", true); // ok
      handle.setVar("gold", 5); // ok

      // @ts-expect-error — "bogus" is not a declared variable.
      handle.setVar("bogus", 1);

      // @ts-expect-error — `greeted` is a boolean; a number is rejected.
      handle.setVar("greeted", 99);

      const greeted: boolean = handle.getVars().greeted; // typed by the declare
      void greeted;
    };

    expect(typeof typeChecks).toBe("function");
  });
});
