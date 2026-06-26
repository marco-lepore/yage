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
 *   [sfx=ding/]                (self-closing reveal MARKER — fires at its offset)
 *   [expression=happy/]        (self-named shortcut → props { expression: happy })
 *   [shake amount=3/]          (marker with explicit key=value props)
 *   \[literal bracket]
 *
 * Tags nest; styles inherit down the stack (so [b][color=red]X[/color][/b]
 * is bold+red). A trailing `/` makes a tag **self-closing** — a zero-width
 * {@link MarkerToken} that fires as a reveal event at its char offset, distinct
 * from the styling/`pause` tags (which never end in `/`). Unknown *non*-self-
 * closing tags are dropped silently (forward-compatible); translators MUST keep
 * the self-closing `/` so the marker survives a re-order.
 */

import type {
  EffectId,
  MarkerToken,
  ParsedText,
  PauseToken,
  RunStyle,
  TextRun,
} from "./types.js";

/** The empty parse result (no runs / pauses / markers, length 0). Shared so a
 *  presenter or the session can present a contentless line (an empty choice
 *  prompt) without re-constructing the shape — and without forgetting the now-
 *  required `markers` field. */
export const EMPTY_PARSED: ParsedText = Object.freeze({
  runs: Object.freeze([]) as readonly TextRun[],
  pauses: Object.freeze([]) as readonly PauseToken[],
  markers: Object.freeze([]) as readonly MarkerToken[],
  length: 0,
});

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

/**
 * Every tag name {@link parseMarkup} acts on (styling, effects, and the
 * self-closing `pause`); any other tag is dropped silently. Kept beside
 * {@link styleForTag} and {@link EFFECTS} so the recognized set has one home —
 * {@link firstUnknownTag} reads it to tell a real markup tag from a typo.
 */
const KNOWN_TAGS: ReadonlySet<string> = new Set<string>([
  "b",
  "bold",
  "i",
  "italic",
  "color",
  "c",
  "speed",
  "pause",
  ...EFFECTS,
]);

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

// Groups: 1 closing `/`, 2 name, 3 `=value` (styled spans / `pause` / a marker's
// self-named shortcut — the shared `=`-separator, left as-is), 4 marker-only
// space-separated `key=value` props, 5 a trailing `/` marking a self-closing
// MARKER. Values/props exclude `/` so the trailing slash is unambiguous. Groups
// 4–5 are additive: an existing styled/`pause`/closing tag matches them empty.
const TAG_RE =
  /\[(\/?)([a-zA-Z]+)(?:=([^\]/]*))?((?:\s+[A-Za-z_][\w-]*=[^\s\]/]*)*)(\/)?\]/g;

/**
 * Grapheme segmenter for all reveal bookkeeping. Pixi's `SplitText` /
 * `SplitBitmapText` create one glyph node per grapheme via
 * `CanvasTextMetrics.graphemeSegmenter`, which is `new Intl.Segmenter()`
 * (default "grapheme" granularity). We intentionally use the same segmentation
 * — without importing pixi (this file is in the pixi-free root entry) — so run
 * lengths, pause offsets, and per-glyph styles line up with rendered glyphs on
 * emoji / ZWJ sequences / combining marks.
 */
const GRAPHEME_SEGMENTER = new Intl.Segmenter();

/**
 * Split a string into graphemes (user-perceived characters) — the unit the
 * renderer creates one glyph node per, and the unit every reveal-side count
 * (`ParsedText.length`, `TextRun.graphemeCount`, `PauseToken.atChar`) uses.
 */
export function splitGraphemes(text: string): string[] {
  const out: string[] = [];
  for (const s of GRAPHEME_SEGMENTER.segment(text)) out.push(s.segment);
  return out;
}

