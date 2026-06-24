import { describe, expect, it } from "vitest";

import { parseCompact, loadCompact } from "./compact.js";
import { DialogueScriptError } from "./canonical.js";
import { parseMarkup } from "../markup.js";
import type {
  BinaryOp,
  ChoiceStep,
  CommandStep,
  Expr,
  SayStep,
  VarValue,
} from "../types.js";

// Terse Expr builders (mirroring expr-parse.test.ts).
const lit = (value: VarValue): Expr => ({ kind: "literal", value });
const v = (name: string): Expr => ({ kind: "varRef", name });
const bin = (op: BinaryOp, left: Expr, right: Expr): Expr => ({ kind: "binary", op, left, right });

/** The worked example shown in the docs — exercises every leader. */
const SHOP = `
# shop
@ mira Mira Brightwater #ffcc00
@ guard Guard

:: start
mira: Welcome to my [b]shop[/b], traveler!
mira happy: You've got coin to spend, I hope.
set gold = 100
? Buy a healing potion if: gold >= 50 -> buy #once
? Ask about the [i]rumors[/i] -> rumors #side:right
? Just browsing -> done

:: buy
set gold = gold - 50
mira: A fine choice. Here you are.
do give-item id=healing-potion count=1
-> done

:: rumors
guard: Keep your voice down.
The tavern falls silent for a moment.
-> done

:: done
mira: Safe travels!
end
`;

describe("loadCompact — the worked shop script round-trips to IR", () => {
  const script = loadCompact(SHOP);

  it("carries the id, implicit start (first node), and speakers", () => {
    expect(script.id).toBe("shop");
    expect(script.start).toBe("start"); // first `::` node
    expect(Object.keys(script.nodes)).toEqual(["start", "buy", "rumors", "done"]);
    expect(script.speakers).toEqual({
      mira: { id: "mira", name: "Mira Brightwater", color: 0xffcc00 },
      guard: { id: "guard", name: "Guard" },
    });
    expect(Object.isFrozen(script)).toBe(true);
  });

  it("reads say lines, faces, narrator lines, and keeps markup verbatim", () => {
    const start = script.nodes.start!.steps;
    expect(start[0]).toEqual({
      kind: "say",
      speaker: "mira",
      text: "Welcome to my [b]shop[/b], traveler!",
    });
    // `mira happy:` → the 2nd header token is the avatar expression.
    expect(start[1]).toEqual({
      kind: "say",
      speaker: "mira",
      expression: "happy",
      text: "You've got coin to spend, I hope.",
    });
    // A line with no declared-speaker prefix is a narrator line.
    const rumors = script.nodes.rumors!.steps;
    expect(rumors[1]).toEqual({ kind: "say", text: "The tavern falls silent for a moment." });
  });

  it("reads `set` literals and expressions, and a `do` command", () => {
    expect(script.nodes.start!.steps[2]).toEqual({
      kind: "command",
      commands: [{ type: "set", var: "gold", value: 100 }],
    });
    const buy = script.nodes.buy!.steps;
    expect(buy[0]).toEqual({
      kind: "command",
      commands: [{ type: "set", var: "gold", value: bin("-", v("gold"), lit(50)) }],
    });
    expect(buy[2]).toEqual({
      kind: "command",
      commands: [{ type: "give-item", id: "healing-potion", count: 1 }],
    });
    expect(buy[3]).toEqual({ kind: "goto", target: "done" });
  });

  it("coalesces consecutive `?` into one choice step with parsed attributes", () => {
    const choice = script.nodes.start!.steps[3] as ChoiceStep;
    expect(choice.kind).toBe("choice");
    expect(choice.options).toEqual([
      {
        text: "Buy a healing potion",
        condition: bin(">=", v("gold"), lit(50)),
        target: "buy",
        once: true,
      },
      { text: "Ask about the [i]rumors[/i]", target: "rumors", meta: { side: "right" } },
      { text: "Just browsing", target: "done" },
    ]);
  });
});

