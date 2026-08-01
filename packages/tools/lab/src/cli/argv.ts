export type LabCommand = "dev" | "build";

export interface ParsedArgs {
  command: LabCommand;
  port?: number;
  open?: boolean;
  scenarios?: readonly string[];
  outDir?: string;
  help: boolean;
  version: boolean;
  /** Set when argv could not be parsed. */
  error?: string;
}

export const DEFAULT_PORT = 5210;
export const DEFAULT_OUT_DIR = "dist-lab";

function splitPatterns(value: string): readonly string[] {
  return value
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

/**
 * Parses an argv slice with node and the script path already removed.
 * Unknown flags are rejected so a typo does not silently run the defaults.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = { command: "dev", help: false, version: false };
  let sawCommand = false;
  let i = 0;

  const takeValue = (flag: string): string | undefined => {
    const arg = argv[i] as string;
    if (arg.startsWith(`${flag}=`)) {
      i++;
      return arg.slice(flag.length + 1);
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("-")) return undefined;
    i += 2;
    return next;
  };

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
    if (arg === "--no-open") {
      result.open = false;
      i++;
      continue;
    }
    if (arg === "--port" || arg === "-p" || arg.startsWith("--port=")) {
      const value = takeValue(arg.startsWith("--port=") ? "--port" : arg);
      if (value === undefined) return { ...result, error: "--port requires a value" };
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { ...result, error: `Invalid port: ${value}` };
      }
      result.port = port;
      continue;
    }
    if (arg === "--scenarios" || arg.startsWith("--scenarios=")) {
      const value = takeValue("--scenarios");
      if (value === undefined) {
        return { ...result, error: "--scenarios requires a value" };
      }
      const patterns = splitPatterns(value);
      if (patterns.length === 0) {
        return { ...result, error: "--scenarios requires at least one pattern" };
      }
      result.scenarios = patterns;
      continue;
    }
    if (arg === "--out-dir" || arg.startsWith("--out-dir=")) {
      const value = takeValue("--out-dir");
      if (value === undefined) {
        return { ...result, error: "--out-dir requires a value" };
      }
      result.outDir = value;
      continue;
    }
    if (arg.startsWith("-")) {
      return { ...result, error: `Unknown flag: ${arg}` };
    }

    if (sawCommand) {
      return { ...result, error: `Unexpected argument: ${arg}` };
    }
    if (arg !== "dev" && arg !== "build") {
      return { ...result, error: `Unknown command: ${arg}` };
    }
    result.command = arg;
    sawCommand = true;
    i++;
  }

  // A flag the command ignores is the same typo the checks above catch, one
  // step later: `yage-lab build --port 3000` would otherwise build quietly.
  const misplaced: string[] = [];
  if (result.command === "build") {
    if (result.port !== undefined) misplaced.push("--port");
    if (result.open !== undefined) misplaced.push("--no-open");
  } else if (result.outDir !== undefined) {
    misplaced.push("--out-dir");
  }
  const offender = misplaced[0];
  if (offender !== undefined) {
    return {
      ...result,
      error: `${offender} is not an option of \`yage-lab ${result.command}\``,
    };
  }

  return result;
}

export const HELP_TEXT = `yage-lab — scenario browser for YAGE games

Usage:
  yage-lab [dev] [options]      Start the scenario browser
  yage-lab build [options]      Build it as a static site

Options:
  -p, --port <n>          Dev server port (default ${DEFAULT_PORT})
      --no-open           Don't open a browser window
      --scenarios <list>  Comma-separated glob patterns, relative to the Vite
                          root (default **/*.scenario.ts). Also settable as
                          "yage-lab": { "scenarios": [...] } in package.json
      --out-dir <dir>     Build output directory (default ${DEFAULT_OUT_DIR})
  -h, --help              Show this help
  -v, --version           Print version

The lab extends the project's own vite.config.ts, and runs every scenario
against the engine and plugins declared in lab/harness.ts.
`;
