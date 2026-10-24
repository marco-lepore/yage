import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isCapacitorHost } from "./detect.js";

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

/**
 * The source with its comments removed and its string contents blanked, so
 * only code is left to match. A regular expression literal is read as code:
 * a quote or a `//` inside one would throw the scan off.
 */
function codeOf(source: string): string {
  let code = "";
  let i = 0;
  while (i < source.length) {
    const char = source[i] as string;
    const pair = source.slice(i, i + 2);
    if (pair === "//") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
    } else if (pair === "/*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      code += " ";
    } else if (char === '"' || char === "'" || char === "`") {
      let end = i + 1;
      while (end < source.length && source[end] !== char) {
        end += source[end] === "\\" ? 2 : 1;
      }
      code += char + char;
      i = end + 1;
    } else {
      code += char;
      i += 1;
    }
  }
  return code;
}

/** Each way one module loads another. */
const LOADS = [
  // The keyword, except in `import(` and `import.meta`.
  { form: "import statement", pattern: /\bimport\b(?!\s*[(.])/ },
  {
    form: "re-export",
    pattern: /\bexport\b\s*(?:type\b\s*)?[*{][^;]*\bfrom\b/,
  },
  { form: "dynamic import", pattern: /\bimport\s*\(/ },
];

/** The forms of loading another module that a source contains. */
function loadsIn(source: string): string[] {
  const code = codeOf(source);
  return LOADS.filter(({ pattern }) => pattern.test(code)).map(
    ({ form }) => form,
  );
}

describe("loadsIn", () => {
  it("finds each way a module loads another", () => {
    expect(loadsIn('import { a } from "./a.js";')).toEqual([
      "import statement",
    ]);
    expect(loadsIn('import type { A } from "./a.js";')).toEqual([
      "import statement",
    ]);
    expect(loadsIn('import "./a.js";')).toEqual(["import statement"]);
    expect(loadsIn('export * from "./a.js";')).toEqual(["re-export"]);
    expect(loadsIn('export { a } from "./a.js";')).toEqual(["re-export"]);
    expect(loadsIn('const a = await import("./a.js");')).toEqual([
      "dynamic import",
    ]);
  });

  it("ignores comments, strings and code that loads nothing", () => {
    const source = [
      '// import { a } from "./a.js";',
      '/* export * from "./a.js"; */',
      'const text = "import it before it imports";',
      "const url = import.meta.url;",
      "export { text, url };",
      "export function f(): void {}",
    ].join("\n");
    expect(loadsIn(source)).toEqual([]);
  });
});

describe("isCapacitorHost", () => {
  it("is false on a page no app injected a bridge into", () => {
    expect(isCapacitorHost()).toBe(false);
    (globalThis as { Capacitor?: unknown }).Capacitor = {};
    expect(isCapacitorHost()).toBe(false);
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => false,
    };
    expect(isCapacitorHost()).toBe(false);
  });

  it("is true inside a Capacitor app", () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
    };
    expect(isCapacitorHost()).toBe(true);
  });

  it("loads nothing, so a browser build can ask before it imports", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./detect.ts", import.meta.url)),
      "utf8",
    );
    expect(loadsIn(source)).toEqual([]);
  });
});
