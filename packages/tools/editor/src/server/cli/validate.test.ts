import { realpathSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  describeValidation,
  runValidate,
  type ValidationReport,
} from "./validate.js";

const EMPTY: ValidationReport = {
  levels: ["levels/*.yage-level.json"],
  projectModule: "/src/levelProject.ts",
  catalog: [],
  files: [],
};

describe("describeValidation", () => {
  it("says a project matched no level file", () => {
    expect(describeValidation(EMPTY)).toContain(
      "No level file matched levels/*.yage-level.json.",
    );
  });

  it("counts the files it checked when they are all clean", () => {
    const text = describeValidation({
      ...EMPTY,
      files: [
        { file: "levels/forest.yage-level.json", problems: [] },
        { file: "levels/meadow.yage-level.json", problems: [] },
      ],
    });

    expect(text).toContain("2 level files checked, no problems.");
  });

  it("reports catalog problems instead of levels, which it could not check", () => {
    const text = describeValidation({
      ...EMPTY,
      catalog: [
        {
          subject: "game.crate",
          path: "-",
          code: "catalog",
          message: "Two entity classes declare the id.",
        },
      ],
      files: [{ file: "levels/forest.yage-level.json", problems: [] }],
    });

    expect(text).toContain("/src/levelProject.ts");
    expect(text).toContain(
      "game.crate  -  catalog  Two entity classes declare the id.",
    );
    expect(text).toContain(
      "1 problem in /src/levelProject.ts. No level was checked.",
    );
  });

  it("groups problems by file and lines their columns up", () => {
    const text = describeValidation({
      ...EMPTY,
      files: [
        { file: "levels/clean.yage-level.json", problems: [] },
        {
          file: "levels/forest.yage-level.json",
          problems: [
            {
              subject: "01JSTALE",
              path: "-",
              code: "migration-failed",
              message: "No migration reaches version 2.",
            },
            {
              subject: "01JSHORT",
              path: "speed",
              code: "parameter-invalid",
              message: "Expected a number.",
            },
          ],
        },
      ],
    });

    expect(text).toContain("  levels/forest.yage-level.json\n");
    expect(text).not.toContain("levels/clean.yage-level.json");
    expect(text).toContain(
      "01JSTALE  -      migration-failed   No migration reaches version 2.",
    );
    expect(text).toContain(
      "01JSHORT  speed  parameter-invalid  Expected a number.",
    );
    expect(text).toContain("2 problems in 1 of 2 level files.");
  });
});

/**
 * The editor E2E project, copied so a run reads exactly the levels a case
 * wrote. Its entity classes are the ones the editor itself builds a catalog
 * from, which is what makes this a check of the real import path.
 */
const FIXTURE = fileURLToPath(
  new URL("../../../../../../e2e/editor-project", import.meta.url),
);
const REPO = fileURLToPath(new URL("../../../../../../", import.meta.url));

const LEVELS = "levels";
const CLEAN = "forest.yage-level.json";
const STALE = "forest-stale.yage-level.json";

/**
 * The config the copy is validated against, written rather than copied from
 * the fixture: the fixture's own config calls `defineEditorConfig`, which would
 * make the temp project import this package's build. `defineEditorConfig` is an
 * identity function, so a plain object is the same config.
 */
const CONFIG = `export default {
  modules: {
    project: "../src/levelProject.ts",
    harness: "../lab/harness.ts",
  },
  levels: [
    { glob: "${LEVELS}/*.yage-level.json", layers: "../src/forestLayers.ts" },
  ],
};
`;

describe("runValidate", () => {
  let root: string;
  let printed = "";

  beforeAll(async () => {
    root = realpathSync(
      await mkdtemp(path.join(tmpdir(), "yage-editor-validate-")),
    );
    for (const directory of ["src", "lab"]) {
      await cp(path.join(FIXTURE, directory), path.join(root, directory), {
        recursive: true,
      });
    }
    await mkdir(path.join(root, "editor"), { recursive: true });
    await writeFile(path.join(root, "editor", "config.ts"), CONFIG);
    // The copy sits outside the repository and nothing is installed beside it,
    // so its `@yagejs/*` imports resolve through the repository's own install.
    await symlink(
      path.join(REPO, "node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
    await mkdir(path.join(root, LEVELS), { recursive: true });
    await copyFile(
      path.join(FIXTURE, LEVELS, "forest.template.json"),
      path.join(root, LEVELS, CLEAN),
    );
    await copyFile(
      path.join(FIXTURE, LEVELS, "forest-stale.template.json"),
      path.join(root, LEVELS, STALE),
    );
  }, 60_000);

  afterAll(async () => {
    // Recursive removal unlinks the `node_modules` symlink rather than
    // following it, so the repository's own install is left alone.
    await rm(root, { recursive: true, force: true });
  });

  async function run(): Promise<number> {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        printed += String(chunk);
        return true;
      });
    try {
      return await runValidate({ cwd: root });
    } finally {
      write.mockRestore();
    }
  }

  it("fails on the level whose placement names a version nothing migrates to", async () => {
    printed = "";

    expect(await run()).toBe(1);
    expect(printed).toContain(`${LEVELS}/${STALE}`);
    expect(printed).toContain("migration-failed");
    expect(printed).not.toContain(`${LEVELS}/${CLEAN}`);
    expect(printed).toContain("of 2 level files.");
  }, 60_000);

  it("passes once every level matches the catalog", async () => {
    await rm(path.join(root, LEVELS, STALE));
    printed = "";

    expect(await run()).toBe(0);
    expect(printed).toContain("1 level file checked, no problems.");
  }, 60_000);
});

