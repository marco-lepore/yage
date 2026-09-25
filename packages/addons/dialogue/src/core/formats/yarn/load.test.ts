import type { RandomService } from "@yagejs/core";
import { describe, expect, it } from "vitest";

import { DialogueSession } from "../../session.js";
import type {
  ChoiceChannel,
  PresentedChoice,
  TextChannel,
} from "../../session.js";
import { interpolateDialogueText, type I18nAdapter } from "../../i18n.js";
import { MemoryVariableStorage } from "../../vars.js";
import { DialoguePlayError, DialogueScriptError } from "../../validate.js";
import type {
  CommandHandler,
  DialogueFunction,
  DialogueScript,
  MarkerToken,
  ParsedText,
  VariableStorage,
} from "../../types.js";
import { loadYarn, type YarnScript } from "./load.js";
import { DialogueYarnError } from "./parse.js";

/** A random source that always draws `value` (0 → first pick, 0.99 → last). */
function fixedRandom(value: number): RandomService {
  return {
    float: () => value,
    range: (min, max) => min + value * (max - min),
    int: (min, max) => Math.min(max, Math.floor(min + value * (max - min + 1))),
    pick: (arr) =>
      arr[Math.min(arr.length - 1, Math.floor(value * arr.length))]!,
    shuffle: (arr) => arr,
    getSeed: () => 0,
  };
}

/** One node titled `Start` with `body`. */
const start = (body: string, more = ""): string =>
  `title: Start\n---\n${body}\n===\n${more}`;

const node = (title: string, body: string): string =>
  `title: ${title}\n---\n${body}\n===\n`;

/** Let the runner's async steps settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface RunOptions {
  readonly start?: string;
  readonly storage?: VariableStorage;
  /** Command types to accept (no-op handlers); every command is recorded. */
  readonly handled?: readonly string[];
  readonly commands?: Readonly<Record<string, CommandHandler>>;
  readonly functions?: Readonly<Record<string, DialogueFunction>>;
  readonly i18n?: I18nAdapter;
  readonly random?: RandomService;
}

interface Harness {
  readonly session: DialogueSession;
  /** `Speaker: text` lines, `? a | b` menus, and `<<command args>>`. */
  readonly transcript: string[];
  readonly parsed: ParsedText[];
  rows: readonly PresentedChoice[];
}

function harness(opts: RunOptions = {}): Harness {
  let onReveal: (() => void) | undefined;
  const h: Harness = {
    session: undefined!,
    transcript: [],
    parsed: [],
    rows: [],
  };
  const text: TextChannel = {
    present(line) {
      h.parsed.push(line.text);
      const body = line.text.runs.map((r) => r.text).join("");
      h.transcript.push(line.speaker ? `${line.speaker.name}: ${body}` : body);
      onReveal?.();
    },
    replaceVisible() {},
    completeReveal() {},
    isRevealComplete: () => true,
    isRevealing: () => false,
    setSpeedMultiplier() {},
    setVisible() {},
    update() {},
    clear() {},
    setRevealListener(listener) {
      onReveal = listener;
    },
    setBeatListener() {},
  };
  const choices: ChoiceChannel = {
    present(rows) {
      h.rows = rows;
      h.transcript.push(
        `? ${rows.map((r) => (r.disabled ? `(${r.label})` : r.label)).join(" | ")}`,
      );
    },
    highlight() {},
    setVisible() {},
    clear() {},
  };
  const handled = Object.fromEntries(
    (opts.handled ?? []).map((name): [string, CommandHandler] => [
      name,
      () => {},
    ]),
  );
  (h as { session: DialogueSession }).session = new DialogueSession(
    { text, choices },
    {
      storage: opts.storage,
      functions: opts.functions,
      commands: { ...handled, ...opts.commands },
      i18n: opts.i18n,
      random: opts.random ?? fixedRandom(0),
      onCommand: (cmd) =>
        h.transcript.push(`<<${[cmd.type, ...(cmd.args ?? [])].join(" ")}>>`),
    },
  );
  return h;
}

/** Play `script`, advancing every line and picking options by label in order,
 *  until it ends or runs out of picks. */
