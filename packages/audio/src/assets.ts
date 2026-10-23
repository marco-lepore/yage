import { AssetHandle } from "@yagejs/core";

/**
 * Playback metadata stored with a sound. Loop points are seconds in the
 * recording and apply when `play` sets `loop: true`; set both or neither.
 */
export interface SoundMetadata {
  /** Sustain loop start in seconds. */
  loopStart?: number;
  /** Sustain loop end in seconds. */
  loopEnd?: number;
  /** MIDI pitch the recording sounds at its original rate (60 is middle C). */
  rootNote?: number;
}
interface Registration {
  metadata: SoundMetadata;
  buffer: AudioBuffer;
  owner: "runtime" | "asset";
  /** Engines that hold this loaded file. A runtime sound has none. */
  holders: number;
}
const sounds = new Map<string, Registration>();

/** A decoded recording loaded by the engine's AssetManager. */
export function sound(
  path: string,
  metadata?: SoundMetadata,
): AssetHandle<AudioBuffer> {
  if (metadata) validateMetadata(path, metadata);
  return new AssetHandle(
    "sound",
    path,
    metadata ? copyMetadata(metadata) : undefined,
  );
}

/** Register a generated buffer. Runtime aliases persist until unregisterSound(). */
export function registerSound(
  alias: string,
  buffer: AudioBuffer,
  metadata: SoundMetadata = {},
): void {
  if (!alias.trim()) throw new Error("registerSound: alias must not be empty.");
  if (sounds.get(alias)?.owner === "asset")
    throw new Error(
      `registerSound("${alias}"): alias is used by a loaded sound.`,
    );
  validateBuffer(alias, buffer);
  validateMetadata(alias, metadata, buffer.duration);
  sounds.set(alias, {
    buffer,
    owner: "runtime",
    metadata: copyMetadata(metadata),
    holders: 0,
  });
}
/** Remove a sound added with `registerSound`. Loaded assets are unaffected. */
export function unregisterSound(alias: string): void {
  if (sounds.get(alias)?.owner === "runtime") sounds.delete(alias);
}
/** @internal */
export function getSound(alias: string): AudioBuffer | undefined {
  return sounds.get(alias)?.buffer;
}
/**
 * Register a decoded file for one engine and return the buffer every engine
 * plays. Engines that load the same file share the first decode; the file
 * stays registered until each of them unloads it. @internal
 */
export function registerLoadedSound(
  alias: string,
  buffer: AudioBuffer,
  metadata: SoundMetadata = {},
): AudioBuffer {
  validateMetadata(alias, metadata, buffer.duration);
  const copy = copyMetadata(metadata);
  const existing = sounds.get(alias);
  if (existing?.owner === "runtime")
    throw new Error(
      `Audio asset "${alias}": alias is already registered with registerSound().`,
    );
  if (existing) {
    if (!sameMetadata(existing.metadata, copy))
      throw new Error(
        `Audio asset "${alias}": another engine loaded this file with metadata ${JSON.stringify(existing.metadata)}, not ${JSON.stringify(copy)}. Load it with the same metadata.`,
      );
    existing.holders++;
    return existing.buffer;
  }
  sounds.set(alias, { buffer, owner: "asset", metadata: copy, holders: 1 });
  return buffer;
}
/** Release one engine's hold on a loaded file. @internal */
export function unloadSound(alias: string): void {
  const registration = sounds.get(alias);
  if (registration?.owner !== "asset") return;
  registration.holders--;
  if (registration.holders === 0) sounds.delete(alias);
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

/** @internal A copy of the metadata registered under `alias`. */
export function getSoundMetadata(alias: string): SoundMetadata | undefined {
  const registration = sounds.get(alias);
  return registration && copyMetadata(registration.metadata);
}

/** @internal AssetHandle metadata is untrusted at the loader boundary. */
export function parseSoundMetadata(value: unknown): SoundMetadata {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("sound: expected a metadata object.");
  const metadata = value as SoundMetadata;
  validateMetadata("sound", metadata);
  return copyMetadata(metadata);
}
function validateMetadata(
  alias: string,
  metadata: SoundMetadata,
  duration = Infinity,
): void {
  const { loopStart, loopEnd, rootNote } = metadata;
  if (loopStart !== undefined || loopEnd !== undefined) {
    if (
      loopStart === undefined ||
      loopEnd === undefined ||
      !Number.isFinite(loopStart) ||
      !Number.isFinite(loopEnd) ||
      loopStart < 0 ||
      loopEnd <= loopStart ||
      loopEnd > duration
    )
      throw new Error(`Sound "${alias}": invalid sustain loop.`);
  }
  if (
    rootNote !== undefined &&
    (!Number.isFinite(rootNote) || rootNote < 0 || rootNote > 127)
  )
    throw new Error(
      `Sound "${alias}": rootNote must be a MIDI pitch from 0 to 127, got ${rootNote}.`,
    );
}
function sameMetadata(a: SoundMetadata, b: SoundMetadata): boolean {
  return (
    a.loopStart === b.loopStart &&
    a.loopEnd === b.loopEnd &&
    a.rootNote === b.rootNote
  );
}
function copyMetadata(metadata: SoundMetadata): SoundMetadata {
  return {
    ...(metadata.loopStart === undefined
      ? {}
      : { loopStart: metadata.loopStart, loopEnd: metadata.loopEnd! }),
    ...(metadata.rootNote === undefined ? {} : { rootNote: metadata.rootNote }),
  };
}
