import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import type { OpenTiledOutcome } from "../../shared/protocol/index.js";

interface TiledCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly waitForExit: boolean;
}

interface TiledHost {
  readonly platform: string;
  readonly env: NodeJS.ProcessEnv;
  readonly exists: (path: string) => boolean;
}

const HOST: TiledHost = {
  platform: process.platform,
  env: process.env,
  exists: existsSync,
};

/** Select a native launcher. Map paths are always arguments, never shell text. */
export function tiledCommand(
  file: string,
  host: TiledHost = HOST,
): TiledCommand {
  const configured = host.env["YAGE_TILED_PATH"];
  if (configured)
    return { executable: configured, args: [file], waitForExit: false };
  if (host.platform === "darwin") {
    return {
      executable: "open",
      args: ["-a", "Tiled", file],
      waitForExit: true,
    };
  }
  if (host.platform === "win32") {
    for (const directory of [
      host.env["ProgramFiles"],
      host.env["ProgramFiles(x86)"],
    ]) {
      if (!directory) continue;
      const executable = win32.join(directory, "Tiled", "tiled.exe");
      if (host.exists(executable))
        return { executable, args: [file], waitForExit: false };
    }
    return { executable: "tiled.exe", args: [file], waitForExit: false };
  }
  return { executable: "tiled", args: [file], waitForExit: false };
}

/** Launch acceptance does not wait for the developer to close Tiled. */
export async function launchTiled(
  file: string,
  options: TiledHost & {
    readonly run?: (command: TiledCommand) => Promise<void>;
  } = HOST,
): Promise<OpenTiledOutcome> {
  const command = tiledCommand(file, options);
  try {
    await (options.run ?? runCommand)(command);
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Could not open Tiled: ${reason}. Install Tiled on the editor server's machine or set YAGE_TILED_PATH to its executable.`,
    };
  }
}

function runCommand(command: TiledCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args], {
      shell: false,
      detached: !command.waitForExit,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    if (command.waitForExit) {
      // `open` reports a missing application through its exit code.
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`${command.executable} exited with code ${String(code)}`),
          );
      });
    } else {
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    }
  });
}
