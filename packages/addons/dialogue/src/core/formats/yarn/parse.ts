/**
 * Yarn Spinner source → syntax tree. Splits a `.yarn` file into nodes (header
 * lines, `---`, body, `===`) and parses each body into statements: lines,
 * option groups (`->`, nested by indentation), line groups (`=>`), and `<<…>>`
 * commands, with `<<if>>` / `<<once>>` / `<<enum>>` blocks resolved into their
 * nested form. Expressions, command arguments, and line text stay source
 * strings here; `compile.ts` interprets them.
 */

import { DialogueScriptError } from "../../validate.js";

/**
 * A Yarn source file failed to parse or compile. Carries the file name and
 * the 1-based line, and is a {@link DialogueScriptError}, so one
 * `catch (e instanceof DialogueScriptError)` covers every loader.
 */
export class DialogueYarnError extends DialogueScriptError {
  readonly file: string;
  readonly line: number;
  constructor(message: string, file: string, line: number) {
    super(`${file}:${line}: ${message}`);
    this.name = "DialogueYarnError";
    this.file = file;
    this.line = line;
  }
}

export interface YarnPos {
  readonly file: string;
  readonly line: number;
}

/** `<<once>>` / `<<once if cond>>` on a line or option. */
export interface YarnOnceMark {
  readonly condition?: string | undefined;
}

/** The parts every line-like statement shares (lines, options, line group items). */
export interface YarnContent {
  readonly pos: YarnPos;
  /** Line text as written, escapes intact, without its condition or hashtags. */
  readonly text: string;
  /** Source of an `<<if …>>` condition. */
  readonly condition?: string | undefined;
  readonly once?: YarnOnceMark | undefined;
  /** Hashtags without the leading `#`. */
  readonly tags: readonly string[];
}

export interface YarnLineStmt extends YarnContent {
  readonly kind: "line";
}

export interface YarnOption extends YarnContent {
  readonly body: readonly YarnStmt[];
}

export interface YarnOptionsStmt {
  readonly kind: "options";
  readonly pos: YarnPos;
  readonly options: readonly YarnOption[];
}

export interface YarnLineGroupStmt {
  readonly kind: "lineGroup";
  readonly pos: YarnPos;
  readonly items: readonly YarnOption[];
}

export interface YarnIfStmt {
  readonly kind: "if";
  readonly pos: YarnPos;
  /** `if` / `elseif` clauses in order; a clause with no condition is `else`. */
  readonly clauses: readonly {
    readonly pos: YarnPos;
    readonly condition: string | undefined;
    readonly body: readonly YarnStmt[];
  }[];
}

export interface YarnOnceStmt {
  readonly kind: "once";
  readonly pos: YarnPos;
  readonly condition: string | undefined;
  readonly body: readonly YarnStmt[];
  readonly elseBody: readonly YarnStmt[] | undefined;
}

export interface YarnEnumStmt {
  readonly kind: "enum";
  readonly pos: YarnPos;
  readonly name: string;
  readonly cases: readonly {
    readonly pos: YarnPos;
    readonly name: string;
    readonly value: string | undefined;
  }[];
}

/** Any other `<<…>>`: `set`, `declare`, `jump`, a game command, … */
export interface YarnCommandStmt {
  readonly kind: "command";
  readonly pos: YarnPos;
  /** The first word (`set`, `jump`, `give_item`, …). */
  readonly name: string;
  /** Everything after the first word, trimmed. */
  readonly rest: string;
}

export type YarnStmt =
  | YarnLineStmt
  | YarnOptionsStmt
  | YarnLineGroupStmt
  | YarnIfStmt
  | YarnOnceStmt
  | YarnEnumStmt
  | YarnCommandStmt;

export interface YarnHeader {
  readonly key: string;
  readonly value: string;
}

export interface YarnNode {
  readonly title: string;
  readonly pos: YarnPos;
  readonly headers: readonly YarnHeader[];
  readonly body: readonly YarnStmt[];
}

