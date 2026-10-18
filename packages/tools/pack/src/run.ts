import { spawnSync } from "node:child_process";

/** What a command printed, and how it ended. */
export interface RunResult {
  /** `null` when the command could not be started at all. */
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run a command and wait for it. Arguments are passed as a list and no shell
 * is involved, so a path holding a space or a quote is the argument it looks
 * like. A command that is not installed comes back with a `null` status
 * rather than throwing: a missing tool is something the rules report.
 */
export function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): RunResult {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  return {
    status: result.error === undefined ? result.status : null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
