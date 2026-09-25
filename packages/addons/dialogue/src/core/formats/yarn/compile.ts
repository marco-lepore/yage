/**
 * Yarn syntax tree → dialogue script. Every Yarn construct lowers onto the
 * existing dialogue model, so the runner, session, presenters, and validation
 * run Yarn content with no Yarn-specific code:
 *
 * - A node becomes a dialogue node of the same title. Structured flow inside a
 *   node (`<<if>>`, option bodies, `<<once>>`, line groups) splits it into
 *   extra nodes named `Title#1`, `Title#2`, … joined by jumps.
 * - A line becomes a `say` step; its `Character:` prefix becomes the speaker,
 *   each `{expression}` a `{0}`-style token filled from the step's
 *   `expressions`, and `#line:` its catalog key.
 * - Options become a `choice` step; line groups (`=>`) and node groups
 *   (`when:`) a `select` step; `<<jump>>` / `<<detour>>` / `<<return>>` /
 *   `<<stop>>` become `goto` / `detour` / `return` / `end`.
 * - `<<set>>` becomes the built-in `set` command, and every other command a
 *   command whose `args` are the command's words.
 * - `<<declare>>` (and variables whose type the script implies) become
 *   declared defaults; a declaration whose value is not a plain value (a smart
 *   variable) is expanded where it is read; enum cases become their values.
 * - `visited()` / `visited_count()`, `<<once>>`, and group view counts read
 *   and write counters in the variable storage under Yarn Spinner's own names
 *   (`$Yarn.Internal.Visiting.<Title>`, `$Yarn.Internal.Once.<id>`,
 *   `$Yarn.Internal.Content.ViewCount.<id>`), so they persist and save like
 *   any variable.
 */

import { isExpr } from "../../expr.js";
import { parseYarnExpr } from "../../expr-parse.js";
import type { DialogueText } from "../../i18n.js";
import type {
  ChoiceOption,
  Command,
  DialogueScript,
  Expr,
  SayStep,
  SelectOption,
  SpeakerDef,
  Step,
  StepTarget,
  VarMap,
  VarValue,
} from "../../types.js";
import {
  DialogueYarnError,
  findBraceEnd,
  type YarnContent,
  type YarnFile,
  type YarnNode,
  type YarnOption,
  type YarnPos,
  type YarnStmt,
} from "./parse.js";
import { waitSeconds } from "../../validate.js";
import { convertSourceText, splitCharacter } from "./text.js";

/** Storage names Yarn Spinner keeps its own bookkeeping under. */
const VISITING = "$Yarn.Internal.Visiting.";
const ONCE = "$Yarn.Internal.Once.";
const VIEW_COUNT = "$Yarn.Internal.Content.ViewCount.";

