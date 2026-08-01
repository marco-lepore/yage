import {
  coerceControlValue,
  type ControlDef,
  type ControlSchema,
  type ControlValue,
} from "../grammar/controls.js";

/**
 * The query keys the lab owns. Control values are prefixed, so a scenario with
 * a control named `speed` or `scenario` cannot collide with them.
 */
export const URL_SCENARIO = "scenario";
export const URL_SPEED = "speed";
export const URL_PAUSED = "paused";
export const URL_CONTROL_PREFIX = "c.";

export interface LabUrlState {
  readonly scenario: string | undefined;
  /**
   * Raw parameter values keyed by control name. Turned into control values by
   * {@link controlsFromUrl}, which needs the scenario's own schema.
   */
  readonly controls: Readonly<Record<string, string>>;
  readonly speed: number | undefined;
  readonly paused: boolean | undefined;
}

export interface LabUrlWrite {
  readonly scenario: string;
  readonly controls: Readonly<Record<string, ControlValue>>;
  readonly schema: ControlSchema | undefined;
  readonly speed: number;
  readonly paused: boolean;
}

/**
 * Reads lab state out of a query string.
 *
 * A URL is typed, edited and shared by hand, so every field is optional and
 * anything unreadable is left out rather than throwing. The caller falls back
 * to what the scenario declares.
 */
export function readLabUrl(search: string): LabUrlState {
  const params = new URLSearchParams(search);
  const controls: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!key.startsWith(URL_CONTROL_PREFIX)) continue;
    const name = key.slice(URL_CONTROL_PREFIX.length);
    if (name !== "") controls[name] = value;
  }

  const speed = params.get(URL_SPEED);
  const speedValue = speed === null ? NaN : Number(speed);

  return {
    scenario: params.get(URL_SCENARIO) ?? undefined,
    controls,
    speed: Number.isFinite(speedValue) ? speedValue : undefined,
    paused: readFlag(params.get(URL_PAUSED)),
  };
}

/** Both spellings, because a URL is edited by hand. Anything else is not a flag. */
function readFlag(raw: string | null): boolean | undefined {
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return undefined;
}

/**
 * The query string for a lab state, keeping any parameter the lab does not own
 * — the page it mounts into is the project's own.
 *
 * Only a control that differs from its declared value is written, so a URL
 * carries what was actually changed and resetting a control drops it again.
 */
export function writeLabUrl(search: string, state: LabUrlWrite): string {
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) {
    if (key.startsWith(URL_CONTROL_PREFIX)) params.delete(key);
  }
  params.delete(URL_SCENARIO);
  params.delete(URL_SPEED);
  params.delete(URL_PAUSED);

  params.set(URL_SCENARIO, state.scenario);
  for (const [name, def] of Object.entries(state.schema ?? {})) {
    const value = state.controls[name];
    if (value === undefined || value === def.value) continue;
    params.set(`${URL_CONTROL_PREFIX}${name}`, String(value));
  }
  if (state.speed !== 1) params.set(URL_SPEED, String(state.speed));
  if (state.paused) params.set(URL_PAUSED, "1");

  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/** One raw parameter, or `undefined` when it does not fit the control. */
function parseControlValue(
  def: ControlDef,
  raw: string,
): ControlValue | undefined {
  if (def.kind === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return undefined;
  }
  if (def.kind === "select") {
    return def.options.includes(raw) ? raw : undefined;
  }
  if (raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return coerceControlValue(def, value);
}

/**
 * The control values a URL carries, keyed by name. Names the schema does not
 * declare and values it cannot take are dropped, so the result is safe to
 * merge over the declared defaults.
 */
export function controlsFromUrl(
  schema: ControlSchema | undefined,
  raw: Readonly<Record<string, string>>,
): Record<string, ControlValue> {
  const values: Record<string, ControlValue> = {};
  for (const [name, def] of Object.entries(schema ?? {})) {
    const text = raw[name];
    if (text === undefined) continue;
    const value = parseControlValue(def, text);
    if (value !== undefined) values[name] = value;
  }
  return values;
}