async function run(
  script: DialogueScript,
  picks: string[] = [],
  opts: RunOptions = {},
): Promise<Harness> {
  const h = harness(opts);
  h.session.play(script, opts.start === undefined ? {} : { start: opts.start });
  for (let i = 0; i < 500; i++) {
    await settle();
    if (!h.session.isActive()) break;
    if (h.session.isChoosing()) {
      const pick = picks.shift();
      if (pick === undefined) break;
      const at = h.rows.findIndex((r) => r.label === pick);
      if (at < 0)
        throw new Error(`no option "${pick}" in ${h.transcript.at(-1)}`);
      h.session.confirmAt(at);
    } else {
      h.session.update(1);
      h.session.advance();
    }
  }
  return h;
}

describe("loadYarn — lines, characters, and flow", () => {
  it("plays lines in order with speakers from their character names", async () => {
    const yarn = loadYarn(start("Mae: Hi.\nThe wind blows.\nOld Man: Hm."));
    expect(yarn.speakers).toEqual({
      Mae: { id: "Mae", name: "Mae" },
      "Old Man": { id: "Old Man", name: "Old Man" },
    });
    expect((await run(yarn)).transcript).toEqual([
      "Mae: Hi.",
      "The wind blows.",
      "Old Man: Hm.",
    ]);
  });

  it("the speakers option adds nameplate details", () => {
    const yarn = loadYarn(start("Mae: Hi."), {
      speakers: { Mae: { color: 0xffcc00 }, Unused: { name: "U" } },
    });
    expect(yarn.speakers).toEqual({
      Mae: { id: "Mae", name: "Mae", color: 0xffcc00 },
    });
  });

  it("starts at Start, else the first node; play({ start }) picks another", async () => {
    const two = node("Intro", "I") + node("Start", "S");
    expect((await run(loadYarn(two))).transcript).toEqual(["S"]);
    expect((await run(loadYarn(node("Intro", "I")))).transcript).toEqual(["I"]);
    expect(
      (await run(loadYarn(two), [], { start: "Intro" })).transcript,
    ).toEqual(["I"]);
  });

  it("options: bodies run, then flow continues after the group", async () => {
    const yarn = loadYarn(
      start(
        [
          "Mae: Tea or coffee?",
          "-> Tea",
          "    Mae: Tea it is.",
          "-> Coffee",
          "    Mae: Strong.",
          "Mae: Enjoy.",
        ].join("\n"),
      ),
    );
    expect((await run(yarn, ["Coffee"])).transcript).toEqual([
      "Mae: Tea or coffee?",
      "? Tea | Coffee",
      "Mae: Strong.",
      "Mae: Enjoy.",
    ]);
  });

  it("an option's condition hides it; #disabled shows it greyed; none available falls through", async () => {
    const src = start(
      [
        "<<declare $gold = 3>>",
        "-> Buy <<if $gold >= 5>>",
        "-> Beg <<if $gold >= 5>> #disabled",
        "-> Leave",
        "-> Only rich <<if $gold > 100>>",
        "After",
      ].join("\n"),
    );
    const h = await run(loadYarn(src), ["Leave"]);
    expect(h.transcript).toEqual(["? (Beg) | Leave", "After"]);

    const none = loadYarn(start("-> A <<if false>>\nNext"));
    expect((await run(none)).transcript).toEqual(["Next"]);
  });

  it("if / elseif / else", async () => {
    const src = (n: number) =>
      start(
        `<<declare $n = ${n}>>\n<<if $n > 5>>\nBig\n<<elseif $n > 1>>\nMid\n<<else>>\nSmall\n<<endif>>\nDone`,
      );
    expect((await run(loadYarn(src(9)))).transcript).toEqual(["Big", "Done"]);
    expect((await run(loadYarn(src(3)))).transcript).toEqual(["Mid", "Done"]);
    expect((await run(loadYarn(src(0)))).transcript).toEqual(["Small", "Done"]);
  });

  it("a line condition shows the line only when it holds", async () => {
    const yarn = loadYarn(
      start("<<declare $x = false>>\nA <<if $x>>\nB <<if not $x>>"),
    );
    expect((await run(yarn)).transcript).toEqual(["B"]);
  });

  it("jump, stop, and running off the end", async () => {
    const yarn = loadYarn(
      start("A\n<<jump Other>>\nNever", node("Other", "B\n<<stop>>\nNever")),
    );
    expect((await run(yarn)).transcript).toEqual(["A", "B"]);
  });

  it("detour runs a node and comes back; return leaves early", async () => {
    const yarn = loadYarn(
      start("A\n<<detour Side>>\nC", node("Side", "B\n<<return>>\nNever")),
    );
    expect((await run(yarn)).transcript).toEqual(["A", "B", "C"]);
  });

  it("a jump inside a detour doesn't come back", async () => {
    const yarn = loadYarn(
      start(
        "<<detour Side>>\nNever",
        node("Side", "<<jump Away>>") + node("Away", "Gone"),
      ),
    );
    expect((await run(yarn)).transcript).toEqual(["Gone"]);
  });

  it("jump {expression} goes to the node with that title", async () => {
    const yarn = loadYarn(
      start(
        '<<declare $to = "B">>\n<<jump {$to}>>',
        node("A", "in A") + node("B", "in B"),
      ),
    );
    expect((await run(yarn)).transcript).toEqual(["in B"]);
  });

  it("jump / detour {expression} evaluates the expression once", async () => {
    const titles = ["A", "B", "Start"];
    let calls = 0;
    const next_node = (): string => titles[calls++ % titles.length]!;
    const yarn = loadYarn(
      start(
        "<<detour {next_node()}>>\n<<jump {next_node()}>>",
        node("A", "in A") + node("B", "in B"),
      ),
    );
    const h = await run(yarn, [], { functions: { next_node } });
    expect(h.transcript).toEqual(["in A", "in B"]);
    expect(calls).toBe(2);
  });

  it("a node may be titled __proto__", async () => {
    const yarn = loadYarn(
      start("<<jump __proto__>>", node("__proto__", "in proto\n<<give>>")),
    );
    expect(Object.hasOwn(yarn.nodes, "__proto__")).toBe(true);
    // Its commands are checked like any node's.
    expect(() => harness().session.play(yarn)).toThrow(/give/);
    expect((await run(yarn, [], { handled: ["give"] })).transcript).toEqual([
      "in proto",
      "<<give>>",
    ]);
  });

  it("// starts a comment in a line, as in Yarn; \\/ keeps a slash", async () => {
    const yarn = loadYarn(
      start("Mae: Visit https:\\/\\/yarnspinner.dev // not shown"),
    );
    expect((await run(yarn)).transcript).toEqual([
      "Mae: Visit https://yarnspinner.dev",
    ]);
  });
});

