import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** One file of a directory, with its size and hash. */
export interface HashedFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** Every file of a directory, and the one digest that stands for all of them. */
export interface HashedDirectory {
  readonly files: readonly HashedFile[];
  readonly digest: string;
}

/**
 * Hash every file under `dir`. Paths are relative to `dir` with `/`
 * separators and sorted, so the same tree produces the same digest wherever
 * it was built; the digest is the hash of the lines `"<sha256>  <path>"`
 * joined with newlines.
 *
 * A symbolic link that leaves `dir` is refused rather than followed: the
 * digest stands for what the directory ships.
 */
export async function hashDirectory(dir: string): Promise<HashedDirectory> {
  const root = await realpath(path.resolve(dir));
  const files: HashedFile[] = [];
  for (const file of await listFiles(root, root)) {
    const bytes = await readFile(file);
    files.push({
      path: toPosix(path.relative(root, file)),
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const digest = createHash("sha256")
    .update(files.map((file) => `${file.sha256}  ${file.path}`).join("\n"))
    .digest("hex");
  return { files, digest };
}

async function listFiles(dir: string, root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink() && !isInside(root, await realpath(full))) {
      throw new Error(`hashDirectory: ${full} points outside ${root}.`);
    }
    // The link's own path stays the one in the digest: it is where the file
    // sits in what the directory ships.
    const info = entry.isSymbolicLink() ? await stat(full) : entry;
    if (info.isDirectory()) found.push(...(await listFiles(full, root)));
    else if (info.isFile()) found.push(full);
  }
  return found;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}
