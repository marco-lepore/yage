import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import {
  DEFAULT_OUT_DIR,
  DEFAULT_PORT,
  HELP_TEXT,
  parseArgs,
} from "./cli/argv.js";
import { runBuild } from "./cli/build.js";
import { runDev } from "./cli/dev.js";

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

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

  const cwd = process.cwd();
  try {
    if (parsed.command === "build") {
      await runBuild({
        cwd,
        outDir: parsed.outDir ?? DEFAULT_OUT_DIR,
        scenarios: parsed.scenarios,
      });
    } else {
      await runDev({
        cwd,
        port: parsed.port ?? DEFAULT_PORT,
        open: parsed.open ?? true,
        scenarios: parsed.scenarios,
      });
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n${pc.red("Error:")} ${message}\n`);
    return 1;
  }
}

function readVersion(): string {
  const pkgUrl = new URL("../package.json", import.meta.url);
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// The exit code is set rather than forced: `dev` returns as soon as the server
// is listening, and the server is what keeps the process alive after that.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`Unexpected error: ${String(error)}\n`);
    process.exitCode = 1;
  },
);
