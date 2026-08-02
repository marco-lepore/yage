import { createServer, mergeConfig, type InlineConfig } from "vite";
import pc from "picocolors";
import { createLabConfig } from "./labConfig.js";
import { describeProject } from "./report.js";

export interface DevOptions {
  cwd: string;
  port: number;
  open: boolean;
  scenarios?: readonly string[] | undefined;
}

/**
 * Starts the scenario browser. Resolves once the server is listening; the
 * server keeps the process alive from there.
 */
export async function runDev(opts: DevOptions): Promise<void> {
  const lab = await createLabConfig({
    cwd: opts.cwd,
    env: { command: "serve", mode: "development" },
    scenarios: opts.scenarios,
  });

  const server = await createServer(
    mergeConfig(lab.config, {
      // The lab page is generated, so Vite must not answer `/` with an
      // index.html of the project's own.
      appType: "custom",
      server: { port: opts.port, open: opts.open },
    } satisfies InlineConfig),
  );

  await server.listen();
  process.stdout.write(`\n  ${pc.green("yage-lab")} ${pc.dim("dev")}\n`);
  server.printUrls();
  process.stdout.write(describeProject(lab));
}
