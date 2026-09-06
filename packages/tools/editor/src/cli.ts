// Entry point for the `yage-editor` executable. The shebang is added at build
// time.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCli } from "./server/cli/index.js";

/**
 * Read beside the built executable, which is where the package manifest sits
 * relative to `dist/cli.js`.
 */
function readVersion(): string {
  try {
    const manifest = fileURLToPath(new URL("../package.json", import.meta.url));
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
      version?: string;
    };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// The exit code is set rather than forced: the dev command returns as soon as
// the server is listening, and the server is what keeps the process alive.
runCli(process.argv.slice(2), readVersion()).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`Unexpected error: ${String(error)}\n`);
    process.exitCode = 1;
  },
);