/** A node title, as Yarn Spinner 2 accepts it (3 is stricter). */
const TITLE = /^[^\s[\]<>{}|:#$"]+$/;

export interface YarnCompileOptions {
  readonly id: string;
  /** Extra speaker details keyed by character name. */
  readonly speakers?: Readonly<Record<string, Partial<SpeakerDef>>> | undefined;
}

/** A `#line:` tagged string: its base-language text and where it was written. */
export interface YarnLineString {
  readonly text: string;
  /** Whether the source line had a `Character:` prefix (a translation's copy
   *  of the prefix is dropped the same way). */
  readonly hasCharacter: boolean;
  readonly pos: YarnPos;
}

export interface YarnCompiled {
  readonly script: DialogueScript;
  /** Every `#line:` id → its string, in source order. */
  readonly strings: ReadonlyMap<string, YarnLineString>;
}

type YarnType = "number" | "string" | "boolean";

interface Declaration {
  readonly pos: YarnPos;
  /** Stored default; absent for a smart variable. */
  readonly value?: VarValue;
  /** A smart variable's expression, expanded where the variable is read. */
  readonly smart?: Expr;
}

/** One node of a node group: its unique id and its `when:` availability. */
interface GroupMember {
  readonly node: YarnNode;
  readonly id: string;
  readonly condition: Expr | undefined;
  readonly priority: number;
  readonly once: boolean;
}

/** Say-line hashtags that set a first-class step field (the compact DSL's
 *  line hint names). */
const SAY_FIELDS: Readonly<
  Record<string, "view" | "voice" | "speed" | "autoAdvance">
> = { view: "view", voice: "voice", speed: "speed", auto: "autoAdvance" };

export function compileYarn(
  files: readonly YarnFile[],
  options: YarnCompileOptions,
): YarnCompiled {
  return new Compiler(files, options).compile();
}

class Compiler {
  /** Plain nodes by title. */
  private readonly nodes = new Map<string, YarnNode>();
  /** Node groups by title (nodes sharing a title, each with `when:`). */
  private readonly groups = new Map<string, GroupMember[]>();
  private readonly titleOrder: string[] = [];
  private readonly enums = new Map<string, Map<string, VarValue>>();
  private readonly declarations = new Map<string, Declaration>();
  /** Smart variables currently being expanded (cycle guard). */
  private readonly expanding = new Set<string>();
  /** Titles whose visits are counted. */
  private readonly tracked = new Set<string>();
  private readonly untracked = new Set<string>();
  private readonly characters = new Set<string>();
  private readonly strings = new Map<string, YarnLineString>();
  /** Types implied by how undeclared variables are used. */
  private readonly implied = new Map<string, Set<YarnType>>();
  /** Every `$variable` the script reads or sets, with where it first appears
   *  (an undeclared one needs a type the script implies). */
  private readonly referenced = new Map<string, YarnPos>();
  /** `<<set>>` values, re-typed at the end so an assignment from a variable
   *  typed later still passes its type on. */
  private readonly assignments: { name: string; value: Expr }[] = [];
  /** Where each node's visits are read, to reject `tracking: never` nodes. */
  private readonly visitReads: { title: string; pos: YarnPos }[] = [];
  /** Extra declared defaults: once flags and view counters. */
  private readonly internal: VarMap = {};

  constructor(
    private readonly files: readonly YarnFile[],
    private readonly options: YarnCompileOptions,
  ) {}

  compile(): YarnCompiled {
    this.collectNodes();

    // Enums first (declarations may use their cases), then declarations.
    this.walkAll((stmt) => {
      if (stmt.kind === "enum") this.declareEnum(stmt);
    });
    const pending: { pos: YarnPos; rest: string }[] = [];
    this.walkAll((stmt) => {
      if (stmt.kind === "command" && stmt.name === "declare") {
        pending.push({ pos: stmt.pos, rest: stmt.rest });
      }
    });
    for (const d of pending) this.declare(d.pos, d.rest);
    for (const members of this.groups.values()) this.resolveWhen(members);

    // Null prototype: a node title is any string, `__proto__` included.
    const irNodes: Record<string, { id: string; steps: Step[] }> =
      Object.create(null);
    const add = (segments: readonly Segment[]): void => {
      for (const seg of segments) irNodes[seg.id] = seg;
    };
    for (const title of this.titleOrder) {
      const node = this.nodes.get(title);
      if (node) {
        add(new NodeCompiler(this, node, title, title).compile());
        continue;
      }
      const members = this.groups.get(title)!;
      add([this.groupHub(title, members)]);
      for (const member of members) {
        add(
          new NodeCompiler(this, member.node, member.id, title).compile(
            member.once ? [setStep(ONCE + member.id, literal(true))] : [],
          ),
        );
      }
    }

    // Visit counting, now that every `visited()` reader is known.
    for (const read of this.visitReads) {
      if (this.untracked.has(read.title)) {
        this.fail(
          read.pos,
          `visited("${read.title}") reads the visits of "${read.title}", which has 'tracking: never'`,
        );
      }
    }
    for (const title of this.untracked) this.tracked.delete(title);
    for (const seg of Object.values(irNodes)) {
      seg.steps = seg.steps.flatMap((step) => this.exitStep(step));
    }

    return { script: this.script(irNodes), strings: this.strings };
  }

  private script(
    nodes: Record<string, { id: string; steps: Step[] }>,
  ): DialogueScript {
    const declare: VarMap = {};
    // An assignment from a variable whose type was implied later.
    for (let changed = true; changed; ) {
      changed = false;
      for (const { name, value } of this.assignments) {
        const before = this.implied.get(name)?.size ?? 0;
        this.implyAssignment(name, value);
        if ((this.implied.get(name)?.size ?? 0) !== before) changed = true;
      }
    }
    for (const [name, pos] of this.referenced) {
      if (this.declarations.has(name)) continue;
      const types = [...(this.implied.get(name) ?? [])];
      if (types.length !== 1) {
        this.fail(
          pos,
          types.length === 0
            ? `can't tell what type ${name} is; declare it (<<declare ${name} = …>>)`
            : `${name} is used as both ${types.join(" and ")}; declare it (<<declare ${name} = …>>)`,
        );
      }
      const [type] = types;
      declare[name] = type === "number" ? 0 : type === "string" ? "" : false;
    }
    for (const [name, decl] of this.declarations) {
      if (decl.value !== undefined) declare[name] = decl.value;
    }
    for (const title of this.tracked) declare[VISITING + title] = 0;
    Object.assign(declare, this.internal);

    const speakers: Record<string, SpeakerDef> = {};
    for (const character of this.characters) {
      speakers[character] = {
        name: character,
        ...this.options.speakers?.[character],
      };
    }
    return {
      id: this.options.id,
      start: this.titleOrder.includes("Start") ? "Start" : this.titleOrder[0]!,
      nodes,
      ...(this.characters.size > 0 ? { speakers } : {}),
      ...(Object.keys(declare).length > 0 ? { declare } : {}),
    };
  }

  // ── Nodes and node groups ────────────────────────────────────────────────

  private collectNodes(): void {
    const byTitle = new Map<string, YarnNode[]>();
    for (const file of this.files) {
      for (const node of file.nodes) {
        if (!TITLE.test(node.title)) {
          this.fail(node.pos, `"${node.title}" is not a valid node title`);
        }
        let list = byTitle.get(node.title);
        if (!list) {
          byTitle.set(node.title, (list = []));
          this.titleOrder.push(node.title);
        }
        list.push(node);
      }
    }
    if (byTitle.size === 0) {
      throw new DialogueYarnError(
        "no nodes found",
        this.files[0]?.file ?? "<yarn>",
        1,
      );
    }
    for (const [title, list] of byTitle) {
      const tracking = list.map((n) => header(n, "tracking")[0]);
      if (tracking.includes("always")) this.tracked.add(title);
      if (tracking.includes("never")) this.untracked.add(title);
      const grouped = list.filter((n) => header(n, "when").length > 0);
      if (grouped.length === 0 && list.length === 1) {
        this.nodes.set(title, list[0]!);
        continue;
      }
      if (grouped.length !== list.length) {
        const other = list.find((n) => !grouped.includes(n))!;
        const first = list[0]!;
        this.fail(
          list[1]!.pos,
          grouped.length === 0
            ? `node "${title}" is already defined at ${first.pos.file}:${first.pos.line}`
            : `node "${title}" at ${other.pos.file}:${other.pos.line} needs a 'when:' header like the other nodes named "${title}"`,
        );
      }
      const ids = new Set<string>();
      this.groups.set(
        title,
        list.map((node, i) => {
          const sub = header(node, "subtitle")[0];
          const id = `${title}.${sub ?? i + 1}`;
          if (ids.has(id) || byTitle.has(id)) {
            this.fail(node.pos, `node group member name "${id}" is taken`);
          }
          ids.add(id);
          return { node, id, condition: undefined, priority: 0, once: false };
        }),
      );
    }
  }

  /** Each group member's `when:` headers → availability, priority, once. */
  private resolveWhen(members: GroupMember[]): void {
    for (const [i, member] of members.entries()) {
      const parts: Expr[] = [];
      let priority = 0;
      let once = false;
      for (const when of header(member.node, "when")) {
        if (when === "always") continue;
        let source = when;
        if (/^once(\s|$)/.test(when)) {
          once = true;
          priority += 1;
          parts.push(not({ kind: "varRef", name: ONCE + member.id }));
          const rest = when.slice(4).trim();
          if (rest === "") continue;
          const m = /^if\s+(.+)$/.exec(rest);
          if (!m) {
            this.fail(
              member.node.pos,
              `expected "when: once if …", got "when: ${when}"`,
            );
          }
          source = m[1]!;
        }
        const expr = this.condition(source, member.node.pos);
        priority += 1 + countLogical(expr);
        parts.push(expr);
      }
      if (once) this.internal[ONCE + member.id] = false;
      this.internal[VIEW_COUNT + member.id] = 0;
      members[i] = {
        ...member,
        condition: parts.length > 0 ? all(parts) : undefined,
        priority,
        once,
      };
    }
  }

  /** A node group's own node: pick a member, or return when none fits. */
  private groupHub(title: string, members: readonly GroupMember[]): Segment {
    return {
      id: title,
      steps: [
        {
          kind: "select",
          options: members.map(
            (m): SelectOption => ({
              target: m.id,
              ...(m.condition ? { condition: m.condition } : {}),
              priority: m.priority,
              counter: VIEW_COUNT + m.id,
            }),
          ),
        },
        { kind: "return" },
      ],
    };
  }

  // ── Declarations, enums, expressions ─────────────────────────────────────

  private declareEnum(stmt: Extract<YarnStmt, { kind: "enum" }>): void {
    if (this.enums.has(stmt.name)) {
      this.fail(stmt.pos, `enum "${stmt.name}" is already declared`);
    }
    if (stmt.cases.length === 0) {
      this.fail(stmt.pos, `enum "${stmt.name}" has no cases`);
    }
    const valued = stmt.cases.filter((c) => c.value !== undefined).length;
    if (valued !== 0 && valued !== stmt.cases.length) {
      this.fail(
        stmt.pos,
        `enum "${stmt.name}": give every case a value, or none`,
      );
    }
    const cases = new Map<string, VarValue>();
    const seen = new Set<VarValue>();
    for (const [i, c] of stmt.cases.entries()) {
      if (cases.has(c.name)) {
        this.fail(c.pos, `enum "${stmt.name}" repeats case "${c.name}"`);
      }
      let value: VarValue = i;
      if (c.value !== undefined) {
        const expr = this.expr(c.value, c.pos);
        const v = expr.kind === "literal" ? expr.value : undefined;
        if (typeof v !== "number" && typeof v !== "string") {
          this.fail(
            c.pos,
            `enum case "${c.name}" needs a number or string value`,
          );
        }
        value = v;
      }
      if (seen.has(value)) {
        this.fail(
          c.pos,
          `enum "${stmt.name}" uses the value ${String(value)} twice`,
        );
      }
      seen.add(value);
      cases.set(c.name, value);
    }
    const types = new Set([...cases.values()].map((v) => typeof v));
    if (types.size > 1) {
      this.fail(stmt.pos, `enum "${stmt.name}" mixes number and string values`);
    }
    this.enums.set(stmt.name, cases);
  }

  private declare(pos: YarnPos, rest: string): void {
    const m =
      /^(\$[A-Za-z_][\w.]*)\s*(?:=|to)\s*([\s\S]+?)(?:\s+as\s+([A-Za-z_]\w*))?$/.exec(
        rest,
      );
    if (!m) {
      this.fail(
        pos,
        `expected <<declare $name = value>>, got "<<declare ${rest}>>"`,
      );
    }
    const name = m[1]!;
    const prior = this.declarations.get(name);
    if (prior) {
      this.fail(
        pos,
        `${name} is already declared at ${prior.pos.file}:${prior.pos.line}`,
      );
    }
    const source = m[2]!.trim();
    const declaredType = m[3];
    const tree = this.parse(source, pos);
    if (!isPlainValue(source, tree)) {
      // Anything but a plain value is a smart variable. Its tree is lowered
      // where it is read, once node groups and every declaration are known.
      this.declarations.set(name, { pos, smart: tree });
      return;
    }
    const value = storedValue(this.lower(tree, pos));
    if (declaredType !== undefined) {
      const expected = typeName(declaredType);
      const cases = this.enums.get(declaredType);
      if (expected === undefined && !cases) {
        this.fail(pos, `unknown type "${declaredType}" for ${name}`);
      }
      if (expected !== undefined && typeof value !== expected) {
        this.fail(
          pos,
          `${name} is declared as ${declaredType} but its value is a ${typeof value}`,
        );
      }
      if (cases && ![...cases.values()].includes(value)) {
        this.fail(
          pos,
          `${name} is declared as ${declaredType} but its value is not one of its cases`,
        );
      }
    }
    this.declarations.set(name, { pos, value });
  }

  /** Parse and lower a Yarn expression: enum cases become literals, smart
   *  variables expand, `visited()` / `visited_count()` read visit counters. */
  expr(source: string, pos: YarnPos): Expr {
    return this.lower(this.parse(source, pos), pos);
  }

  /** Parse a Yarn expression without lowering it. */
  private parse(source: string, pos: YarnPos): Expr {
    try {
      return parseYarnExpr(enumShorthand(source));
    } catch (e) {
      return this.fail(
        pos,
        `${e instanceof Error ? e.message : String(e)} in "${source}"`,
      );
    }
  }

  /** An expression used as a condition (its value is a boolean). */
  condition(source: string, pos: YarnPos): Expr {
    const expr = this.expr(source, pos);
    this.implyVar(expr, "boolean");
    return expr;
  }

  private lower(expr: Expr, pos: YarnPos): Expr {
    switch (expr.kind) {
      case "literal":
        return expr;
      case "varRef":
        return this.lowerName(expr.name, pos);
      case "group":
        return { kind: "group", expr: this.lower(expr.expr, pos) };
      case "unary": {
        const operand = this.lower(expr.operand, pos);
        this.implyVar(operand, expr.op === "-" ? "number" : "boolean");
        return { ...expr, operand };
      }
      case "binary": {
        const left = this.lower(expr.left, pos);
        const right = this.lower(expr.right, pos);
        this.imply(expr.op, left, right);
        return { ...expr, left, right };
      }
      case "call": {
        if (expr.fn === "visited" || expr.fn === "visited_count") {
          return this.visitRead(expr, pos);
        }
        if (expr.fn === "has_any_content") return this.hasAnyContent(expr, pos);
        return {
          ...expr,
          args: (expr.args ?? []).map((a) => this.lower(a, pos)),
        };
      }
    }
  }

  private lowerName(name: string, pos: YarnPos): Expr {
    if (name.startsWith("$")) {
      const decl = this.declarations.get(name);
      if (!decl?.smart) {
        this.reference(name, pos);
        return { kind: "varRef", name };
      }
      if (this.expanding.has(name)) {
        this.fail(pos, `smart variable ${name} refers to itself`);
      }
      this.expanding.add(name);
      try {
        return { kind: "group", expr: this.lower(decl.smart, decl.pos) };
      } finally {
        this.expanding.delete(name);
      }
    }
    // `Enum.Case`, or `.Case` (written `Case` after enumShorthand).
    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      const value = this.enums
        .get(name.slice(0, dot))
        ?.get(name.slice(dot + 1));
      if (value !== undefined) return literal(value);
    } else {
      const matches = [...this.enums.values()].filter((cases) =>
        cases.has(name),
      );
      if (matches.length === 1) return literal(matches[0]!.get(name)!);
      if (matches.length > 1) {
        this.fail(
          pos,
          `".${name}" is a case of several enums; write Enum.${name}`,
        );
      }
    }
    return this.fail(
      pos,
      `unknown name "${name}" (variables start with '$'; enum cases are written Enum.Case)`,
    );
  }

  private visitRead(expr: Extract<Expr, { kind: "call" }>, pos: YarnPos): Expr {
    const title = this.titleArg(expr, pos);
    this.tracked.add(title);
    this.visitReads.push({ title, pos });
    const count: Expr = { kind: "varRef", name: VISITING + title };
    return expr.fn === "visited_count"
      ? count
      : { kind: "binary", op: ">", left: count, right: literal(0) };
  }

  /** `has_any_content("Group")`: whether any member of the node group is
   *  available now. */
  private hasAnyContent(
    expr: Extract<Expr, { kind: "call" }>,
    pos: YarnPos,
  ): Expr {
    const title = this.titleArg(expr, pos);
    const members = this.groups.get(title);
    if (!members) {
      this.fail(
        pos,
        `has_any_content("${title}"): "${title}" is not a node group`,
      );
    }
    // Members' `when:` conditions resolve before any node body compiles.
    return members
      .map((m): Expr => m.condition ?? literal(true))
      .reduce((a, b) => ({ kind: "binary", op: "||", left: a, right: b }));
  }

  private titleArg(
    expr: Extract<Expr, { kind: "call" }>,
    pos: YarnPos,
  ): string {
    const arg = expr.args?.[0];
    if (
      expr.args?.length !== 1 ||
      arg?.kind !== "literal" ||
      typeof arg.value !== "string"
    ) {
      this.fail(pos, `${expr.fn}() takes one node title in quotes`);
    }
    if (!this.hasNode(arg.value)) {
      this.fail(
        pos,
        `${expr.fn}("${arg.value}"): there is no node "${arg.value}"`,
      );
    }
    return arg.value;
  }

  // ── Implicit declarations ────────────────────────────────────────────────

  /** Record the type a binary operator implies for an undeclared operand. */
  private imply(op: string, left: Expr, right: Expr): void {
    if ([">", "<", ">=", "<=", "-", "*", "/", "%"].includes(op)) {
      this.implyVar(left, "number");
      this.implyVar(right, "number");
    } else if (["&&", "||", "^"].includes(op)) {
      this.implyVar(left, "boolean");
      this.implyVar(right, "boolean");
    } else if (op === "==" || op === "!=" || op === "+") {
      const lt = this.typeOf(left);
      const rt = this.typeOf(right);
      if (lt) this.implyVar(right, lt);
      if (rt) this.implyVar(left, rt);
    }
  }

  /** Note a `$variable` the script reads or sets. */
  reference(name: string, pos: YarnPos): void {
    if (name.startsWith("$Yarn.Internal.")) return;
    if (!this.referenced.has(name)) this.referenced.set(name, pos);
  }

  /** `<<set $x …>>`: the target is referenced, and the value's type is its. */
  assign(name: string, value: Expr, pos: YarnPos): void {
    this.reference(name, pos);
    this.assignments.push({ name, value });
    this.implyAssignment(name, value);
  }

  /** `<<set $x …>>`: the value's type is the variable's. */
  private implyAssignment(name: string, value: Expr): void {
    const type = this.typeOf(value);
    if (type) this.implyVar({ kind: "varRef", name }, type);
  }

  private implyVar(expr: Expr, type: YarnType): void {
    if (expr.kind === "group") return this.implyVar(expr.expr, type);
    if (expr.kind !== "varRef" || !expr.name.startsWith("$")) return;
    if (expr.name.startsWith("$Yarn.Internal.")) return;
    let types = this.implied.get(expr.name);
    if (!types) this.implied.set(expr.name, (types = new Set()));
    types.add(type);
  }

  /** The type an expression evaluates to, when it is plain from the tree. */
  private typeOf(expr: Expr): YarnType | undefined {
    switch (expr.kind) {
      case "literal":
        return expr.value === null
          ? undefined
          : (typeof expr.value as YarnType);
      case "group":
        return this.typeOf(expr.expr);
      case "varRef": {
        const value = this.declarations.get(expr.name)?.value;
        if (value !== undefined && value !== null)
          return typeof value as YarnType;
        const implied = this.implied.get(expr.name);
        return implied?.size === 1 ? [...implied][0] : undefined;
      }
      case "unary":
        return expr.op === "-" ? "number" : "boolean";
      case "binary":
        if (expr.op === "+") {
          const l = this.typeOf(expr.left);
          const r = this.typeOf(expr.right);
          return l === "string" || r === "string" ? "string" : (l ?? r);
        }
        return ["-", "*", "/", "%"].includes(expr.op) ? "number" : "boolean";
      case "call":
        return undefined;
    }
  }

  // ── Shared helpers for NodeCompiler ──────────────────────────────────────

  hasNode(title: string): boolean {
    return this.nodes.has(title) || this.groups.has(title);
  }

  isSmart(name: string): boolean {
    return this.declarations.get(name)?.smart !== undefined;
  }

  addCharacter(name: string): void {
    this.characters.add(name);
  }

  addString(id: string, str: YarnLineString): void {
    const prior = this.strings.get(id);
    if (prior) {
      this.fail(
        str.pos,
        `line id "${id}" is already used at ${prior.pos.file}:${prior.pos.line}`,
      );
    }
    this.strings.set(id, str);
  }

  /** A `$Yarn.Internal.Once.<id>` flag, declared `false`. */
  onceFlag(id: string): string {
    const name = ONCE + id;
    this.internal[name] = false;
    return name;
  }

  /** A `$Yarn.Internal.Content.ViewCount.<id>` counter, declared `0`. */
  viewCounter(id: string): string {
    const name = VIEW_COUNT + id;
    this.internal[name] = 0;
    return name;
  }

  /** Replace a node-exit marker with its visit count (or nothing). */
  private exitStep(step: Step): Step[] {
    if (step.kind !== "command" || step.commands[0]?.type !== EXIT)
      return [step];
    const title = step.commands[0]["node"] as string;
    if (!this.tracked.has(title)) return [];
    const name = VISITING + title;
    return [
      setStep(name, {
        kind: "binary",
        op: "+",
        left: { kind: "varRef", name },
        right: literal(1),
      }),
    ];
  }

  private walkAll(visit: (stmt: YarnStmt) => void): void {
    const walk = (stmts: readonly YarnStmt[]): void => {
      for (const stmt of stmts) {
        visit(stmt);
        switch (stmt.kind) {
          case "options":
            for (const o of stmt.options) walk(o.body);
            break;
          case "lineGroup":
            for (const o of stmt.items) walk(o.body);
            break;
          case "if":
            for (const c of stmt.clauses) walk(c.body);
            break;
          case "once":
            walk(stmt.body);
            if (stmt.elseBody) walk(stmt.elseBody);
            break;
          default:
            break;
        }
      }
    };
    for (const file of this.files) {
      for (const node of file.nodes) walk(node.body);
    }
  }

  fail(pos: YarnPos, message: string): never {
    throw new DialogueYarnError(message, pos.file, pos.line);
  }
}

