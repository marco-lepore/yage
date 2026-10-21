import { AssetHandle } from "@yagejs/core";

export interface SoundLoop {
  loopStart: number;
  loopEnd: number;
}
interface Registration {
  loop?: SoundLoop;
  buffer: AudioBuffer;
  owner: "runtime" | "asset";
}
const sounds = new Map<string, Registration>();

/** A decoded recording loaded by the engine's AssetManager. */
export function sound(
  path: string,
  loop?: SoundLoop,
): AssetHandle<AudioBuffer> {
  if (loop) validateLoop(path, loop);
  return new AssetHandle("sound", path, loop ? { ...loop } : undefined);
}

/** Register a generated buffer. Runtime aliases persist until unregisterSound(). */
export function registerSound(
  alias: string,
  buffer: AudioBuffer,
  loop?: SoundLoop,
): void {
  if (!alias.trim()) throw new Error("registerSound: alias must not be empty.");
  if (sounds.get(alias)?.owner === "asset")
    throw new Error(
      `registerSound("${alias}"): alias is used by a loaded sound.`,
    );
  validateBuffer(alias, buffer);
  if (loop) validateLoop(alias, loop, buffer.duration);
  sounds.set(alias, {
    buffer,
    owner: "runtime",
    ...(loop ? { loop: { ...loop } } : {}),
  });
}
export function unregisterSound(alias: string): void {
  if (sounds.get(alias)?.owner === "runtime") sounds.delete(alias);
}
/** @internal */
export function getSound(alias: string): AudioBuffer | undefined {
  return sounds.get(alias)?.buffer;
}
/** @internal */
export function registerLoadedSound(
  alias: string,
  buffer: AudioBuffer,
  loop?: SoundLoop,
): void {
  if (sounds.has(alias))
    throw new Error(`Audio asset "${alias}": alias is already registered.`);
  if (loop) validateLoop(alias, loop, buffer.duration);
  sounds.set(alias, {
    buffer,
    owner: "asset",
    ...(loop ? { loop: { ...loop } } : {}),
  });
}
/** @internal */
export function unloadSound(alias: string): void {
  if (sounds.get(alias)?.owner === "asset") sounds.delete(alias);
}
/** Test isolation. @internal */
export function clearRegisteredSounds(): void {
  sounds.clear();
}
function validateBuffer(alias: string, buffer: AudioBuffer): void {
  if (
    buffer.length < 1 ||
    !Number.isFinite(buffer.sampleRate) ||
    buffer.sampleRate <= 0
  )
    throw new Error(`registerSound("${alias}"): invalid audio buffer.`);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i]))
        throw new Error(
          `registerSound("${alias}"): non-finite sample at channel ${channel}, sample ${i}.`,
        );
    }
  }
}

/** @internal */
export function getSoundLoop(alias: string): SoundLoop | undefined {
  return sounds.get(alias)?.loop;
}

/** @internal AssetHandle metadata is untrusted at the loader boundary. */
export function parseSoundLoop(value: unknown): SoundLoop | undefined {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    !("loopStart" in value) ||
    !("loopEnd" in value)
  )
    throw new Error("sound: expected loopStart and loopEnd metadata.");
  const loop = value as SoundLoop;
  validateLoop("sound", loop);
  return { loopStart: loop.loopStart, loopEnd: loop.loopEnd };
}
function validateLoop(
  alias: string,
  loop: SoundLoop,
  duration = Infinity,
): void {
  if (
    !Number.isFinite(loop.loopStart) ||
    !Number.isFinite(loop.loopEnd) ||
    loop.loopStart < 0 ||
    loop.loopEnd <= loop.loopStart ||
    loop.loopEnd > duration
  )
    throw new Error(`Sound "${alias}": invalid sustain loop.`);
}
