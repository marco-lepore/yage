import { readFile } from "node:fs/promises";

/** The package build places the standalone browser bundle beside server modules. */
export function readGalleryScript(): Promise<Buffer> {
  return readFile(new URL("./gallery.js", import.meta.url));
}
