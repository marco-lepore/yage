import { describe, expect, it, vi } from "vitest";

import {
  DialogueRunner,
  evalCondition,
  type ResolvedChoice,
  type RunnerHandlers,
} from "./runner.js";
import type {
  ChoiceStep,
  Command,
  CommandContext,
  DialogueScript,
  SayStep,
  SpeakerDef,
  VarMap,
} from "./types.js";

/**
 * Records everything the runner surfaces so a test can assert the exact
 * sequence of lines/choices/commands/end the state machine produced.
 */
interface Recorder {
  readonly handlers: RunnerHandlers;
  readonly says: SayStep[];
  readonly choiceSets: { step: ChoiceStep; choices: readonly ResolvedChoice[] }[];
  readonly commands: { command: Command; ctx: CommandContext }[];
  ended: number;
}

function makeRecorder(
  onCommand?: (command: Command, ctx: CommandContext) => void | Promise<void>,
): Recorder {
  const says: SayStep[] = [];
  const choiceSets: { step: ChoiceStep; choices: readonly ResolvedChoice[] }[] = [];
  const commands: { command: Command; ctx: CommandContext }[] = [];
  const rec: Recorder = {
    says,
    choiceSets,
    commands,
    ended: 0,
    handlers: {
      onSay: (step) => void says.push(step),
      onChoice: (step, choices) => void choiceSets.push({ step, choices }),
      onCommand: (command, ctx) => {
        commands.push({ command, ctx });
        return onCommand?.(command, ctx);
      },
      onEnd: () => void (rec.ended += 1),
    },
  };
  return rec;
}

/** Convenience: text of every say line surfaced, in order. */
function lineTexts(rec: Recorder): string[] {
  return rec.says.map((s) => s.text);
}

