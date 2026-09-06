import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEditorConfig } from "../config/load.js";
import { runInit } from "./init.js";

function manifest(dependencies: Record<string, string>): string {
  return `${JSON.stringify({ name: "game", dependencies }, null, 2)}\n`;
}

const MINIMAL = manifest({
  "@yagejs/core": "^0.10.0",
  "@yagejs/renderer": "^0.10.0",
});

/**
 * `defineEditorConfig` returns its argument, so a stub of it is enough for
 * `loadEditorConfig` to read a written config. The temp project is outside the
 * repository, so nothing else could resolve the name.
 */
const EDITOR_STUB = "export const defineEditorConfig = (config) => config;";

const roots: string[] = [];

/**
 * A throwaway project, keyed by path relative to its root. The path is
 * resolved through `realpath` because a temp directory reaches the project
 * through a symlink on macOS, and every path the config resolves is compared
 * against the root.
 */
function writeProject(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "yage-editor-")));
  roots.push(root);
  const stub = "node_modules/@yagejs-tools/editor";
  const all = {
    [`${stub}/package.json`]: JSON.stringify({
      name: "@yagejs-tools/editor",
      version: "0.0.0",
      type: "module",
      exports: "./index.js",
    }),
    [`${stub}/index.js`]: EDITOR_STUB,
    ...files,
  };
  for (const [name, contents] of Object.entries(all)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents, "utf8");
  }
  return root;
}

function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

let written: string[];

