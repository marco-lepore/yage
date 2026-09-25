import { describe, expect, it } from "vitest";

import {
  adaptMarkup,
  convertSourceText,
  convertTranslatedText,
  splitCharacter,
} from "./text.js";

describe("convertSourceText", () => {
  it("numbers each {expression} and keeps its source", () => {
    expect(
      convertSourceText('You have {$gold} of {$max + 1} {"coins"}'),
    ).toEqual({
      text: "You have {0} of {1} {2}",
      parts: [
        { kind: "expr", name: "0", source: "$gold" },
        { kind: "expr", name: "1", source: "$max + 1" },
        { kind: "expr", name: "2", source: '"coins"' },
      ],
    });
  });

  it("maps Yarn escapes onto dialogue text", () => {
    const out = convertSourceText("a \\[b\\] \\\\ \\{x\\} \\# \\/ \\< \\> \\:");
    expect(out).toEqual({
      text: "a \\[b\\] \\\\ {lbrace}x} # / < > :",
      parts: [{ kind: "literal", name: "lbrace", value: "{" }],
    });
  });

  it("numbers expressions only, as a Yarn string table does", () => {
    expect(convertSourceText("\\{ {$x} \\{ {$y}")).toEqual({
      text: "{lbrace} {0} {lbrace} {1}",
      parts: [
        { kind: "literal", name: "lbrace", value: "{" },
        { kind: "expr", name: "0", source: "$x" },
        { kind: "expr", name: "1", source: "$y" },
      ],
    });
  });

  it("returns undefined for an unclosed {", () => {
    expect(convertSourceText("oops {$x")).toBeUndefined();
  });
});

describe("convertTranslatedText", () => {
  it("keeps {0} tokens and maps escapes, with \\{ as a plain brace", () => {
    expect(convertTranslatedText("Du hast {0} \\{ \\#1")).toBe(
      "Du hast {0} { #1",
    );
  });
});

describe("adaptMarkup — Yarn Spinner runtime conventions", () => {
  it("pause: whole numbers are milliseconds, decimals seconds, bare is 1 s", () => {
    expect(adaptMarkup("a[pause=500/]b")).toBe("a[pause=0.5/]b");
    expect(adaptMarkup("a[pause=1.5 /]b")).toBe("a[pause=1.5/]b");
    expect(adaptMarkup("a[pause/]b")).toBe("a[pause=1/]b");
  });

  it("a self-closing marker swallows one following whitespace character", () => {
    expect(adaptMarkup("Wait [sfx=bell/] here")).toBe("Wait [sfx=bell/]here");
    expect(adaptMarkup("Wait [sfx=bell trimwhitespace=false/] here")).toBe(
      "Wait [sfx=bell trimwhitespace=false/] here",
    );
    expect(adaptMarkup('[plural value=1 one="%" other="%"/] x')).toBe(
      '[plural value=1 one="%" other="%"/] x',
    );
  });

  it("drops properties from span tags but keeps a =value", () => {
    expect(adaptMarkup("[wave size=2]hi[/wave]")).toBe("[wave]hi[/wave]");
    expect(adaptMarkup("[color=#ff0 alpha=1]x[/color]")).toBe(
      "[color=#ff0]x[/color]",
    );
  });

  it("leaves escaped brackets and nomarkup contents alone", () => {
    expect(
      adaptMarkup("\\[pause=500/] [nomarkup][pause=500/] [a b=1][/nomarkup]"),
    ).toBe("\\[pause=500/] [nomarkup][pause=500/] [a b=1][/nomarkup]");
  });
});

describe("splitCharacter", () => {
  it("splits at the first unescaped colon", () => {
    expect(splitCharacter("Mae: Hi: there")).toEqual({
      character: "Mae",
      text: "Hi: there",
    });
    expect(splitCharacter("Old Man:hello")).toEqual({
      character: "Old Man",
      text: "hello",
    });
  });

  it("an escaped colon, a leading colon, or an expression name keeps the line whole", () => {
    expect(splitCharacter("Time\\: 5")).toEqual({
      character: undefined,
      text: "Time\\: 5",
    });
    expect(splitCharacter(": hi")).toEqual({
      character: undefined,
      text: ": hi",
    });
    expect(splitCharacter("{$who}: hi")).toEqual({
      character: undefined,
      text: "{$who}: hi",
    });
    expect(splitCharacter("No colon")).toEqual({
      character: undefined,
      text: "No colon",
    });
  });
});
