import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LevelDocument } from "@yagejs/level/document";
import { createLevelFileService } from "./LevelFileService.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "yage-editor-files-"));
  roots.push(root);
  await mkdir(path.join(root, "src/levels"), { recursive: true });
  return root;
}

function document(id: string): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id,
    metadata: {},
    extensions: {},
    entities: [
      {
        id: "crate-1",
        type: "Crate",
        typeVersion: 1,
        active: true,
        transform: {
          position: { x: 4, y: 5 },
          rotation: 0,
          scale: { x: 1, y: 1 },
        },
        params: {},
        extensions: {},
      },
    ],
  };
}

const LEVELS = [{ glob: "src/levels/**/*.yage-level.json" }];
const ASSETS = ["sprites/**/*.png"];

async function service(root: string) {
  return createLevelFileService({ root, levels: LEVELS, assets: [] });
}

/** The same project, with asset globs and an optional lowered listing cap. */
async function withAssets(root: string, maxAssets?: number) {
  return createLevelFileService({
    root,
    levels: LEVELS,
    assets: ASSETS,
    ...(maxAssets === undefined ? {} : { maxAssets }),
  });
}

describe("listLevels", () => {
  it("finds configured levels and skips everything else", async () => {
    const root = await makeProject();
    await writeFile(path.join(root, "src/levels/a.yage-level.json"), "{}");
    await mkdir(path.join(root, "src/levels/deep"), { recursive: true });
    await writeFile(path.join(root, "src/levels/deep/b.yage-level.json"), "{}");
    await writeFile(path.join(root, "src/levels/notes.json"), "{}");
    await writeFile(path.join(root, "src/other.yage-level.json"), "{}");

    const listed = await (await service(root)).listLevels();

    expect(listed.map((entry) => entry.path)).toEqual([
      "src/levels/a.yage-level.json",
      "src/levels/deep/b.yage-level.json",
    ]);
  });

  it("says which layer set a path belongs to, first matching glob first", async () => {
    const root = await makeProject();
    const files = await createLevelFileService({
      root,
      levels: [
        { glob: "src/levels/forest/*.yage-level.json", layerSet: 0 },
        { glob: "src/levels/**/*.yage-level.json", layerSet: 1 },
        { glob: "src/other/*.yage-level.json" },
      ],
      assets: [],
    });

    expect(files.layerSetOf("src/levels/forest/a.yage-level.json")).toBe(0);
    expect(files.layerSetOf("src/levels/cave/a.yage-level.json")).toBe(1);
    expect(files.layerSetOf("src/other/a.yage-level.json")).toBeUndefined();
  });

  it("stamps each level with the hash of its bytes", async () => {
    const root = await makeProject();
    await writeFile(path.join(root, "src/levels/a.yage-level.json"), "{}");
    const files = await service(root);

    const first = await files.listLevels();
    await writeFile(path.join(root, "src/levels/a.yage-level.json"), "{ }");
    const second = await files.listLevels();

    expect(first[0]?.diskRevision).not.toBe(second[0]?.diskRevision);
  });
});