export function parseMarkup(input: string): ParsedText {
  const runs: TextRun[] = [];
  const pauses: PauseToken[] = [];
  const markers: MarkerToken[] = [];
  const stack: Frame[] = [];
  let charCount = 0;
  let buffer = "";

  const flush = (): void => {
    if (buffer.length === 0) return;
    // Segment once per flushed run (O(n) over the whole input in total).
    const graphemeCount = splitGraphemes(buffer).length;
    runs.push({ text: buffer, style: effectiveStyle(stack), graphemeCount });
    charCount += graphemeCount;
    buffer = "";
  };

  // Walk the string, copying literal text into `buffer` and acting on tags.
  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(input)) !== null) {
    // Escape-awareness: count the contiguous backslashes immediately before the
    // `[`. An odd count means the bracket itself is escaped (`\[b]` → literal
    // "[b]"), so emit the tag text verbatim — consuming the escaping backslash —
    // instead of acting on it. An even count is just escaped backslashes
    // (`\\[b]` → "\" + a REAL [b] tag), handled by unescape() as usual.
    let backslashes = 0;
    for (let i = m.index - 1; i >= lastIndex && input[i] === "\\"; i--) backslashes++;
    if (backslashes % 2 === 1) {
      buffer += unescape(input.slice(lastIndex, m.index - 1)) + m[0];
      lastIndex = TAG_RE.lastIndex;
      continue;
    }
    const literal = input.slice(lastIndex, m.index);
    buffer += unescape(literal);
    lastIndex = TAG_RE.lastIndex;

    const closing = m[1] === "/";
    const name = m[2]!.toLowerCase();
    const arg = m[3];
    const propsStr = m[4];
    const selfClosing = m[5] === "/";

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

    // Self-closing MARKER (`[name k=v/]`): a zero-width reveal event at this char
    // offset. The trailing `/` distinguishes it from a styling tag of the same
    // name (`[shake]…[/shake]` is an effect span; `[shake/]` is a marker).
    if (selfClosing) {
      flush();
      markers.push({ atChar: charCount, name, props: markerProps(name, arg, propsStr) });
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

  return { runs: mergeAdjacent(runs), pauses, markers, length: charCount };
}

/**
 * Build a marker's props. The Yarn self-named shortcut `[name=val/]` (group 3)
 * yields `{ [name]: val }`; explicit space-separated `key=value` pairs (group 4)
 * merge on top. `[name/]` → `{}`. Keys lower-cased (like tag names); values kept
 * verbatim.
 */
function markerProps(
  name: string,
  arg: string | undefined,
  propsStr: string | undefined,
): Record<string, string> {
  const props: Record<string, string> = {};
  if (arg !== undefined) props[name] = arg;
  if (propsStr) {
    for (const tok of propsStr.trim().split(/\s+/)) {
      const eq = tok.indexOf("=");
      if (eq > 0) props[tok.slice(0, eq).toLowerCase()] = tok.slice(eq + 1);
    }
  }
  return props;
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
      // Sum the per-flush counts rather than re-segmenting the joined text:
      // pause offsets were tallied per flush, so this keeps `length`/`atChar`/
      // run counts on one consistent basis. (A grapheme split across a tag
      // boundary — e.g. a combining mark right after `[/b]` — would join when
      // the renderer segments the full line; the cursor then finishes one
      // step past the last glyph, which the reveal clamps harmlessly.)
      out[out.length - 1] = {
        text: prev.text + run.text,
        style: prev.style,
        graphemeCount: prev.graphemeCount + run.graphemeCount,
      };
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
    (a.speed ?? 1) === (b.speed ?? 1)
  );
}

/** Strip every tag, returning plain text (useful for measuring / a11y / logs). */
export function stripMarkup(input: string): string {
  return parseMarkup(input)
    .runs.map((r) => r.text)
    .join("");
}

/**
 * The name of the first bracketed `[tag]` in `input` that {@link parseMarkup}
 * would drop silently (an unrecognized tag), or `null` when every tag is known.
 * Escape-aware: `\[x]` is literal text, not a tag, matching the parser.
 *
 * The compact authoring front-end uses this to reject a `[..]` an author meant
 * as a choice attribute. Brackets are markup-only there, and markup's silent
 * drop would otherwise make a mistyped `#flag` / `-> target` / `if:` vanish
 * without a trace. (Say-line text is passed through untouched, so future markup
 * tokens stay forward-compatible — this guard is for the choice grammar only.)
 */
export function firstUnknownTag(input: string): string | null {
  TAG_RE.lastIndex = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(input)) !== null) {
    // Same odd-backslash escape test parseMarkup uses: an escaped `\[` is text.
    let backslashes = 0;
    for (let i = m.index - 1; i >= lastIndex && input[i] === "\\"; i--) backslashes++;
    lastIndex = TAG_RE.lastIndex;
    if (backslashes % 2 === 1) continue;
    // A self-closing marker (`[sfx=ding/]`) is parsed into a MarkerToken, not
    // dropped — so it is recognized, never a typo'd choice attribute.
    if (m[5] === "/") continue;
    const name = m[2]!.toLowerCase();
    if (!KNOWN_TAGS.has(name)) return name;
  }
  return null;
}
