export type LabCommand = "dev" | "build" | "init";

export interface ParsedArgs {
  command: LabCommand;
  port?: number;
  open?: boolean;
  scenarios?: readonly string[];
  outDir?: string;
  force?: boolean;
  help: boolean;
  version: boolean;
  /** Set when argv could not be parsed. */
  error?: string;
}

export const DEFAULT_PORT = 5210;
export const DEFAULT_OUT_DIR = "dist-lab";

/** Every flag, and the field it fills. */
const FLAG_FIELDS = {
  "--port": "port",
  "--no-open": "open",
  "--scenarios": "scenarios",
  "--out-dir": "outDir",
  "--force": "force",
} as const satisfies Record<string, keyof ParsedArgs>;

type LabFlag = keyof typeof FLAG_FIELDS;

/**
 * The flags each command takes. A flag outside its command's set is the same
 * typo the unknown-flag check catches, one step later: `yage-lab build --port
 * 3000` would otherwise build quietly.
 */
const COMMAND_FLAGS = {
  dev: ["--port", "--no-open", "--scenarios"],
  build: ["--out-dir", "--scenarios"],
  init: ["--force"],
} as const satisfies Record<LabCommand, readonly LabFlag[]>;

const COMMANDS = Object.keys(COMMAND_FLAGS) as readonly LabCommand[];

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
    if (arg === "--force") {
      result.force = true;
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
    const command = COMMANDS.find((name) => name === arg);
    if (command === undefined) {
      return { ...result, error: `Unknown command: ${arg}` };
    }
    result.command = command;
    sawCommand = true;
    i++;
  }

  const allowed: readonly string[] = COMMAND_FLAGS[result.command];
  const offender = (Object.keys(FLAG_FIELDS) as LabFlag[]).find(
    (flag) => result[FLAG_FIELDS[flag]] !== undefined && !allowed.includes(flag),
  );
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
  yage-lab init [--force]       Write lab/harness.ts, prefilled from the
                                project's @yagejs/* dependencies
  yage-lab [dev] [options]      Start the scenario browser
  yage-lab build [options]      Build it as a static site

Options:
  -p, --port <n>          Dev server port (default ${DEFAULT_PORT})
      --no-open           Don't open a browser window
      --scenarios <list>  Comma-separated glob patterns, relative to the Vite
                          root (default **/*.scenario.ts). Also settable as
                          "yage-lab": { "scenarios": [...] } in package.json
      --out-dir <dir>     Build output directory (default ${DEFAULT_OUT_DIR})
      --force             Overwrite an existing lab/harness.ts
  -h, --help              Show this help
  -v, --version           Print version

The lab extends the project's own vite.config.ts, and runs every scenario
against the engine and plugins declared in lab/harness.ts.
`;
