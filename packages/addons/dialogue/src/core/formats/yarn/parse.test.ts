import { describe, expect, it } from "vitest";

import { DialogueScriptError } from "../../validate.js";
import { DialogueYarnError, parseYarn, type YarnStmt } from "./parse.js";

const node = (body: string, headers = "title: Start"): string =>
  `${headers}\n---\n${body}\n===\n`;

function body(src: string): readonly YarnStmt[] {
  return parseYarn(node(src), "test.yarn").nodes[0]!.body;
}

function error(src: string): DialogueYarnError {
  try {
    parseYarn(src, "test.yarn");
  } catch (e) {
    return e as DialogueYarnError;
  }
  throw new Error("expected a parse error");
}

describe("parseYarn — files and nodes", () => {
  it("reads nodes, their headers, and file-level hashtags", () => {
    const file = parseYarn(
      "#file_tag\n// comment\ntitle: A\ntags: x y\nposition: 1,2\n---\nHi\n===\ntitle: B\n---\n===\n",
      "f.yarn",
    );
    expect(file.tags).toEqual(["file_tag"]);
    expect(file.nodes.map((n) => n.title)).toEqual(["A", "B"]);
    expect(file.nodes[0]!.headers).toEqual([
      { key: "title", value: "A" },
      { key: "tags", value: "x y" },
      { key: "position", value: "1,2" },
    ]);
    expect(file.nodes[0]!.pos).toEqual({ file: "f.yarn", line: 3 });
    expect(file.nodes[1]!.body).toEqual([]);
  });

  it("reports a missing title, a missing ---, and a missing ===", () => {
    expect(error("tags: x\n---\n===\n").message).toBe(
      "test.yarn:1: node has no 'title:' header",
    );
    expect(error("title: A\nHi\n").message).toMatch(
      /expected a "key: value" node header or '---'/,
    );
    expect(error("title: A\n---\nHi\n").message).toBe(
      "test.yarn:1: node has no '===' line before the end of the file",
    );
  });

  it("errors are DialogueScriptErrors carrying file and line", () => {
    const e = error("title: A\n---\n<<if $x>>\nHi\n===\n");
    expect(e).toBeInstanceOf(DialogueScriptError);
    expect(e.file).toBe("test.yarn");
    expect(e.line).toBe(3);
    expect(e.message).toMatch(/<<if>> has no matching <<endif>>/);
  });
});

describe("parseYarn — lines", () => {
  it("splits text, condition, once, hashtags, and a trailing comment", () => {
    expect(
      body("Mae: Hi {$name}! <<if $x > 1>> #line:a1 #happy // note"),
    ).toEqual([
      {
        kind: "line",
        pos: { file: "test.yarn", line: 3 },
        text: "Mae: Hi {$name}!",
        condition: "$x > 1",
        once: undefined,
        tags: ["line:a1", "happy"],
      },
    ]);
    expect(body("Hi <<once if $y>>")[0]).toMatchObject({
      text: "Hi",
      condition: undefined,
      once: { condition: "$y" },
    });
  });

  it("a # inside markup or an expression is text, an escaped one too", () => {
    expect(body('[color=#ff0]x[/color] {"#"} \\#1')[0]).toMatchObject({
      text: '[color=#ff0]x[/color] {"#"} \\#1',
      tags: [],
    });
  });
});

describe("parseYarn — options and line groups", () => {
  it("groups consecutive options at one indent, each with its indented body", () => {
    const stmts = body(
      [
        "-> One #line:o1",
        "    A",
        "    -> Nested",
        "        B",
        "-> Two <<if $ok>>",
        "After",
      ].join("\n"),
    );
    expect(stmts.map((s) => s.kind)).toEqual(["options", "line"]);
    const group = stmts[0] as Extract<YarnStmt, { kind: "options" }>;
    expect(group.options.map((o) => o.text)).toEqual(["One", "Two"]);
    expect(group.options[0]!.tags).toEqual(["line:o1"]);
    expect(group.options[0]!.body.map((s) => s.kind)).toEqual([
      "line",
      "options",
    ]);
    expect(group.options[1]!.condition).toBe("$ok");
    expect(group.options[1]!.body).toEqual([]);
  });

  it("an option body may hold an if block, and an endif can close options", () => {
    const stmts = body(
      [
        "<<if $a>>",
        "    -> X",
        "        <<if $b>>",
        "        Inner",
        "        <<endif>>",
        "    -> Y",
        "<<endif>>",
      ].join("\n"),
    );
    const ifStmt = stmts[0] as Extract<YarnStmt, { kind: "if" }>;
    const group = ifStmt.clauses[0]!.body[0] as Extract<
      YarnStmt,
      { kind: "options" }
    >;
    expect(group.options.map((o) => o.text)).toEqual(["X", "Y"]);
    expect(group.options[0]!.body[0]!.kind).toBe("if");
  });

  it("=> items form a line group", () => {
    const stmts = body("=> One\n=> Two <<if $x>>\n    More");
    expect(stmts[0]).toMatchObject({
      kind: "lineGroup",
      items: [{ text: "One" }, { text: "Two", condition: "$x" }],
    });
  });
});

describe("parseYarn — blocks and commands", () => {
  it("if / elseif / else / endif", () => {
    const stmts = body(
      "<<if $a>>\nA\n<<elseif $b>>\nB\n<<else>>\nC\n<<endif>>",
    );
    expect(stmts[0]).toMatchObject({
      kind: "if",
      clauses: [
        { condition: "$a", body: [{ text: "A" }] },
        { condition: "$b", body: [{ text: "B" }] },
        { condition: undefined, body: [{ text: "C" }] },
      ],
    });
  });

  it("once blocks with an optional condition and else", () => {
    expect(
      body("<<once if $x>>\nA\n<<else>>\nB\n<<endonce>>")[0],
    ).toMatchObject({
      kind: "once",
      condition: "$x",
      body: [{ text: "A" }],
      elseBody: [{ text: "B" }],
    });
  });

  it("enums with cases", () => {
    expect(
      body(
        '<<enum Food>>\n<<case Apple>>\n<<case Pear = "p">>\n<<endenum>>',
      )[0],
    ).toMatchObject({
      kind: "enum",
      name: "Food",
      cases: [
        { name: "Apple", value: undefined },
        { name: "Pear", value: '"p"' },
      ],
    });
  });

  it("any other command keeps its name and the rest", () => {
    expect(body('<<give_item sword "big one" {$n}>> // why')[0]).toMatchObject({
      kind: "command",
      name: "give_item",
      rest: 'sword "big one" {$n}',
    });
    // `>>` inside a string or an expression doesn't close the command.
    expect(body('<<say ">>" {$a >> 1}>>')[0]).toMatchObject({
      rest: '">>" {$a >> 1}',
    });
  });

  it("reports stray and unclosed block commands", () => {
    expect(error(node("<<endif>>")).message).toMatch(
      /<<endif>> has no matching block/,
    );
    expect(error(node("<<if $a>>\n<<endonce>>")).message).toMatch(
      /use <<endif>>/,
    );
    expect(
      error(node("<<if $a>>\n<<else>>\n<<elseif $b>>\n<<endif>>")).message,
    ).toMatch(/<<elseif>> after <<else>>/);
    expect(error(node("<<wait 1")).message).toMatch(/'<<' has no closing '>>'/);
  });
});
