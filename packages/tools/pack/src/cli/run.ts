import path from "node:path";
import { runCheck } from "../check.js";
import { runDoctor } from "../doctor.js";
import { initText, runInit } from "../init.js";
import { writeBuildRecord } from "../record.js";
import { reportText } from "../report.js";
import { TARGETS, type Target } from "../types.js";
import { HELP_TEXT, parseArgv, type ParsedArgs } from "./argv.js";

/** Where the CLI writes, so a test reads what a run printed. */
export interface Output {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const consoleOutput: Output = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

/**
 * Run one command and return the exit code: 0 when every rule passed, 1 on a
 * failed rule or an authored error.
 */
export async function runCli(
  argv: readonly string[],
  version: string,
  output: Output = consoleOutput,
  cwd: string = process.cwd(),
): Promise<number> {
  const args = parseArgv(argv);
  if (args.error !== undefined) {
    output.err(`yage-pack: ${args.error}`);
    return 1;
  }
  if (args.version) {
    output.out(version);
    return 0;
  }
  if (args.help) {
    output.out(HELP_TEXT);
    return 0;
  }
  try {
    return await dispatch(args, output, cwd);
  } catch (error) {
    output.err(
      `yage-pack: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

async function dispatch(
  args: ParsedArgs,
  output: Output,
  cwd: string,
): Promise<number> {
  if (args.command === "init") {
    const report = runInit({
      root: cwd,
      targets: args.targets,
      ...(args.appId === undefined ? {} : { appId: args.appId }),
      ...(args.name === undefined ? {} : { name: args.name }),
      force: args.force,
    });
    output.out(initText(report));
    return 0;
  }

  if (args.command === "doctor") {
    const reports = await runDoctor({
      root: cwd,
      ...(args.targets.length === 0
        ? {}
        : { targets: args.targets.map(readTarget) }),
    });
    output.out(
      args.json
        ? JSON.stringify(reports, null, 2)
        : reports.map((report) => reportText(report)).join("\n\n"),
    );
    return reports.every((report) => report.ok) ? 0 : 1;
  }

  if (args.command === "check") {
    const target = checkTarget(args.targets);
    if (target === null) {
      // The Capacitor hook runs once per platform, the browser build
      // included, and these rules are about the native projects.
      output.out(
        `yage-pack check — ${process.env.CAPACITOR_PLATFORM_NAME ?? ""}: no rules for this platform.`,
      );
      return 0;
    }
    if (args.apps.length > 0 && target !== "electron") {
      throw new Error(
        `yage-pack check: --app reads a packaged Electron app, got --target ${target}.`,
      );
    }
    const report = await runCheck({
      root: cwd,
      target,
      release: args.release,
      ...(args.previous === undefined ? {} : { previous: args.previous }),
      ...(args.apps.length === 0
        ? {}
        : { apps: args.apps.map((app) => path.resolve(cwd, app)) }),
    });
    output.out(
      args.json ? JSON.stringify(report, null, 2) : reportText(report),
    );
    return report.ok ? 0 : 1;
  }

  const target = recordTarget(args.targets);
  const profile = readProfile(args.profile);
  if (args.artifacts.length === 0) {
    throw new Error(
      "yage-pack record: pass --artifact with the path of a file or bundle the build produced.",
    );
  }
  const { record, file } = await writeBuildRecord({
    root: cwd,
    target,
    profile,
    artifacts: args.artifacts.map((artifact) => path.resolve(cwd, artifact)),
    out: path.resolve(cwd, args.out ?? `out/yage-build-${target}.json`),
  });
  output.out(args.json ? JSON.stringify(record, null, 2) : `wrote ${file}`);
  return 0;
}

function readTarget(value: string): Target {
  const target = TARGETS.find((candidate) => candidate === value);
  if (target === undefined) {
    throw new Error(
      `--target must be electron, ios or android, got ${JSON.stringify(value)}.`,
    );
  }
  return target;
}

/**
 * The target a check runs for, or `null` for a Capacitor platform that has
 * no native project of its own. Capacitor's sync hook names the platform in
 * the environment, which is why the flag is optional inside it.
 */
function checkTarget(targets: readonly string[]): Target | null {
  if (targets.length > 0) return readOneTarget("check", targets);
  const platform = process.env.CAPACITOR_PLATFORM_NAME;
  if (platform === "ios" || platform === "android") return platform;
  if (platform === "web") return null;
  throw new Error("yage-pack check: pass --target electron, ios or android.");
}

function recordTarget(targets: readonly string[]): Target {
  if (targets.length === 0) {
    throw new Error(
      "yage-pack record: pass --target electron, ios or android.",
    );
  }
  return readOneTarget("record", targets);
}

/** `check` and `record` run for one target; a second one would go unread. */
function readOneTarget(command: string, targets: readonly string[]): Target {
  if (targets.length > 1) {
    throw new Error(
      `yage-pack ${command}: pass one --target, got ${targets.length} ` +
        `(${targets.join(", ")}). Run the command once per target.`,
    );
  }
  return readTarget(targets[0] as string);
}

function readProfile(value: string | undefined): "development" | "release" {
  if (value === "development" || value === "release") return value;
  throw new Error(
    `yage-pack record: --profile must be development or release, got ${JSON.stringify(value)}.`,
  );
}
