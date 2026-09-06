import { DEFAULT_PORT, HELP_TEXT, parseArgs } from "./argv.js";
import { runDev } from "./dev.js";
import { runInit } from "./init.js";
import { runValidate } from "./validate.js";

/**
 * The `yage-editor` command. Returns the process exit code.
 *
 * A failure here — no config, a config that does not load, a project Vite
 * config that throws — ends the command instead of starting a server on
 * guessed settings. `validate` returns its own code, because a run that found
 * problems is a report rather than a failure of the command.
 */
export async function runCli(
  argv: readonly string[],
  version: string,
): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.error !== undefined) {
    process.stderr.write(`Error: ${parsed.error}\n\n${HELP_TEXT}`);
    return 1;
  }
  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (parsed.version) {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  try {
    if (parsed.command === "init") {
      await runInit({ cwd: process.cwd(), force: parsed.force ?? false });
      return 0;
    }
    if (parsed.command === "validate") {
      return await runValidate({
        cwd: process.cwd(),
        configFile: parsed.config,
      });
    }
    await runDev({
      cwd: process.cwd(),
      port: parsed.port ?? DEFAULT_PORT,
      open: parsed.open ?? true,
      configFile: parsed.config,
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\nError: ${message}\n`);
    return 1;
  }
}
