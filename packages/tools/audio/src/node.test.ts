import { afterEach, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAudioBank, inspectAudioBank } from "./node.js";
import { synthInstruments } from "@yagejs-addons/synth/instruments";
import { defineInstrument, renderNoise } from "@yagejs-addons/synth/render";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function directory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "yage-audio-"));
  dirs.push(dir);
  return dir;
}
const config = {
  version: 1,
  sampleRate: 8000,
  sounds: {
    a: { sound: { wave: "sine", duration: 0.1 } },
    b: { sound: { instrument: "kick" } },
  },
};
it("inspects files and removes only previously exported resources when selection changes", async () => {
  const outDir = await directory();
  await writeFile(join(outDir, "keep.txt"), "unrelated");
  const first = await buildAudioBank(config, { outDir });
  expect((await inspectAudioBank(join(outDir, "manifest.json"))).files).toBe(2);
  await buildAudioBank({ ...config, include: ["b"] }, { outDir });
  const remaining = await readdir(outDir);
  expect(remaining).toContain("keep.txt");
  expect(remaining).not.toContain(first.sounds.a!.file);
  expect(remaining).toContain(first.sounds.b!.file);
  const report = await inspectAudioBank(join(outDir, "manifest.json"));
  expect(report.decodedBytes).toBe(report.manifest.sounds.b!.frames * 4);
});
it("keeps an existing bank intact when a later render fails", async () => {
  const outDir = await directory();
  await buildAudioBank(config, { outDir });
  const path = join(outDir, "manifest.json");
  const before = await readFile(path, "utf8");
  await expect(
    buildAudioBank({ ...config, include: ["missing"] }, { outDir }),
  ).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe(before);
  expect((await inspectAudioBank(path)).files).toBe(2);
});
it("detects missing or modified exported bytes", async () => {
  const outDir = await directory();
  const bank = await buildAudioBank(config, { outDir });
  const path = join(outDir, bank.sounds.a!.file);
  const bytes = await readFile(path);
  bytes[bytes.length - 1] = 123;
  await writeFile(path, bytes);
  await expect(inspectAudioBank(join(outDir, "manifest.json"))).rejects.toThrow(
    "corrupt",
  );
});
it("names a leftover lock file instead of overwriting the bank", async () => {
  const outDir = await directory();
  await writeFile(join(outDir, ".yage-audio.lock"), "");
  await expect(buildAudioBank(config, { outDir })).rejects.toThrow(
    "delete the lock file once no build is running",
  );
});
it("builds a bank with a custom instrument supplied as an option", async () => {
  const outDir = await directory();
  const hiss = defineInstrument(
    "hiss",
    (_frequency, sampleRate, seed) =>
      renderNoise({ color: "pink", duration: 0.2, seed }, sampleRate),
    { pitched: false },
  );
  const manifest = await buildAudioBank(
    {
      version: 1,
      sampleRate: 8000,
      sounds: { air: { sound: { instrument: "hiss" } } },
    },
    { outDir, instruments: { ...synthInstruments, hiss } },
  );
  expect(manifest.sounds.air?.frames).toBe(1600);
  expect((await inspectAudioBank(join(outDir, "manifest.json"))).aliases).toBe(
    1,
  );
});
