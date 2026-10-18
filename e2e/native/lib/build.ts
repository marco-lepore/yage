import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";
import { fixtureBuildConfig } from "../../fixtures/vite.config.js";
import { repoRoot, workDir } from "./paths.js";

/** Which entry's page is built. */
export type BaselineTarget = "web" | "electron" | "capacitor";

/** Which build of the fixture is produced. */
export type BaselineProfile = "test" | "release";

/** The page each target's entry is reached through. */
const PAGES: Record<BaselineTarget, string> = {
  web: "baseline.html",
  electron: "baseline-electron.html",
  capacitor: "baseline-capacitor.html",
};

/**
 * Where a built web directory lands. The Capacitor project's configuration
 * points at one fixed directory, so its two profiles share the slot and a
 * build replaces what was there.
 */
export function webDirFor(
  target: BaselineTarget,
  profile: BaselineProfile,
): string {
  const slot = target === "capacitor" ? "capacitor" : `${target}-${profile}`;
  return resolve(workDir, "web", slot);
}

/**
 * Build one target's web directory with Vite and return its absolute path.
 * The emitted page is renamed `index.html`, so a shell loads one well-known
 * file whatever entry it carries.
 */
export async function buildBaseline(
  target: BaselineTarget,
  profile: BaselineProfile,
): Promise<string> {
  if (!existsSync(resolve(repoRoot, "packages/core/dist/index.js"))) {
    throw new Error(
      "buildBaseline: the engine packages are not built. " +
        "Run npx turbo build first.",
    );
  }
  const page = PAGES[target];
  const outDir = webDirFor(target, profile);
  const config = fixtureBuildConfig({
    index: resolve(repoRoot, "e2e/fixtures", page),
  });
  await build({
    ...config,
    configFile: false,
    // The release profile is a build mode of its own; the test profile keeps
    // Vite's default, which is what the development server also reports.
    ...(profile === "release" ? { mode: "release" } : {}),
    logLevel: "warn",
    build: { ...config.build, outDir, emptyOutDir: true },
  });
  const emitted = resolve(outDir, page);
  if (emitted !== resolve(outDir, "index.html")) {
    await rename(emitted, resolve(outDir, "index.html"));
  }
  return outDir;
}
