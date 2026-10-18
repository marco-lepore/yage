import { parseArgs } from "node:util";

export type PackCommand = "init" | "doctor" | "check" | "record";

export interface ParsedArgs {
  readonly command: PackCommand;
  readonly targets: readonly string[];
  readonly appId?: string | undefined;
  readonly name?: string | undefined;
  readonly force: boolean;
  readonly release: boolean;
  readonly json: boolean;
  readonly apps: readonly string[];
  readonly previous?: string | undefined;
  readonly profile?: string | undefined;
  readonly artifacts: readonly string[];
  readonly out?: string | undefined;
  readonly help: boolean;
  readonly version: boolean;
  /** Set when argv could not be parsed. */
  readonly error?: string | undefined;
}

/**
 * The flags each command takes. A flag outside its command's set is an
 * error: `yage-pack doctor --release` would otherwise check nothing it was
 * asked for and say so nowhere.
 */
const COMMAND_FLAGS = {
  init: ["target", "app-id", "name", "force"],
  doctor: ["target", "json"],
  check: ["target", "release", "app", "previous", "json"],
  record: ["target", "profile", "artifact", "out", "json"],
} as const satisfies Record<PackCommand, readonly string[]>;

const COMMANDS = Object.keys(COMMAND_FLAGS) as readonly PackCommand[];

export const HELP_TEXT = `yage-pack — package a YAGE game with Electron Forge and Capacitor

Usage
  yage-pack init --target <electron|ios|android>... [--app-id <id>] [--name <name>] [--force]
  yage-pack doctor [--target <electron|ios|android>]... [--json]
  yage-pack check [--target <electron|ios|android>] [--release] [--app <path>]... [--previous <record.json>] [--json]
  yage-pack record --target <electron|ios|android> --profile <development|release> --artifact <path>... [--out <file>] [--json]

Options
  --target <name>     The packaging target; repeat it for more than one
  --app-id <id>       The app's reverse-domain identifier, such as com.example.mygame
  --name <name>       The app's display name
  --force             Rewrite the files init would otherwise keep
  --release           Also run the rules a release has to pass
  --app <path>        A packaged Electron app to read the fuse wire from
  --previous <file>   The build record of the last release
  --profile <name>    development or release
  --artifact <path>   A file or bundle the build produced; repeat it for more
  --out <file>        Where the build record is written
  --json              Print the report as JSON
  -h, --help          Show this help
  -v, --version       Show the package version
`;

const OPTIONS = {
  target: { type: "string", multiple: true },
  "app-id": { type: "string" },
  name: { type: "string" },
  force: { type: "boolean" },
  release: { type: "boolean" },
  app: { type: "string", multiple: true },
  previous: { type: "string" },
  profile: { type: "string" },
  artifact: { type: "string", multiple: true },
  out: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

const EMPTY: Omit<ParsedArgs, "command" | "error"> = {
  targets: [],
  force: false,
  release: false,
  json: false,
  apps: [],
  artifacts: [],
  help: false,
  version: false,
};

/** Parse an argv slice with node and the script path removed. */
export function parseArgv(argv: readonly string[]): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    return {
      ...EMPTY,
      command: "doctor",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const values = parsed.values;
  const help = values.help === true;
  const version = values.version === true;
  const [named, ...extra] = parsed.positionals;
  if (extra.length > 0) {
    return {
      ...EMPTY,
      command: "doctor",
      help,
      version,
      error: `Unexpected argument "${extra[0] as string}".`,
    };
  }
  if (named === undefined) {
    return {
      ...EMPTY,
      command: "doctor",
      help,
      version,
      ...(help || version
        ? {}
        : { error: `Pass a command: ${listed(COMMANDS)}.` }),
    };
  }
  const command = COMMANDS.find((candidate) => candidate === named);
  if (command === undefined) {
    return {
      ...EMPTY,
      command: "doctor",
      help,
      version,
      error: `Unknown command "${named}". Expected ${listed(COMMANDS)}.`,
    };
  }

  const allowed: readonly string[] = COMMAND_FLAGS[command];
  const used = Object.keys(values).filter(
    (flag) => flag !== "help" && flag !== "version",
  );
  const offender = used.find((flag) => !allowed.includes(flag));
  if (offender !== undefined) {
    return {
      ...EMPTY,
      command,
      help,
      version,
      error: `--${offender} is not an option of \`yage-pack ${command}\`.`,
    };
  }

  return {
    command,
    targets: values.target ?? [],
    appId: values["app-id"],
    name: values.name,
    force: values.force === true,
    release: values.release === true,
    json: values.json === true,
    apps: values.app ?? [],
    previous: values.previous,
    profile: values.profile,
    artifacts: values.artifact ?? [],
    out: values.out,
    help,
    version,
  };
}

/** The command names as a sentence reads them: `a`, `b` or `c`. */
function listed(names: readonly string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1] as string}`;
}