/** Internal marker for "the node finishes here"; replaced after compilation
 *  by the visit-count increment, or dropped for an untracked node. */
const EXIT = "$yarn:exit";

interface Segment {
  readonly id: string;
  steps: Step[];
}

/** Compiles one Yarn node into its dialogue node plus the extra nodes its
 *  structured flow splits into. */
class NodeCompiler {
  private readonly segments: Segment[] = [];
  private onceCount = 0;
  private groupCount = 0;

  constructor(
    private readonly c: Compiler,
    private readonly node: YarnNode,
    /** The dialogue node id (the title, or a group member's unique id). */
    private readonly id: string,
    /** Whose visits a finish counts (a group member counts its group). */
    private readonly visits: string,
  ) {}

  compile(prelude: readonly Step[] = []): Segment[] {
    const head = this.segment(this.id);
    head.steps.push(...prelude);
    const tail = this.emit(this.node.body, head);
    tail.steps.push(this.exit(), { kind: "return" });
    return this.segments;
  }

  private segment(id = `${this.id}#${this.segments.length}`): Segment {
    const seg: Segment = { id, steps: [] };
    this.segments.push(seg);
    return seg;
  }

  private exit(): Step {
    return { kind: "command", commands: [{ type: EXIT, node: this.visits }] };
  }

