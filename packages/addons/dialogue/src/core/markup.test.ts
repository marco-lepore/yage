import { describe, expect, it } from "vitest";

import { parseMarkup, stripMarkup } from "./markup.js";

describe("parseMarkup — plain text", () => {
  it("returns a single unstyled run with the correct length", () => {
    const r = parseMarkup("hello world");
    expect(r.runs).toEqual([{ text: "hello world", style: {} }]);
    expect(r.length).toBe(11);
    expect(r.pauses).toEqual([]);
  });

  it("empty input yields no runs and zero length", () => {
    const r = parseMarkup("");
    expect(r.runs).toEqual([]);
    expect(r.length).toBe(0);
  });
});

describe("parseMarkup — basic styles", () => {
  it("[b]/[i] toggle bold and italic on the wrapped run", () => {
    const r = parseMarkup("a[b]b[/b][i]c[/i]");
    expect(r.runs).toEqual([
      { text: "a", style: {} },
      { text: "b", style: { bold: true } },
      { text: "c", style: { italic: true } },
    ]);
    expect(r.length).toBe(3);
  });

  it("accepts the long aliases [bold] and [italic]", () => {
    const r = parseMarkup("[bold]x[/bold][italic]y[/italic]");
    expect(r.runs).toEqual([
      { text: "x", style: { bold: true } },
      { text: "y", style: { italic: true } },
    ]);
  });

  it("nested tags inherit down the stack (bold+color)", () => {
    const r = parseMarkup("[b][color=#ff0000]X[/color][/b]");
    expect(r.runs).toEqual([{ text: "X", style: { bold: true, color: 0xff0000 } }]);
  });
});

describe("parseMarkup — color parsing", () => {
  it("parses #rrggbb and the [c] alias", () => {
    expect(parseMarkup("[color=#00ff00]g[/color]").runs[0]!.style.color).toBe(0x00ff00);
    expect(parseMarkup("[c=#0000ff]b[/c]").runs[0]!.style.color).toBe(0x0000ff);
  });

  it("expands #rgb shorthand", () => {
    expect(parseMarkup("[color=#f00]x[/color]").runs[0]!.style.color).toBe(0xff0000);
  });

  it("parses 0xRRGGBB and named colors", () => {
    expect(parseMarkup("[color=0xffd25a]x[/color]").runs[0]!.style.color).toBe(0xffd25a);
    expect(parseMarkup("[color=gold]x[/color]").runs[0]!.style.color).toBe(0xffd25a);
    expect(parseMarkup("[color=GOLD]x[/color]").runs[0]!.style.color).toBe(0xffd25a);
  });

  it("drops a color tag with an unparseable argument (no style applied)", () => {
    const r = parseMarkup("[color=notacolor]x[/color]");
    expect(r.runs).toEqual([{ text: "x", style: {} }]);
  });
});

describe("parseMarkup — effects", () => {
  it("recognises all four effect tags", () => {
    for (const fx of ["wave", "shake", "pulse", "rainbow"] as const) {
      const r = parseMarkup(`[${fx}]x[/${fx}]`);
      expect(r.runs[0]!.style.effect).toBe(fx);
    }
  });
});

describe("parseMarkup — speed", () => {
  it("a single [speed] tag sets a per-run multiplier", () => {
    expect(parseMarkup("[speed=2]fast[/speed]").runs[0]!.style.speed).toBe(2);
  });

  it("nested speed tags compose multiplicatively", () => {
    const r = parseMarkup("[speed=2][speed=3]x[/speed][/speed]");
    expect(r.runs[0]!.style.speed).toBe(6);
  });

  it("ignores a non-positive or non-finite speed", () => {
    expect(parseMarkup("[speed=0]x[/speed]").runs[0]!.style.speed).toBeUndefined();
    expect(parseMarkup("[speed=abc]x[/speed]").runs[0]!.style.speed).toBeUndefined();
  });
});

describe("parseMarkup — pauses", () => {
  it("emits a zero-width pause token at the right character index", () => {
    const r = parseMarkup("ab[pause=400]cd");
    expect(r.runs).toEqual([{ text: "abcd", style: {} }]);
    expect(r.length).toBe(4);
    expect(r.pauses).toEqual([{ atChar: 2, ms: 400 }]);
  });

  it("ignores a pause with a non-positive duration", () => {
    expect(parseMarkup("a[pause=0]b").pauses).toEqual([]);
    expect(parseMarkup("a[pause]b").pauses).toEqual([]);
  });
});

