import { describe, expect, it } from "vitest";

import {
  IdentityI18n,
  dialogueTextFallback,
  interpolateDialogueText,
  isDialogueMessage,
  isDialogueText,
} from "./i18n.js";

describe("interpolateDialogueText", () => {
  it("replaces known tokens and leaves unknown ones untouched", () => {
    expect(interpolateDialogueText("hi {name}, {nope}", { name: "Mara" })).toBe(
      "hi Mara, {nope}",
    );
  });

  it("does not walk the prototype chain for token names", () => {
    // `{constructor}`/`{toString}` are inherited Object.prototype members, not
    // params — they must stay untouched like any other unknown token.
    expect(interpolateDialogueText("{constructor}", {})).toBe("{constructor}");
    expect(
      interpolateDialogueText("{toString} {valueOf} {hasOwnProperty}", {}),
    ).toBe("{toString} {valueOf} {hasOwnProperty}");
  });

  it("an own param shadowing a prototype name still interpolates", () => {
    expect(interpolateDialogueText("{constructor}", { constructor: "X" })).toBe(
      "X",
    );
  });
});

describe("IdentityI18n", () => {
  it("returns a string as authored, interpolating params", () => {
    const i18n = new IdentityI18n();
    expect(i18n.resolve("hi {name}", { name: "Mara" })).toBe("hi Mara");
    expect(i18n.resolve("plain")).toBe("plain");
  });

  it("returns a message's fallback, with call values over the message's own", () => {
    const i18n = new IdentityI18n();
    const text = {
      key: "greet",
      fallback: "hi {name} ({hp})",
      values: { name: "Mara", hp: 3 },
    };
    expect(i18n.resolve(text)).toBe("hi Mara (3)");
    expect(i18n.resolve(text, { hp: 9 })).toBe("hi Mara (9)");
  });
});

describe("DialogueText guards", () => {
  it("recognise strings and { key, fallback } messages", () => {
    expect(isDialogueMessage({ key: "k", fallback: "f" })).toBe(true);
    expect(
      isDialogueMessage({ key: "k", fallback: "f", values: { n: 1 } }),
    ).toBe(true);
    expect(isDialogueMessage({ key: "", fallback: "f" })).toBe(false);
    expect(isDialogueMessage({ key: "k" })).toBe(false);
    expect(isDialogueMessage("k")).toBe(false);
    expect(isDialogueText("k")).toBe(true);
    expect(isDialogueText({ key: "k", fallback: "f" })).toBe(true);
    expect(isDialogueText(3)).toBe(false);
    expect(dialogueTextFallback("k")).toBe("k");
    expect(dialogueTextFallback({ key: "k", fallback: "f" })).toBe("f");
  });
});
