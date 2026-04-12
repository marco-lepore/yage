import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HELP_TEXT, parseArgs } from "./argv.js";
import { runPrompts, reportFailure, reportStart, reportSuccess } from "./prompts.js";
import { scaffold } from "./scaffold.js";
import { inspectDirectory, resolveTemplatesRoot } from "./utils.js";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed.error) {
    process.stderr.write(`Error: ${parsed.error}\n\n${HELP_TEXT}`);
    return 1;
  }
  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (parsed.version) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  const templatesRoot = resolveTemplatesRoot(import.meta.url);

  const options = await runPrompts(
    {
      ...(parsed.targetDir !== undefined && { targetDirArg: parsed.targetDir }),
      ...(parsed.template !== undefined && { template: parsed.template }),
      ...(parsed.install !== undefined && { install: parsed.install }),
      ...(parsed.git !== undefined && { git: parsed.git }),
      ...(parsed.overwrite !== undefined && { overwrite: parsed.overwrite }),
      ...(parsed.yes !== undefined && { yes: parsed.yes }),
    },
    {
      inspectTarget: inspectDirectory,
      resolveTarget: (input) => resolve(process.cwd(), input),
    },
  );

  if (!options) return 1;

  reportStart(options.template, options.targetDir);

  try {
    const result = await scaffold({
      targetDir: options.targetDir,
      projectName: options.projectName,
      template: options.template,
      templatesRoot,
      overwrite: options.overwrite,
      install: options.install,
      git: options.git,
    });

    reportSuccess({
      projectName: options.projectName,
      targetDir: options.targetDir,
      installSucceeded: result.installSucceeded,
      gitSucceeded: result.gitSucceeded,
    });
    return 0;
  } catch (err) {
    reportFailure(err);
    return 1;
  }
}

function readVersion(): string {
  const pkgUrl = new URL("../package.json", import.meta.url);
  try {
    const raw = readFileSync(fileURLToPath(pkgUrl), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`Unexpected error: ${String(err)}\n`);
    process.exit(1);
  },
);
