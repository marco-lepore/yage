import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { copyLlms, llmInputs } from "./copy-llms.mjs";
import { repoRoot } from "./check-snippets.mjs";

test("copy follows external edits and source deletion while preserving unrelated assets", (context) => {
  const root = mkdtempSync(join(tmpdir(), "yage-copy-llms-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  write("docs/llms.txt", "index");
  write("docs/llms/core-concepts.md", "core");
  write("docs/llms/packages/renderer.md", "renderer");
  write("packages/addons/quests/docs/llms/quests.md", "quests first");
  write("packages/tools/lab/docs/llms/lab.md", "lab");
  write("docs/public/keep.svg", "unrelated");
  copyLlms(root);
  assert.equal(
    readFileSync(join(root, "docs/public/llms/addons/quests.md"), "utf8"),
    "quests first",
  );
  assert.equal(
    readFileSync(join(root, "docs/public/llms-full.txt"), "utf8"),
    "core\n---\n\nrenderer\n---\n\nquests first\n---\n\nlab",
  );
  write("packages/addons/quests/docs/llms/quests.md", "quests edited");
  copyLlms(root);
  assert.match(
    readFileSync(join(root, "docs/public/llms-full.txt"), "utf8"),
    /quests edited/,
  );
  renameSync(
    join(root, "packages/addons/quests/docs/llms/quests.md"),
    join(root, "packages/addons/quests/docs/llms/renamed.md"),
  );
  rmSync(join(root, "docs/llms/packages/renderer.md"));
  copyLlms(root);
  assert.equal(
    existsSync(join(root, "docs/public/llms/addons/quests.md")),
    false,
  );
  assert.equal(
    existsSync(join(root, "docs/public/llms/packages/renderer.md")),
    false,
  );
  assert.equal(
    existsSync(join(root, "docs/public/llms/addons/renamed.md")),
    true,
  );
  assert.doesNotMatch(
    readFileSync(join(root, "docs/public/llms-full.txt"), "utf8"),
    /renderer|quests first/,
  );
  assert.equal(
    readFileSync(join(root, "docs/public/keep.svg"), "utf8"),
    "unrelated",
  );
});

test("resolved Turbo docs build includes every copy input and generated output", () => {
  const output = execFileSync(
    join(repoRoot, "node_modules/.bin/turbo"),
    ["run", "build", "--filter=@yagejs/docs", "--dry=json"],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const task = JSON.parse(output).tasks.find(
    (entry) => entry.taskId === "@yagejs/docs#build",
  );
  assert.ok(task);
  const inputs = new Set(
    Object.keys(task.inputs).map((path) =>
      relative(repoRoot, join(repoRoot, "docs", path)),
    ),
  );
  for (const input of llmInputs(repoRoot))
    assert.ok(
      inputs.has(relative(repoRoot, input)),
      `Missing input ${relative(repoRoot, input)}`,
    );
  for (const output of [
    "dist/**",
    "public/llms/**",
    "public/llms.txt",
    "public/llms-full.txt",
  ])
    assert.ok(task.outputs.includes(output), `Missing output ${output}`);
});

test("an external addon reference edit invalidates the docs build hash", (context) => {
  const root = mkdtempSync(join(tmpdir(), "yage-docs-cache-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  write(
    "package.json",
    JSON.stringify({
      name: "docs-cache-fixture",
      private: true,
      packageManager: "npm@10.8.2",
      workspaces: ["docs"],
    }),
  );
  write(
    "package-lock.json",
    JSON.stringify({
      name: "docs-cache-fixture",
      lockfileVersion: 3,
      packages: {
        "": { name: "docs-cache-fixture", workspaces: ["docs"] },
        docs: { name: "@yagejs/docs", version: "0.0.0" },
        "node_modules/@yagejs/docs": { resolved: "docs", link: true },
      },
    }),
  );
  write(
    "docs/package.json",
    JSON.stringify({
      name: "@yagejs/docs",
      version: "0.0.0",
      scripts: { build: "node build.mjs" },
    }),
  );
  write("docs/build.mjs", "");
  write("turbo.json", readFileSync(join(repoRoot, "turbo.json"), "utf8"));
  write("packages/addons/quests/docs/llms/quests.md", "first");
  const task = () =>
    JSON.parse(
      execFileSync(
        join(repoRoot, "node_modules/.bin/turbo"),
        ["run", "build", "--filter=@yagejs/docs", "--dry=json"],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    ).tasks.find((entry) => entry.taskId === "@yagejs/docs#build");
  const initial = task();
  write("packages/addons/quests/docs/llms/quests.md", "edited");
  const edited = task();
  assert.notEqual(initial.hash, edited.hash);
  rmSync(join(root, "packages/addons/quests/docs/llms/quests.md"));
  assert.notEqual(edited.hash, task().hash);
});
