import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readDirectDependencies,
  resolveLevelContributions,
} from "./contributions.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

function contributor(entry: unknown): unknown {
  return { yage: { levelContribution: entry } };
}

describe("resolveLevelContributions", () => {
  it("turns a declared subpath into a specifier", () => {
    const resolved = resolveLevelContributions([
      { name: "@yagejs/renderer", manifest: contributor("./level") },
      { name: "@yagejs/physics", manifest: contributor("./level/index.js") },
    ]);

    expect(resolved.specifiers).toEqual([
      "@yagejs/renderer/level",
      "@yagejs/physics/level/index.js",
    ]);
    expect(resolved.rejections).toEqual([]);
  });

  it("passes over a package that declares nothing", () => {
    const resolved = resolveLevelContributions([
      { name: "react", manifest: { version: "19.0.0" } },
      { name: "@yagejs/core", manifest: { yage: {} } },
      { name: "broken", manifest: "not an object" },
    ]);

    expect(resolved).toEqual({ specifiers: [], rejections: [] });
  });

  it.each([
    ["a bare specifier", "level"],
    ["a parent segment", "./../secret"],
    ["a current-directory segment", "./././level"],
    ["an absolute path", "/etc/passwd"],
    ["a quote", './level";import "evil'],
    ["a space", "./level entry"],
    ["a query suffix", "./level?raw"],
    ["a backslash", ".\\level"],
    ["a non-string", 42],
  ])("rejects %s and keeps the editor running", (_name, entry) => {
    const resolved = resolveLevelContributions([
      { name: "@yagejs/renderer", manifest: contributor(entry) },
      { name: "@yagejs/physics", manifest: contributor("./level") },
    ]);

    expect(resolved.specifiers).toEqual(["@yagejs/physics/level"]);
    expect(resolved.rejections).toHaveLength(1);
    expect(resolved.rejections[0]?.packageName).toBe("@yagejs/renderer");
  });

  it("rejects a package whose name is not an npm name", () => {
    const resolved = resolveLevelContributions([
      { name: "../evil", manifest: contributor("./level") },
    ]);

    expect(resolved.specifiers).toEqual([]);
    expect(resolved.rejections[0]?.reason).toContain("npm name");
  });
});

describe("readDirectDependencies", () => {
  it("reads the manifests of direct dependencies only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yage-editor-deps-"));
    roots.push(root);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        dependencies: { "@yagejs/renderer": "^0.10.2" },
        optionalDependencies: { "@yagejs/physics": "^0.10.2" },
        devDependencies: { vitest: "^4.0.0" },
      }),
    );
    for (const name of ["@yagejs/renderer", "@yagejs/physics", "vitest"]) {
      const directory = path.join(root, "node_modules", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({ name, yage: { levelContribution: "./level" } }),
      );
    }

    const found = await readDirectDependencies(root);

    expect(found.map((entry) => entry.name)).toEqual([
      "@yagejs/physics",
      "@yagejs/renderer",
    ]);
  });

  it("skips a declared dependency that is not installed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yage-editor-deps-"));
    roots.push(root);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { "@yagejs/renderer": "^0.10.2" } }),
    );

    expect(await readDirectDependencies(root)).toEqual([]);
  });
});
