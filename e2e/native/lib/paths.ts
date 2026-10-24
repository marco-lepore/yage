import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The `e2e/native` directory. */
export const nativeDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The repository root. */
export const repoRoot = resolve(nativeDir, "../..");

/** Everything a run generates: built web directories, projects, reports. */
export const workDir = resolve(nativeDir, ".work");