describe("loadYarn — variables and expressions", () => {
  it("declare, set, compound set, and inline expressions", async () => {
    const yarn = loadYarn(
      start(
        [
          "<<declare $gold = 10>>",
          '<<declare $name = "Ari" as string>>',
          "{$name} has {$gold} gold.",
          "<<set $gold to $gold * 2>>",
          "<<set $gold -= 5>>",
          '<<set $name += "!">>',
          "{$name} has {$gold} gold, {$gold % 4} left over.",
        ].join("\n"),
      ),
    );
    expect(yarn.declare).toEqual({ $gold: 10, $name: "Ari" });
    expect((await run(yarn)).transcript).toEqual([
      "Ari has 10 gold.",
      "Ari! has 15 gold, 3 left over.",
    ]);
  });

  it("uses Yarn precedence: and / or / xor share one level", async () => {
    const yarn = loadYarn(
      start("<<if true or false and false>>\nyes\n<<else>>\nno\n<<endif>>"),
    );
    // Yarn reads it as (true or false) and false.
    expect((await run(yarn)).transcript).toEqual(["no"]);
  });

  it("undeclared variables get a default from how the script uses them", () => {
    const yarn = loadYarn(
      start(
        '<<set $count to $count + 1>>\n<<if $met>>\nHi\n<<endif>>\n<<set $title to "Sir">>\n<<set $copy to $late>>\n<<if $late > 2>>\n<<endif>>',
      ),
    );
    expect(yarn.declare).toEqual({
      $count: 0,
      $met: false,
      $title: "",
      $late: 0,
      $copy: 0,
    });
  });

  it("a variable whose type the script doesn't imply must be declared", () => {
    expect(() => loadYarn(start("Hi {$name}"))).toThrow(
      /<yarn>:3: can't tell what type \$name is; declare it/,
    );
    expect(() =>
      loadYarn(start("<<set $x to 1>>\n<<if $x and true>>\n<<endif>>")),
    ).toThrow(/\$x is used as both number and boolean; declare it/);
    const declared = loadYarn(start('<<declare $name = "Ari">>\nHi {$name}'));
    expect(declared.declare).toEqual({ $name: "Ari" });
  });

  it("a variable the game provides overrides an implied default", async () => {
    const yarn = loadYarn(start("<<if $gold > 5>>\nRich\n<<endif>>"));
    const storage = new MemoryVariableStorage({ $gold: 9 });
    expect((await run(yarn, [], { storage })).transcript).toEqual(["Rich"]);
  });

  it("smart variables are evaluated where they are read and can't be set", async () => {
    const yarn = loadYarn(
      start(
        "<<declare $gold = 60>>\n<<declare $rich = $gold > 50>>\n<<if $rich>>\nRich\n<<endif>>\n<<set $gold to 0>>\n{$rich}",
      ),
    );
    expect(yarn.declare).toEqual({ $gold: 60 });
    expect((await run(yarn)).transcript).toEqual(["Rich", "false"]);
    expect(() =>
      loadYarn(
        start("<<declare $a = $b + 1>>\n<<declare $b = 0>>\n<<set $a to 2>>"),
      ),
    ).toThrow(/\$a is a smart variable and can't be set/);
  });

  it("enums: cases are numbered unless given values; .Case and Enum.Case", async () => {
    const yarn = loadYarn(
      start(
        [
          "<<enum Mood>>",
          "<<case Happy>>",
          "<<case Sad>>",
          "<<endenum>>",
          "<<declare $mood = Mood.Sad as Mood>>",
          "<<if $mood == .Sad>>",
          "Sad",
          "<<endif>>",
        ].join("\n"),
      ),
    );
    expect(yarn.declare).toEqual({ $mood: 1 });
    expect((await run(yarn)).transcript).toEqual(["Sad"]);
    expect(() =>
      loadYarn(start('<<enum E>>\n<<case A = "a">>\n<<case B>>\n<<endenum>>')),
    ).toThrow(/give every case a value, or none/);
  });

  it("built-in functions work without installing them", async () => {
    const yarn = loadYarn(
      start("{round(2.5)} {dice(6)} {floor(2.7)} {format_invariant(1.5)}"),
    );
    expect((await run(yarn)).transcript).toEqual(["2 1 2 1.5"]);
  });

  it("a game function is checked when the script plays", () => {
    const yarn = loadYarn(start('{has_item("key")}'));
    expect(() => harness().session.play(yarn)).toThrow(DialoguePlayError);
    expect(() =>
      harness({ functions: { has_item: () => true } }).session.play(yarn),
    ).not.toThrow();
  });
});

describe("loadYarn — visits and once", () => {
  it("visited / visited_count count finished visits of a node", async () => {
    const yarn = loadYarn(
      start(
        '<<detour Shop>>\n{visited("Shop")} {visited_count("Shop")}\n<<detour Shop>>\n{visited_count("Shop")}',
        node("Shop", 'in shop {visited("Shop")}'),
      ),
    );
    expect(yarn.declare).toEqual({ "$Yarn.Internal.Visiting.Shop": 0 });
    expect((await run(yarn)).transcript).toEqual([
      "in shop false",
      "true 1",
      "in shop true",
      "2",
    ]);
  });

  it("visited() on a node with tracking: never is an error at load", () => {
    expect(() =>
      loadYarn(
        start(
          '<<if visited("T")>>\nx\n<<endif>>',
          "title: T\ntracking: never\n---\nt\n===\n",
        ),
      ),
    ).toThrow(
      /<yarn>:3: visited\("T"\) reads the visits of "T", which has 'tracking: never'/,
    );
  });

  it("<<once>> blocks, lines, and options run once across plays", async () => {
    const yarn = loadYarn(
      start(
        [
          "<<once>>",
          "First time.",
          "<<else>>",
          "Again.",
          "<<endonce>>",
          "Only once. <<once>> #line:once1",
          "-> Ask <<once>>",
          "-> Leave",
        ].join("\n"),
      ),
    );
    const storage = new MemoryVariableStorage();
    expect((await run(yarn, ["Ask"], { storage })).transcript).toEqual([
      "First time.",
      "Only once.",
      "? Ask | Leave",
    ]);
    expect(storage.get("$Yarn.Internal.Once.line:once1")).toBe(true);
    expect((await run(yarn, ["Leave"], { storage })).transcript).toEqual([
      "Again.",
      "? Leave",
    ]);
  });
});

describe("loadYarn — line groups and node groups", () => {
  it("a line group plays one available line, least seen first", async () => {
    const yarn = loadYarn(
      start("=> One\n=> Two\n=> Never <<if false>>\nAfter"),
    );
    const storage = new MemoryVariableStorage();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(...(await run(yarn, [], { storage })).transcript);
    }
    expect(seen).toEqual(["One", "After", "Two", "After", "One", "After"]);
  });

  it("the more specific line wins among the least seen", async () => {
    const yarn = loadYarn(
      start("<<declare $met = true>>\n=> Hello.\n=> Welcome back. <<if $met>>"),
    );
    expect((await run(yarn)).transcript).toEqual(["Welcome back."]);
  });

  it("node groups pick a member by its when: headers", async () => {
    const src =
      "title: Greet\nwhen: always\n---\nHello.\n===\n" +
      "title: Greet\nwhen: $met\n---\nWelcome back.\n===\n" +
      "title: Greet\nwhen: once\n---\nNice to meet you.\n===\n" +
      'title: Start\n---\n<<declare $met = false>>\n<<detour Greet>>\n<<set $met to true>>\n<<detour Greet>>\n{has_any_content("Greet")}\n===\n';
    const yarn = loadYarn(src);
    expect((await run(yarn)).transcript).toEqual([
      "Nice to meet you.",
      "Welcome back.",
      "true",
    ]);
  });

  it("a smart variable reading has_any_content() sees the group's conditions", async () => {
    const src =
      "title: G\nwhen: $x > 1\n---\nIn G.\n===\n" +
      'title: Start\n---\n<<declare $x = 0>>\n<<declare $any = has_any_content("G")>>\n{$any}\n<<set $x to 5>>\n{$any}\n===\n';
    expect((await run(loadYarn(src))).transcript).toEqual(["false", "true"]);
  });

  it("nodes sharing a title without when: headers are an error", () => {
    expect(() => loadYarn(node("A", "x") + node("A", "y"))).toThrow(
      /node "A" is already defined at <yarn>:1/,
    );
    expect(() =>
      loadYarn("title: A\nwhen: always\n---\nx\n===\n" + node("A", "y")),
    ).toThrow(/needs a 'when:' header/);
  });
});