describe("loadCompact — choice text vs choice attributes", () => {
  const wrap = (choiceLine: string): ChoiceStep => {
    const script = parseCompact(`# t\n:: n\n${choiceLine}\nend\n`);
    return script.nodes.n!.steps[0] as ChoiceStep;
  };

  it("keeps `[b]bold[/b]` markup in the text while consuming `#disabled`", () => {
    const opt = wrap("? [b]Force[/b] the door -> hatch #disabled").options[0]!;
    expect(opt.text).toBe("[b]Force[/b] the door"); // markup survives, flag stripped
    expect(opt.presentation).toBe("disabled");
    expect(opt.target).toBe("hatch");
    // The retained markup still renders bold (and the flag never leaks into it).
    const parsed = parseMarkup(opt.text);
    expect(parsed.runs[0]).toMatchObject({ text: "Force", style: { bold: true } });
    expect(opt.text).not.toContain("#disabled");
  });

  it("ERRORS on an unconsumed bracket-attr ('[..]' is markup-only in a choice)", () => {
    expect(() => wrap("? Pick the lock [skill=8] -> done")).toThrow(DialogueScriptError);
    expect(() => wrap("? Pick the lock [skill=8] -> done")).toThrow(/markup only|\[skill\]/);
  });

  it("lexes `#once` / `#disabled` flags and `#key:value` meta off the text", () => {
    const opt = wrap("? Open it #once #side:right").options[0]!;
    expect(opt).toEqual({ text: "Open it", once: true, meta: { side: "right" } });
  });

  it("parses `if:` (anywhere a space-bounded token) into an Expr condition", () => {
    const opt = wrap("? Bribe the guard if: gold >= 50 -> bribe").options[0]!;
    expect(opt.condition).toEqual(bin(">=", v("gold"), lit(50)));
    expect(opt.target).toBe("bribe");
    expect(opt.text).toBe("Bribe the guard");
  });

  it("accepts the `target=node` form as an alternative to `->`", () => {
    expect(wrap("? Leave target=exit").options[0]!.target).toBe("exit");
  });

  it("`#line:id` sets the i18n key (not meta) on a choice option", () => {
    const opt = wrap("? Trade -> shop #line:opt_trade").options[0]!;
    expect(opt.key).toBe("opt_trade");
    expect(opt.meta).toBeUndefined();
  });
});

describe("parseCompact — say lines", () => {
  const firstSay = (line: string, speakers = ""): SayStep => {
    const script = parseCompact(`# t\n${speakers}:: n\n${line}\nend\n`);
    return script.nodes.n!.steps[0] as SayStep;
  };

  it("a colon-bearing line with no matching speaker stays intact (narrator)", () => {
    const say = firstSay("Warning: do not enter.");
    expect(say).toEqual({ kind: "say", text: "Warning: do not enter." });
  });

  it("`speaker face: text` puts the face on SayStep.expression (Q4)", () => {
    const say = firstSay("hero happy: At last!", "@ hero Hero\n");
    expect(say).toEqual({ kind: "say", speaker: "hero", expression: "happy", text: "At last!" });
  });

  it("trailing `#key:value` → SayStep.meta", () => {
    const say = firstSay("hero: Look out! #side:right", "@ hero Hero\n");
    expect(say.meta).toEqual({ side: "right" });
    expect(say.text).toBe("Look out!");
  });

  it("`#line:id` sets the i18n key (not meta) on a say line", () => {
    const say = firstSay("hero: Hello #line:greet_01", "@ hero Hero\n");
    expect(say.key).toBe("greet_01");
    expect(say.text).toBe("Hello");
    expect(say.meta).toBeUndefined();
  });

  it("first-class hints view/voice/speed/auto map to SayStep fields", () => {
    const say = firstSay("hero: Whispered… speed=0.5 voice=vo_42 view=bubble auto=2000", "@ hero Hero\n");
    expect(say).toMatchObject({
      speaker: "hero",
      text: "Whispered…",
      speed: 0.5,
      voice: "vo_42",
      view: "bubble",
      autoAdvanceMs: 2000,
    });
  });

  it("rejects a non-numeric speed= / auto= hint", () => {
    expect(() => firstSay("hero: Hi speed=fast", "@ hero Hero\n")).toThrow(/speed.*number/);
  });
});

