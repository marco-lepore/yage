import { createServer, mergeConfig, type InlineConfig } from "vite";
import { createEditorViteConfig } from "./editorViteConfig.js";

export interface DevOptions {
  readonly cwd: string;
  readonly port: number;
  readonly open: boolean;
  readonly configFile?: string | undefined;
}

/**
 * Start the editor. Resolves once the server is listening; the server keeps the
 * process alive from there.
 *
 * The host is set here rather than inherited: a game's config may bind its dev
 * server to every interface, and the editor writes to the project's files.
 */
export async function runDev(options: DevOptions): Promise<void> {
  const editor = await createEditorViteConfig({
    cwd: options.cwd,
    env: { command: "serve", mode: "development" },
    configFile: options.configFile,
  });

  const server = await createServer(
    mergeConfig(editor.config, {
      server: {
        host: "127.0.0.1",
        port: options.port,
        open: options.open,
      },
    } satisfies InlineConfig),
  );

  await server.listen();
  process.stdout.write(`\n  yage-editor\n`);
  server.printUrls();
  process.stdout.write(
    `\n  project   ${editor.editor.projectId}\n` +
      `  root      ${editor.editor.root}\n` +
      `  config    ${editor.editor.configFile}\n` +
      `  levels    ${editor.editor.levels.map((level) => level.glob).join(", ")}\n\n`,
  );
}
