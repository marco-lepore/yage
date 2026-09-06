import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const groups = ["addons", "tools"];

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? markdownFiles(path)
        : entry.name.endsWith(".md")
          ? [path]
          : [];
    })
    .sort();
}

/** Lists every authored file read by copyLlms, for build-input verification. */
export function llmInputs(root) {
  const inputs = [
    join(root, "docs/llms.txt"),
    ...markdownFiles(join(root, "docs/llms")),
  ];
  for (const group of groups) {
    const directory = join(root, "packages", group);
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory).sort())
      inputs.push(...markdownFiles(join(directory, name, "docs/llms")));
  }
  return inputs;
}

/** Recreates public/llms and its two text indexes; other public assets are untouched. */
export function copyLlms(root) {
  const docsRoot = join(root, "docs");
  const source = join(docsRoot, "llms");
  const publicRoot = join(docsRoot, "public");
  const destination = join(publicRoot, "llms");
  const entries = markdownFiles(source).map((path) => ({
    path,
    target: relative(source, path),
    group: "core",
  }));
  for (const group of groups) {
    const directory = join(root, "packages", group);
    if (!existsSync(directory)) continue;
    const collected = [];
    for (const name of readdirSync(directory).sort()) {
      const base = join(directory, name, "docs/llms");
      for (const path of markdownFiles(base))
        collected.push({
          path,
          target: join(group, relative(base, path)),
          group,
        });
    }
    entries.push(...collected.sort((a, b) => a.target.localeCompare(b.target)));
  }
  const targets = new Set();
  for (const entry of entries) {
    if (targets.has(entry.target))
      throw new Error(
        `Duplicate LLM documentation destination: ${entry.target}`,
      );
    targets.add(entry.target);
  }
  // Read inputs before removing generated files, so a bad source leaves the last build intact.
  const contents = new Map(
    entries.map((entry) => [entry.path, readFileSync(entry.path, "utf8")]),
  );
  const index = readFileSync(join(docsRoot, "llms.txt"), "utf8");
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(publicRoot, "llms.txt"), index);
  for (const entry of entries) {
    mkdirSync(dirname(join(destination, entry.target)), { recursive: true });
    cpSync(entry.path, join(destination, entry.target));
  }
  const first = [
    "core-concepts.md",
    "quick-start.md",
    "patterns.md",
    "play-sessions.md",
  ];
  const ordered = [
    ...first
      .map((target) => entries.find((entry) => entry.target === target))
      .filter(Boolean),
    ...entries.filter(
      (entry) => entry.group === "core" && entry.target.startsWith("packages/"),
    ),
    ...entries.filter((entry) => entry.group !== "core"),
  ];
  writeFileSync(
    join(publicRoot, "llms-full.txt"),
    ordered.map((entry) => contents.get(entry.path)).join("\n---\n\n"),
  );
  return { files: entries.length, inputs: llmInputs(root) };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const result = copyLlms(root);
  console.log(`LLM docs copied to public/ (${result.files} files).`);
}
