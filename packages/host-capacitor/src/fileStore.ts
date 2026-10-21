import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { SaveFileStore } from "@yagejs/save";

/**
 * What a file in the store may be called. The adapter above it builds every
 * name out of these characters, so a name outside the set names a file the
 * store never wrote and must not touch.
 */
const SAFE_NAME = /^[a-z0-9-][a-z0-9.-]*$/;

/** The code the Filesystem plugin reports for a missing file or directory. */
const NOT_FOUND = "OS-PLUG-FILE-0008";

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === NOT_FOUND;
}

/**
 * Replaces a byte sequence that is not UTF-8 with U+FFFD. A write cut short
 * can end inside a multi-byte character, and the adapter above reads such a
 * file as torn and falls back to its shadow copy.
 */
const decoder = new TextDecoder();

/** The text of a file the plugin returned as base64. */
function decodeFile(base64: string): string {
  const binary = atob(base64);
  return decoder.decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function checkName(method: string, name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `capacitorFileStore.${method}: name must match ${SAFE_NAME.source}, ` +
        `got ${JSON.stringify(name)}.`,
    );
  }
}

/**
 * A directory under the app's Library directory, through the Filesystem
 * plugin. The directory is private to the app, kept when the app is killed,
 * and included in the system's backup on iOS.
 */
export function capacitorFileStore(directory: string): SaveFileStore {
  const pathOf = (name: string): string => `${directory}/${name}`;

  return {
    async read(name: string): Promise<string | null> {
      checkName("read", name);
      let result;
      try {
        // Read as bytes: the plugin's UTF-8 read rejects a file whose last
        // character is incomplete.
        result = await Filesystem.readFile({
          path: pathOf(name),
          directory: Directory.Library,
        });
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      const data: unknown = result.data;
      if (typeof data !== "string") {
        throw new Error(
          `capacitorFileStore.read: the Filesystem plugin returned ` +
            `${typeof data} data for ${JSON.stringify(name)}, ` +
            `expected a string.`,
        );
      }
      return decodeFile(data);
    },

    async write(name: string, content: string): Promise<void> {
      checkName("write", name);
      await Filesystem.writeFile({
        path: pathOf(name),
        directory: Directory.Library,
        encoding: Encoding.UTF8,
        data: content,
        recursive: true,
      });
    },

    async delete(name: string): Promise<void> {
      checkName("delete", name);
      try {
        await Filesystem.deleteFile({
          path: pathOf(name),
          directory: Directory.Library,
        });
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
    },

    async list(): Promise<string[]> {
      try {
        const result = await Filesystem.readdir({
          path: directory,
          directory: Directory.Library,
        });
        return result.files.map((file) => file.name);
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
    },
  };
}
