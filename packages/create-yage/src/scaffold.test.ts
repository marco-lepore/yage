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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffold } from "./scaffold.js";

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
});