  /** Emit statements into `cur`; returns the segment flow continues in. */
  private emit(stmts: readonly YarnStmt[], cur: Segment): Segment {
    for (const [i, stmt] of stmts.entries()) {
      cur = this.statement(stmt, cur, stmts[i + 1]?.kind === "options");
    }
    return cur;
  }

  private statement(
    stmt: YarnStmt,
    cur: Segment,
    beforeOptions: boolean,
  ): Segment {
    switch (stmt.kind) {
      case "line": {
        const gate = this.gate(stmt);
        if (!gate) {
          cur.steps.push(this.say(stmt, beforeOptions));
          return cur;
        }
        return this.branch(
          [
            {
              condition: gate.condition,
              emit: (seg) => {
                if (gate.onceFlag)
                  seg.steps.push(setStep(gate.onceFlag, literal(true)));
                seg.steps.push(this.say(stmt, beforeOptions));
                return seg;
              },
            },
          ],
          cur,
        );
      }
      case "options":
        return this.options(stmt.options, cur);
      case "lineGroup":
        return this.lineGroup(stmt.items, cur);
      case "if":
        return this.branch(
          stmt.clauses.map((clause) => ({
            condition:
              clause.condition === undefined
                ? undefined
                : this.c.condition(clause.condition, clause.pos),
            emit: (seg: Segment) => this.emit(clause.body, seg),
          })),
          cur,
        );
      case "once": {
        const flag = this.c.onceFlag(`${this.id}.${this.onceCount++}`);
        const unseen = not({ kind: "varRef", name: flag });
        const condition =
          stmt.condition === undefined
            ? unseen
            : all([unseen, this.c.condition(stmt.condition, stmt.pos)]);
        const elseBody = stmt.elseBody;
        return this.branch(
          [
            {
              condition,
              emit: (seg) => {
                seg.steps.push(setStep(flag, literal(true)));
                return this.emit(stmt.body, seg);
              },
            },
            ...(elseBody
              ? [
                  {
                    condition: undefined,
                    emit: (seg: Segment) => this.emit(elseBody, seg),
                  },
                ]
              : []),
          ],
          cur,
        );
      }
      case "enum":
        return cur; // declared up front
      case "command":
        return this.command(stmt, cur);
    }
  }