describe("parseMarkup — term / glossary is REMOVED", () => {
  it("[term]/[gloss] tags are treated as unknown and dropped (text flows through)", () => {
    const r = parseMarkup("a [term=cauldron]cauldron[/term] b");
    expect(r.runs).toEqual([{ text: "a cauldron b", style: {} }]);
    expect(stripMarkup("[gloss=mana]mana[/gloss]")).toBe("mana");
  });
});

describe("parseMarkup — ruby/furigana is REMOVED", () => {
  it("[ruby]/[rt] tags are treated as unknown and dropped (text flows through)", () => {
    const r = parseMarkup("[ruby]kanji[rt]reading[/rt][/ruby]");
    // No ruby style key exists on RunStyle, and the tags are not recognised, so
    // the text is concatenated with no styling.
    expect(stripMarkup("[ruby]kanji[rt]reading[/rt][/ruby]")).toBe("kanjireading");
    for (const run of r.runs) {
      expect(run.style).not.toHaveProperty("ruby");
    }
  });
});

describe("parseMarkup — robustness", () => {
  it("drops unknown tags but keeps their inner text", () => {
    const r = parseMarkup("a[blink]b[/blink]c");
    expect(r.runs).toEqual([{ text: "abc", style: {} }]);
  });

  it("ignores a stray closing tag with no matching open", () => {
    const r = parseMarkup("a[/b]b");
    expect(r.runs).toEqual([{ text: "ab", style: {} }]);
  });

  it("recovers inherited style when a crossed tag closes", () => {
    // [b][i]X[/b]Y[/i] — closing [b] first still leaves Y italic.
    const r = parseMarkup("[b][i]X[/b]Y[/i]");
    expect(r.runs).toEqual([
      { text: "X", style: { bold: true, italic: true } },
      { text: "Y", style: { italic: true } },
    ]);
  });

  it("merges adjacent runs that resolve to the same style", () => {
    const r = parseMarkup("[b]a[/b][b]b[/b]");
    expect(r.runs).toEqual([{ text: "ab", style: { bold: true } }]);
  });

  it("unescapes \\[ \\] and \\\\ to literal characters", () => {
    const r = parseMarkup("price: \\[5\\] \\\\ done");
    expect(r.runs).toEqual([{ text: "price: [5] \\ done", style: {} }]);
  });
});

describe("parseMarkup — escaped tag-shaped sequences", () => {
  it("\\[b] renders the literal text instead of opening bold", () => {
    const r = parseMarkup("Press \\[b] to block");
    expect(r.runs).toEqual([{ text: "Press [b] to block", style: {} }]);
  });

  it("\\[pause=400] is literal text, not a reveal pause", () => {
    const r = parseMarkup("wait \\[pause=400] here");
    expect(r.runs).toEqual([{ text: "wait [pause=400] here", style: {} }]);
    expect(r.pauses).toEqual([]);
  });

  it("\\[unknowntag] is kept literally rather than silently swallowed", () => {
    expect(stripMarkup("a \\[unknowntag] b")).toBe("a [unknowntag] b");
  });

  it("\\\\[b] is an escaped backslash followed by a REAL bold tag", () => {
    const r = parseMarkup("x \\\\[b]y[/b]");
    expect(r.runs).toEqual([
      { text: "x \\", style: {} },
      { text: "y", style: { bold: true } },
    ]);
  });

  it("\\\\\\[b] is an escaped backslash followed by an escaped bracket", () => {
    const r = parseMarkup("\\\\\\[b]");
    expect(r.runs).toEqual([{ text: "\\[b]", style: {} }]);
  });

  it("an escaped closing tag stays literal and does not pop the stack", () => {
    const r = parseMarkup("[b]a\\[/b]b[/b]");
    expect(r.runs).toEqual([{ text: "a[/b]b", style: { bold: true } }]);
  });
});

describe("stripMarkup", () => {
  it("returns plain text with all tags removed", () => {
    expect(stripMarkup("[b]hi[/b] [color=gold]there[/color]")).toBe("hi there");
  });

  it("keeps unknown-tag text but drops the markup", () => {
    expect(stripMarkup("the [term=cauldron]cauldron[/term] bubbles")).toBe(
      "the cauldron bubbles",
    );
  });

  it("strips pause tokens entirely", () => {
    expect(stripMarkup("a[pause=200]b")).toBe("ab");
  });
});
