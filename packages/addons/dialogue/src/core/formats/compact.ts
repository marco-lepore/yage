/**
 * Compact authoring front-end — a small, line-oriented DSL for RPG-style
 * dialogue that compiles to the same {@link DialogueScript} IR as JSON / YAML.
 * `parseCompact(text)` produces the IR; `loadCompact(text)` runs it through
 * {@link loadScript}, so validation and the frozen model are identical to every
 * other loader. Pixi-free: it imports only the headless core (`parseExpr`,
 * `loadScript`, the markup tag guard).
 *
 * One statement per line. Leading whitespace is insignificant (indent nodes for
 * readability). Blank lines and `// comment` lines are ignored. Each non-blank
 * line is one of:
 *
 *   # id                 script id (required, once) — the start node is the
 *                        first `::` node defined.
 *   @ id Name [#hex]     a speaker: an opaque id, a display name (may have
 *                        spaces), an optional nameplate colour (`#ffcc00` /
 *                        `#fc0`). `@` lines may appear before or after their use.
 *   :: nodeId            opens a node; following step lines belong to it.
 *   speaker[ face]: text a spoken line — ONLY when the first token is a declared
 *                        `@`-speaker. `face` (a 2nd header token) becomes the
 *                        line's avatar `expression`. Otherwise the WHOLE line,
 *                        colons and all, is a narrator line.
 *   text                 a narrator line (no declared speaker prefix).
 *   ? text …             a choice option; consecutive `?` lines coalesce into
 *                        one choice step (see below).
 *   -> nodeId [if: cond] a jump — unconditional, or conditional (taken only if
 *                        `cond` holds, else fall through to the next step).
 *   declare v = value    a script-level variable default (a literal value).
 *   set v = rhs          write a variable. A bare number / `true` / `false` /
 *                        `null` stays a literal; anything else is parsed as an
 *                        expression (`set hp = hp - 1`), so the host reads it
 *                        back through the same evaluator JSON uses.
 *   do type k=v … #flag  a host command: `type` then `key=value` data and
 *                        `#flag` booleans (`do give-item id=key count=1 #blocking`).
 *   end                  ends the conversation.
 *
 * **Per-line hints** ride the end of a `say` line: `view=` / `voice=` / `speed=`
 * / `auto=` set the first-class {@link SayStep} fields, and trailing `#key:value`
 * / bare `#flag` hashtags become {@link SayStep.meta} (Yarn-aligned — metadata is
 * trailing). A `say` line's text is otherwise passed to the markup parser
 * **verbatim**, so inline `[..]` markup (and any markup tokens a later release
 * adds) survives untouched.
 *
 * **Choices** carry their attributes as non-bracket sigils, in this order after
 * the text: `if: cond`, then `-> target` (or `target=node`), then `#once` /
 * `#disabled` / `#key:value` hashtags. They are lexed off and stripped before
 * the remaining choice text reaches markup — `[..]` is reserved for inline
 * markup there, so a bracketed token that markup doesn't recognize is reported
 * as an error (it is almost always a mistyped attribute that would otherwise be
 * dropped silently).
 *
 * Conditions and non-literal `set` values are parsed with the shared
 * {@link parseExpr}, so a malformed expression throws {@link DialogueExprError}
 * (a {@link DialogueScriptError} subtype) with its position.
 */

import { parseExpr } from "../expr-parse.js";
import { firstUnknownTag } from "../markup.js";
import { loadScript, DialogueScriptError } from "./canonical.js";
import type {
  ChoiceOption,
  Command,
  DialogueNode,
  DialogueScript,
  Expr,
  SayStep,
  SpeakerDef,
  Step,
  VarValue,
} from "../types.js";

/**
 * Parse compact-DSL source into a (mutable) {@link DialogueScript}. Throws
 * {@link DialogueScriptError} on a structural problem (with the 1-based line) and
 * {@link DialogueExprError} on a malformed condition / `set` expression.
 */
