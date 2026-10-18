import { createHash } from "node:crypto";
import { symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashDirectory } from "./hash.js";
import { makeTree, removeTrees } from "./test/tree.js";

const files = {
  "web/index.html": "<!doctype html>\n",
  "web/assets/b.js": "console.log(2);\n",
  "web/assets/a.js": "console.log(1);\n",
};

afterEach(() => {
  removeTrees();
});

describe("hashDirectory", () => {
  it("lists every file once, sorted by its path inside the directory", async () => {
    const root = makeTree(files);
    const hashed = await hashDirectory(path.join(root, "web"));
    expect(hashed.files.map((file) => file.path)).toEqual([
      "assets/a.js",
      "assets/b.js",
      "index.html",
    ]);
    expect(hashed.files[0]?.bytes).toBe(16);
  });

  it("gives two identical trees the same digest", async () => {
    const a = await hashDirectory(path.join(makeTree(files), "web"));
    const b = await hashDirectory(path.join(makeTree(files), "web"));
    expect(a.digest).toBe(b.digest);
  });

  it("changes the digest when one byte changes", async () => {
    const before = await hashDirectory(path.join(makeTree(files), "web"));
    const root = makeTree(files);
    writeFileSync(path.join(root, "web/assets/a.js"), "console.log(9);\n");
    const after = await hashDirectory(path.join(root, "web"));
    expect(after.digest).not.toBe(before.digest);
  });

  it("digests the listing of hashes and paths", async () => {
    const root = makeTree(files);
    const hashed = await hashDirectory(path.join(root, "web"));
    const expected = createHash("sha256")
      .update(
        hashed.files.map((file) => `${file.sha256}  ${file.path}`).join("\n"),
      )
      .digest("hex");
    expect(hashed.digest).toBe(expected);
  });

  it("refuses a link that leaves the directory", async () => {
    const root = makeTree({ ...files, "outside/secret.txt": "x\n" });
    const link = path.join(root, "web", "escape.txt");
    symlinkSync(path.join(root, "outside", "secret.txt"), link);
    await expect(hashDirectory(path.join(root, "web"))).rejects.toThrow(
      "points outside",
    );
  });
});
