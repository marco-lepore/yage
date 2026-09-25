import { describe, expect, it } from "vitest";

import {
  globMatcher,
  normalizePath,
  parseCsv,
  parseLenientJson,
  resolvePath,
  stem,
} from "./files.js";

describe("paths", () => {
  it("normalizes separators, . and ..", () => {
    expect(normalizePath("./dialogue//a/../Intro.yarn")).toBe(
      "dialogue/Intro.yarn",
    );
    expect(normalizePath("/src\\dialogue\\x.yarn")).toBe(
      "/src/dialogue/x.yarn",
    );
    expect(normalizePath("../shared/x.yarn")).toBe("../shared/x.yarn");
  });

  it("resolves against a directory", () => {
    expect(resolvePath("src/dialogue", "../shared/*.yarn")).toBe(
      "src/shared/*.yarn",
    );
    expect(resolvePath("", "**/*.yarn")).toBe("**/*.yarn");
    expect(resolvePath("src", "/abs/x.yarn")).toBe("/abs/x.yarn");
  });

  it("stem", () => {
    expect(stem("src/Game.yarnproject")).toBe("Game");
  });
});

describe("globMatcher", () => {
  it("** spans directories, * and ? stay in one", () => {
    const all = globMatcher("dlg/**/*.yarn");
    expect(all.test("dlg/a.yarn")).toBe(true);
    expect(all.test("dlg/x/y/a.yarn")).toBe(true);
    expect(all.test("other/a.yarn")).toBe(false);
    expect(globMatcher("dlg/*.yarn").test("dlg/x/a.yarn")).toBe(false);
    expect(globMatcher("dlg/?.yarn").test("dlg/a.yarn")).toBe(true);
  });

  it("is case-insensitive and reads {a,b}", () => {
    expect(globMatcher("dlg/*.YARN").test("DLG/a.yarn")).toBe(true);
    expect(globMatcher("dlg/{intro,outro}.yarn").test("dlg/outro.yarn")).toBe(
      true,
    );
    expect(globMatcher("dlg/**/*~/*").test("dlg/backup~/a.yarn")).toBe(true);
  });
});

describe("parseLenientJson", () => {
  it("allows comments and trailing commas, but not inside strings", () => {
    expect(
      parseLenientJson('{ // c\n "a": [1, 2,], /* x */ "b": "x,]//y", }'),
    ).toEqual({ a: [1, 2], b: "x,]//y" });
  });
});

describe("parseCsv", () => {
  it("reads quoted fields with commas, quotes, and newlines by header name", () => {
    const rows = parseCsv(
      '\uFEFFlanguage,ID,text\r\nde,line:a,"Hallo, ""du""\nda"\nde,line:b,Tschüss\n',
    );
    expect(rows).toEqual([
      { language: "de", id: "line:a", text: 'Hallo, "du"\nda' },
      { language: "de", id: "line:b", text: "Tschüss" },
    ]);
  });
});