export function parseCompact(text: string): DialogueScript {
  const lines = text.split(/\r\n|\r|\n/);

  // Pass 1: collect every speaker so a `@` declaration may follow its first use
  // (line order is irrelevant for speaker resolution).
  const speakers: Record<string, SpeakerDef> = {};
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith("@")) return;
    const def = parseSpeaker(line, i + 1);
    if (Object.hasOwn(speakers, def.id)) {
      fail(i + 1, `duplicate speaker "${def.id}"`);
    }
    speakers[def.id] = def;
  });

  // Pass 2: the script id, nodes, and steps. The current choice run is buffered
  // and flushed into one choice step the moment a non-`?` line ends it.
  let id: string | undefined;
  const nodes: Record<string, DialogueNode> = {};
  const nodeOrder: string[] = [];
  let current: { id: string; steps: Step[] } | null = null;
  let choiceRun: ChoiceOption[] | null = null;
  const declares: Record<string, VarValue> = {};

  const flushChoice = (): void => {
    if (choiceRun && current) current.steps.push({ kind: "choice", options: choiceRun });
    choiceRun = null;
  };

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();

    if (line === "" || line.startsWith("//")) return;
    if (line.startsWith("@")) return; // handled in pass 1

    if (line.startsWith("#")) {
      flushChoice();
      const newId = line.slice(1).trim();
      if (!newId) fail(lineNo, "'#' script id directive needs an id");
      if (id !== undefined) fail(lineNo, `duplicate '#' script id directive (already "${id}")`);
      id = newId;
      return;
    }

    if (line.startsWith("::")) {
      flushChoice();
      const nodeId = line.slice(2).trim();
      if (!nodeId) fail(lineNo, "':: ' node directive needs an id");
      if (Object.hasOwn(nodes, nodeId)) fail(lineNo, `duplicate node "${nodeId}"`);
      current = { id: nodeId, steps: [] };
      nodes[nodeId] = current;
      nodeOrder.push(nodeId);
      return;
    }

    if (line.startsWith("?")) {
      if (!current) fail(lineNo, "choice '?' appears before any ':: <node>'");
      (choiceRun ??= []).push(parseChoice(line.slice(1).trim(), lineNo));
      return;
    }

    // Any other line ends a choice run.
    flushChoice();

    // `declare` is a script-level default — allowed anywhere, needs no node.
    const decl = parseDeclare(line);
    if (decl) {
      declares[decl.name] = decl.value;
      return;
    }

    // The remaining leaders are node steps.
    const node = current;
    if (!node) fail(lineNo, `dialogue line appears before any ':: <node>'  ("${line}")`);

    if (line.startsWith("->")) {
      node.steps.push(parseGoto(line, lineNo));
      return;
    }
    const set = parseSet(line);
    if (set) {
      node.steps.push(set);
      return;
    }
    const cmd = parseDo(line, lineNo);
    if (cmd) {
      node.steps.push(cmd);
      return;
    }
    if (line === "end") {
      node.steps.push({ kind: "end" });
      return;
    }
    node.steps.push(parseSay(line, lineNo, speakers));
  });

  flushChoice();

  if (id === undefined) throw new DialogueScriptError("compact: missing '# <id>' script directive");
  if (nodeOrder.length === 0) {
    throw new DialogueScriptError(`compact: script "${id}" has no ':: <node>' nodes`);
  }

  return {
    id,
    start: nodeOrder[0]!,
    nodes,
    ...(Object.keys(speakers).length > 0 ? { speakers } : {}),
    ...(Object.keys(declares).length > 0 ? { declare: declares } : {}),
  };
}

/** Parse compact-DSL source and run it through {@link loadScript} — same
 *  validated, frozen IR as the JSON and YAML loaders. */
export function loadCompact(text: string): DialogueScript {
  return loadScript(parseCompact(text));
}

// ── Speakers (`@ id Name [#hex]`) ────────────────────────────────────────────

function parseSpeaker(line: string, lineNo: number): SpeakerDef {
  const tokens = line.slice(1).trim().split(/\s+/).filter(Boolean);
  const id = tokens[0];
  if (!id) fail(lineNo, "'@' speaker directive needs an id");
  let nameTokens = tokens.slice(1);
  let color: number | undefined;
  const last = nameTokens[nameTokens.length - 1];
  if (last !== undefined && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(last)) {
    color = hexColor(last);
    nameTokens = nameTokens.slice(0, -1);
  }
  return {
    id,
    name: nameTokens.length > 0 ? nameTokens.join(" ") : id,
    ...(color !== undefined ? { color } : {}),
  };
}

