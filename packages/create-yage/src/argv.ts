import type { TemplateId } from "./templates.js";
import { isTemplateId } from "./templates.js";

export interface ParsedArgs {
  targetDir?: string;
  template?: TemplateId;
  install?: boolean;
  git?: boolean;
  overwrite?: boolean;
  yes?: boolean;
  help: boolean;
  version: boolean;
  /** Error string if argv parsing failed. */
  error?: string;
}

/**
 * Parses a minimal argv slice (without node + script path). Supports:
 *   [target-dir]
 *   --template <recommended|minimal>
 *   --no-install / --no-git
 *   --force / --yes
 *   --help / --version
 * Unknown flags are rejected so typos don't silently succeed.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = { help: false, version: false };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) break;

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      i++;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      result.version = true;
      i++;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      result.yes = true;
      i++;
      continue;
    }
    if (arg === "--force" || arg === "-f") {
      result.overwrite = true;
      i++;
      continue;
    }
    if (arg === "--no-install") {
      result.install = false;
      i++;
      continue;
    }
    if (arg === "--install") {
      result.install = true;
      i++;
      continue;
    }
    if (arg === "--no-git") {
      result.git = false;
      i++;
      continue;
    }
    if (arg === "--git") {
      result.git = true;
      i++;
      continue;
    }
    if (arg === "--template" || arg === "-t") {
      const next = argv[i + 1];
      if (!next) {
        return { ...result, error: "--template requires a value" };
      }
      if (!isTemplateId(next)) {
        return {
          ...result,
          error: `Unknown template: ${next}. Valid options: recommended, minimal`,
        };
      }
      result.template = next;
      i += 2;
      continue;
    }
    if (arg.startsWith("--template=")) {
      const value = arg.slice("--template=".length);
      if (!isTemplateId(value)) {
        return {
          ...result,
          error: `Unknown template: ${value}. Valid options: recommended, minimal`,
        };
      }
      result.template = value;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      return { ...result, error: `Unknown flag: ${arg}` };
    }

    // Positional: the first non-flag argument is the target directory
    if (result.targetDir === undefined) {
      result.targetDir = arg;
      i++;
      continue;
    }

    return { ...result, error: `Unexpected argument: ${arg}` };
  }

  return result;
}

export const HELP_TEXT = `create-yage — scaffold a new YAGE game project

Usage:
  npm create yage@latest [target-dir] [options]
  npx create-yage [target-dir] [options]

Options:
  -t, --template <id>    Template to use: recommended | minimal
      --no-install       Skip \`npm install\`
      --no-git           Skip \`git init\`
  -f, --force            Overwrite non-empty target directory without prompting
  -y, --yes              Accept all defaults (CI/automation)
  -h, --help             Show this help
  -v, --version          Print version

Examples:
  npm create yage@latest my-game
  npm create yage@latest my-game -- --template minimal --yes
  npx create-yage . --template recommended --no-install
`;