describe("loadYarn — commands", () => {
  it("game commands get their words as args, expressions evaluated", async () => {
    const yarn = loadYarn(
      start(
        '<<declare $n = 2>>\n<<give_item sword {$n + 1} "big one" true>>\n<<camera pan{$n}>>',
      ),
    );
    const h = await run(yarn, [], { handled: ["give_item", "camera"] });
    expect(h.transcript).toEqual([
      "<<give_item sword 3 big one true>>",
      "<<camera pan2>>",
    ]);
  });

  it("an unhandled command fails when the script plays, naming it", () => {
    const yarn = loadYarn(start("<<shake 3>>"));
    expect(() => harness().session.play(yarn)).toThrow(
      /no handler for command type\(s\): shake/,
    );
  });

  it("<<wait>> needs one duration, checked when it's a literal", () => {
    expect(() => loadYarn(start("<<wait>>"))).toThrow(
      /<yarn>:3: <<wait>> takes one argument/,
    );
    expect(() => loadYarn(start("<<wait abc>>"))).toThrow(
      /<<wait>> needs a number of seconds >= 0, got "abc"/,
    );
    expect(() => loadYarn(start("<<wait -1>>"))).toThrow(/>= 0/);
    expect(() =>
      loadYarn(start("<<declare $d = 1>>\n<<wait {$d}>>\n<<wait 0.5>>")),
    ).not.toThrow();
  });

  it("an escaped brace in a command's words is text", async () => {
    const h = await run(loadYarn(start("<<give \\{x>>")), [], {
      handled: ["give"],
    });
    expect(h.transcript).toEqual(["<<give {x>>"]);
  });

  it("<<wait>> holds the conversation on the session clock", async () => {
    const yarn = loadYarn(start("A\n<<wait 2>>\nB"));
    const h = harness();
    h.session.play(yarn);
    await settle();
    h.session.advance();
    await settle();
    h.session.update(1.5);
    await settle();
    expect(h.transcript).toEqual(["A", "<<wait 2>>"]);
    h.session.update(1);
    await settle();
    expect(h.transcript).toEqual(["A", "<<wait 2>>", "B"]);
  });
});

