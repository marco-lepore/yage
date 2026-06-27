import { describe, expect, it } from "vitest";

import { firstUnknownTag, parseMarkup, splitGraphemes, stripMarkup } from "./markup.js";
import type { RunStyle, TextRun } from "./types.js";

/** Expected-run helper for ASCII-only cases, where graphemes = code units. */
const run = (text: string, style: RunStyle = {}): TextRun => ({
  text,
  style,
  graphemeCount: text.length,
});

describe("parseMarkup — plain text", () => {
  it("returns a single unstyled run with the correct length", () => {
    const r = parseMarkup("hello world");
    expect(r.runs).toEqual([run("hello world")]);
    expect(r.length).toBe(11);
    expect(r.tokens).toEqual([]);
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
      run("a"),
      run("b", { bold: true }),
      run("c", { italic: true }),
    ]);
    expect(r.length).toBe(3);
  });

  it("accepts the long aliases [bold] and [italic]", () => {
    const r = parseMarkup("[bold]x[/bold][italic]y[/italic]");
    expect(r.runs).toEqual([
      run("x", { bold: true }),
      run("y", { italic: true }),
    ]);
  });

  it("nested tags inherit down the stack (bold+color)", () => {
    const r = parseMarkup("[b][color=#ff0000]X[/color][/b]");
    expect(r.runs).toEqual([run("X", { bold: true, color: 0xff0000 })]);
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
    expect(r.runs).toEqual([run("x")]);
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

describe("parseMarkup — pauses (self-closing [pause=N/])", () => {
  it("emits a zero-width pause token at the right character index", () => {
    const r = parseMarkup("ab[pause=400/]cd");
    expect(r.runs).toEqual([run("abcd")]);
    expect(r.length).toBe(4);
    expect(r.tokens).toEqual([{ kind: "pause", atChar: 2, ms: 400 }]);
  });

  it("ignores a pause with a non-positive or absent duration", () => {
    expect(parseMarkup("a[pause=0/]b").tokens).toEqual([]);
    expect(parseMarkup("a[pause/]b").tokens).toEqual([]);
  });

  it("a bare [pause=N] without the slash is NOT a pause", () => {
    // pause is self-closing now: the old no-slash spelling drops as an unknown
    // tag in a say line (text flows) and is flagged in a compact choice.
    const r = parseMarkup("a[pause=400]b");
    expect(r.tokens).toEqual([]);
    expect(r.runs).toEqual([run("ab")]);
    expect(firstUnknownTag("a[pause=400]b")).toBe("pause");
  });
});

describe("splitGraphemes", () => {
  it("splits user-perceived characters, not code units or code points", () => {
    expect(splitGraphemes("héllo")).toEqual(["h", "é", "l", "l", "o"]);
    expect(splitGraphemes("🔥ok")).toEqual(["🔥", "o", "k"]); // astral: 2 code units
    expect(splitGraphemes("👩‍🚀!")).toEqual(["👩‍🚀", "!"]); // ZWJ sequence
    // NFD: "e" + U+0301 combining acute is ONE grapheme (two code points).
    expect(splitGraphemes("Cafe\u0301")).toEqual(["C", "a", "f", "e\u0301"]);
  });
});

describe("parseMarkup — grapheme counting (F12)", () => {
  it("counts an astral emoji as one grapheme, not two code units", () => {
    const r = parseMarkup("🔥 now");
    expect(r.runs).toEqual([{ text: "🔥 now", style: {}, graphemeCount: 5 }]);
    expect(r.length).toBe(5);
  });

  it("counts a ZWJ family emoji as one grapheme", () => {
    const r = parseMarkup("👨‍👩‍👧‍👦!"); // 7 code points / 11 code units, 1 grapheme
    expect(r.length).toBe(2);
    expect(r.runs[0]!.graphemeCount).toBe(2);
  });

  it("rides NFD combining marks on their base character", () => {
    const r = parseMarkup("Cafe\u0301"); // 5 code units, 4 graphemes
    expect(r.length).toBe(4);
  });

  it("places pause atChar at a grapheme index, not a code-unit index", () => {
    const r = parseMarkup("🔥🔥[pause=300/]ab"); // 4 code units but 2 graphemes before
    expect(r.tokens).toEqual([{ kind: "pause", atChar: 2, ms: 300 }]);
    expect(r.length).toBe(4);
  });

  it("keeps counts aligned across styled runs and pauses", () => {
    const r = parseMarkup("[b]🔥a[/b]e\u0301[pause=100/]👩‍🚀");
    expect(r.runs).toEqual([
      { text: "🔥a", style: { bold: true }, graphemeCount: 2 },
      // The pause flushes, then the two same-style runs re-merge (counts sum).
      { text: "e\u0301👩‍🚀", style: {}, graphemeCount: 2 },
    ]);
    expect(r.tokens).toEqual([{ kind: "pause", atChar: 3, ms: 100 }]);
    expect(r.length).toBe(4);
  });

  it("sums grapheme counts when adjacent same-style runs merge", () => {
    const r = parseMarkup("[b]🔥[/b][b]🔥[/b]");
    expect(r.runs).toEqual([{ text: "🔥🔥", style: { bold: true }, graphemeCount: 2 }]);
    expect(r.length).toBe(2);
  });
});

describe("parseMarkup — self-closing markers", () => {
  it("a bare [name/] marker fires at its char offset with empty props", () => {
    const r = parseMarkup("ab[sfx/]cd");
    expect(r.runs).toEqual([run("abcd")]); // marker is zero-width
    expect(r.length).toBe(4);
    expect(r.tokens).toEqual([{ kind: "marker", atChar: 2, name: "sfx", props: {} }]);
  });

  it("the self-named shortcut [name=val/] → props { name: val }", () => {
    const r = parseMarkup("[expression=happy/]hi");
    expect(r.tokens).toEqual([{ kind: "marker", atChar: 0, name: "expression", props: { expression: "happy" } }]);
    expect(r.runs).toEqual([run("hi")]);
  });

  it("explicit space-separated key=value props", () => {
    const r = parseMarkup("x[shake amount=3 speed=2/]y");
    expect(r.tokens).toEqual([
      { kind: "marker", atChar: 1, name: "shake", props: { amount: "3", speed: "2" } },
    ]);
  });

  it("the self-named shortcut composes with explicit props (Yarn [name=val] ≡ [name name=val])", () => {
    const r = parseMarkup("[shake=500 amount=3/]go");
    expect(r.tokens).toEqual([
      { kind: "marker", atChar: 0, name: "shake", props: { shake: "500", amount: "3" } },
    ]);
  });

  it("records markers at grapheme offsets, alongside pauses, in order", () => {
    const r = parseMarkup("🔥[sfx=a/]ab[pause=100/][expression=sad/]z");
    expect(r.length).toBe(4); // 🔥 a b z
    // One ordered stream: source order is drain order (sfx @1, then pause then
    // expression both @3).
    expect(r.tokens).toEqual([
      { kind: "marker", atChar: 1, name: "sfx", props: { sfx: "a" } },
      { kind: "pause", atChar: 3, ms: 100 },
      { kind: "marker", atChar: 3, name: "expression", props: { expression: "sad" } },
    ]);
  });

  it("a marker name shadowing an effect ([shake/]) is a marker, not a span", () => {
    const r = parseMarkup("a[shake/]b");
    expect(r.runs).toEqual([run("ab")]); // no effect style applied
    expect(r.runs.every((x) => x.style.effect === undefined)).toBe(true);
    expect(r.tokens).toEqual([{ kind: "marker", atChar: 1, name: "shake", props: {} }]);
  });

  it("a props-bearing tag with NO trailing slash stays literal (forgotten `/`)", () => {
    // `[shake amount=3]` must NOT open an effect span / drop the props — it's a
    // mistyped marker, kept as visible literal text (the pre-marker behavior).
    const r = parseMarkup("Hi [shake amount=3]there");
    expect(r.runs).toEqual([run("Hi [shake amount=3]there")]);
    expect(r.runs.every((x) => x.style.effect === undefined)).toBe(true);
    expect(r.tokens).toEqual([]);
    // …and the choice-attr guard doesn't flag it (it isn't dropped).
    expect(firstUnknownTag("Hi [shake amount=3]there")).toBeNull();
  });

  it("stripMarkup drops markers entirely (no text)", () => {
    expect(stripMarkup("a[sfx=ding/]b")).toBe("ab");
  });

  it("leaves styling / pause tags untouched (no marker emitted)", () => {
    const r = parseMarkup("[b]x[/b][pause=50/]y[color=red]z[/color]");
    expect(r.tokens).toEqual([{ kind: "pause", atChar: 1, ms: 50 }]);
  });

  it("firstUnknownTag does NOT flag a self-closing marker (markup consumes it)", () => {
    expect(firstUnknownTag("pick [sfx=ding/] this")).toBeNull();
    // a non-self-closing unknown tag is still flagged
    expect(firstUnknownTag("[sfx=ding]")).toBe("sfx");
  });
});

describe("parseMarkup — term / glossary is REMOVED", () => {
  it("[term]/[gloss] tags are treated as unknown and dropped (text flows through)", () => {
    const r = parseMarkup("a [term=cauldron]cauldron[/term] b");
    expect(r.runs).toEqual([run("a cauldron b")]);
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
    expect(r.runs).toEqual([run("abc")]);
  });

  it("ignores a stray closing tag with no matching open", () => {
    const r = parseMarkup("a[/b]b");
    expect(r.runs).toEqual([run("ab")]);
  });

  it("recovers inherited style when a crossed tag closes", () => {
    // [b][i]X[/b]Y[/i] — closing [b] first still leaves Y italic.
    const r = parseMarkup("[b][i]X[/b]Y[/i]");
    expect(r.runs).toEqual([
      run("X", { bold: true, italic: true }),
      run("Y", { italic: true }),
    ]);
  });

  it("merges adjacent runs that resolve to the same style", () => {
    const r = parseMarkup("[b]a[/b][b]b[/b]");
    expect(r.runs).toEqual([run("ab", { bold: true })]);
  });

  it("unescapes \\[ \\] and \\\\ to literal characters", () => {
    const r = parseMarkup("price: \\[5\\] \\\\ done");
    expect(r.runs).toEqual([run("price: [5] \\ done")]);
  });
});

describe("parseMarkup — escaped tag-shaped sequences", () => {
  it("\\[b] renders the literal text instead of opening bold", () => {
    const r = parseMarkup("Press \\[b] to block");
    expect(r.runs).toEqual([run("Press [b] to block")]);
  });

  it("\\[pause=400] is literal text, not a reveal pause", () => {
    const r = parseMarkup("wait \\[pause=400] here");
    expect(r.runs).toEqual([run("wait [pause=400] here")]);
    expect(r.tokens).toEqual([]);
  });

  it("\\[unknowntag] is kept literally rather than silently swallowed", () => {
    expect(stripMarkup("a \\[unknowntag] b")).toBe("a [unknowntag] b");
  });

  it("\\\\[b] is an escaped backslash followed by a REAL bold tag", () => {
    const r = parseMarkup("x \\\\[b]y[/b]");
    expect(r.runs).toEqual([run("x \\"), run("y", { bold: true })]);
  });

  it("\\\\\\[b] is an escaped backslash followed by an escaped bracket", () => {
    const r = parseMarkup("\\\\\\[b]");
    expect(r.runs).toEqual([run("\\[b]")]);
  });

  it("an escaped closing tag stays literal and does not pop the stack", () => {
    const r = parseMarkup("[b]a\\[/b]b[/b]");
    expect(r.runs).toEqual([run("a[/b]b", { bold: true })]);
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
    expect(stripMarkup("a[pause=200/]b")).toBe("ab");
  });
});

describe("firstUnknownTag", () => {
  it("returns null when every tag is a recognized markup tag", () => {
    expect(firstUnknownTag("plain text")).toBeNull();
    expect(firstUnknownTag("[b]x[/b] [color=#f00]y[/color] [wave]z[/wave] [pause=100/][speed=2]w[/speed]")).toBeNull();
  });

  it("returns the name of the first tag parseMarkup would drop silently", () => {
    expect(firstUnknownTag("a [term=cauldron]b[/term]")).toBe("term");
    expect(firstUnknownTag("[skill=8] roll")).toBe("skill");
  });

  it("ignores an escaped bracket (it is literal text, not a tag)", () => {
    expect(firstUnknownTag("price is \\[skill=8]")).toBeNull();
  });
});