export interface YarnFile {
  readonly file: string;
  /** File-level hashtags written before the first node. */
  readonly tags: readonly string[];
  readonly nodes: readonly YarnNode[];
}

/** One non-blank body line: its indentation width and trimmed content. */
interface SourceLine {
  readonly line: number;
  readonly indent: number;
  readonly content: string;
}

/** Parse one `.yarn` file. Throws {@link DialogueYarnError} with the location. */
export function parseYarn(source: string, file: string): YarnFile {
  const raw = source.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const fileTags: string[] = [];
  const nodes: YarnNode[] = [];
  let i = 0;

  while (i < raw.length) {
    const trimmed = raw[i]!.trim();
    if (trimmed === "" || trimmed.startsWith("//")) {
      i++;
      continue;
    }
    if (trimmed.startsWith("#") && nodes.length === 0) {
      for (const tag of trimmed.split(/\s+/)) {
        if (tag.startsWith("#") && tag.length > 1) fileTags.push(tag.slice(1));
      }
      i++;
      continue;
    }

    // Headers until `---`.
    const nodeStart = i + 1;
    const headers: YarnHeader[] = [];
    for (;;) {
      if (i >= raw.length) {
        throw new DialogueYarnError(
          "node header has no '---' line before the end of the file",
          file,
          nodeStart,
        );
      }
      const h = raw[i]!.trim();
      i++;
      if (h === "---") break;
      if (h === "" || h.startsWith("//")) continue;
      const colon = h.indexOf(":");
      if (colon <= 0) {
        throw new DialogueYarnError(
          `expected a "key: value" node header or '---', got "${h}"`,
          file,
          i,
        );
      }
      headers.push({
        key: h.slice(0, colon).trim(),
        value: h.slice(colon + 1).trim(),
      });
    }

    // Body until `===`.
    const bodyLines: SourceLine[] = [];
    let closed = false;
    while (i < raw.length) {
      const text = raw[i]!;
      i++;
      if (text.trim() === "===") {
        closed = true;
        break;
      }
      const content = text.trim();
      if (content === "" || content.startsWith("//")) continue;
      bodyLines.push({ line: i, indent: indentWidth(text), content });
    }
    if (!closed) {
      throw new DialogueYarnError(
        "node has no '===' line before the end of the file",
        file,
        nodeStart,
      );
    }

    const titles = headers.filter((h) => h.key === "title");
    if (titles.length !== 1 || !titles[0]!.value) {
      throw new DialogueYarnError(
        titles.length > 1
          ? "node has more than one 'title:' header"
          : "node has no 'title:' header",
        file,
        nodeStart,
      );
    }
    const title = titles[0]!.value;
    const body = new BodyParser(bodyLines, file).parseBody();
    nodes.push({ title, pos: { file, line: nodeStart }, headers, body });
  }

  return { file, tags: fileTags, nodes };
}

/** Leading whitespace width; a tab counts as 8 columns, like Yarn's lexer. */
function indentWidth(line: string): number {
  let width = 0;
  for (const c of line) {
    if (c === " ") width += 1;
    else if (c === "\t") width += 8;
    else break;
  }
  return width;
}

/** Block keywords that close or continue an enclosing block. */
const TERMINATORS = new Set(["elseif", "else", "endif", "endonce"]);

class BodyParser {
  private i = 0;

  constructor(
    private readonly lines: readonly SourceLine[],
    private readonly file: string,
  ) {}

  parseBody(): YarnStmt[] {
    const body = this.parseBlock(0);
    const stray = this.lines[this.i];
    if (stray) {
      const name = commandName(stray.content);
      this.fail(
        stray,
        name !== undefined
          ? `<<${name}>> has no matching block to close`
          : "unexpected line",
      );
    }
    return body;
  }

