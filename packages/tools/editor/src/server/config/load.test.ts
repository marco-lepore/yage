import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEditorConfig } from "./load.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const VALID_CONFIG = `export default {
  modules: { project: "../src/levelProject.ts", harness: "../lab/harness.ts" },
  levels: ["src/levels/**/*.yage-level.json"],
};
`;

/** A project directory with the modules a config normally points at. */
async function makeProject(config?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "yage-editor-config-"));
  roots.push(root);
  await mkdir(path.join(root, "editor"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "lab"), { recursive: true });
  await writeFile(path.join(root, "package.json"), '{ "name": "my-game" }');
  await writeFile(path.join(root, "src/levelProject.ts"), "export default {};");
  await writeFile(path.join(root, "lab/harness.ts"), "export default {};");
  if (config !== undefined) {
    await writeFile(path.join(root, "editor/config.ts"), config);
  }
  return root;
}

function load(root: string) {
  return loadEditorConfig({ cwd: root, root });
}

/** The config source with an `assets` list added to it. */
function withAssets(config: string, patterns: string): string {
  return config.replace("levels:", `assets: ${patterns},\n  levels:`);
}

/** The config source with a `gamePage` added to it. */
function withGamePage(config: string, page: string): string {
  return config.replace(
    "levels:",
    `gamePage: ${JSON.stringify(page)},\n  levels:`,
  );
}

describe("loadEditorConfig", () => {
  it("resolves module paths to URLs under the Vite root", async () => {
    const root = await makeProject(VALID_CONFIG);

    const config = await load(root);

    expect(config.modules).toEqual({
      project: "/src/levelProject.ts",
      harness: "/lab/harness.ts",
    });
    expect(config.levels).toEqual(["src/levels/**/*.yage-level.json"]);
    expect(config.projectId).toBe("my-game");
  });

  it("leaves the game page absent when the project named none", async () => {
    const root = await makeProject(VALID_CONFIG);

    expect((await load(root)).gamePage).toBeUndefined();
  });

  it("keeps a game page's query and fragment", async () => {
    const root = await makeProject(
      withGamePage(VALID_CONFIG, "/play/index.html?mode=debug#start"),
    );

    expect((await load(root)).gamePage).toBe(
      "/play/index.html?mode=debug#start",
    );
  });

  it("refuses a game page that is not root-relative", async () => {
    const root = await makeProject(
      withGamePage(VALID_CONFIG, "https://example.com/game"),
    );

    await expect(load(root)).rejects.toThrow(/root-relative URL/);
  });

  // Both start with "/" and both resolve to another host, which is what the
  // shape test alone would let through.
  it.each(["//example.com/game", "/\\example.com/game"])(
    "refuses a game page that names another origin: %s",
    async (page) => {
      const root = await makeProject(withGamePage(VALID_CONFIG, page));

      await expect(load(root)).rejects.toThrow(/another origin/);
    },
  );

  // The editor's middleware answers both ahead of Vite, so a project page
  // there is shadowed and Run would open a second editor.
  it.each([
    "/",
    "/index.html",
    "/index.html?debug=1",
    // The play page, and the extensionless form Vite would resolve onto it.
    "/play.html",
    "/play",
  ])("refuses a game page the editor serves itself: %s", async (page) => {
    const root = await makeProject(withGamePage(VALID_CONFIG, page));

    await expect(load(root)).rejects.toThrow(/serves one of its own pages/);
  });

  it("keeps a game page under a directory", async () => {
    const root = await makeProject(
      withGamePage(VALID_CONFIG, "/play/index.html"),
    );

    // Only the project's own root index is the editor's. A page one directory
    // down is the project's, whatever base it is later served under.
    expect((await load(root)).gamePage).toBe("/play/index.html");
  });

  it("refuses a module that resolves outside the root", async () => {
    const root = await makeProject(
      VALID_CONFIG.replace("../src/levelProject.ts", "../../elsewhere.ts"),
    );

    await expect(load(root)).rejects.toThrow(/outside the Vite root/);
  });

  it("refuses a module the project does not have", async () => {
    const root = await makeProject(
      VALID_CONFIG.replace("../src/levelProject.ts", "../src/missing.ts"),
    );

    await expect(load(root)).rejects.toThrow(/no module at/);
  });

  it("refuses a level pattern that reaches outside the project", async () => {
    const root = await makeProject(
      VALID_CONFIG.replace(
        '"src/levels/**/*.yage-level.json"',
        '"../shared/**/*.yage-level.json"',
      ),
    );

    await expect(load(root)).rejects.toThrow(/reaches outside/);
  });

  it("normalises asset patterns and resolves them relative to the root", async () => {
    const root = await makeProject(
      withAssets(VALID_CONFIG, '["./public/x/*.png", "sprites/**/*.png"]'),
    );

    expect((await load(root)).assets).toEqual([
      "public/x/*.png",
      "sprites/**/*.png",
    ]);
  });

  it("resolves a config with no assets to an empty list", async () => {
    const root = await makeProject(VALID_CONFIG);

    expect((await load(root)).assets).toEqual([]);
  });

  it("refuses an asset pattern that reaches outside the project", async () => {
    const root = await makeProject(
      withAssets(VALID_CONFIG, '["../shared/**/*.png"]'),
    );

    await expect(load(root)).rejects.toThrow(/"assets".*reaches outside/s);
  });

  it.each([
    ["not strings", "[1]"],
    ["an empty list", "[]"],
  ])("refuses assets that are %s", async (_name, patterns) => {
    const root = await makeProject(withAssets(VALID_CONFIG, patterns));

    await expect(load(root)).rejects.toThrow(/non-empty array of patterns/);
  });

  it("refuses a config that exports no editor config", async () => {
    const root = await makeProject("export const config = {};\n");

    await expect(load(root)).rejects.toThrow(/must default-export/);
  });

  it("refuses a config whose levels are not patterns", async () => {
    const root = await makeProject(VALID_CONFIG.replace('["src', '[1, "src'));

    await expect(load(root)).rejects.toThrow(/non-empty array of patterns/);
  });

  it("reports a config file that throws while it is read", async () => {
    const root = await makeProject('throw new Error("boom");\n');

    await expect(load(root)).rejects.toThrow(/Failed to load/);
  });

  it("says which names it looked for when there is no config", async () => {
    const root = await makeProject();

    await expect(load(root)).rejects.toThrow(/editor\/config\.ts/);
  });

  it("falls back to the directory name when the project has no manifest", async () => {
    const root = await makeProject(VALID_CONFIG);
    await rm(path.join(root, "package.json"));

    const config = await load(root);

    expect(config.projectId).toBe(path.basename(root));
  });
});
