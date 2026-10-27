import type { SynthBankNames, SynthInstrumentBank } from "./instruments.js";
import type { SynthSound } from "./types.js";

type Fields = Readonly<Record<string, (value: unknown, path: string) => void>>;
const number =
  (min: number, max: number) =>
  (v: unknown, path: string): void => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
      throw new Error(
        `${path}: expected a finite number from ${min} to ${max}, got ${String(v)}.`,
      );
  };
const choice =
  (values: readonly unknown[]) =>
  (v: unknown, path: string): void => {
    if (!values.includes(v))
      throw new Error(
        `${path}: expected one of ${values.join(", ")}, got ${String(v)}.`,
      );
  };
const seed = (v: unknown, path: string): void => {
  number(0, 0xffffffff)(v, path);
  if (!Number.isInteger(v)) throw new Error(`${path}: expected an integer.`);
};
function object(
  v: unknown,
  fields: Fields,
  path: string,
  required: string[] = [],
): void {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.getPrototypeOf(v) !== Object.prototype
  )
    throw new Error(`${path}: expected a plain object.`);
  for (const key of required)
    if (!Object.hasOwn(v, key)) throw new Error(`${path}.${key}: required.`);
  for (const [key, value] of Object.entries(v)) {
    const check = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (!check) throw new Error(`${path}.${key}: unknown field.`);
    check(value, `${path}.${key}`);
  }
}
const voice: Fields = {
  wave: choice(["sine", "square", "sawtooth", "triangle", "noise"]),
  attack: number(0, 30),
  curve: number(0, 100),
  noise: number(0, 1),
  volume: number(0, 1),
  seed,
  filter: (v, p) =>
    object(
      v,
      {
        type: choice(["lowpass", "highpass", "bandpass"]),
        frequency: number(1, 96000),
        sweepTo: number(1, 96000),
        q: number(0.001, 100),
      },
      p,
      ["type", "frequency"],
    ),
};
const patch: Fields = {
  ...voice,
  frequency: number(1, 48000),
  glideTo: number(1, 48000),
  duration: number(0.001, 30),
  delay: number(0, 30),
  seamless: choice([true, false]),
};

/**
 * Parse portable sound data. An instrument descriptor must name a definition
 * in `instruments`. Limits keep an individual preview bounded.
 */
export function parseSynthSound<
  Bank extends SynthInstrumentBank = SynthInstrumentBank,
>(value: unknown, instruments?: Bank): SynthSound<SynthBankNames<Bank>> {
  const path = "parseSynthSound";
  if (Array.isArray(value)) {
    if (!value.length || value.length > 32)
      throw new Error(`${path}: expected 1..32 layered patches.`);
    value.forEach((v, i) => object(v, patch, `${path}[${i}]`));
  } else if (value && typeof value === "object" && "instrument" in value) {
    object(
      value,
      {
        instrument: choice(
          Object.values(instruments ?? {}).map((definition) => definition.name),
        ),
        frequency: number(20, 4000),
        seed,
        volume: number(0, 1),
      },
      path,
      ["instrument"],
    );
  } else if (value && typeof value === "object" && "notes" in value) {
    object(
      value,
      {
        noteDuration: number(0.001, 30),
        noteSpacing: number(0, 30),
        voice: (v, p) => object(v, { ...voice, glideTo: number(1, 48000) }, p),
        notes: (v, p) => {
          if (!Array.isArray(v) || !v.length || v.length > 256)
            throw new Error(`${p}: expected 1..256 notes.`);
          v.forEach((note: unknown, i) => {
            if (typeof note === "number") number(0, 48000)(note, `${p}[${i}]`);
            else
              object(
                note,
                {
                  frequency: number(0, 48000),
                  duration: number(0.001, 30),
                  volume: number(0, 1),
                },
                `${p}[${i}]`,
                ["frequency"],
              );
          });
        },
      },
      path,
      ["notes"],
    );
    const jingle = value as Extract<SynthSound, { notes: unknown }>;
    const duration = Math.max(
      ...jingle.notes.map(
        (n, i) =>
          i * (jingle.noteSpacing ?? jingle.noteDuration ?? 0.16) +
          (typeof n === "number"
            ? (jingle.noteDuration ?? 0.16)
            : (n.duration ?? jingle.noteDuration ?? 0.16)),
      ),
    );
    if (duration > 60)
      throw new Error(`${path}: jingles must fit within 60 seconds.`);
  } else object(value, patch, path);
  return structuredClone(value) as SynthSound<SynthBankNames<Bank>>;
}