  /**
   * Statements until a line indented below `minIndent` (the end of an option
   * body) or a block terminator (`<<elseif>>`, `<<else>>`, `<<endif>>`,
   * `<<endonce>>`), which the caller consumes.
   */
  private parseBlock(minIndent: number): YarnStmt[] {
    const out: YarnStmt[] = [];
    for (;;) {
      const line = this.lines[this.i];
      if (!line || line.indent < minIndent) return out;
      const name = commandName(line.content);
      if (name !== undefined && TERMINATORS.has(name)) return out;
      out.push(this.parseStatement(line, minIndent));
    }
  }

  private parseStatement(line: SourceLine, minIndent: number): YarnStmt {
    const { content } = line;
    if (content.startsWith("->")) return this.parseChoiceGroup("options");
    if (content.startsWith("=>")) return this.parseChoiceGroup("lineGroup");
    if (content.startsWith("<<")) return this.parseCommand(line, minIndent);
    this.i++;
    return { kind: "line", ...this.content(line, content) };
  }

  /** Consecutive `->` (or `=>`) items at one indentation, each with the body
   *  indented beneath it. */
  private parseChoiceGroup(
    kind: "options" | "lineGroup",
  ): YarnOptionsStmt | YarnLineGroupStmt {
    const marker = kind === "options" ? "->" : "=>";
    const first = this.lines[this.i]!;
    const items: YarnOption[] = [];
    for (;;) {
      const line = this.lines[this.i];
      if (
        !line ||
        line.indent !== first.indent ||
        !line.content.startsWith(marker)
      ) {
        break;
      }
      this.i++;
      const parts = this.content(line, line.content.slice(2).trim());
      const body = this.parseBlock(line.indent + 1);
      items.push({ ...parts, body });
    }
    const pos = this.pos(first);
    return kind === "options"
      ? { kind, pos, options: items }
      : { kind, pos, items };
  }

  private parseCommand(line: SourceLine, minIndent: number): YarnStmt {
    const { inner, after } = this.command(line);
    const { name, rest } = splitCommand(inner);
    this.expectNothingAfter(line, after, name);
    const pos = this.pos(line);
    this.i++;
    switch (name) {
      case "if":
        return this.parseIf(pos, rest, line, minIndent);
      case "once":
        return this.parseOnce(pos, rest, line, minIndent);
      case "enum":
        return this.parseEnum(pos, rest, line);
      case "":
        return this.fail(line, "empty command '<<>>'");
      default:
        return { kind: "command", pos, name, rest };
    }
  }

  private parseIf(
    pos: YarnPos,
    condition: string,
    opener: SourceLine,
    minIndent: number,
  ): YarnIfStmt {
    if (!condition) this.fail(opener, "<<if>> needs a condition");
    const clauses: {
      pos: YarnPos;
      condition: string | undefined;
      body: YarnStmt[];
    }[] = [];
    let clause: { pos: YarnPos; condition: string | undefined } = {
      pos,
      condition,
    };
    let sawElse = false;
    for (;;) {
      const body = this.parseBlock(minIndent);
      clauses.push({ ...clause, body });
      const line = this.lines[this.i];
      const name = line ? commandName(line.content) : undefined;
      if (!line || name === undefined || !TERMINATORS.has(name)) {
        this.fail(opener, "<<if>> has no matching <<endif>>");
      }
      const { inner, after } = this.command(line);
      const { rest } = splitCommand(inner);
      this.expectNothingAfter(line, after, name);
      this.i++;
      if (name === "endif") {
        if (rest) this.fail(line, "<<endif>> takes no condition");
        return { kind: "if", pos, clauses };
      }
      if (name === "endonce") {
        this.fail(line, "<<endonce>> closes an <<if>> block; use <<endif>>");
      }
      if (sawElse) this.fail(line, `<<${name}>> after <<else>>`);
      if (name === "elseif") {
        if (!rest) this.fail(line, "<<elseif>> needs a condition");
        clause = { pos: this.pos(line), condition: rest };
      } else {
        if (rest) {
          this.fail(line, "<<else>> takes no condition; use <<elseif …>>");
        }
        sawElse = true;
        clause = { pos: this.pos(line), condition: undefined };
      }
    }
  }