describe("parseCompact — set / do disambiguation", () => {
  const firstStep = (line: string) => parseCompact(`# t\n:: n\n${line}\nend\n`).nodes.n!.steps[0]!;

  it("`set hp = hp-1` → a `set` command whose value is binary minus", () => {
    expect(firstStep("set hp = hp-1")).toEqual({
      kind: "command",
      commands: [{ type: "set", var: "hp", value: bin("-", v("hp"), lit(1)) }],
    });
  });

  it("`set` literals stay literal (number/bool/null); strings become Expr literals", () => {
    const setVal = (line: string): unknown =>
      (firstStep(line) as CommandStep).commands[0]!.value;
    expect(setVal("set gold = 100")).toBe(100);
    expect(setVal("set ready = true")).toBe(true);
    expect(setVal("set slot = null")).toBeNull();
    // A quoted string must round-trip as an Expr literal, not a raw string, or
    // loadScript's pre-walk would re-read it as a variable reference.
    expect(setVal(`set name = "Mira"`)).toEqual(lit("Mira"));
  });

  it("`set the table` (no `=`) is NOT a command — it falls through to narrator", () => {
    expect(firstStep("set the table")).toEqual({ kind: "say", text: "set the table" });
  });

  it("`do type k=v #flag` builds a host command with typed values", () => {
    expect(firstStep("do give-item id=rusty-key count=2 #blocking")).toEqual({
      kind: "command",
      commands: [{ type: "give-item", id: "rusty-key", count: 2, blocking: true }],
    });
  });

  it("`do msg=\"two words\"` keeps a quoted value together", () => {
    expect(firstStep('do log msg="two words"')).toEqual({
      kind: "command",
      commands: [{ type: "log", msg: "two words" }],
    });
  });

  it("`do you agree?` is not a command shape — it falls through to narrator", () => {
    expect(firstStep("do you agree?")).toEqual({ kind: "say", text: "do you agree?" });
  });

  it("ERRORS when a `do` data key collides with the command type", () => {
    // `type=` would overwrite the dispatch type — caught as a load error, not silently.
    expect(() => firstStep("do spawn type=goblin")).toThrow(DialogueScriptError);
    expect(() => firstStep("do spawn type=goblin")).toThrow(/collides with the command type/);
  });

  it("a `do`-shaped line with a trailing bare token stays narrator (no false error)", () => {
    // The bare `extra` token means it isn't a command shape, so the type-collision
    // check never fires — it falls through to narrator text.
    expect(firstStep("do spawn type=goblin extra")).toEqual({
      kind: "say",
      text: "do spawn type=goblin extra",
    });
  });

  it("ERRORS on the `#type` flag form too (same dispatch-type collision)", () => {
    // `#type` would set command.type = true; guard it like `type=`.
    expect(() => firstStep("do spawn #type")).toThrow(DialogueScriptError);
    expect(() => firstStep("do spawn #type")).toThrow(/collides with the command type/);
  });

  it("a `#type` flag with a trailing bare token also stays narrator", () => {
    expect(firstStep("do spawn #type extra")).toEqual({ kind: "say", text: "do spawn #type extra" });
  });
});

