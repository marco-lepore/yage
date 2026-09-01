export interface ParsedArgs {
  readonly command: "dev";
  readonly port?: number | undefined;
  readonly open?: boolean | undefined;
  /** An explicit config file, overriding the probe for `editor/config.ts`. */
  readonly config?: string | undefined;
  readonly help: boolean;
  readonly version: boolean;
  /** Set when argv could not be parsed. */
  readonly error?: string | undefined;
}

export const DEFAULT_PORT = 5211;

export const HELP_TEXT = `yage-editor — the YAGE level editor

Usage
  yage-editor [dev] [options]

Options
  --port <number>   Port for the editor server (default ${DEFAULT_PORT})
  --no-open         Do not open a browser
  --config <path>   Editor config file (default editor/config.ts)
  -h, --help        Show this help
  -v, --version     Show the package version
`;

/**
 * Parse an argv slice with node and the script path removed.
 *
 * An unknown flag is an error rather than a default, so a typo cannot start a
 * server against a different project than the one that was asked for.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let port: number | undefined;
  let open: boolean | undefined;
  let config: string | undefined;
  let help = false;
  let version = false;
  let sawCommand = false;

  const fail = (error: string): ParsedArgs => ({
    command: "dev",
    help,
    version,
    error,
  });

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;

    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      version = true;
      continue;
    }
    if (arg === "--no-open") {
      open = false;
      continue;
    }
    if (arg === "--port" || arg.startsWith("--port=")) {
      const value = takeValue(argv, i, "--port");
      if (value === undefined) return fail("--port needs a port number.");
      i += value.consumed;
      const parsed = Number(value.text);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return fail(`"${value.text}" is not a port number.`);
      }
      port = parsed;
      continue;
    }
    if (arg === "--config" || arg.startsWith("--config=")) {
      const value = takeValue(argv, i, "--config");
      if (value === undefined) return fail("--config needs a file path.");
      i += value.consumed;
      config = value.text;
      continue;
    }
    if (arg.startsWith("-")) return fail(`Unknown option "${arg}".`);
    if (arg === "dev" && !sawCommand) {
      sawCommand = true;
      continue;
    }
    return fail(`Unknown command "${arg}". The editor runs as "yage-editor".`);
  }

  return { command: "dev", port, open, config, help, version };
}

/**
 * The value of `--flag value` or `--flag=value`, and how many extra argv
 * entries it took. An empty value counts as missing: `--config=` would
 * otherwise name the project directory.
 */
function takeValue(
  argv: readonly string[],
  index: number,
  flag: string,
): { text: string; consumed: number } | undefined {
  const arg = argv[index] as string;
  if (arg.startsWith(`${flag}=`)) {
    const text = arg.slice(flag.length + 1);
    return text.length > 0 ? { text, consumed: 0 } : undefined;
  }
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("-")) return undefined;
  return { text: next, consumed: 1 };
}