  private parseOnce(
    pos: YarnPos,
    rest: string,
    opener: SourceLine,
    minIndent: number,
  ): YarnOnceStmt {
    const condition = onceCondition(rest, () =>
      this.fail(opener, `expected <<once>> or <<once if …>>, got "${rest}"`),
    );
    const body = this.parseBlock(minIndent);
    let elseBody: YarnStmt[] | undefined;
    for (;;) {
      const line = this.lines[this.i];
      const name = line ? commandName(line.content) : undefined;
      if (!line || name === undefined || !TERMINATORS.has(name)) {
        this.fail(opener, "<<once>> has no matching <<endonce>>");
      }
      const { inner, after } = this.command(line);
      this.expectNothingAfter(line, after, name);
      if (splitCommand(inner).rest) {
        this.fail(line, `<<${name}>> takes no condition here`);
      }
      this.i++;
      if (name === "endonce")
        return { kind: "once", pos, condition, body, elseBody };
      if (name !== "else" || elseBody) {
        this.fail(line, `<<${name}>> doesn't belong in a <<once>> block`);
      }
      elseBody = this.parseBlock(minIndent);
    }
  }

  private parseEnum(
    pos: YarnPos,
    name: string,
    opener: SourceLine,
  ): YarnEnumStmt {
    if (!/^[A-Za-z_]\w*$/.test(name)) {
      this.fail(opener, `<<enum>> needs a name, got "${name}"`);
    }
    const cases: { pos: YarnPos; name: string; value: string | undefined }[] =
      [];
    for (;;) {
      const line = this.lines[this.i];
      if (!line) this.fail(opener, `<<enum ${name}>> has no <<endenum>>`);
      const { inner, after } = this.command(line);
      this.expectNothingAfter(line, after, "case");
      const cmd = splitCommand(inner);
      this.i++;
      if (cmd.name === "endenum") return { kind: "enum", pos, name, cases };
      if (cmd.name !== "case") {
        this.fail(line, `expected <<case …>> or <<endenum>> inside <<enum>>`);
      }
      const m = /^([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/.exec(cmd.rest);
      if (!m) this.fail(line, `<<case>> needs a name, got "${cmd.rest}"`);
      cases.push({ pos: this.pos(line), name: m[1]!, value: m[2]?.trim() });
    }
  }

  /** The `<<…>>` at the start of `line` and whatever follows it. */
  private command(line: SourceLine): { inner: string; after: string } {
    if (!line.content.startsWith("<<")) {
      this.fail(line, "expected a <<command>>");
    }
    const end = findCommandEnd(line.content, 2);
    if (end < 0) this.fail(line, "'<<' has no closing '>>'");
    return {
      inner: line.content.slice(2, end).trim(),
      after: line.content.slice(end + 2),
    };
  }

  /** A command line may end in a `// comment`, but block commands take no
   *  hashtags; a game command's hashtags are ignored like Yarn's are. */
  private expectNothingAfter(
    line: SourceLine,
    after: string,
    name: string,
  ): void {
    const tail = stripComment(after).trim();
    if (tail === "" || tail.startsWith("#")) return;
    this.fail(line, `unexpected text after <<${name}>>: "${tail}"`);
  }

  /** Split a line / option / line-group item into text, `<<if>>` / `<<once>>`
   *  condition, and hashtags. */
  private content(line: SourceLine, content: string): YarnContent {
    const pos = this.pos(line);
    const { text, rest } = splitText(content);
    let condition: string | undefined;
    let once: YarnOnceMark | undefined;
    let tail = rest;
    for (;;) {
      tail = tail.trimStart();
      if (!tail.startsWith("<<")) break;
      const end = findCommandEnd(tail, 2);
      if (end < 0) this.fail(line, "'<<' has no closing '>>'");
      const { name, rest: arg } = splitCommand(tail.slice(2, end).trim());
      if (name === "if" && condition === undefined && once === undefined) {
        if (!arg) this.fail(line, "<<if>> needs a condition");
        condition = arg;
      } else if (
        name === "once" &&
        condition === undefined &&
        once === undefined
      ) {
        once = {
          condition: onceCondition(arg, () =>
            this.fail(line, `expected <<once>> or <<once if …>>, got "${arg}"`),
          ),
        };
      } else {
        this.fail(
          line,
          "a line or option takes one <<if …>> or <<once>> condition",
        );
      }
      tail = tail.slice(end + 2);
    }
    const tags: string[] = [];
    for (const word of stripComment(tail).trim().split(/\s+/)) {
      if (word === "") continue;
      if (!word.startsWith("#") || word.length === 1) {
        this.fail(line, `unexpected text after the line: "${word}"`);
      }
      tags.push(word.slice(1));
    }
    return { pos, text, condition, once, tags };
  }

  private pos(line: SourceLine): YarnPos {
    return { file: this.file, line: line.line };
  }

  private fail(line: SourceLine, message: string): never {
    throw new DialogueYarnError(message, this.file, line.line);
  }
}

/** `<<once>>` → no condition; `<<once if cond>>` → `cond`. */
function onceCondition(rest: string, bad: () => never): string | undefined {
  if (rest === "") return undefined;
  const m = /^if\s+(.+)$/.exec(rest);
  if (!m) bad();
  return m[1]!.trim();
}

/** The first word of a `<<…>>` line, or `undefined` if the line isn't one. */
function commandName(content: string): string | undefined {
  if (!content.startsWith("<<")) return undefined;
  return /^<<\s*([^\s>]*)/.exec(content)![1]!;
}

function splitCommand(inner: string): { name: string; rest: string } {
  const m = /^(\S*)\s*([\s\S]*)$/.exec(inner)!;
  return { name: m[1]!, rest: m[2]!.trim() };
}

/**
 * Index of the `>>` closing a `<<` whose content starts at `from`, skipping
 * `"…"` strings and `{…}` expressions; -1 when unclosed.
 */
export function findCommandEnd(s: string, from: number): number {
  let depth = 0;
  let quoted = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === ">" && s[i + 1] === ">") return i;
  }
  return -1;
}