/**
 * A project shaped like a scaffolded game: one entity type whose module
 * reaches `@yagejs/physics` and `@yagejs/audio`. Neither package loads under
 * plain Node — `@dimforge/rapier2d` declares no entry point Node's resolver
 * finds, and `@pixi/sound` reads `document` while it evaluates — so this is
 * the check that the run transforms them instead of handing them over.
 */
const PHYSICS_PROJECT = {
  "vite.config.ts": `import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({ plugins: [wasm()] });
`,
  "src/Boulder.ts": `import { Entity, Transform, Vec2 } from "@yagejs/core";
import { sound } from "@yagejs/audio";
import { defineLevelEntity } from "@yagejs/level";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";

const Thud = sound("assets/thud.wav");

export class Boulder extends Entity {
  static readonly level = defineLevelEntity({ id: "game.boulder", version: 1 });

  readonly landing = Thud;

  setup(): void {
    this.add(new Transform({ position: new Vec2(0, 0) }));
    this.add(new RigidBodyComponent({ type: "dynamic" }));
    this.add(new ColliderComponent({ shape: { type: "circle", radius: 16 } }));
  }
}
`,
  "src/levelProject.ts": `import { defineLevelProject } from "@yagejs/level";
import { Boulder } from "./Boulder.js";

export default defineLevelProject({ entities: [Boulder] });
`,
  "lab/harness.ts": `export default { plugins: [] };
`,
  "editor/config.ts": `export default {
  modules: {
    project: "../src/levelProject.ts",
    harness: "../lab/harness.ts",
  },
  levels: ["${LEVELS}/*.yage-level.json"],
};
`,
  [`${LEVELS}/quarry.yage-level.json`]: JSON.stringify(
    {
      format: "yage-level",
      version: 1,
      id: "quarry",
      metadata: {},
      entities: [
        {
          id: "01J00000000000000BOULDER01",
          type: "game.boulder",
          typeVersion: 1,
          name: "Boulder",
          active: true,
          transform: {
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
          },
          params: {},
          extensions: {},
        },
      ],
    },
    null,
    2,
  ),
} as const;

describe("runValidate over a project that uses physics and audio", () => {
  let root: string;

  beforeAll(async () => {
    root = realpathSync(
      await mkdtemp(path.join(tmpdir(), "yage-editor-validate-engine-")),
    );
    for (const [file, contents] of Object.entries(PHYSICS_PROJECT)) {
      const absolute = path.join(root, file);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, contents);
    }
    await symlink(
      path.join(REPO, "node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
  }, 60_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("imports the project module and checks its level", async () => {
    let printed = "";
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        printed += String(chunk);
        return true;
      });
    let code: number;
    try {
      code = await runValidate({ cwd: root });
    } finally {
      write.mockRestore();
    }

    expect(printed).toContain("1 level file checked, no problems.");
    expect(code).toBe(0);
  }, 60_000);
});

describe("runValidate over a project module that needs a browser", () => {
  let root: string;

  beforeAll(async () => {
    root = realpathSync(
      await mkdtemp(path.join(tmpdir(), "yage-editor-validate-browser-")),
    );
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "lab"), { recursive: true });
    await mkdir(path.join(root, "editor"), { recursive: true });
    await writeFile(
      path.join(root, "src", "levelProject.ts"),
      "export const title = document.title;\nexport default { entities: [] };\n",
    );
    await writeFile(
      path.join(root, "lab", "harness.ts"),
      "export default {};\n",
    );
    await writeFile(
      path.join(root, "editor", "config.ts"),
      `export default {
  modules: { project: "../src/levelProject.ts", harness: "../lab/harness.ts" },
  levels: ["${LEVELS}/*.yage-level.json"],
};
`,
    );
    await symlink(
      path.join(REPO, "node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
  }, 60_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("says what to do about an import that reached for one", async () => {
    await expect(runValidate({ cwd: root })).rejects.toThrowError(
      /document is not defined.*needs a browser at import time/s,
    );
  }, 60_000);
});
