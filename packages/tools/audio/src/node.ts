import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  open,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { parseSoundBankManifest } from "@yagejs/audio";
import type { SoundBankManifest } from "@yagejs/audio";
import { renderAudioBank } from "./render.js";

export interface AudioBankBuildOptions {
  outDir: string;
}
export interface AudioBankInspection {
  manifest: SoundBankManifest;
  aliases: number;
  files: number;
  wavBytes: number;
  /** Mono float32 bytes at the source sample rate, excluding decoder overhead. */
  decodedBytes: number;
}
/** Render before writing. Replace the manifest last, then remove obsolete bank files. */
export async function buildAudioBank(
  input: unknown,
  options: AudioBankBuildOptions,
): Promise<SoundBankManifest> {
  if (!options.outDir.trim())
    throw new Error("buildAudioBank: outDir must not be empty.");
  const bank = await renderAudioBank(input);
  await mkdir(options.outDir, { recursive: true });
  const lockPath = join(options.outDir, ".yage-audio.lock");
  const lock = await open(lockPath, "wx");
  const manifestPath = join(options.outDir, "manifest.json");
  const temporary = join(options.outDir, `.manifest-${randomUUID()}.json`);
  try {
    const previous = await readManifestIfPresent(manifestPath);
    for (const file of bank.files) {
      const path = join(options.outDir, file.file);
      try {
        await writeFile(path, file.data, { flag: "wx" });
      } catch (error) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "EEXIST"
          )
        )
          throw error;
        if (!(await readFile(path)).equals(file.data))
          throw new Error(
            `AudioBank: existing resource ${file.file} is corrupt.`,
            { cause: error },
          );
      }
    }
    await writeFile(temporary, `${JSON.stringify(bank.manifest, null, 2)}\n`);
    await rename(temporary, manifestPath);
    const current = new Set(bank.files.map((f) => f.file));
    for (const file of new Set(
      Object.values(previous?.sounds ?? {}).map((s) => s.file),
    )) {
      if (/^[a-f0-9]{64}\.wav$/.test(file) && !current.has(file))
        await unlink(join(options.outDir, file)).catch(ignoreMissing);
    }
    return bank.manifest;
  } finally {
    await unlink(temporary).catch(ignoreMissing);
    await lock.close();
    await unlink(lockPath);
  }
}
/** Inspect exported files as well as metadata; reject missing or changed resources. */
export async function inspectAudioBank(
  manifestPath: string,
): Promise<AudioBankInspection> {
  const manifest = parseSoundBankManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  const files = new Map<string, { frames: number; bytes: number }>();
  for (const entry of Object.values(manifest.sounds)) {
    const previous = files.get(entry.file);
    if (
      previous &&
      (previous.frames !== entry.frames || previous.bytes !== entry.bytes)
    )
      throw new Error(`AudioBank: conflicting metadata for ${entry.file}.`);
    files.set(entry.file, entry);
  }
  for (const [file, entry] of files) {
    const data = await readFile(join(dirname(manifestPath), file));
    const hash = createHash("sha256").update(data).digest("hex");
    if (
      file !== `${hash}.wav` ||
      data.length !== entry.bytes ||
      data.length !== 44 + entry.frames * 2 ||
      data.readUInt32LE(24) !== manifest.sampleRate ||
      data.toString("ascii", 0, 4) !== "RIFF" ||
      data.toString("ascii", 8, 16) !== "WAVEfmt " ||
      data.readUInt16LE(20) !== 1 ||
      data.readUInt16LE(22) !== 1 ||
      data.readUInt16LE(34) !== 16 ||
      data.toString("ascii", 36, 40) !== "data" ||
      data.readUInt32LE(40) !== entry.frames * 2
    )
      throw new Error(`AudioBank: corrupt resource ${file}.`);
  }
  return {
    manifest,
    aliases: Object.keys(manifest.sounds).length,
    files: files.size,
    wavBytes: [...files.values()].reduce((n, f) => n + f.bytes, 0),
    decodedBytes: [...files.values()].reduce((n, f) => n + f.frames * 4, 0),
  };
}
async function readManifestIfPresent(
  path: string,
): Promise<SoundBankManifest | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    ignoreMissing(error);
    return undefined;
  }
  return parseSoundBankManifest(JSON.parse(text) as unknown);
}
function ignoreMissing(error: unknown): void {
  if (
    !(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
  )
    throw error;
}
