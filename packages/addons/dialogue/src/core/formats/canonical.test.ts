import { describe, expect, it } from "vitest";

import { DialogueScriptError, loadScript } from "./canonical.js";
import type { DialogueScript } from "../types.js";

function script(partial: Partial<DialogueScript>): DialogueScript {
  return {
    id: "t",
    start: "a",
    nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } },
    ...partial,
  } as DialogueScript;
}

describe("loadScript — structural validation", () => {
  it("accepts a minimal valid script", () => {
    expect(() => loadScript(script({}))).not.toThrow();
  });

  it("rejects a goto without a target (instead of silently ending at runtime)", () => {
    const s = script({
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "goto" } as unknown as { kind: "goto"; target: string }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(DialogueScriptError);
    expect(() => loadScript(s)).toThrow(/goto has no target/);
  });

  it("rejects a goto whose target does not exist", () => {
    const s = script({
      nodes: { a: { id: "a", steps: [{ kind: "goto", target: "missing" }] } },
    });
    expect(() => loadScript(s)).toThrow(/jump target "missing"/);
  });

  it("rejects a choice with no options", () => {
    const s = script({
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "choice", options: [] }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/choice has no options/);
  });
});

describe("loadScript — speaker validation", () => {
  it("rejects a speakers record whose key != speaker.id", () => {
    const s = script({
      speakers: { gwen: { id: "gewn", name: "Gwen" } },
    });
    expect(() => loadScript(s)).toThrow(DialogueScriptError);
    expect(() => loadScript(s)).toThrow(/speaker key "gwen" != speaker.id "gewn"/);
  });

  it("rejects a say.speaker that is not in script.speakers", () => {
    const s = script({
      speakers: { gwen: { id: "gwen", name: "Gwen" } },
      nodes: {
        a: { id: "a", steps: [{ kind: "say", speaker: "gwne", text: "typo" }] },
      },
    });
    expect(() => loadScript(s)).toThrow(/speaker "gwne" is not in script.speakers/);
  });

  it("rejects a choice.speaker that is not in script.speakers", () => {
    const s = script({
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "choice", speaker: "ghost", options: [{ text: "x" }] }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/speaker "ghost"/);
  });

  it("accepts matching keys and resolvable speaker references", () => {
    const s = script({
      speakers: { gwen: { id: "gwen", name: "Gwen" } },
      nodes: {
        a: { id: "a", steps: [{ kind: "say", speaker: "gwen", text: "hi" }] },
      },
    });
    expect(() => loadScript(s)).not.toThrow();
  });

  it("speakerless lines remain valid (narrator)", () => {
    expect(() => loadScript(script({}))).not.toThrow();
  });
});