/** `#rrggbb` / `#rgb` → a 0xRRGGBB number. */
function hexColor(token: string): number {
  let hex = token.slice(1);
  if (hex.length === 3) hex = hex.replace(/./g, "$&$&");
  return parseInt(hex, 16);
}

// ── Goto (`-> nodeId [if: cond]`) ────────────────────────────────────────────

function parseGoto(line: string, lineNo: number): Step {
  const m = /^->\s*(\S+)(?:\s+if:\s*(.+))?\s*$/.exec(line);
  if (!m) fail(lineNo, "'->' goto needs a target node id (optionally `-> node if: cond`)");
  const target = m[1]!;
  // `-> node if: cond` is a conditional jump (a CommandStep with no commands):
  // take the jump only if the condition holds, else fall through to the next
  // step. Bare `-> node` is an unconditional GotoStep.
  if (m[2] !== undefined) {
    return { kind: "command", commands: [], condition: parseExpr(m[2].trim()), target };
  }
  return { kind: "goto", target };
}

// ── Declare (`declare v = value`) ────────────────────────────────────────────

/** A script-level variable default, or `null` when the line is not a `declare`
 *  (so `declare your intentions`, with no `=`, stays narrator text). The value
 *  is a literal scalar — declare defaults are plain values, not expressions. */
function parseDeclare(line: string): { name: string; value: VarValue } | null {
  const m = /^declare\s+([A-Za-z_$][A-Za-z0-9_.$]*)\s*=\s*(\S.*)$/.exec(line);
  if (!m) return null;
  return { name: m[1]!, value: scalar(m[2]!.trim()) };
}

// ── `set v = rhs` ────────────────────────────────────────────────────────────

/** A `set` line, or `null` when the line is not a `set` (so it falls through to
 *  the say-line reading — `set the table` with no `=` is narrator text). */
function parseSet(line: string): Step | null {
  const m = /^set\s+([A-Za-z_$][A-Za-z0-9_.$]*)\s*=\s*(\S.*)$/.exec(line);
  if (!m) return null;
  return {
    kind: "command",
    commands: [{ type: "set", var: m[1]!, value: setValue(m[2]!.trim()) }],
  };
}

/** A bare number / `true` / `false` / `null` stays a literal; everything else
 *  (identifiers, quoted strings, arithmetic) is an expression. A string literal
 *  MUST go through `parseExpr` (→ an `Expr` literal), never be emitted as a raw
 *  string: `loadScript`'s pre-walk re-parses any string `set` value, so a raw
 *  `"hi"` would be misread as a variable reference. */
function setValue(rhs: string): VarValue | Expr {
  const literal = numberBoolNull(rhs);
  // A non-literal RHS is an expression. `parseExpr` throws `DialogueExprError`
  // (a `DialogueScriptError`, carrying a source position) on a malformed value.
  return literal === NOT_LITERAL ? parseExpr(rhs) : literal;
}

// ── `do type k=v … #flag` ────────────────────────────────────────────────────

/** A `do` command line, or `null` when the line does not fully match the
 *  command shape (`do <type> (<k=v> | <#flag>)*`). A non-matching `do …` line
 *  falls through to the say reading, so prose like `do you agree?` stays text. */
function parseDo(line: string, lineNo: number): Step | null {
  if (!/^do(\s|$)/.test(line)) return null;
  const tokens = splitArgs(line.slice(2).trim());
  const type = tokens[0];
  if (type === undefined || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(type)) return null;
  const command: Record<string, unknown> = { type };
  // `type` is the command's dispatch key (the leading token); a `type=` data key
  // OR a `#type` flag would overwrite it. Flag either form, but only fail once the
  // whole line is confirmed a valid command shape — a later bare token still
  // falls through to narrator, so `do spawn #type extra` stays text, not an error.
  let typeKeyCollision = false;
  for (const tok of tokens.slice(1)) {
    if (tok.startsWith("#")) {
      const flag = tok.slice(1);
      if (!flag) return null;
      if (flag === "type") typeKeyCollision = true;
      else command[flag] = true;
      continue;
    }
    const eq = tok.indexOf("=");
    if (eq <= 0) return null; // not `key=value` → not a command shape (falls through to narrator)
    const key = tok.slice(0, eq);
    if (key === "type") typeKeyCollision = true;
    else command[key] = scalar(tok.slice(eq + 1));
  }
  if (typeKeyCollision) {
    fail(lineNo, `'do' data key "type" collides with the command type (the leading token); rename it`);
  }
  return { kind: "command", commands: [command as Command] };
}

