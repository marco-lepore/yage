import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffold } from "./scaffold.js";
import { TEMPLATES } from "./templates.js";

describe("scaffold overwrite", () => {
  let workDir: string;
  let templatesRoot: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "create-yage-scaffold-"));
    templatesRoot = join(workDir, "templates");
    const templateDir = join(templatesRoot, "minimal");
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(
      join(templateDir, "_package.json"),
      '{"name":"my-yage-game"}',
    );
    writeFileSync(join(templateDir, "template.txt"), "from template");
    mkdirSync(join(templateDir, "src"));
    writeFileSync(
      join(templateDir, "src", "main.web.ts"),
      'localStorageAdapter({ namespace: "my-yage-game" });\n',
    );
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("preserves .git while removing other directory entries", async () => {
    const targetDir = join(workDir, "game");
    mkdirSync(join(targetDir, ".git"), { recursive: true });
    writeFileSync(join(targetDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(targetDir, "old.txt"), "old");

    const result = await scaffold({
      targetDir,
      projectName: "game",
      template: "minimal",
      templatesRoot,
      overwrite: true,
      install: false,
      git: true,
    });

    expect(result.gitSucceeded).toBeNull();
    expect(readFileSync(join(targetDir, ".git", "HEAD"), "utf8")).toBe(
      "ref: refs/heads/main\n",
    );
    expect(existsSync(join(targetDir, "old.txt"))).toBe(false);
    expect(readFileSync(join(targetDir, "template.txt"), "utf8")).toBe(
      "from template",
    );
  });

  it("replaces an existing file target", async () => {
    const targetDir = join(workDir, "game");
    writeFileSync(targetDir, "old file");

    await scaffold({
      targetDir,
      projectName: "game",
      template: "minimal",
      templatesRoot,
      overwrite: true,
      install: false,
      git: false,
    });

    expect(readFileSync(join(targetDir, "template.txt"), "utf8")).toBe(
      "from template",
    );
  });

  it("writes the editor feature's deps and script into package.json", async () => {
    const templateDir = join(templatesRoot, "minimal");
    writeFileSync(
      join(templateDir, "_package.json"),
      '{"name":"my-yage-game","scripts":{"dev":"vite"}}',
    );
    writeFileSync(join(templateDir, "tsconfig.json"), "{}");
    const targetDir = join(workDir, "game");

    await scaffold({
      targetDir,
      projectName: "game",
      template: "minimal",
      templatesRoot,
      features: ["editor"],
      overwrite: false,
      install: false,
      git: false,
    });

    const pkg = JSON.parse(
      readFileSync(join(targetDir, "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies).toHaveProperty("@yagejs/level");
    expect(pkg.devDependencies).toHaveProperty("@yagejs-tools/editor");
    expect(pkg.scripts).toEqual({ dev: "vite", editor: "yage-editor" });
  });
});

describe("scaffold save namespace", () => {
  const templatesRoot = fileURLToPath(new URL("../templates", import.meta.url));
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "create-yage-namespace-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it.each(TEMPLATES.map((template) => template.id))(
    "writes the project name into the %s template's browser save namespace",
    async (template) => {
      const targetDir = join(workDir, "game");
      await scaffold({
        targetDir,
        projectName: "space-miner",
        template,
        templatesRoot,
        overwrite: false,
        install: false,
        git: false,
      });

      const web = readFileSync(join(targetDir, "src", "main.web.ts"), "utf8");
      expect(web).toContain(
        'saveAdapter: localStorageAdapter({ namespace: "space-miner" }),',
      );
      expect(web).not.toContain("my-yage-game");
    },
  );

  it("refuses a template whose browser entry has no save namespace to name", async () => {
    const templateDir = join(workDir, "templates", "minimal");
    mkdirSync(join(templateDir, "src"), { recursive: true });
    writeFileSync(
      join(templateDir, "_package.json"),
      '{"name":"my-yage-game"}',
    );
    writeFileSync(join(templateDir, "src", "main.web.ts"), "boot();\n");

    await expect(
      scaffold({
        targetDir: join(workDir, "game"),
        projectName: "space-miner",
        template: "minimal",
        templatesRoot: join(workDir, "templates"),
        overwrite: false,
        install: false,
        git: false,
      }),
    ).rejects.toThrow(
      'has no namespace: "my-yage-game" to name after the project',
    );
  });
});