/**
 * The runner's `run()` loop is async (it may `await` blocking commands), so the
 * continuation that walks past a non-`say` step — `goto`, `command`, `set`, a
 * skipped/empty `choice` — lands on the microtask queue rather than running
 * synchronously inside `start()`/`advance()`. Drain a few microtask turns so a
 * test can assert the settled state. (Pure `say→say` flows settle synchronously
 * and don't need this.)
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("DialogueRunner — linear flow", () => {
  it("walks say steps one advance at a time, then ends off the end", () => {
    const script: DialogueScript = {
      id: "linear",
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
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);

    runner.start();
    expect(lineTexts(rec)).toEqual(["one"]);
    expect(rec.ended).toBe(0);

    runner.advance();
    expect(lineTexts(rec)).toEqual(["one", "two"]);

    runner.advance(); // off the end of node "a" → end
    expect(rec.ended).toBe(1);
    expect(runner.isEnded()).toBe(true);
  });

  it("start() is idempotent — a second call does not re-emit the first line", () => {
    const script: DialogueScript = {
      id: "idem",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } },
    };
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    runner.start();
    expect(lineTexts(rec)).toEqual(["hi"]);
  });

  it("advance() is a no-op when not on a say line", () => {
    const script: DialogueScript = {
      id: "noop",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } },
    };
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);
    // Before start(): idle, advance ignored.
    runner.advance();
    expect(lineTexts(rec)).toEqual([]);
    runner.start();
    runner.advance(); // ends
    runner.advance(); // already ended → ignored, no extra onEnd
    expect(rec.ended).toBe(1);
  });

  it("an explicit `end` step ends immediately and skips later steps", () => {
    const script: DialogueScript = {
      id: "explicit-end",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "one" },
            { kind: "end" },
            { kind: "say", text: "never" },
          ],
        },
      },
    };
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    runner.advance(); // steps onto `end`
    expect(rec.ended).toBe(1);
    expect(lineTexts(rec)).toEqual(["one"]);
  });
});

describe("DialogueRunner — goto and branching", () => {
  it("follows a goto step to another node", async () => {
    const script: DialogueScript = {
      id: "goto",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "say", text: "a1" }, { kind: "goto", target: "b" }],
        },
        b: { id: "b", steps: [{ kind: "say", text: "b1" }] },
      },
    };
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    expect(runner.getNodeId()).toBe("a");
    runner.advance(); // a1 → goto b → b1
    await flush();
    expect(lineTexts(rec)).toEqual(["a1", "b1"]);
    expect(runner.getNodeId()).toBe("b");
    expect(runner.getStepIndex()).toBe(0);
  });

  it("a conditional command step jumps only when its condition holds", async () => {
    const make = async (gate: boolean): Promise<Recorder> => {
      const script: DialogueScript = {
        id: "cond-jump",
        start: "a",
        vars: { gate },
        nodes: {
          a: {
            id: "a",
            steps: [
              { kind: "command", commands: [], condition: "gate", target: "b" },
              { kind: "say", text: "fellthrough" },
            ],
          },
          b: { id: "b", steps: [{ kind: "say", text: "jumped" }] },
        },
      };
      const rec = makeRecorder();
      new DialogueRunner(script, rec.handlers).start();
      await flush();
      return rec;
    };
    expect(lineTexts(await make(true))).toEqual(["jumped"]);
    expect(lineTexts(await make(false))).toEqual(["fellthrough"]);
  });
});

describe("DialogueRunner — set / vars", () => {
  it("`set` commands mutate vars and feed later conditions", async () => {
    const script: DialogueScript = {
      id: "set",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [{ type: "set", var: "flag", value: true }] },
            { kind: "command", commands: [], condition: "flag", target: "b" },
            { kind: "say", text: "no" },
          ],
        },
        b: { id: "b", steps: [{ kind: "say", text: "yes" }] },
      },
    };
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    await flush();
    expect(lineTexts(rec)).toEqual(["yes"]);
    expect(runner.getVars().flag).toBe(true);
    // `set` is built-in: never surfaced to the host as a command.
    expect(rec.commands).toHaveLength(0);
  });

  it("seeds vars from the script and exposes them read-only via getVars", () => {
    const script: DialogueScript = {
      id: "seed",
      start: "a",
      vars: { score: 3 },
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "x" }] } },
    };
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);
    expect(runner.getVars().score).toBe(3);
    // Mutating the script's vars after construction must not leak in (copied).
    (script.vars as VarMap).score = 99;
    expect(runner.getVars().score).toBe(3);
  });
});

describe("DialogueRunner — choices", () => {
  const choiceScript = (): DialogueScript => ({
    id: "choices",
    start: "a",
    nodes: {
      a: {
        id: "a",
        steps: [
          {
            kind: "choice",
            text: "pick",
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
  });

  it("presents reachable choices and branches on the chosen option's target", async () => {
    const rec = makeRecorder();
    const runner = new DialogueRunner(choiceScript(), rec.handlers);
    runner.start();
    expect(rec.choiceSets).toHaveLength(1);
    expect(rec.choiceSets[0]!.choices.map((c) => c.option.text)).toEqual(["left", "right"]);

    await runner.choose(1);
    expect(lineTexts(rec)).toEqual(["went-right"]);
    expect(runner.getNodeId()).toBe("R");
  });

  it("an option with no target just continues to the next step in the node", async () => {
    const script: DialogueScript = {
      id: "choice-continue",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "choice", options: [{ text: "ok" }] },
            { kind: "say", text: "after" },
          ],
        },
      },
    };
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    await runner.choose(0);
    expect(lineTexts(rec)).toEqual(["after"]);
  });

  it("filters out options whose condition fails (by original index)", async () => {
    const script: DialogueScript = {
      id: "cond-choice",
      start: "a",
      vars: { hasKey: false },
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "choice",
              options: [
                { text: "locked", target: "L", condition: "hasKey" },
                { text: "open", target: "O" },
              ],
            },
          ],
        },
        L: { id: "L", steps: [{ kind: "say", text: "locked-line" }] },
        O: { id: "O", steps: [{ kind: "say", text: "open-line" }] },
      },
    };
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    const presented = rec.choiceSets[0]!.choices;
    expect(presented.map((c) => c.option.text)).toEqual(["open"]);
    // The surviving option keeps its ORIGINAL index (1), not its display slot.
    expect(presented[0]!.index).toBe(1);

    // choose() ignores a disabled original index.
    await runner.choose(0); // "locked" is condition-disabled
    expect(lineTexts(rec)).toEqual([]); // still choosing, nothing branched

    await runner.choose(1);
    expect(lineTexts(rec)).toEqual(["open-line"]);
  });

  it("skips a choice step entirely when no option is reachable", async () => {
    const script: DialogueScript = {
      id: "no-options",
      start: "a",
      vars: { ok: false },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "choice", options: [{ text: "x", condition: "ok" }] },
            { kind: "say", text: "fallthrough" },
          ],
        },
      },
    };
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    await flush();
    expect(rec.choiceSets).toHaveLength(0);
    expect(lineTexts(rec)).toEqual(["fallthrough"]);
  });

  it("choose() is a no-op outside the choosing state and ignores bad indices", async () => {
    const rec = makeRecorder();
    const runner = new DialogueRunner(choiceScript(), rec.handlers);
    // Before start: no-op.
    await runner.choose(0);
    expect(lineTexts(rec)).toEqual([]);
    runner.start();
    await runner.choose(99); // out of range
    expect(lineTexts(rec)).toEqual([]);
    expect(runner.getNodeId()).toBe("a");
  });
});

describe("DialogueRunner — `once` choices", () => {
  it("hides an option after it has been picked (tracked via chosenOnce)", async () => {
    // Loop back to the hub so the choice is re-presented after the first pick.
    const script: DialogueScript = {
      id: "once",
      start: "hub",
      nodes: {
        hub: {
          id: "hub",
          steps: [
            {
              kind: "choice",
              options: [
                { text: "ask-once", target: "answer", once: true },
                { text: "leave", target: "end" },
              ],
            },
          ],
        },
        answer: { id: "answer", steps: [{ kind: "goto", target: "hub" }] },
        end: { id: "end", steps: [{ kind: "end" }] },
      },
    };
    const rec = makeRecorder();
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    expect(rec.choiceSets[0]!.choices.map((c) => c.option.text)).toEqual(["ask-once", "leave"]);
    expect(runner.getChosenOnce().size).toBe(0);

    await runner.choose(0); // pick the once option → loops back to hub
    expect(runner.getChosenOnce().size).toBe(1);
    // Re-presented choice now omits the consumed once option.
    expect(rec.choiceSets[1]!.choices.map((c) => c.option.text)).toEqual(["leave"]);
  });
});

describe("DialogueRunner — command surfacing", () => {
  it("surfaces non-builtin commands to onCommand with the run mode", async () => {
    const script: DialogueScript = {
      id: "cmd",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [{ type: "give-item", id: "key" }] },
            { kind: "say", text: "done" },
          ],
        },
      },
    };
    const rec = makeRecorder();
    new DialogueRunner(script, rec.handlers).start();
    await flush();
    expect(rec.commands).toHaveLength(1);
    expect(rec.commands[0]!.command.type).toBe("give-item");
    expect(rec.commands[0]!.ctx.mode).toBe("play");
    expect(lineTexts(rec)).toEqual(["done"]);
  });

  it("waits for a blocking async command before continuing", async () => {
    let resolveCmd!: () => void;
    const gate = new Promise<void>((r) => (resolveCmd = r));
    const rec = makeRecorder((cmd) => (cmd.type === "wait" ? gate : undefined));
    const script: DialogueScript = {
      id: "blocking",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [{ type: "wait", blocking: true }] },
            { kind: "say", text: "after-wait" },
          ],
        },
      },
    };
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    await flush();
    // The blocking command is in flight — the next line has NOT surfaced yet.
    expect(lineTexts(rec)).toEqual([]);
    resolveCmd();
    await gate;
    await flush(); // let the awaited continuation run
    expect(lineTexts(rec)).toEqual(["after-wait"]);
  });

  it("does NOT wait for a non-blocking async command (fire-and-forget)", async () => {
    let resolveCmd!: () => void;
    const gate = new Promise<void>((r) => (resolveCmd = r));
    const rec = makeRecorder((cmd) => (cmd.type === "fx" ? gate : undefined));
    const script: DialogueScript = {
      id: "nonblocking",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [{ type: "fx" }] }, // no `blocking`
            { kind: "say", text: "immediately" },
          ],
        },
      },
    };
    new DialogueRunner(script, rec.handlers).start();
    await flush();
    // Continued past the pending promise straight away.
    expect(lineTexts(rec)).toEqual(["immediately"]);
    resolveCmd();
    await gate;
  });

  it("a throwing blocking command does not wedge the conversation", async () => {
    const rec = makeRecorder((cmd) => {
      if (cmd.type === "boom") return Promise.reject(new Error("nope"));
      return undefined;
    });
    const script: DialogueScript = {
      id: "throwing",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [{ type: "boom", blocking: true }] },
            { kind: "say", text: "survived" },
          ],
        },
      },
    };
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    // Let the rejected blocking promise settle and the continuation run.
    await flush();
    expect(lineTexts(rec)).toEqual(["survived"]);
    expect(runner.isEnded()).toBe(false);
  });

  it("fires an option's commands before branching, in skip-aware mode", async () => {
    const rec = makeRecorder();
    const script: DialogueScript = {
      id: "choice-cmd",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "choice",
              options: [
                {
                  text: "take",
                  target: "b",
                  commands: [
                    { type: "set", var: "took", value: true },
                    { type: "play-sfx", id: "ding" },
                  ],
                },
              ],
            },
          ],
        },
        b: { id: "b", steps: [{ kind: "say", text: "next" }] },
      },
    };
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    await runner.choose(0);
    // The non-builtin command surfaced; `set` applied; branch happened.
    expect(rec.commands.map((c) => c.command.type)).toEqual(["play-sfx"]);
    expect(runner.getVars().took).toBe(true);
    expect(lineTexts(rec)).toEqual(["next"]);
  });

  it("runCommands() runs a batch (set + surfaced) without changing wait-state", async () => {
    const rec = makeRecorder();
    const script: DialogueScript = {
      id: "runcommands",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "line" }] } },
    };
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start(); // now in `saying`
    await runner.runCommands([
      { type: "set", var: "k", value: 5 },
      { type: "emit", id: "evt" },
    ]);
    expect(runner.getVars().k).toBe(5);
    expect(rec.commands.map((c) => c.command.type)).toEqual(["emit"]);
    // Still on the line — advance still works.
    runner.advance();
    expect(runner.isEnded()).toBe(true);
  });
});

describe("DialogueRunner — skip / fast-forward", () => {
  it("runs intervening commands at show-time and stops at the next choice", async () => {
    const rec = makeRecorder();
    const script: DialogueScript = {
      id: "skip",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "one" },
            // "two" is skipped; the runner fires its (world-reconstruction)
            // command itself during the fast-forward, in skip mode.
            { kind: "say", text: "two", commands: [{ type: "fx" }] },
            {
              kind: "choice",
              options: [{ text: "ok", target: "b" }],
            },
          ],
        },
        b: { id: "b", steps: [{ kind: "say", text: "b1" }] },
      },
    };
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start(); // shows "one"
    await runner.skip();
    // Skipped past "two" and stopped at the choice; no further say lines shown.
    expect(lineTexts(rec)).toEqual(["one"]);
    expect(rec.choiceSets).toHaveLength(1);
    // The skipped line's command fired during the fast-forward (skip mode).
    const fx = rec.commands.find((c) => c.command.type === "fx");
    expect(fx?.ctx.mode).toBe("skip");
  });

  it("skip() to the end fires onEnd", async () => {
    const rec = makeRecorder();
    const script: DialogueScript = {
      id: "skip-end",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "say", text: "one" }, { kind: "say", text: "two" }],
        },
      },
    };
    const runner = new DialogueRunner(script, rec.handlers);
    runner.start();
    await runner.skip();
    expect(runner.isEnded()).toBe(true);
    expect(rec.ended).toBe(1);
  });

  it("skip() is a no-op when not on a say line", async () => {
    const rec = makeRecorder();
    const script: DialogueScript = {
      id: "skip-noop",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "x" }] } },
    };
    const runner = new DialogueRunner(script, rec.handlers);
    await runner.skip(); // idle → no-op
    expect(lineTexts(rec)).toEqual([]);
  });
});

describe("DialogueRunner — speaker resolution", () => {
  it("resolves a say step's speaker from the script's speakers table", () => {
    const npc: SpeakerDef = { id: "npc", name: "Witch", color: 0xff00ff };
    const seen: (SpeakerDef | undefined)[] = [];
    const script: DialogueScript = {
      id: "speakers",
      start: "a",
      speakers: { npc },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", speaker: "npc", text: "hi" },
            { kind: "say", text: "narrator" },
          ],
        },
      },
    };
    const runner = new DialogueRunner(script, {
      onSay: (_step, speaker) => void seen.push(speaker),
      onChoice: () => {},
      onCommand: () => {},
      onEnd: () => {},
    });
    runner.start();
    runner.advance();
    expect(seen[0]).toBe(npc);
    expect(seen[1]).toBeUndefined();
  });
});

describe("evalCondition", () => {
  const vars: VarMap = { n: 5, flag: true, name: "x", zero: 0 };

  it("string key → truthy check", () => {
    expect(evalCondition("flag", vars)).toBe(true);
    expect(evalCondition("zero", vars)).toBe(false);
    expect(evalCondition("missing", vars)).toBe(false);
  });

  it("comparison operators", () => {
    expect(evalCondition({ var: "n", op: "==", value: 5 }, vars)).toBe(true);
    expect(evalCondition({ var: "n", op: "!=", value: 4 }, vars)).toBe(true);
    expect(evalCondition({ var: "n", op: ">", value: 4 }, vars)).toBe(true);
    expect(evalCondition({ var: "n", op: ">=", value: 5 }, vars)).toBe(true);
    expect(evalCondition({ var: "n", op: "<", value: 6 }, vars)).toBe(true);
    expect(evalCondition({ var: "n", op: "<=", value: 5 }, vars)).toBe(true);
    expect(evalCondition({ var: "flag", op: "truthy", value: null }, vars)).toBe(true);
    expect(evalCondition({ var: "zero", op: "falsy", value: null }, vars)).toBe(true);
  });

  it("predicate function", () => {
    const fn = vi.fn((v: VarMap) => v.n === 5);
    expect(evalCondition(fn, vars)).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });
});