// ── Say / narrator lines ─────────────────────────────────────────────────────

function parseSay(line: string, lineNo: number, speakers: Record<string, SpeakerDef>): SayStep {
  let speaker: string | undefined;
  let expression: string | undefined;
  let body = line;

  const colon = line.indexOf(":");
  if (colon !== -1) {
    const header = line.slice(0, colon).trim();
    const tokens = header.length > 0 ? header.split(/\s+/) : [];
    const first = tokens[0];
    // A header is a speaker prefix ONLY when its first token is a declared
    // speaker; otherwise the colon belongs to narrator prose ("Warning: …").
    if (first !== undefined && Object.hasOwn(speakers, first)) {
      if (tokens.length > 2) {
        fail(lineNo, `speaker header "${header}" has too many tokens (use "speaker [face]: text")`);
      }
      speaker = first;
      expression = tokens[1];
      body = line.slice(colon + 1).trimStart();
    }
  }

  const { text, fields, meta } = peelSayHints(body, lineNo);
  return {
    kind: "say",
    ...(speaker !== undefined ? { speaker } : {}),
    ...(expression !== undefined ? { expression } : {}),
    text,
    ...fields,
    ...(meta ? { meta } : {}),
  };
}

interface SayFields {
  view?: string;
  voice?: string;
  speed?: number;
  autoAdvanceMs?: number;
  /** i18n key from a `#line:id` hashtag (Yarn's localization tag). */
  key?: string;
}

/** Strip the trailing run of `#hashtag` / `key=value` hints off a say body; the
 *  remainder is the verbatim line text. */
function peelSayHints(
  body: string,
  lineNo: number,
): { text: string; fields: SayFields; meta: Record<string, unknown> | undefined } {
  let rest = body;
  const fields: SayFields = {};
  const meta: Record<string, unknown> = {};
  let metaCount = 0;

  for (;;) {
    const hash = /(^|\s)#(\S+)\s*$/.exec(rest);
    if (hash) {
      const tag = hash[2]!;
      const lk = lineKey(tag);
      if (lk !== undefined) fields.key = lk; // #line:id → SayStep.key (i18n)
      else metaCount += applyHashtag(meta, tag);
      rest = rest.slice(0, hash.index).replace(/\s+$/, "");
      continue;
    }
    const hint = /(^|\s)(view|voice|speed|auto)=(\S+)\s*$/.exec(rest);
    if (hint) {
      applySayField(fields, hint[2]!, hint[3]!, lineNo);
      rest = rest.slice(0, hint.index).replace(/\s+$/, "");
      continue;
    }
    break;
  }

  return { text: rest, fields, meta: metaCount > 0 ? meta : undefined };
}

function applySayField(fields: SayFields, key: string, value: string, lineNo: number): void {
  switch (key) {
    case "view":
      fields.view = unquote(value);
      return;
    case "voice":
      fields.voice = unquote(value);
      return;
    case "speed":
      fields.speed = numberHint(value, lineNo, "speed");
      return;
    case "auto":
      fields.autoAdvanceMs = numberHint(value, lineNo, "auto");
      return;
  }
}

function numberHint(value: string, lineNo: number, key: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) fail(lineNo, `'${key}=' expects a number, got "${value}"`);
  return n;
}

// ── Choices (`? text [if: cond] [-> target] [#flags]`) ───────────────────────

