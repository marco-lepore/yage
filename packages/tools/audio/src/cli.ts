import { readFile } from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  openInstrumentModule,
  type InstrumentModule,
} from "./instrumentModule.js";
import { buildAudioBank, inspectAudioBank } from "./node.js";
import { listAudioInstruments } from "./render.js";

/** The `--instruments` module, imported through the project's own Vite. */
async function openSource(
  path: string | undefined,
): Promise<InstrumentModule | undefined> {
  return path === undefined
    ? undefined
    : openInstrumentModule(resolve(path), process.cwd());
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      instruments: { type: "string" },
      watch: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const [command, input, ...extra] = positionals;
  if (values.help || !command) {
    console.log(
      "yage-audio build <config.json> --out <directory> [--instruments <module>] [--watch]\nyage-audio inspect <manifest.json>\nyage-audio instruments [--instruments <module>]",
    );
    return;
  }
  if (extra.length) throw new Error("Unexpected positional arguments.");
  if (command === "instruments" && !input && !values.out && !values.watch) {
    const source = await openSource(values.instruments);
    try {
      console.log(listAudioInstruments(await source?.load()).join("\n"));
    } finally {
      await source?.close();
    }
    return;
  }
  if (
    command === "inspect" &&
    input &&
    !values.out &&
    !values.watch &&
    !values.instruments
  ) {
    console.log(
      JSON.stringify(await inspectAudioBank(resolve(input)), null, 2),
    );
    return;
  }
  if (command !== "build" || !input || !values.out)
    throw new Error(
      "Use build <config.json> --out <directory>, inspect <manifest.json>, or instruments.",
    );
  const configPath = resolve(input);
  const outDir = resolve(values.out);
  const source = await openSource(values.instruments);
  const build = async (): Promise<void> => {
    const config: unknown = JSON.parse(await readFile(configPath, "utf8"));
    const instruments = await source?.load();
    const manifest = await buildAudioBank(config, {
      outDir,
      ...(instruments ? { instruments } : {}),
    });
    console.log(
      `Built ${Object.keys(manifest.sounds).length} aliases in ${outDir}`,
    );
  };
  if (!values.watch) {
    try {
      await build();
    } finally {
      await source?.close();
    }
    return;
  }
  // Poll the config and every file the instrument module imports: atomic saves
  // work without consuming native watch slots. The first build reports a
  // failure like every later one, so a broken or missing file waits for a fix.
  const watched = new Set<string>();
  let running = false;
  let dirty = false;
  const rebuild = async (): Promise<void> => {
    dirty = true;
    if (running) return;
    running = true;
    while (dirty) {
      dirty = false;
      try {
        await build();
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
      // An edit can add or drop the files the module imports.
      watchFiles();
    }
    running = false;
  };
  const changed = (): void => {
    void rebuild();
  };
  const watchFiles = (): void => {
    const next = new Set([configPath, ...(source?.files ?? [])]);
    for (const file of watched) {
      if (next.has(file)) continue;
      unwatchFile(file, changed);
      watched.delete(file);
    }
    for (const file of next) {
      if (watched.has(file)) continue;
      watchFile(file, { interval: 250 }, changed);
      watched.add(file);
    }
  };
  await rebuild();
  const stop = (): void => {
    for (const file of watched) unwatchFile(file, changed);
    void source?.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(
    source
      ? `Watching ${configPath} and ${source.files.length} files of the instrument module`
      : `Watching ${configPath}`,
  );
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
