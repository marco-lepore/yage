import { describe, expect, it } from "vitest";
import { readEditorScript, withEditorScript } from "./manifestScript.js";

const MANIFEST = `{
  "name": "game",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@yagejs/core": "^0.10.0"
  }
}
`;

describe("withEditorScript", () => {
  it("adds the script and leaves the rest of the manifest alone", () => {
    const text = withEditorScript(MANIFEST, "yage-editor");

    expect(readEditorScript(text)).toBe("yage-editor");
    expect(text).toContain(`  "scripts": {\n    "editor": "yage-editor",\n`);
    expect(text.replace(`    "editor": "yage-editor",\n`, "")).toBe(MANIFEST);
  });

  it("keeps every other script, in the order the project wrote them", () => {
    const parsed = JSON.parse(withEditorScript(MANIFEST, "yage-editor")) as {
      scripts: Record<string, string>;
    };

    expect(Object.keys(parsed.scripts)).toEqual(["editor", "dev", "build"]);
    expect(parsed.scripts["dev"]).toBe("vite");
  });

  it("matches the indentation the manifest uses", () => {
    const tabbed = '{\n\t"scripts": {\n\t\t"dev": "vite"\n\t}\n}\n';

    expect(withEditorScript(tabbed, "yage-editor")).toContain(
      '\n\t\t"editor": "yage-editor",',
    );
  });

  it("writes a scripts block for a manifest with none", () => {
    const bare = '{\n  "name": "game"\n}\n';

    const text = withEditorScript(bare, "yage-editor");

    expect(readEditorScript(text)).toBe("yage-editor");
    expect(text).toContain('"name": "game"');
  });

  // An empty block has no following entry for a trailing comma to belong to.
  it("fills an empty scripts block without a trailing comma", () => {
    const empty = '{\n  "name": "game",\n  "scripts": {}\n}\n';

    expect(readEditorScript(withEditorScript(empty, "yage-editor"))).toBe(
      "yage-editor",
    );
  });

  it("replaces a declared script rather than adding a second key", () => {
    const declared = MANIFEST.replace(
      '"dev": "vite",',
      '"dev": "vite",\n    "editor": "yage-editor",',
    );

    const text = withEditorScript(declared, "yage-editor --config a/b.ts");

    expect(readEditorScript(text)).toBe("yage-editor --config a/b.ts");
    expect(text.match(/"editor"/g)).toHaveLength(1);
  });

  it("finds the scripts of a manifest written on one line", () => {
    const oneLine = '{"name":"game","scripts":{"dev":"vite"}}';

    const text = withEditorScript(oneLine, "yage-editor");
    const parsed = JSON.parse(text) as { scripts: Record<string, string> };

    expect(parsed.scripts["editor"]).toBe("yage-editor");
    expect(parsed.scripts["dev"]).toBe("vite");
  });

  it("finds a scripts block whose brace is on the next line", () => {
    const wrapped = '{\n  "scripts":\n  {\n    "dev": "vite"\n  }\n}\n';

    const text = withEditorScript(wrapped, "yage-editor");

    expect(readEditorScript(text)).toBe("yage-editor");
    expect(JSON.parse(text).scripts["dev"]).toBe("vite");
  });

  it("inserts with the line ending the manifest already uses", () => {
    const crlf = MANIFEST.replace(/\n/g, "\r\n");

    const text = withEditorScript(crlf, "yage-editor");

    expect(readEditorScript(text)).toBe("yage-editor");
    expect(text).toContain('\r\n    "editor": "yage-editor",');
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  // A brace inside a script value would end the block for a naive scan.
  it("survives a script whose value contains braces", () => {
    const braces = MANIFEST.replace(
      '"dev": "vite",',
      '"dev": "node -e \\"console.log({})\\"",',
    );

    expect(readEditorScript(withEditorScript(braces, "yage-editor"))).toBe(
      "yage-editor",
    );
  });
});

describe("readEditorScript", () => {
  it("is undefined for a manifest that declares none", () => {
    expect(readEditorScript(MANIFEST)).toBeUndefined();
    expect(readEditorScript('{ "name": "game" }')).toBeUndefined();
  });
});
