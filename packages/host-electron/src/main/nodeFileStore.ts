import { mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { SaveFileStore } from "@yagejs/save";

/**
 * What a file in the store may be called. The adapter above it builds every
 * name out of these characters, so a name outside the set names a file the
 * store never wrote and must not touch.
 */
const SAFE_NAME = /^[a-z0-9-][a-z0-9.-]*$/;

/** The error a missing file or directory reports. */
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function checkName(method: string, name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `nodeFileStore.${method}: name must match ${SAFE_NAME.source}, ` +
        `got ${JSON.stringify(name)}.`,
    );
  }
}

/**
 * A directory of files on disk. Each write reaches the drive before it
 * resolves, so a save that resolved survives a power cut of the machine.
 */
export function nodeFileStore(directory: string): SaveFileStore {
  let created = false;

  return {
    async read(name: string): Promise<string | null> {
      checkName("read", name);
      try {
        return await readFile(join(directory, name), "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async write(name: string, content: string): Promise<void> {
      checkName("write", name);
      if (!created) {
        await mkdir(directory, { recursive: true });
        created = true;
      }
      const file = await open(join(directory, name), "w");
      try {
        await file.writeFile(content, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
    },

    async delete(name: string): Promise<void> {
      checkName("delete", name);
      try {
        await unlink(join(directory, name));
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
    },

    async list(): Promise<string[]> {
      try {
        return await readdir(directory);
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
    },
  };
}