  /**
   * `if` / `elseif` / `else` lowered to conditional jumps: each conditional
   * branch gets its own segment, an `else` runs inline, and every branch
   * rejoins in a fresh segment.
   */
  private branch(
    clauses: readonly {
      condition: Expr | undefined;
      emit: (seg: Segment) => Segment;
    }[],
    cur: Segment,
  ): Segment {
    const join = this.segment();
    let otherwise: ((seg: Segment) => Segment) | undefined;
    for (const clause of clauses) {
      if (clause.condition === undefined) {
        otherwise = clause.emit;
        break;
      }
      const body = this.segment();
      cur.steps.push({
        kind: "command",
        commands: [],
        condition: clause.condition,
        target: body.id,
      });
      clause.emit(body).steps.push({ kind: "goto", target: join.id });
    }
    const tail = otherwise ? otherwise(cur) : cur;
    tail.steps.push({ kind: "goto", target: join.id });
    return join;
  }

  /**
   * A line's, option's, or line group item's availability: its `<<if>>`, and
   * for `<<once>>` / `<<once if>>` the once flag (named after the `#line:` id
   * when it has one, as Yarn Spinner does). Undefined when always available.
   */
  private gate(
    content: YarnContent,
  ):
    | { condition: Expr; onceFlag: string | undefined; complexity: number }
    | undefined {
    const parts: Expr[] = [];
    let complexity = 0;
    let onceFlag: string | undefined;
    if (content.once) {
      const lineId = content.tags.find((t) => t.startsWith("line:"));
      onceFlag = this.c.onceFlag(lineId ?? `${this.id}.${this.onceCount++}`);
      parts.push(not({ kind: "varRef", name: onceFlag }));
      complexity += 1;
    }
    const conditionSource = content.condition ?? content.once?.condition;
    if (conditionSource !== undefined) {
      const expr = this.c.condition(conditionSource, content.pos);
      parts.push(expr);
      complexity += 1 + countLogical(expr);
    }
    if (parts.length === 0) return undefined;
    return { condition: all(parts), onceFlag, complexity };
  }