describe("parseCompact — conditional goto + declare", () => {
  it("`-> node if: cond` is a conditional jump (CommandStep); the next step is the else path", () => {
    const steps = parseCompact(
      ["# t", ":: n", "-> rich if: gold > 100", "Still poor.", ":: rich", "end"].join("\n"),
    ).nodes.n!.steps;
    expect(steps[0]).toEqual({
      kind: "command",
      commands: [],
      condition: bin(">", v("gold"), lit(100)),
      target: "rich",
    });
    expect(steps[1]).toEqual({ kind: "say", text: "Still poor." });
  });

  it("bare `-> node` stays an unconditional goto", () => {
    const steps = parseCompact(["# t", ":: n", "-> done", ":: done", "end"].join("\n")).nodes.n!.steps;
    expect(steps[0]).toEqual({ kind: "goto", target: "done" });
  });

  it("loadCompact still validates a conditional jump's target", () => {
    expect(() => loadCompact(["# t", ":: n", "-> nowhere if: x", "end"].join("\n"))).toThrow(
      /jump target "nowhere"/,
    );
  });

  it("`declare` sets script-level defaults (literal scalars), in the preamble or inside a node", () => {
    const script = parseCompact(
      ["# t", "declare gold = 100", 'declare name = "Hero"', ":: n", "declare ready = false", "end"].join("\n"),
    );
    expect(script.declare).toEqual({ gold: 100, name: "Hero", ready: false });
  });

  it("`declare your intentions` (no `=`) is not a declare — narrator fallthrough", () => {
    const step = parseCompact(["# t", ":: n", "declare your intentions", "end"].join("\n")).nodes.n!.steps[0];
    expect(step).toEqual({ kind: "say", text: "declare your intentions" });
  });
});

describe("parseCompact — structure, comments, errors", () => {
  it("ignores blank lines, `// comments`, and indentation", () => {
    const script = parseCompact(
      ["# t", "", "// a leading comment", ":: n", "  A narrated line.", "  end"].join("\n"),
    );
    // The comment line is dropped; the indented step still lands in node "n".
    expect(script.nodes.n!.steps).toHaveLength(2);
    expect(script.nodes.n!.steps[0]).toEqual({ kind: "say", text: "A narrated line." });
  });

  it("ends a choice run when a non-`?` line follows", () => {
    const script = parseCompact(`# t\n:: n\n? A -> x\n? B -> y\nNarration after.\nend\n`);
    const steps = script.nodes.n!.steps;
    expect(steps[0]!.kind).toBe("choice");
    expect((steps[0] as ChoiceStep).options).toHaveLength(2);
    expect(steps[1]).toEqual({ kind: "say", text: "Narration after." });
  });

  it("requires a `# id` directive", () => {
    expect(() => parseCompact(":: n\nend\n")).toThrow(/missing '# <id>'/);
  });

  it("rejects a step before any `:: node`", () => {
    expect(() => parseCompact("# t\nhero: stray\n")).toThrow(/before any ':: <node>'/);
  });

  it("rejects a script with an id but no `:: node`", () => {
    expect(() => parseCompact("# t\n")).toThrow(/has no ':: <node>'/);
  });

  it("rejects a speaker header with too many tokens", () => {
    expect(() => parseCompact("# t\n@ h H\n:: n\nh one two: hi\n")).toThrow(/too many tokens/);
  });

  it("rejects duplicate ids, nodes, and speakers with the line number", () => {
    expect(() => parseCompact("# a\n# b\n:: n\nend\n")).toThrow(/line 2: duplicate '#'/);
    expect(() => parseCompact("# t\n:: n\nend\n:: n\nend\n")).toThrow(/duplicate node "n"/);
    expect(() => parseCompact("# t\n@ x A\n@ x B\n:: n\nend\n")).toThrow(/duplicate speaker "x"/);
  });

  it("surfaces a malformed `if:` expression as a DialogueExprError (a script error)", () => {
    expect(() => parseCompact("# t\n:: n\n? Bad if: gold >= -> x\n")).toThrow(DialogueScriptError);
  });

  it("still validates downstream — a goto to a missing node dies in loadScript", () => {
    expect(() => loadCompact("# t\n:: n\n-> nowhere\n")).toThrow(/jump target "nowhere"/);
  });

  it("parseCompact output is mutable; loadCompact freezes it", () => {
    expect(Object.isFrozen(parseCompact("# t\n:: n\nend\n"))).toBe(false);
    expect(Object.isFrozen(loadCompact("# t\n:: n\nend\n"))).toBe(true);
  });
});