describe("listAssets", () => {
  it("finds the files the asset globs match and skips the levels", async () => {
    const root = await makeProject();
    await mkdir(path.join(root, "sprites/props"), { recursive: true });
    await writeFile(path.join(root, "sprites/b.png"), "b");
    await writeFile(path.join(root, "sprites/a.png"), "a");
    await writeFile(path.join(root, "sprites/props/crate.png"), "crate");
    await writeFile(path.join(root, "sprites/notes.txt"), "notes");
    await writeFile(path.join(root, "src/levels/a.yage-level.json"), "{}");

    const listed = await (await withAssets(root)).listAssets();

    expect(listed).toEqual({
      paths: ["sprites/a.png", "sprites/b.png", "sprites/props/crate.png"],
      truncated: false,
    });
  });

  it("lists nothing for a project that configured no assets", async () => {
    const root = await makeProject();
    await mkdir(path.join(root, "sprites"), { recursive: true });
    await writeFile(path.join(root, "sprites/a.png"), "a");

    expect(await (await service(root)).listAssets()).toEqual({
      paths: [],
      truncated: false,
    });
  });

  it("does not report a symlinked file or descend a symlinked directory", async () => {
    const root = await makeProject();
    const outside = await mkdtemp(path.join(tmpdir(), "yage-editor-outside-"));
    roots.push(outside);
    await mkdir(path.join(outside, "hidden"), { recursive: true });
    await writeFile(path.join(outside, "secret.png"), "secret");
    await writeFile(path.join(outside, "hidden/deeper.png"), "deeper");
    await mkdir(path.join(root, "sprites"), { recursive: true });
    await writeFile(path.join(root, "sprites/real.png"), "real");
    await symlink(
      path.join(outside, "secret.png"),
      path.join(root, "sprites/link.png"),
    );
    await symlink(
      path.join(outside, "hidden"),
      path.join(root, "sprites/linked"),
    );

    const listed = await (await withAssets(root)).listAssets();

    expect(listed.paths).toEqual(["sprites/real.png"]);
  });

  it("cuts the sorted list at the cap and says it did", async () => {
    const root = await makeProject();
    // Sorted, then cut. The directory is made before the file beside it, so a
    // walk reaches `sprites/a/z.png` first whether the filesystem lists a
    // directory alphabetically or in creation order — while sorting puts
    // `sprites/a.png` first, because "." sorts below "/". Cutting before
    // sorting would therefore answer the other file.
    await mkdir(path.join(root, "sprites/a"), { recursive: true });
    await writeFile(path.join(root, "sprites/a/z.png"), "z");
    await writeFile(path.join(root, "sprites/a.png"), "a");
    await writeFile(path.join(root, "sprites/b.png"), "b");

    expect(await (await withAssets(root, 1)).listAssets()).toEqual({
      paths: ["sprites/a.png"],
      truncated: true,
    });
    expect(await (await withAssets(root, 3)).listAssets()).toEqual({
      paths: ["sprites/a.png", "sprites/a/z.png", "sprites/b.png"],
      truncated: false,
    });
  });

  it("offers a file under publicDir by the path the browser fetches", async () => {
    const root = await makeProject();
    await mkdir(path.join(root, "public/sprites"), { recursive: true });
    await writeFile(path.join(root, "public/sprites/hero.png"), "hero");
    await mkdir(path.join(root, "sprites"), { recursive: true });
    await writeFile(path.join(root, "sprites/crate.png"), "crate");

    const files = await createLevelFileService({
      root,
      levels: LEVELS,
      assets: ["public/sprites/**/*.png", "sprites/**/*.png"],
      publicDir: path.join(root, "public"),
    });

    // Vite serves the contents of publicDir at the server root, so a level
    // stores `sprites/hero.png` while the glob that matched it is one segment
    // longer. A file outside publicDir keeps the path the glob matched.
    expect((await files.listAssets()).paths).toEqual([
      "sprites/crate.png",
      "sprites/hero.png",
    ]);
  });

  it("offers one row for two files the browser fetches by one path", async () => {
    const root = await makeProject();
    await mkdir(path.join(root, "public"), { recursive: true });
    await writeFile(path.join(root, "public/hero.png"), "served");
    await writeFile(path.join(root, "hero.png"), "shadowed");

    const files = await createLevelFileService({
      root,
      levels: LEVELS,
      assets: ["**/*.png"],
      publicDir: path.join(root, "public"),
    });

    // Both are `hero.png` to the browser, and publicDir's middleware answers
    // first, so the picker offers the one string once.
    expect(await files.listAssets()).toEqual({
      paths: ["hero.png"],
      truncated: false,
    });
  });

  it.each([
    ["turned off", ""],
    ["outside the root", path.join("..", "elsewhere")],
    ["the root itself", "."],
  ])("strips nothing when publicDir is %s", async (_name, publicDir) => {
    const root = await makeProject();
    await mkdir(path.join(root, "public/sprites"), { recursive: true });
    await writeFile(path.join(root, "public/sprites/hero.png"), "hero");

    const files = await createLevelFileService({
      root,
      levels: LEVELS,
      assets: ["public/**/*.png"],
      publicDir: publicDir === "" ? "" : path.resolve(root, publicDir),
    });

    expect((await files.listAssets()).paths).toEqual([
      "public/sprites/hero.png",
    ]);
  });
});