  private options(options: readonly YarnOption[], cur: Segment): Segment {
    const join = this.segment();
    const out: ChoiceOption[] = [];
    for (const option of options) {
      const text = this.text(option, true);
      const gate = this.gate(option);
      let target = join.id;
      if (option.body.length > 0) {
        const body = this.segment();
        target = body.id;
        this.emit(option.body, body).steps.push({
          kind: "goto",
          target: join.id,
        });
      }
      const tags = optionTags(option.tags);
      const disabled = tags.disabled;
      // Options have no speaker; a `Name:` prefix is kept as `meta.character`.
      const meta =
        text.character === undefined
          ? tags.meta
          : { ...tags.meta, character: text.character };
      out.push({
        text: text.text,
        ...(text.expressions ? { expressions: text.expressions } : {}),
        target,
        ...(gate ? { condition: gate.condition } : {}),
        ...(gate?.onceFlag
          ? { commands: [setCommand(gate.onceFlag, literal(true))] }
          : {}),
        ...(disabled ? { presentation: "disabled" as const } : {}),
        ...(meta ? { meta } : {}),
      });
    }
    cur.steps.push({ kind: "choice", options: out });
    // No option available: carry on after the group.
    cur.steps.push({ kind: "goto", target: join.id });
    return join;
  }

