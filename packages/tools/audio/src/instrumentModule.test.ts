import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { flute, synthInstruments } from "@yagejs-addons/synth/instruments";
import { defineInstrument } from "@yagejs-addons/synth/render";
import { normalizePath } from "vite";
import {
  instrumentBank,
  isMissingPackage,
  openInstrumentModule,
  type InstrumentModule,
} from "./instrumentModule.js";
import { renderAudioBank } from "./render.js";

const blip = defineInstrument("blip", (_frequency, sampleRate) =>
  new Float32Array(Math.round(sampleRate * 0.05)).fill(0.5),
);

describe("instrumentBank", () => {
  it("adds the exported definitions to the built-ins and skips other exports", () => {
    const bank = instrumentBank(
      { blip, again: blip, label: "not an instrument", count: 3 },
      "instruments.ts",
    );
    expect(Object.keys(bank)).toHaveLength(
      Object.keys(synthInstruments).length + 1,
    );
    expect(bank["blip"]).toBe(blip);
    expect(bank["flute"]).toBe(flute);
  });

  it("lets an export replace the built-in of the same name", () => {
    const ownFlute = defineInstrument("flute", () => new Float32Array(8));
    expect(instrumentBank({ ownFlute }, "instruments.ts")["flute"]).toBe(
      ownFlute,
    );
  });

  it("rejects two definitions with one name and a module without one", () => {
    const other = defineInstrument("blip", () => new Float32Array(8));
    expect(() => instrumentBank({ blip, other }, "instruments.ts")).toThrow(
      'AudioBank: instruments.ts exports two instruments named "blip"',
    );
    expect(() => instrumentBank({ blip: 1 }, "instruments.ts")).toThrow(
      "AudioBank: instruments.ts exports no instrument definition",
    );
  });
});

it("recognizes Node failing to find a package by its name", () => {
  const missing = Object.assign(
    new Error("Cannot find package 'vite' imported from /game/cli.js"),
    { code: "ERR_MODULE_NOT_FOUND" },
  );
  expect(isMissingPackage(missing, "vite")).toBe(true);
  expect(isMissingPackage(missing, "vitest")).toBe(false);
  expect(isMissingPackage(new Error("'vite'"), "vite")).toBe(false);
});

describe("openInstrumentModule", () => {
  // Inside the package, so the module's bare imports resolve through the
  // workspace the way a game's resolve through its node_modules.
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });
  async function project(files: Record<string, string>): Promise<string> {
    const dir = await realpath(
      await mkdtemp(join(packageDir, ".instrument-module-")),
    );
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    for (const [name, text] of Object.entries(files))
      await writeFile(join(dir, name), text);
    return dir;
  }
  async function open(dir: string): Promise<InstrumentModule> {
    const source = await openInstrumentModule(join(dir, "instruments.ts"), dir);
    cleanup.push(() => source.close());
    return source;
  }
  const peak = async (source: InstrumentModule): Promise<number> =>
    (
      await renderAudioBank(
        {
          version: 1,
          sampleRate: 8000,
          sounds: { tone: { sound: { instrument: "tone", volume: 1 } } },
        },
        { instruments: await source.load() },
      )
    ).manifest.sounds.tone!.samplePeak;

  it("imports a module split across files and reads them again on every load", async () => {
    const dir = await project({
      // An extensionless relative import: Vite resolves it, Node does not.
      "instruments.ts": [
        'import { defineInstrument } from "@yagejs-addons/synth/render";',
        'import { LEVEL } from "./level";',
        'export const tone = defineInstrument("tone", (_frequency, sampleRate) =>',
        "  new Float32Array(Math.round(sampleRate * 0.05)).fill(LEVEL),",
        ");",
      ].join("\n"),
      "level.ts": "export const LEVEL: number = 0.5;\n",
    });
    const source = await open(dir);
    expect(await peak(source)).toBeCloseTo(0.5, 3);
    expect(source.files).toEqual(
      expect.arrayContaining([
        normalizePath(join(dir, "instruments.ts")),
        normalizePath(join(dir, "level.ts")),
      ]),
    );
    expect(source.files[0]).toBe(normalizePath(join(dir, "instruments.ts")));

    await writeFile(
      join(dir, "level.ts"),
      "export const LEVEL: number = 0.25;\n",
    );
    expect(await peak(source)).toBeCloseTo(0.25, 3);
  }, 30_000);

  it("names the module when it fails to import and keeps its files", async () => {
    const dir = await project({ "instruments.ts": "export const = ;\n" });
    const source = await open(dir);
    const error = await source.load().then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    const { message } = error as Error;
    expect(message).toMatch(/^AudioBank: failed to import instruments\.ts: \S/);
    // The cause, not the transform heading or its colour codes.
    expect(message.endsWith(":")).toBe(false);
    expect(message.includes("\u001b")).toBe(false);
    expect(source.files).toEqual([normalizePath(join(dir, "instruments.ts"))]);
  }, 30_000);

  it("opens no file watcher when the project's Vite config has a server block", async () => {
    const probe = globalThis as { yageAudioWatch?: unknown };
    delete probe.yageAudioWatch;
    const dir = await project({
      "instruments.ts": [
        'import { defineInstrument } from "@yagejs-addons/synth/render";',
        'export const tone = defineInstrument("tone", () => new Float32Array(8));',
      ].join("\n"),
      "vite.config.mjs": [
        "export default {",
        "  server: { port: 5999 },",
        "  plugins: [{",
        '    name: "watch-probe",',
        "    configResolved(config) { globalThis.yageAudioWatch = config.server.watch; },",
        "  }],",
        "};",
      ].join("\n"),
    });
    await open(dir);
    expect(probe.yageAudioWatch).toBeNull();
  }, 30_000);
});
