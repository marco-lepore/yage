export type EditorCommand = "dev" | "init" | "validate";

export interface ParsedArgs {
  readonly command: EditorCommand;
  readonly port?: number | undefined;
  readonly open?: boolean | undefined;
  /** An explicit config file, overriding the probe for `editor/config.ts`. */
  readonly config?: string | undefined;
  /** `init` only: rewrite the files it would otherwise keep. */
  readonly force?: boolean | undefined;
  readonly help: boolean;
  readonly version: boolean;
  /** Set when argv could not be parsed. */
  readonly error?: string | undefined;
}

export const DEFAULT_PORT = 5211;

/**
 * The flags each command takes. A flag outside its command's set is the typo
 * the unknown-flag check catches, one step later: `yage-editor init --port
 * 3000` would otherwise write files and say nothing about the port.
 */
const COMMAND_FLAGS = {
  dev: ["--port", "--no-open", "--config"],
  init: ["--force"],
  validate: ["--config"],
} as const satisfies Record<EditorCommand, readonly string[]>;

const COMMANDS = Object.keys(COMMAND_FLAGS) as readonly EditorCommand[];

export const HELP_TEXT = `yage-editor — the YAGE level editor

Usage
  yage-editor init [--force]   Set the project up: editor/config.ts,
                               editor/harness.ts, src/levelProject.ts, and an
                               "editor" script, prefilled from the project
  yage-editor [dev] [options]  Start the editor
  yage-editor validate         Check every level file against the project's
                               entity declarations and exit non-zero when
                               anything is wrong

Options
  --port <number>   Port for the editor server (default ${DEFAULT_PORT})
  --no-open         Do not open a browser
  --config <path>   Editor config file (default editor/config.ts)
  --force           Rewrite the files init would otherwise keep
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
  let force: boolean | undefined;
  let command: EditorCommand = "dev";
  let help = false;
  let version = false;
  let sawCommand = false;
  /** Every flag read, so the command can be checked against its own set. */
  const flags: string[] = [];

  const fail = (error: string): ParsedArgs => ({
    command,
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
      flags.push(arg);
      continue;
    }
    if (arg === "--force") {
      force = true;
      flags.push(arg);
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
      flags.push("--port");
      continue;
    }
    if (arg === "--config" || arg.startsWith("--config=")) {
      const value = takeValue(argv, i, "--config");
      if (value === undefined) return fail("--config needs a file path.");
      i += value.consumed;
      config = value.text;
      flags.push("--config");
      continue;
    }
    if (arg.startsWith("-")) return fail(`Unknown option "${arg}".`);
    if (sawCommand) return fail(`Unexpected argument "${arg}".`);
    const named = COMMANDS.find((name) => name === arg);
    if (named === undefined) {
      return fail(
        `Unknown command "${arg}". Expected ${listed(COMMANDS)}; ` +
          `"yage-editor" on its own starts the editor.`,
      );
    }
    command = named;
    sawCommand = true;
  }

  const allowed: readonly string[] = COMMAND_FLAGS[command];
  const offender = flags.find((flag) => !allowed.includes(flag));
  if (offender !== undefined) {
    return fail(`${offender} is not an option of \`yage-editor ${command}\`.`);
  }

  return { command, port, open, config, force, help, version };
}

/** The command names as a sentence reads them: `a`, `b` or `c`. */
function listed(names: readonly string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1] as string}`;
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
