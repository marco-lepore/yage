/**
 * Inline-markup parser. Turns an authored string into styled {@link TextRun}s
 * plus {@link PauseToken}s, using a small BBCode-ish tag syntax that survives
 * translation (translators keep the tags, reorder the words):
 *
 *   plain text
 *   [b]bold[/b] [i]italic[/i]
 *   [color=#ffcc00]hex[/color]   [color=gold]named[/color]
 *   [wave]animated[/wave] [shake]..[/shake] [pulse]..[/pulse] [rainbow]..[/rainbow]
 *   [speed=2]faster[/speed]  [speed=0.5]slower[/speed]
 *   [pause=400]                (zero-width reveal pause, in ms)
 *   \[literal bracket]
 *
 * Tags nest; styles inherit down the stack (so [b][color=red]X[/color][/b]
 * is bold+red). Unknown tags are dropped silently (forward-compatible).
 */

import type {
  EffectId,
  ParsedText,
  PauseToken,
  RunStyle,
  TextRun,
} from "./types.js";

const NAMED_COLORS: Record<string, number> = {
  black: 0x000000,
  white: 0xffffff,
  red: 0xff5a5a,
  green: 0x8ce06b,
  blue: 0x6fa3d9,
  yellow: 0xffe066,
  gold: 0xffd25a,
  orange: 0xf5a168,
  purple: 0xc9a4ff,
  pink: 0xff9ecb,
  gray: 0x9aa0a6,
  grey: 0x9aa0a6,
};

const EFFECTS = new Set<EffectId>(["wave", "shake", "pulse", "rainbow"]);

function parseColor(raw: string): number | undefined {
  const v = raw.trim().toLowerCase();
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    if (/^[0-9a-f]{6}$/.test(hex)) return parseInt(hex, 16);
    if (/^[0-9a-f]{3}$/.test(hex)) {
      // #rgb → #rrggbb
      const r = hex[0]!;
      const g = hex[1]!;
      const b = hex[2]!;
      return parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
    }
    return undefined;
  }
  if (/^0x[0-9a-f]{6}$/.test(v)) return parseInt(v.slice(2), 16);
  return NAMED_COLORS[v];
}

interface Frame {
  /** Originating tag name, so a closing tag pops the matching frame. */
  readonly name: string;
  /** This tag's own style delta (not pre-merged with parents). */
  readonly override: Partial<RunStyle>;
}

/**
 * Fold every open frame's delta outermost→innermost into one effective style.
 * Recomputing from deltas (rather than caching a pre-merged style per frame)
 * means closing any frame — even a crossed/mismatched one — yields the
 * correct inherited style for the text that follows.
 */
function effectiveStyle(stack: readonly Frame[]): RunStyle {
  let style: RunStyle = {};
  for (const f of stack) style = mergeStyle(style, f.override);
  return style;
}

/** Merge a child override onto the inherited parent style. */
function mergeStyle(parent: RunStyle, child: Partial<RunStyle>): RunStyle {
  const merged: { -readonly [K in keyof RunStyle]: RunStyle[K] } = {
    ...parent,
    ...stripUndefined(child),
  };
  // `speed` composes multiplicatively so nested [speed] tags stack.
  if (child.speed !== undefined) {
    merged.speed = (parent.speed ?? 1) * child.speed;
  }
  return merged;
}

function stripUndefined(s: Partial<RunStyle>): Partial<RunStyle> {
  const out: Partial<RunStyle> = {};
  for (const k of Object.keys(s) as (keyof RunStyle)[]) {
    if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
}

const TAG_RE = /\[(\/?)([a-zA-Z]+)(?:=([^\]]*))?\]/g;

export function parseMarkup(input: string): ParsedText {
  const runs: TextRun[] = [];
  const pauses: PauseToken[] = [];
  const stack: Frame[] = [];
  let charCount = 0;
  let buffer = "";

  const flush = (): void => {
    if (buffer.length === 0) return;
    runs.push({ text: buffer, style: effectiveStyle(stack) });
    charCount += buffer.length;
    buffer = "";
  };

  // Walk the string, copying literal text into `buffer` and acting on tags.
  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(input)) !== null) {
    const literal = input.slice(lastIndex, m.index);
    buffer += unescape(literal);
    lastIndex = TAG_RE.lastIndex;

    const closing = m[1] === "/";
    const name = m[2]!.toLowerCase();
    const arg = m[3];

    if (closing) {
      flush();
      // Pop the innermost frame opened by a tag of this name (BBCode rule);
      // a stray close with no match is ignored (permissive / forward-compatible).
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.name === name) {
          stack.splice(i, 1);
          break;
        }
      }
      continue;
    }

    // Self-closing zero-width tokens.
    if (name === "pause") {
      flush();
      const ms = Number(arg ?? "0");
      if (Number.isFinite(ms) && ms > 0) {
        pauses.push({ atChar: charCount, ms });
      }
      continue;
    }

    const override = styleForTag(name, arg);
    if (override) {
      flush();
      stack.push({ name, override });
    }
    // Unknown opening tag: ignore, leave text flowing.
  }
  buffer += unescape(input.slice(lastIndex));
  flush();

  return { runs: mergeAdjacent(runs), pauses, length: charCount };
}

function styleForTag(name: string, arg?: string): Partial<RunStyle> | null {
  switch (name) {
    case "b":
    case "bold":
      return { bold: true };
    case "i":
    case "italic":
      return { italic: true };
    case "color":
    case "c": {
      const color = arg ? parseColor(arg) : undefined;
      return color !== undefined ? { color } : null;
    }
    case "speed": {
      const s = Number(arg);
      return Number.isFinite(s) && s > 0 ? { speed: s } : null;
    }
    case "term":
    case "gloss":
      return arg ? { term: arg } : null;
    default:
      if (EFFECTS.has(name as EffectId)) return { effect: name as EffectId };
      return null;
  }
}

/** `\[` → `[`, `\]` → `]`, `\\` → `\`. */
function unescape(s: string): string {
  return s.replace(/\\([[\]\\])/g, "$1");
}

/** Coalesce neighbouring runs that ended up with identical styles. */
function mergeAdjacent(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (prev && sameStyle(prev.style, run.style)) {
      out[out.length - 1] = { text: prev.text + run.text, style: prev.style };
    } else {
      out.push(run);
    }
  }
  return out;
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    a.color === b.color &&
    a.effect === b.effect &&
    (a.speed ?? 1) === (b.speed ?? 1) &&
    a.term === b.term
  );
}

/** Strip every tag, returning plain text (useful for measuring / a11y / logs). */
export function stripMarkup(input: string): string {
  return parseMarkup(input)
    .runs.map((r) => r.text)
    .join("");
}
