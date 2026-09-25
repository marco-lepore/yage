/**
 * Yarn line text → dialogue text. Two callers share it: the compiler, on a
 * line's source (where each `{expression}` becomes a numbered `{0}` token the
 * line evaluates when shown), and the localisation loader, on a translated
 * string table entry (which already carries the numbered tokens).
 *
 * Yarn escapes map onto the dialogue markup's: `\[` / `\]` / `\\` stay escaped
 * for the markup parser, `\{` becomes a literal brace, and `\<`, `\>`, `\#`,
 * `\/`, `\:` become the plain character.
 *
 * Markup follows Yarn Spinner's runtime where the two differ (see
 * {@link adaptMarkup}): `[pause=500/]` is milliseconds, a self-closing marker
 * swallows one following space, and properties on a span tag are dropped.
 */

import { findBraceEnd } from "./parse.js";

/** One `{…}` in a line's source: an expression, or a literal `{` from `\{`. */
export type TextPart =
  | { readonly kind: "expr"; readonly source: string }
  | { readonly kind: "literal"; readonly value: string };

export interface ConvertedText {
  /** Dialogue text; the i-th {@link parts} entry fills the `{i}` token. */
  readonly text: string;
  readonly parts: readonly TextPart[];
}

/**
 * Convert a line's source. Each `{expression}` becomes `{i}` with its source
 * in `parts[i]`; an escaped `\{` also becomes a token (a literal part), so no
 * literal brace can be read as a variable token. Returns `undefined` for an
 * unclosed `{`.
 */
export function convertSourceText(raw: string): ConvertedText | undefined {
  const parts: TextPart[] = [];
  let text = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === "\\" && i + 1 < raw.length) {
      const next = raw[++i]!;
      if (next === "{") {
        text += `{${parts.length}}`;
        parts.push({ kind: "literal", value: "{" });
      } else {
        text += escaped(next);
      }
      continue;
    }
    if (c === "{") {
      const end = findBraceEnd(raw, i + 1);
      if (end < 0) return undefined;
      text += `{${parts.length}}`;
      parts.push({ kind: "expr", source: raw.slice(i + 1, end).trim() });
      i = end;
      continue;
    }
    text += c;
  }
  return { text: adaptMarkup(text), parts };
}

/**
 * Convert a translated string table entry. Its `{0}` tokens pass through
 * unchanged (the line's own expressions fill them); escapes map as for a
 * source line, except `\{`, which becomes a plain `{`.
 */
export function convertTranslatedText(raw: string): string {
  let text = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === "\\" && i + 1 < raw.length) {
      const next = raw[++i]!;
      text += next === "{" ? "{" : escaped(next);
      continue;
    }
    text += c;
  }
  return adaptMarkup(text);
}

/** A markup tag: `[`, optional `/`, name, then values and props up to `]`,
 *  with `"…"` values allowed to hold `]`. */
const TAG = /\[(\/?)([A-Za-z]\w*)((?:"(?:[^"\\]|\\.)*"|[^\]"])*)\]/y;

/** The replacement markers, which Yarn never trims whitespace after. */
const REPLACEMENT = new Set(["select", "plural", "ordinal"]);

/**
 * Rewrite markup where Yarn Spinner's runtime and the dialogue markup differ,
 * so Yarn text shows as it does in Yarn Spinner's Unity and Godot presenters:
 *
 * - `[pause=N/]` with a whole number is milliseconds (`[pause=500/]` → 0.5 s),
 *   a decimal is seconds, and a bare `[pause/]` is one second.
 * - A self-closing marker swallows one whitespace character after it
 *   (`Wait [sfx=bell/] here` → `Wait here`) unless it sets
 *   `trimwhitespace=false`. The replacement markers never do.
 * - Space-separated properties on a span tag are dropped (`[wave size=2]` →
 *   `[wave]`): dialogue spans take a name and an optional `=value` only.
 *
 * `[nomarkup]…[/nomarkup]` is copied as is.
 */
export function adaptMarkup(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c !== "[") {
      out += c;
      i++;
      continue;
    }
    TAG.lastIndex = i;
    const m = TAG.exec(text);
    if (!m) {
      out += c;
      i++;
      continue;
    }
    const [whole, slash, rawName, body] = m as unknown as [
      string,
      string,
      string,
      string,
    ];
    const name = rawName.toLowerCase();
    i += whole.length;
    if (!slash && name === "nomarkup") {
      const rest = text.slice(i);
      const end = rest.search(/\[\/nomarkup\]/i);
      const inner = end < 0 ? rest : rest.slice(0, end + "[/nomarkup]".length);
      out += whole + inner;
      i += inner.length;
      continue;
    }
    const selfClosing = /\s*\/$/.test(body);
    if (!selfClosing) {
      // A span (or a closing tag): keep the name and a leading `=value`.
      const value = /^=("(?:[^"\\]|\\.)*"|[^\s"]*)/.exec(body)?.[0] ?? "";
      out += `[${slash}${rawName}${value}]`;
      continue;
    }
    if (name === "pause") {
      const value = /^=\s*("?)(-?\d+(?:\.\d+)?)\1/.exec(body);
      const seconds = !value
        ? 1
        : value[2]!.includes(".")
          ? Number(value[2])
          : Number(value[2]) / 1000;
      out += `[pause=${seconds}/]`;
    } else {
      out += whole;
    }
    if (
      !REPLACEMENT.has(name) &&
      !/\btrimwhitespace\s*=\s*"?false"?/i.test(body) &&
      /\s/.test(text[i] ?? "")
    ) {
      i++;
    }
  }
  return out;
}

/** An escaped character in dialogue-text form. */
function escaped(c: string): string {
  switch (c) {
    // The markup parser reads these escapes itself.
    case "[":
    case "]":
    case "\\":
      return `\\${c}`;
    case "}":
    case "<":
    case ">":
    case "#":
    case "/":
    case ":":
      return c;
    default:
      return `\\${c}`;
  }
}

/**
 * Split a leading `Character: ` off a line, the way Yarn Spinner does: the
 * name is everything before the first unescaped `:` (escape a colon as `\:`
 * to keep it in the text), trimmed. A line with no such colon, an empty name,
 * or a `{…}` expression in the name has no character; the line keeps its
 * text whole.
 */
export function splitCharacter(raw: string): {
  character: string | undefined;
  text: string;
} {
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") return { character: undefined, text: raw };
    if (c === ":") {
      const name = unescapeName(raw.slice(0, i).trim());
      if (name === "") return { character: undefined, text: raw };
      return { character: name, text: raw.slice(i + 1).trimStart() };
    }
  }
  return { character: undefined, text: raw };
}

function unescapeName(name: string): string {
  return name.replace(/\\(.)/g, "$1");
}