describe("loadYarn — tags, markup, and metadata", () => {
  it("hashtags become meta; #view / #voice / #speed / #auto set the line's fields", () => {
    const yarn = loadYarn(
      start(
        "Mae: Hi. #view:bubble #voice:vo_1 #speed:2 #auto:1.5 #mood:happy #urgent",
      ),
    );
    expect(yarn.nodes["Start"]!.steps[0]).toEqual({
      kind: "say",
      speaker: "Mae",
      text: "Hi.",
      view: "bubble",
      voice: "vo_1",
      speed: 2,
      autoAdvance: 1.5,
      meta: { mood: "happy", urgent: true },
    });
  });

  it("an option's Name: prefix leaves the label and lands in meta.character", () => {
    const yarn = loadYarn(start("-> Mae: I'll go.\n-> Stay"));
    const choice = yarn.nodes["Start"]!.steps[0];
    expect(choice).toMatchObject({
      kind: "choice",
      options: [
        { text: "I'll go.", meta: { character: "Mae" } },
        { text: "Stay" },
      ],
    });
    expect(yarn.speakers).toBeUndefined();
  });

  it("the line right before options gets meta.lastline", () => {
    const yarn = loadYarn(start("Well?\n-> A\n-> B"));
    expect(yarn.nodes["Start"]!.steps[0]).toMatchObject({
      meta: { lastline: true },
    });
  });

  it("markup follows Yarn's runtime: pauses in ms, one space trimmed after a marker", async () => {
    const h = await run(
      loadYarn(start("Wait [pause=500/] for [sfx=bell/] it.")),
    );
    expect(h.transcript).toEqual(["Wait for it."]);
    expect(h.parsed[0]!.tokens).toEqual([
      { kind: "pause", atChar: 5, seconds: 0.5 },
      {
        kind: "marker",
        atChar: 9,
        name: "sfx",
        props: { sfx: "bell" },
      } satisfies MarkerToken,
    ]);
  });

  it("replacement markers read substituted values", async () => {
    const yarn = loadYarn(
      start(
        '<<declare $n = 1>>\nYou have [plural value={$n} one="% coin" other="% coins"/].',
      ),
    );
    expect((await run(yarn)).transcript).toEqual(["You have 1 coin."]);
  });
});