beforeEach(() => {
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runInit", () => {
  it("writes a project the editor can start from", async () => {
    const cwd = writeProject({ "package.json": MINIMAL });

    await runInit({ cwd, force: false });
    const config = await loadEditorConfig({ cwd, root: cwd });

    expect(config.modules).toEqual({
      project: "/src/levelProject.ts",
      harness: "/editor/harness.ts",
    });
    expect(config.levels).toEqual([{ glob: "levels/*.yage-level.json" }]);
    expect(config.assets).toEqual([]);
    expect(config.gamePage).toBeUndefined();

    // The harness both tools accept: two members, and no import of either.
    const harness = read(cwd, "editor/harness.ts");
    expect(harness).toContain("export default {");
    expect(harness).toContain("engine: () => new Engine({ debug: true })");
    expect(harness).toContain("new RendererPlugin({");
    expect(harness).not.toContain("@yagejs-tools");

    expect(read(cwd, "src/levelProject.ts")).toContain("defineLevelProject");
    expect(JSON.parse(read(cwd, "package.json")).scripts.editor).toBe(
      "yage-editor",
    );
  });

  it("prefills the harness from every dependency field", async () => {
    const cwd = writeProject({
      "package.json": `${JSON.stringify({
        dependencies: { "@yagejs/renderer": "^0.10.0" },
        devDependencies: { "@yagejs/physics": "^0.10.0" },
        peerDependencies: { "@yagejs/core": "^0.10.0" },
      })}\n`,
    });

    await runInit({ cwd, force: false });

    expect(read(cwd, "editor/harness.ts")).toContain("new PhysicsPlugin(");
    expect(written.join("")).toContain("RendererPlugin, PhysicsPlugin");
  });

  it("takes the level globs from where the project already keeps levels", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "src/levels/forest/one.yage-level.json": "{}",
      "src/levels/menu/two.yage-level.json": "{}",
      "node_modules/some-package/three.yage-level.json": "{}",
    });

    await runInit({ cwd, force: false });

    expect(read(cwd, "editor/config.ts")).toContain(
      '"src/levels/forest/*.yage-level.json",',
    );
    expect(read(cwd, "editor/config.ts")).toContain(
      '"src/levels/menu/*.yage-level.json",',
    );
    expect(read(cwd, "editor/config.ts")).not.toContain("node_modules");
  });

  it("names the project's layers module and public directory", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "src/layers.ts": "export default [];",
      "public/sprites/hero.png": "",
    });

    await runInit({ cwd, force: false });

    expect(read(cwd, "editor/config.ts")).toContain(
      'layers: "../src/layers.ts"',
    );
    expect(read(cwd, "editor/config.ts")).toContain(
      'assets: ["public/**/*.png"],',
    );
  });

  // `src/layers.ts` is a name two different modules answer to: the render
  // layers the editor loads, and the physics collision layers a project can
  // keep under it. Only the first one default-exports.
  it("passes over a layers module that default-exports nothing", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "src/layers.ts": [
        'import { CollisionLayers } from "@yagejs/physics";',
        "const layers = new CollisionLayers();",
        'export const LAYER_PLAYER = layers.define("player");',
      ].join("\n"),
    });

    await runInit({ cwd, force: false });

    // The bare-glob form: no entry names a layers module.
    expect(read(cwd, "editor/config.ts")).toContain(
      '    "levels/*.yage-level.json",',
    );
    expect(written.join("")).toContain("src/layers.ts has no default export");
  });

  it("names a layers module that exports its array under another name", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "src/layers.ts": "const LAYERS = [];\nexport { LAYERS as default };",
    });

    await runInit({ cwd, force: false });

    expect(read(cwd, "editor/config.ts")).toContain(
      'layers: "../src/layers.ts"',
    );
  });

  it("names a layers module that passes another module's default on", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "src/layers.ts": 'export { default } from "./render-layers.js";',
      "src/render-layers.ts": "export default [];",
    });

    await runInit({ cwd, force: false });

    expect(read(cwd, "editor/config.ts")).toContain(
      'layers: "../src/layers.ts"',
    );
  });

  it("passes over a layers module that renames a default away", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "src/layers.ts": 'export { default as layers } from "./collision.js";',
    });

    await runInit({ cwd, force: false });

    // No entry names a layers module.
    expect(read(cwd, "editor/config.ts")).toContain(
      '    "levels/*.yage-level.json",',
    );
    expect(written.join("")).toContain("src/layers.ts has no default export");
  });

  // Both tools accept the same object, so the project links its two harnesses
  // rather than listing the same plugins twice.
  it("re-exports a scenario lab harness that is already there", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "lab/harness.ts":
        "export default { engine: () => {}, plugins: () => [] };",
    });

    await runInit({ cwd, force: false });

    expect(read(cwd, "editor/harness.ts")).toContain(
      'export { default } from "../lab/harness.js";',
    );
    expect(read(cwd, "editor/harness.ts")).not.toContain("RendererPlugin");
    expect(written.join("")).toContain("lab/harness.ts — the harness");
  });

  it("maps the extension of a lab harness written as .mts", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "lab/harness.mts": "export default {};",
    });

    await runInit({ cwd, force: false });

    expect(read(cwd, "editor/harness.ts")).toContain('"../lab/harness.mjs"');
  });

  it("keeps the files that are already there", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "editor/config.ts": "// mine",
      "src/levelProject.ts": "// mine",
    });

    await runInit({ cwd, force: false });

    expect(read(cwd, "editor/config.ts")).toBe("// mine");
    expect(read(cwd, "src/levelProject.ts")).toBe("// mine");
    expect(written.join("")).toContain("kept       editor/config.ts");
    expect(written.join("")).toContain("--force");
  });

  // The config decides which module the editor loads as the harness, so a
  // file written beside a config that is already there could go unread.
  it("leaves the harness to a config that is already there", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "editor/config.ts": "// mine",
    });

    await runInit({ cwd, force: false });

    expect(existsSync(path.join(cwd, "editor/harness.ts"))).toBe(false);
    expect(written.join("")).toContain(
      "harness    not written — editor/config.ts names the one it loads",
    );
  });

  // The manifest edit is the one step that can refuse, so it runs before any
  // file is written and a refusal leaves the project untouched.
  it("writes nothing when the manifest cannot take the script", async () => {
    // `scripts` is not an object, so there is nowhere for the entry to go.
    const cwd = writeProject({
      "package.json": `${JSON.stringify(
        {
          name: "game",
          scripts: 4,
          dependencies: {
            "@yagejs/core": "^0.10.0",
            "@yagejs/renderer": "^0.10.0",
          },
        },
        null,
        2,
      )}\n`,
    });

    await expect(runInit({ cwd, force: false })).rejects.toThrow(/by hand/);
    expect(existsSync(path.join(cwd, "editor/config.ts"))).toBe(false);
    expect(existsSync(path.join(cwd, "src/levelProject.ts"))).toBe(false);
  });

  // The CLI probes four extensions, so writing the .ts would shadow a config
  // the project wrote as .mjs.
  it("keeps a config written under another extension", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "editor/config.mjs": "// mine",
    });

    await runInit({ cwd, force: false });

    expect(existsSync(path.join(cwd, "editor/config.ts"))).toBe(false);
  });

  it("rewrites with --force", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "editor/config.ts": "// mine",
    });

    await runInit({ cwd, force: true });

    expect(read(cwd, "editor/config.ts")).toContain("defineEditorConfig");
  });

  it("leaves a script the project already declares", async () => {
    const cwd = writeProject({
      "package.json": `${JSON.stringify(
        {
          name: "game",
          scripts: { editor: "yage-editor --port 4000" },
          dependencies: {
            "@yagejs/core": "^0.10.0",
            "@yagejs/renderer": "^0.10.0",
          },
        },
        null,
        2,
      )}\n`,
    });

    await runInit({ cwd, force: false });

    expect(JSON.parse(read(cwd, "package.json")).scripts.editor).toBe(
      "yage-editor --port 4000",
    );
  });

  // Every module the config names has to resolve inside the Vite root, so the
  // files follow the root and the script names the config it can no longer
  // probe for.
  it("writes under the Vite root the project declares", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "vite.config.ts": `export default { root: "app" };`,
      "app/index.html": "<!doctype html>",
    });

    await runInit({ cwd, force: false });

    expect(existsSync(path.join(cwd, "app/editor/config.ts"))).toBe(true);
    expect(existsSync(path.join(cwd, "editor/config.ts"))).toBe(false);
    expect(JSON.parse(read(cwd, "package.json")).scripts.editor).toBe(
      "yage-editor --config app/editor/config.ts",
    );
  });

  it("refuses a project missing a package the harness imports", async () => {
    const noRenderer = writeProject({
      "package.json": manifest({ "@yagejs/core": "^0.10.0" }),
    });
    const noCore = writeProject({
      "package.json": manifest({ "@yagejs/renderer": "^0.10.0" }),
    });

    await expect(runInit({ cwd: noRenderer, force: false })).rejects.toThrow(
      /@yagejs\/renderer/,
    );
    await expect(runInit({ cwd: noCore, force: false })).rejects.toThrow(
      /@yagejs\/core/,
    );
  });

  it("refuses a directory that is not a project", async () => {
    const cwd = writeProject({ "src/main.ts": "" });

    await expect(runInit({ cwd, force: false })).rejects.toThrow(
      /No package.json/,
    );
  });

  // Installing the editor pulls its peers in without declaring them.
  it("says the level project needs @yagejs/level declared", async () => {
    const cwd = writeProject({ "package.json": MINIMAL });

    await runInit({ cwd, force: false });

    expect(written.join("")).toMatch(/@yagejs\/level is not a dependency/);
  });
});
