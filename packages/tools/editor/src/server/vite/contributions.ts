import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** A direct dependency's name and its parsed manifest. */
export interface DependencyManifest {
  readonly name: string;
  readonly manifest: unknown;
}

export interface ContributionRejection {
  readonly packageName: string;
  readonly reason: string;
}

export interface ContributionResolution {
  /** Import specifiers, in dependency order. */
  readonly specifiers: readonly string[];
  readonly rejections: readonly ContributionRejection[];
}

/** `@scope/name` or `name`, by npm's rules. */
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** One path segment: letters, digits, `_`, `-`, and interior dots. */
const ENTRY_SEGMENT = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

/**
 * Turn declared package contributions into import specifiers for the generated
 * entry.
 *
 * Pure, and separate from both the filesystem and Vite's plugin lifecycle: the
 * command that writes a project's level module runs the same resolution
 * headlessly, and a second copy of these rules would drift from this one.
 *
 * A package that declares nothing is skipped in silence. A package that
 * declares something unusable is skipped with a reason, and the editor still
 * starts — one broken dependency cannot lock a developer out of their own
 * project. The cost is that the Actors panel quietly lacks that package's entities,
 * which is why a rejection names the package.
 */
export function resolveLevelContributions(
  dependencies: readonly DependencyManifest[],
): ContributionResolution {
  const specifiers: string[] = [];
  const rejections: ContributionRejection[] = [];

  for (const dependency of dependencies) {
    const declared = readContributionEntry(dependency.manifest);
    if (declared === undefined) continue;
    if (typeof declared !== "string") {
      rejections.push({
        packageName: dependency.name,
        reason: "yage.levelContribution must be a string",
      });
      continue;
    }

    const reason =
      entryProblem(declared) ??
      (PACKAGE_NAME.test(dependency.name)
        ? undefined
        : "the package name is not a valid npm name");
    if (reason !== undefined) {
      rejections.push({ packageName: dependency.name, reason });
      continue;
    }
    specifiers.push(`${dependency.name}${declared.slice(1)}`);
  }

  return { specifiers, rejections };
}

/**
 * Whatever the manifest declares under `yage.levelContribution`, or `undefined`
 * when it declares nothing. A declaration of the wrong type comes back as it
 * was, so the caller reports it instead of treating the package as silent.
 */
function readContributionEntry(manifest: unknown): unknown {
  if (!isObject(manifest)) return undefined;
  const yage: unknown = manifest["yage"];
  if (!isObject(yage)) return undefined;
  return yage["levelContribution"];
}

/** The reason an entry cannot become a specifier, or `undefined` when it can. */
function entryProblem(entry: string): string | undefined {
  if (!entry.startsWith("./")) {
    return `"${entry}" must be an explicit "./"-relative subpath`;
  }
  const segments = entry.slice(2).split("/");
  if (segments.some((segment) => !ENTRY_SEGMENT.test(segment))) {
    return `"${entry}" contains a segment that is not a plain subpath name`;
  }
  return undefined;
}

/**
 * The manifests of the project's direct dependencies. Transitive dependencies
 * are not followed and `node_modules` is not searched: a package contributes
 * only when the project depends on it directly.
 */
export async function readDirectDependencies(
  projectDir: string,
): Promise<readonly DependencyManifest[]> {
  const manifest = await readJson(path.join(projectDir, "package.json"));
  if (!isObject(manifest)) return [];
  const names = new Set<string>();
  for (const field of ["dependencies", "optionalDependencies"]) {
    const declared: unknown = manifest[field];
    if (isObject(declared))
      for (const name of Object.keys(declared)) names.add(name);
  }

  const found: DependencyManifest[] = [];
  for (const name of [...names].sort()) {
    const file = findPackageManifest(projectDir, name);
    if (file === undefined) continue;
    const parsed = await readJson(file);
    if (parsed !== undefined) found.push({ name, manifest: parsed });
  }
  return found;
}

/**
 * The installed package's manifest, found by walking up from the project the
 * way Node resolves a bare specifier. Read as a file rather than through
 * `require.resolve`, because a package's `exports` need not expose its own
 * manifest.
 */
function findPackageManifest(from: string, name: string): string | undefined {
  let directory = path.resolve(from);
  for (;;) {
    const candidate = path.join(
      directory,
      "node_modules",
      name,
      "package.json",
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