describe("loadYarn — projects and localisation", () => {
  const project = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      projectFileVersion: 3,
      sourceFiles: ["**/*.yarn"],
      excludeFiles: ["**/drafts/*"],
      baseLanguage: "en",
      ...extra,
    });

  it("compiles the project's source files and ignores the rest", async () => {
    const yarn = loadYarn({
      "./dialogue/Game.yarnproject": project(),
      "./dialogue/Start.yarn": start("From start.\n<<jump Shop>>"),
      "./dialogue/npcs/Shop.yarn": node("Shop", "From shop."),
      "./dialogue/drafts/Old.yarn": node("Old", "Draft"),
      "./other/Stray.yarn": node("Stray", "Not in the project"),
      "./dialogue/notes.txt": "ignored",
    });
    expect(yarn.id).toBe("Game");
    expect(Object.keys(yarn.nodes).sort()).toEqual(["Shop", "Start"]);
    expect((await run(yarn)).transcript).toEqual(["From start.", "From shop."]);
  });

  it("without a project every .yarn file compiles; the id comes from a lone file", () => {
    expect(loadYarn({ "a/Intro.yarn": node("Intro", "x") }).id).toBe("Intro");
    const two = loadYarn({
      "a.yarn": node("A", "x"),
      "b.yarn": node("B", "y"),
    });
    expect(two.id).toBe("yarn");
    expect(Object.keys(two.nodes)).toEqual(["A", "B"]);
    expect(loadYarn(start("x"), { id: "custom" }).id).toBe("custom");
  });

  it("collects #line strings and localisation tables into catalogs", async () => {
    const csv = [
      "language,id,text,file,node,lineNumber,lock,comment",
      'de,line:greet,"Mae: Hallo, {0}!",Start.yarn,Start,3,abcd,',
      "de,line:bye,Tschüss,Start.yarn,Start,4,abcd,",
      "de,line:stale,Old,Start.yarn,Start,9,abcd,",
      "de,line:tea,,Start.yarn,Start,5,abcd,",
    ].join("\n");
    const yarn = loadYarn({
      "dlg/Game.yarnproject": project({
        localisation: { en: { assets: "vo/en" }, de: { strings: "de.csv" } },
      }),
      "dlg/Start.yarn": start(
        '<<declare $who = "Ari">>\nMae: Hello, {$who}! #line:greet\nBye. #line:bye\n-> Tea #line:tea',
      ),
      "dlg/de.csv": csv,
    });
    expect(yarn.baseLanguage).toBe("en");
    expect(yarn.catalogs).toEqual({
      en: {
        "line:greet": "Hello, {0}!",
        "line:bye": "Bye.",
        "line:tea": "Tea",
      },
      de: { "line:greet": "Hallo, {0}!", "line:bye": "Tschüss" },
    });

    const german: I18nAdapter = {
      locale: "de",
      resolve: (text, values) =>
        interpolateDialogueText(
          typeof text === "string"
            ? text
            : (yarn.catalogs["de"]?.[text.key] ?? text.fallback),
          values ?? {},
        ),
    };
    expect((await run(yarn, [], { i18n: german })).transcript).toEqual([
      "Mae: Hallo, Ari!",
      "Tschüss",
      "? Tea",
    ]);
  });

  it("a localisation table missing from the files is an error that says what to do", () => {
    expect(() =>
      loadYarn({
        "Game.yarnproject": project({
          localisation: { de: { strings: "de.csv" } },
        }),
        "Start.yarn": start("x"),
      }),
    ).toThrow(
      /reads its strings from de\.csv, which is not among the files passed to loadYarn/,
    );
  });

  it("reports project file problems", () => {
    expect(() =>
      loadYarn({ "a.yarnproject": "{", "s.yarn": start("x") }),
    ).toThrow(/not valid JSON/);
    expect(() =>
      loadYarn({
        "a.yarnproject": project({ projectFileVersion: 9 }),
        "s.yarn": start("x"),
      }),
    ).toThrow(/projectFileVersion 9 is newer/);
    expect(() =>
      loadYarn({ "a.yarnproject": project(), "b.yarnproject": project() }),
    ).toThrow(/more than one \.yarnproject/);
    expect(() =>
      loadYarn({
        "a.yarnproject": project({ sourceFiles: ["x/*.yarn"] }),
        "s.yarn": start("x"),
      }),
    ).toThrow(/no \.yarn files match/);
  });

  it("reads a project file with comments, trailing commas, and any key case", () => {
    const yarn = loadYarn({
      "g.yarnproject":
        '{ "ProjectFileVersion": 2, // v2\n "BaseLanguage": "fr", }',
      "s.yarn": start("x"),
    });
    expect(yarn.baseLanguage).toBe("fr");
  });

  it("a non-string file value explains the import.meta.glob options", () => {
    expect(() => loadYarn({ "s.yarn": { default: "x" } })).toThrow(
      /pass \{ query: "\?raw", import: "default" \}/,
    );
  });
});