  /** `=>` items: the runtime picks one available item (least seen, then most
   *  specific, then at random) and runs its line and body. */
  private lineGroup(items: readonly YarnOption[], cur: Segment): Segment {
    const join = this.segment();
    const group = this.groupCount++;
    const options: SelectOption[] = items.map((item, i) => {
      const gate = this.gate(item);
      const lineId = item.tags.find((t) => t.startsWith("line:"));
      const counter = this.c.viewCounter(
        lineId ?? `${this.id}.group${group}.${i}`,
      );
      const body = this.segment();
      if (gate?.onceFlag)
        body.steps.push(setStep(gate.onceFlag, literal(true)));
      body.steps.push(this.say(item, false));
      this.emit(item.body, body).steps.push({ kind: "goto", target: join.id });
      return {
        target: body.id,
        ...(gate ? { condition: gate.condition } : {}),
        priority: gate?.complexity ?? 0,
        counter,
      };
    });
    cur.steps.push(
      { kind: "select", options },
      { kind: "goto", target: join.id },
    );
    return join;
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  private command(
    stmt: Extract<YarnStmt, { kind: "command" }>,
    cur: Segment,
  ): Segment {
    const { pos, name, rest } = stmt;
    switch (name) {
      case "declare":
        return cur; // hoisted
      case "set":
        cur.steps.push(this.set(rest, pos));
        return cur;
      case "jump":
      case "detour":
        return this.jump(name, rest, pos, cur);
      case "return":
        this.noArgs(name, rest, pos);
        cur.steps.push(this.exit(), { kind: "return" });
        return cur;
      case "stop":
        this.noArgs(name, rest, pos);
        cur.steps.push(this.exit(), { kind: "end" });
        return cur;
      case "elseif":
      case "else":
      case "endif":
      case "endonce":
      case "case":
      case "endenum":
        return this.c.fail(pos, `<<${name}>> has no matching block`);
      case "call":
      case "local":
        return this.c.fail(pos, `<<${name}>> is not supported; use a command`);
      default: {
        if (!/^[A-Za-z_][\w.-]*$/.test(name)) {
          this.c.fail(pos, `"${name}" is not a valid command name`);
        }
        const args = this.args(rest, pos);
        if (name === "wait") this.checkWait(args, pos);
        const command: Command = {
          type: name,
          ...(args.length > 0 ? { args } : {}),
        };
        cur.steps.push({ kind: "command", commands: [command] });
        return cur;
      }
    }
  }

  /** `<<wait>>` takes one duration in seconds; a literal one is checked now. */
  private checkWait(args: readonly (VarValue | Expr)[], pos: YarnPos): void {
    const [seconds] = args;
    if (args.length !== 1 || seconds === undefined) {
      this.c.fail(pos, "<<wait>> takes one argument: the seconds to wait");
    }
    if (!isExpr(seconds) && waitSeconds(seconds) === undefined) {
      this.c.fail(
        pos,
        `<<wait>> needs a number of seconds >= 0, got "${String(seconds)}"`,
      );
    }
  }

  private noArgs(name: string, rest: string, pos: YarnPos): void {
    if (rest) this.c.fail(pos, `<<${name}>> takes no arguments`);
  }

  private set(rest: string, pos: YarnPos): Step {
    const m =
      /^(\$[A-Za-z_][\w.]*)\s*(to\b|=(?!=)|\+=|-=|\*=|\/=|%=)\s*([\s\S]+)$/.exec(
        rest,
      );
    if (!m)
      this.c.fail(
        pos,
        `expected <<set $name to value>>, got "<<set ${rest}>>"`,
      );
    const name = m[1]!;
    if (this.c.isSmart(name)) {
      this.c.fail(pos, `${name} is a smart variable and can't be set`);
    }
    let value = this.c.expr(m[3]!, pos);
    const op = m[2]!;
    if (op !== "to" && op !== "=") {
      value = {
        kind: "binary",
        op: op[0] as "+" | "-" | "*" | "/" | "%",
        left: { kind: "varRef", name },
        right: value,
      };
    }
    this.c.assign(name, value, pos);
    return setStep(name, value);
  }

  /**
   * `<<jump T>>` leaves this node and any detours pending on it for good;
   * `<<detour T>>` runs `T` and comes back. An `{expression}` target is
   * evaluated when the step runs; a value naming no node is reported through
   * `onError` and ends the conversation.
   */
  private jump(
    kind: "jump" | "detour",
    rest: string,
    pos: YarnPos,
    cur: Segment,
  ): Segment {
    const step = (target: StepTarget): Step =>
      kind === "jump"
        ? { kind: "goto", target, leaveDetours: true }
        : { kind: "detour", target };
    const exits = kind === "jump" ? [this.exit()] : [];
    if (!rest.startsWith("{")) {
      if (!TITLE.test(rest)) {
        this.c.fail(
          pos,
          `<<${kind}>> needs a node title or {expression}, got "${rest}"`,
        );
      }
      if (!this.c.hasNode(rest)) {
        this.c.fail(pos, `<<${kind} ${rest}>>: there is no node "${rest}"`);
      }
      cur.steps.push(...exits, step(rest));
      return cur;
    }
    if (findBraceEnd(rest, 1) !== rest.length - 1) {
      this.c.fail(
        pos,
        `<<${kind}>> needs a node title or {expression}, got "${rest}"`,
      );
    }
    // Evaluated once when the step runs; a result that names no node ends
    // the conversation with an error, as Yarn Spinner stops on one.
    cur.steps.push(...exits, step(this.c.expr(rest.slice(1, -1), pos)));
    return cur;
  }

  /** A command's words: quoted strings, `{expressions}`, numbers, booleans,
   *  or bare words. A word mixing text and `{…}` joins them as text. */
  private args(rest: string, pos: YarnPos): (VarValue | Expr)[] {
    const out: (VarValue | Expr)[] = [];
    let i = 0;
    while (i < rest.length) {
      while (i < rest.length && /\s/.test(rest[i]!)) i++;
      if (i >= rest.length) break;
      const pieces: (string | Expr)[] = [];
      let quoted = false;
      let wasQuoted = false;
      let buf = "";
      while (i < rest.length && (quoted || !/\s/.test(rest[i]!))) {
        const ch = rest[i]!;
        if (ch === "\\" && i + 1 < rest.length) {
          buf += rest[i + 1];
          i += 2;
          continue;
        }
        if (ch === '"') {
          quoted = !quoted;
          wasQuoted = true;
          i++;
          continue;
        }
        if (ch === "{") {
          const end = findBraceEnd(rest, i + 1);
          if (end < 0)
            this.c.fail(pos, "'{' has no closing '}' in a command argument");
          if (buf) pieces.push(buf);
          buf = "";
          pieces.push(this.c.expr(rest.slice(i + 1, end), pos));
          i = end + 1;
          continue;
        }
        buf += ch;
        i++;
      }
      if (quoted) this.c.fail(pos, "unterminated string in command arguments");
      if (buf || pieces.length === 0) pieces.push(buf);
      out.push(joinPieces(pieces, wasQuoted));
    }
    return out;
  }

  // ── Lines and text ───────────────────────────────────────────────────────

  private say(stmt: YarnContent, beforeOptions: boolean): SayStep {
    const text = this.text(stmt, true);
    if (text.character !== undefined) this.c.addCharacter(text.character);
    const fields: {
      view?: string;
      voice?: string;
      speed?: number;
      autoAdvance?: number;
    } = {};
    const meta: Record<string, unknown> = {};
    for (const tag of stmt.tags) {
      const colon = tag.indexOf(":");
      const key = colon < 0 ? tag : tag.slice(0, colon);
      const value = colon < 0 ? "" : tag.slice(colon + 1);
      if (key === "line") continue;
      const field = SAY_FIELDS[key];
      if (field && colon > 0) {
        if (field === "view" || field === "voice") {
          fields[field] = value;
        } else {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0) {
            this.c.fail(
              stmt.pos,
              `#${key}: expects a number >= 0, got "${value}"`,
            );
          }
          fields[field] = n;
        }
        continue;
      }
      meta[key] = colon < 0 ? true : scalar(value);
    }
    if (beforeOptions) meta["lastline"] = true;
    return {
      kind: "say",
      ...(text.character !== undefined ? { speaker: text.character } : {}),
      text: text.text,
      ...(text.expressions ? { expressions: text.expressions } : {}),
      ...fields,
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    };
  }