function parseChoice(body: string, lineNo: number): ChoiceOption {
  let rest = body;
  const meta: Record<string, unknown> = {};
  let metaCount = 0;
  let once = false;
  let disabled = false;
  let target: string | undefined;
  let condition: Expr | undefined;
  let key: string | undefined;

  // Peel attributes from the right, in reverse of the authored order: trailing
  // hashtags, then the target, then `if:` (which holds the rest of the line).
  for (;;) {
    const hash = /(^|\s)#(\S+)\s*$/.exec(rest);
    if (!hash) break;
    const tag = hash[2]!;
    const lk = lineKey(tag);
    if (tag === "once") once = true;
    else if (tag === "disabled") disabled = true;
    else if (lk !== undefined) key = lk; // #line:id → ChoiceOption.key (i18n)
    else metaCount += applyHashtag(meta, tag);
    rest = rest.slice(0, hash.index).replace(/\s+$/, "");
  }

  const arrow = /(^|\s)->\s*(\S+)\s*$/.exec(rest);
  const named = arrow ? null : /(^|\s)target=(\S+)\s*$/.exec(rest);
  if (arrow) {
    target = arrow[2];
    rest = rest.slice(0, arrow.index).replace(/\s+$/, "");
  } else if (named) {
    target = named[2];
    rest = rest.slice(0, named.index).replace(/\s+$/, "");
  }

  const ifm = /(^|\s)if:\s*(.+)$/.exec(rest);
  if (ifm) {
    const condStr = ifm[2]!.trim();
    if (!condStr) fail(lineNo, "choice 'if:' has no condition");
    condition = parseExpr(condStr);
    rest = rest.slice(0, ifm.index).replace(/\s+$/, "");
  }

  const text = rest.trim();
  if (!text) fail(lineNo, "choice has no text");
  const unknown = firstUnknownTag(text);
  if (unknown !== null) {
    fail(
      lineNo,
      `unrecognized markup tag "[${unknown}]" in choice text — '[..]' is for inline ` +
        `markup only; write choice attributes as 'if: …', '-> node', or '#flag'`,
    );
  }

  return {
    text,
    ...(key !== undefined ? { key } : {}),
    ...(condition !== undefined ? { condition } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(once ? { once: true } : {}),
    ...(disabled ? { presentation: "disabled" as const } : {}),
    ...(metaCount > 0 ? { meta } : {}),
  };
}

// ── Shared scalar / token helpers ────────────────────────────────────────────

/** A trailing `#key:value` → `meta[key] = scalar(value)`; a bare `#flag` →
 *  `meta[flag] = true`. Returns 1 (a meta key was written) for the caller's
 *  "did anything land in meta" tally. */
function applyHashtag(meta: Record<string, unknown>, tag: string): 1 {
  const colon = tag.indexOf(":");
  if (colon === -1) meta[tag] = true;
  else meta[tag.slice(0, colon)] = scalar(tag.slice(colon + 1));
  return 1;
}

/** A `line:<id>` hashtag carries an i18n key (Yarn's `#line:` convention) →
 *  the step's `key`, not `meta`. Returns the id, or `undefined` for any other
 *  tag (which routes to `meta` as usual). */
function lineKey(tag: string): string | undefined {
  const colon = tag.indexOf(":");
  return colon > 0 && tag.slice(0, colon) === "line" ? tag.slice(colon + 1) : undefined;
}

/** Sentinel: `numberBoolNull` returns this when the source is not one of the
 *  bare literals (so `null`, a real value, stays distinguishable). */
const NOT_LITERAL = Symbol("not-literal");

function numberBoolNull(raw: string): VarValue | typeof NOT_LITERAL {
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  return NOT_LITERAL;
}

/** A command / hint / meta value: a quoted string, a bare number / bool / null,
 *  else the bareword as a string (`rusty-key`). (Distinct from a `set` value,
 *  which reads a bareword as a variable reference.) */
function scalar(raw: string): VarValue {
  const lit = numberBoolNull(raw);
  return lit === NOT_LITERAL ? unquote(raw) : lit;
}

/** Drop one layer of matching surrounding quotes, if present. */
function unquote(raw: string): string {
  if (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** Split on whitespace, but keep a `"…"` / `'…'` span (including its spaces)
 *  attached to the token it sits in — so `msg="hello world"` is one token. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length) break;
    let tok = "";
    while (i < s.length && !/\s/.test(s[i]!)) {
      const c = s[i]!;
      if (c === '"' || c === "'") {
        tok += c;
        i++;
        while (i < s.length && s[i] !== c) tok += s[i++];
        if (i < s.length) tok += s[i++]; // closing quote
      } else {
        tok += c;
        i++;
      }
    }
    out.push(tok);
  }
  return out;
}

function fail(lineNo: number, message: string): never {
  throw new DialogueScriptError(`compact: line ${lineNo}: ${message}`);
}