describe("loadYarn — errors", () => {
  it("errors are DialogueYarnErrors with file and line", () => {
    let caught: unknown;
    try {
      loadYarn({ "dlg/Start.yarn": start("Hi\n<<jump Nowhere>>") });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DialogueYarnError);
    expect(caught).toBeInstanceOf(DialogueScriptError);
    expect((caught as DialogueYarnError).message).toBe(
      'dlg/Start.yarn:4: <<jump Nowhere>>: there is no node "Nowhere"',
    );
  });

  it("a malformed expression reports the Yarn location", () => {
    expect(() => loadYarn(start("<<if $a + >>\nx\n<<endif>>"))).toThrow(
      /<yarn>:3: .* in "\$a \+"/,
    );
    expect(() => loadYarn(start("{$a +}"))).toThrow(/<yarn>:3:/);
  });

  it("unknown names and misused built-ins", () => {
    expect(() => loadYarn(start("{gold}"))).toThrow(
      /unknown name "gold" \(variables start with '\$'/,
    );
    expect(() => loadYarn(start("{visited($x)}"))).toThrow(
      /visited\(\) takes one node title/,
    );
    expect(() => loadYarn(start("<<call foo()>>"))).toThrow(
      /<<call>> is not supported/,
    );
  });

  it("the compiled script is already loaded, so play() doesn't walk it again", () => {
    const yarn: YarnScript = loadYarn(start("x"));
    expect(Object.isFrozen(yarn)).toBe(true);
  });
});