describe("path confinement", () => {
  it.each([
    ["traversal", "src/levels/../../escape.yage-level.json"],
    ["an absolute path", "/etc/passwd"],
    ["a backslash separator", "src\\levels\\a.yage-level.json"],
    ["a path outside the configured globs", "src/other.yage-level.json"],
    ["an empty path", ""],
  ])("refuses %s", async (_name, candidate) => {
    const root = await makeProject();
    const files = await service(root);

    const read = await files.readLevel(candidate);

    expect(read).toEqual({ ok: false, reason: "outside-roots" });
  });

  it("refuses a symlink that resolves outside the root", async () => {
    const root = await makeProject();
    const outside = await mkdtemp(path.join(tmpdir(), "yage-editor-outside-"));
    roots.push(outside);
    const target = path.join(outside, "secret.yage-level.json");
    await writeFile(target, JSON.stringify(document("secret")));
    await symlink(target, path.join(root, "src/levels/link.yage-level.json"));

    const read = await (
      await service(root)
    ).readLevel("src/levels/link.yage-level.json");

    expect(read).toEqual({ ok: false, reason: "outside-roots" });
  });

  it("reports a missing file separately from a refused one", async () => {
    const root = await makeProject();

    const read = await (
      await service(root)
    ).readLevel("src/levels/gone.yage-level.json");

    expect(read).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("readLevel", () => {
  it("returns the text, its structural result, and a revision", async () => {
    const root = await makeProject();
    const file = path.join(root, "src/levels/a.yage-level.json");
    await writeFile(file, JSON.stringify(document("forest")));

    const read = await (
      await service(root)
    ).readLevel("src/levels/a.yage-level.json");

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.structural.ok).toBe(true);
    expect(read.diskRevision).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns structural errors as data", async () => {
    const root = await makeProject();
    await writeFile(
      path.join(root, "src/levels/a.yage-level.json"),
      '{"format":"yage-level","version":1}',
    );

    const read = await (
      await service(root)
    ).readLevel("src/levels/a.yage-level.json");

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.structural.ok).toBe(false);
  });
});

describe("writeLevel", () => {
  it("writes canonical text and reports its revision", async () => {
    const root = await makeProject();
    const relative = "src/levels/a.yage-level.json";
    const file = path.join(root, relative);
    await writeFile(file, JSON.stringify(document("forest")));
    const files = await service(root);
    const read = await files.readLevel(relative);
    if (!read.ok) throw new Error("fixture unreadable");

    const written = await files.writeLevel(
      relative,
      document("forest"),
      read.diskRevision,
    );

    expect(written.ok).toBe(true);
    const text = await readFile(file, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('  "id": "forest"');
    if (!written.ok) return;
    expect(written.contentHash).toBe(files.hashCanonical(document("forest")));
  });

  it("refuses a write whose expected revision is stale, leaving the file alone", async () => {
    const root = await makeProject();
    const relative = "src/levels/a.yage-level.json";
    const file = path.join(root, relative);
    await writeFile(file, JSON.stringify(document("forest")));
    const files = await service(root);
    const before = await readFile(file, "utf8");

    const written = await files.writeLevel(
      relative,
      document("changed"),
      "not-the-revision",
    );

    expect(written).toEqual({ ok: false, reason: "stale-disk" });
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("reports a write it could not make, leaving the file alone", async () => {
    const root = await makeProject();
    const relative = "src/levels/a.yage-level.json";
    const file = path.join(root, relative);
    await writeFile(file, JSON.stringify(document("forest")));
    const files = await service(root);
    const read = await files.readLevel(relative);
    if (!read.ok) throw new Error("fixture unreadable");
    // A directory the process may read and enter but not write in: the
    // temporary sibling cannot be created, which is the shape a full disk or a
    // checked-out read-only tree takes.
    await chmod(path.join(root, "src/levels"), 0o500);

    const written = await files.writeLevel(
      relative,
      document("changed"),
      read.diskRevision,
    );

    await chmod(path.join(root, "src/levels"), 0o700);
    expect(written).toEqual({ ok: false, reason: "write-failed" });
    expect(await readFile(file, "utf8")).toBe(
      JSON.stringify(document("forest")),
    );
  });

  it("leaves no temporary file behind", async () => {
    const root = await makeProject();
    const relative = "src/levels/a.yage-level.json";
    await writeFile(path.join(root, relative), JSON.stringify(document("f")));
    const files = await service(root);
    const read = await files.readLevel(relative);
    if (!read.ok) throw new Error("fixture unreadable");

    await files.writeLevel(relative, document("f"), read.diskRevision);

    const listed = await (await service(root)).listLevels();
    expect(listed.map((entry) => entry.path)).toEqual([relative]);
  });
});