  /** A line's or option's text: character, dialogue text (a catalog message
   *  when it has a `#line:` id), and its `{expression}` tokens. */
  private text(
    content: YarnContent,
    withCharacter: boolean,
  ): {
    character: string | undefined;
    text: DialogueText;
    expressions: Record<string, Expr> | undefined;
  } {
    const split = withCharacter
      ? splitCharacter(content.text)
      : { character: undefined, text: content.text };
    const converted = convertSourceText(split.text);
    if (!converted) this.c.fail(content.pos, "'{' has no closing '}'");
    let expressions: Record<string, Expr> | undefined;
    converted.parts.forEach((part) => {
      expressions ??= {};
      expressions[part.name] =
        part.kind === "literal"
          ? literal(part.value)
          : this.c.expr(part.source, content.pos);
    });
    const lineTag = content.tags.find((t) => t.startsWith("line:"));
    let text: DialogueText = converted.text;
    if (lineTag !== undefined) {
      if (lineTag === "line:") this.c.fail(content.pos, "#line: needs an id");
      this.c.addString(lineTag, {
        text: converted.text,
        hasCharacter: split.character !== undefined,
        pos: content.pos,
      });
      text = { key: lineTag, fallback: converted.text };
    }
    return { character: split.character, text, expressions };
  }
}

/** Option hashtags: `#line:` is the catalog key, `#disabled` shows the option
 *  greyed out when its condition fails, the rest become `meta`. */
function optionTags(tags: readonly string[]): {
  meta: Record<string, unknown> | undefined;
  disabled: boolean;
} {
  let meta: Record<string, unknown> | undefined;
  let disabled = false;
  for (const tag of tags) {
    if (tag.startsWith("line:")) continue;
    if (tag === "disabled") {
      disabled = true;
      continue;
    }
    const colon = tag.indexOf(":");
    meta ??= {};
    if (colon < 0) meta[tag] = true;
    else meta[tag.slice(0, colon)] = scalar(tag.slice(colon + 1));
  }
  return { meta, disabled };
}

/** Every value of a node header, in order. */
function header(node: YarnNode, key: string): string[] {
  return node.headers.filter((h) => h.key === key).map((h) => h.value);
}

function literal(value: VarValue): Expr {
  return { kind: "literal", value };
}

function not(operand: Expr): Expr {
  return { kind: "unary", op: "!", operand };
}

/** `a && b && …` */
function all(parts: readonly Expr[]): Expr {
  return parts.reduce((a, b) => ({
    kind: "binary",
    op: "&&",
    left: a,
    right: b,
  }));
}

/** How many `and` / `or` / `xor` operators an expression has — Yarn Spinner's
 *  measure of how specific a condition is. */
function countLogical(expr: Expr): number {
  switch (expr.kind) {
    case "group":
      return countLogical(expr.expr);
    case "unary":
      return countLogical(expr.operand);
    case "binary":
      return (
        (["&&", "||", "^", "and", "or", "xor"].includes(expr.op) ? 1 : 0) +
        countLogical(expr.left) +
        countLogical(expr.right)
      );
    case "call":
      return (expr.args ?? []).reduce((n, a) => n + countLogical(a), 0);
    default:
      return 0;
  }
}

function setCommand(name: string, value: Expr): Command {
  return { type: "set", var: name, value };
}

function setStep(name: string, value: Expr): Step {
  return { kind: "command", commands: [setCommand(name, value)] };
}

/** A hashtag value or bare command word: number, boolean, or text. */
function scalar(raw: string): VarValue {
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

/** One command argument from its pieces. A lone expression stays an
 *  expression; plain text becomes a scalar (a quoted word stays text); a mix
 *  joins as text. */
function joinPieces(
  pieces: readonly (string | Expr)[],
  quoted: boolean,
): VarValue | Expr {
  if (pieces.length === 1) {
    const only = pieces[0]!;
    if (typeof only !== "string") return only;
    return quoted ? only : scalar(only);
  }
  return pieces
    .map(
      (p): Expr =>
        typeof p === "string"
          ? literal(p)
          : { kind: "call", fn: "string", args: [p] },
    )
    .reduce((a, b) => ({ kind: "binary", op: "+", left: a, right: b }));
}

/** `bool` / `number` / `string` → the JS type name; else undefined. */
function typeName(name: string): YarnType | undefined {
  if (name === "number") return "number";
  if (name === "string") return "string";
  if (name === "bool") return "boolean";
  return undefined;
}

/**
 * Whether a declaration stores its value (else it declares a smart variable).
 * Yarn Spinner stores a plain literal, a negative number, or an enum case;
 * anything else, even `(1)` or `1 + 2`, is evaluated on each read.
 */
function isPlainValue(source: string, tree: Expr): boolean {
  if (tree.kind === "literal") return !source.startsWith("(");
  if (tree.kind === "varRef") return !tree.name.startsWith("$"); // an enum case
  return (
    tree.kind === "unary" &&
    tree.op === "-" &&
    tree.operand.kind === "literal" &&
    typeof tree.operand.value === "number"
  );
}

/** A plain declaration's lowered value. */
function storedValue(expr: Expr): VarValue {
  if (expr.kind === "literal") return expr.value;
  if (
    expr.kind === "unary" &&
    expr.operand.kind === "literal" &&
    typeof expr.operand.value === "number"
  ) {
    return -expr.operand.value;
  }
  return null;
}

/**
 * Yarn's `.Case` enum shorthand → `Case`, outside string literals, so the
 * shared expression parser reads it as a name (resolved against the enums).
 */
function enumShorthand(source: string): string {
  let out = "";
  let quoted: string | undefined;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      out += c;
      if (c === "\\") out += source[++i] ?? "";
      else if (c === quoted) quoted = undefined;
      continue;
    }
    if (c === '"' || c === "'") quoted = c;
    const prev = out[out.length - 1];
    if (
      c === "." &&
      /[A-Za-z_]/.test(source[i + 1] ?? "") &&
      (prev === undefined || !/[\w$.)]/.test(prev))
    ) {
      continue;
    }
    out += c;
  }
  return out;
}
