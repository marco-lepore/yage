import { createPackage } from "@electron/asar";

/**
 * Pack a built web directory into one archive beside it and return the path
 * the shell serves it from. Electron reads a file inside an archive through
 * the same path it reads a file on disk.
 */
export async function packWebDir(webDir: string): Promise<string> {
  const archive = `${webDir}.asar`;
  await createPackage(webDir, archive);
  return archive;
}
