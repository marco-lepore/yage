import { readFile } from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildAudioBank, inspectAudioBank } from "./node.js";
import { listAudioInstruments } from "./render.js";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      watch: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const [command, input, ...extra] = positionals;
  if (values.help || !command) {
    console.log(
      "yage-audio build <config.json> --out <directory> [--watch]\nyage-audio inspect <manifest.json>\nyage-audio instruments",
    );
    return;
  }
  if (extra.length) throw new Error("Unexpected positional arguments.");
  if (command === "instruments" && !input && !values.out && !values.watch) {
    console.log(listAudioInstruments().join("\n"));
    return;
  }
  if (command === "inspect" && input && !values.out && !values.watch) {
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
  const build = async (): Promise<void> => {
    const config: unknown = JSON.parse(await readFile(configPath, "utf8"));
    const manifest = await buildAudioBank(config, { outDir });
    console.log(
      `Built ${Object.keys(manifest.sounds).length} aliases in ${outDir}`,
    );
  };
  await build();
  if (!values.watch) return;
  // Poll one config file: atomic saves work without consuming native watch slots.
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
    }
    running = false;
  };
  const changed = (): void => {
    void rebuild();
  };
  watchFile(configPath, { interval: 250 }, changed);
  const stop = (): void => unwatchFile(configPath, changed);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`Watching ${configPath}`);
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