/**
 * Index of the `}` closing a `{` whose content starts at `from`, skipping
 * `"…"` strings; -1 when unclosed.
 */
export function findBraceEnd(s: string, from: number): number {
  let quoted = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "}") return i;
  }
  return -1;
}

/**
 * Split line content at the first unescaped `<<`, `#`, or `//` that isn't
 * inside a `{…}` expression (a `#` inside `[…]` markup, like a hex colour,
 * stays text). `text` keeps its escapes; `rest` starts at the split point.
 */
function splitText(content: string): { text: string; rest: string } {
  let bracket = 0;
  for (let i = 0; i < content.length; i++) {
    const c = content[i]!;
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") {
      const end = findBraceEnd(content, i + 1);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (c === "[") bracket++;
    else if (c === "]") bracket = Math.max(0, bracket - 1);
    else if (c === "<" && content[i + 1] === "<") {
      return { text: content.slice(0, i).trimEnd(), rest: content.slice(i) };
    } else if (c === "/" && content[i + 1] === "/") {
      return { text: content.slice(0, i).trimEnd(), rest: "" };
    } else if (c === "#" && bracket === 0) {
      return { text: content.slice(0, i).trimEnd(), rest: content.slice(i) };
    }
  }
  return { text: content.trimEnd(), rest: "" };
}

/** Drop a trailing `// comment` (outside `"…"` strings). */
function stripComment(s: string): string {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "/" && s[i + 1] === "/") return s.slice(0, i);
  }
  return s;
}
