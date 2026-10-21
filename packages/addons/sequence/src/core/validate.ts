import { SEQUENCE_CURVE_NAMES, SEQUENCE_PROPERTY_KINDS } from "./types.js";
import type {
  SequenceDocument,
  SequenceProperty,
  SequenceValue,
} from "./types.js";

function fail(path: string, message: string): never {
  throw new Error(`Sequence: ${path}: ${message}`);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(path, "expected a plain object");
  return value as Record<string, unknown>;
}
function fields(
  value: Record<string, unknown>,
  names: string[],
  path: string,
): void {
  for (const key of Object.keys(value))
    if (!names.includes(key)) fail(path, `unknown field ${key}`);
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}
function name(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    fail(path, "expected a nonempty string");
  return value;
}
export function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(path, `expected a finite number, got ${String(value)}`);
  return value;
}
function positive(value: unknown, path: string): number {
  const n = finite(value, path);
  if (n <= 0) fail(path, "must be > 0");
  return n;
}
function point(value: unknown, path: string): void {
  const p = object(value, path);
  fields(p, ["x", "y"], path);
  finite(p.x, `${path}.x`);
  finite(p.y, `${path}.y`);
}
function schema(value: unknown, path: string): SequenceProperty {
  const p = object(value, path);
  fields(p, p.kind === "enum" ? ["kind", "values"] : ["kind"], path);
  if (!(SEQUENCE_PROPERTY_KINDS as readonly unknown[]).includes(p.kind))
    fail(path, "unknown property kind");
  if (p.kind === "enum") {
    const values = list(p.values, path);
    if (!values.length) fail(path, "enum requires values");
    values.forEach((v) => name(v, path));
    if (new Set(values).size !== values.length)
      fail(path, "duplicate enum values");
  }
  return p as unknown as SequenceProperty;
}
export function validateSequenceValue(
  value: unknown,
  definition: SequenceProperty,
  path: string,
): asserts value is SequenceValue {
  switch (definition.kind) {
    case "position":
    case "vector":
      point(value, path);
      break;
    case "number":
      finite(value, path);
      break;
    case "color": {
      const n = finite(value, path);
      if (!Number.isInteger(n) || n < 0 || n > 0xffffff)
        fail(path, "expected RGB integer 0..0xffffff");
      break;
    }
    case "boolean":
      if (typeof value !== "boolean") fail(path, "expected boolean");
      break;
    case "enum":
      if (typeof value !== "string" || !definition.values.includes(value))
        fail(path, "unknown enum value");
      break;
  }
}
function curve(value: unknown, path: string): void {
  if ((SEQUENCE_CURVE_NAMES as readonly unknown[]).includes(value)) return;
  const c = object(value, path);
  fields(c, ["bezier"], path);
  const points = list(c.bezier, path);
  if (points.length !== 4) fail(path, "Bézier requires four controls");
  points.forEach((v, i) => {
    const n = finite(v, path);
    if ((i === 0 || i === 2) && (n < 0 || n > 1))
      fail(path, "Bézier time controls must be in 0..1");
  });
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
/** Parse and detach JSON data. The returned document is deeply frozen. */
export function parseSequence(input: unknown): SequenceDocument {
  const d = object(input, "document");
  fields(
    d,
    [
      "format",
      "version",
      "name",
      "fps",
      "duration",
      "size",
      "targets",
      "tracks",
      "events",
    ],
    "document",
  );
  if (d.format !== "yage-sequence" || d.version !== 1)
    fail("document", "unsupported format/version");
  name(d.name, "name");
  positive(d.fps, "fps");
  const duration = positive(d.duration, "duration");
  const size = object(d.size, "size");
  fields(size, ["width", "height"], "size");
  positive(size.width, "size.width");
  positive(size.height, "size.height");
  const targets = object(d.targets, "targets");
  const contracts = new Map<
    string,
    {
      properties: Record<string, SequenceProperty>;
      events: Record<string, Record<string, SequenceProperty>>;
    }
  >();
  for (const [id, value] of Object.entries(targets)) {
    name(id, "target");
    const c = object(value, id);
    fields(c, ["properties", "events"], id);
    const properties = Object.fromEntries(
      Object.entries(object(c.properties, `${id}.properties`)).map(
        ([key, v]) => [name(key, id), schema(v, `${id}.${key}`)],
      ),
    );
    const events = Object.fromEntries(
      Object.entries(object(c.events, `${id}.events`)).map(([key, v]) => [
        name(key, id),
        Object.fromEntries(
          Object.entries(object(v, `${id}.${key}`)).map(([field, def]) => [
            name(field, id),
            schema(def, `${id}.${key}.${field}`),
          ]),
        ),
      ]),
    );
    contracts.set(id, { properties, events });
  }
  const ids = new Set<string>();
  const unique = (value: unknown, path: string): void => {
    const id = name(value, `${path}.id`);
    if (ids.has(id)) fail(id, "duplicate id");
    ids.add(id);
  };
  const time = (value: unknown, path: string): number => {
    const n = finite(value, path);
    if (n < 0 || n > duration) fail(path, `must be in 0..${duration}`);
    return n;
  };
  const properties = new Set<string>();
  list(d.tracks, "tracks").forEach((value, trackIndex) => {
    const path = `tracks[${trackIndex}]`;
    const t = object(value, path);
    fields(t, ["id", "target", "property", "keys", "position"], path);
    unique(t.id, path);
    // From here the track's id names it.
    const target = name(t.target, `${String(t.id)}.target`);
    const prop = name(t.property, `${String(t.id)}.property`);
    const defs = contracts.get(target)?.properties;
    const def = defs && Object.hasOwn(defs, prop) ? defs[prop] : undefined;
    if (!def) fail(String(t.id), `unknown property ${target}.${prop}`);
    const pair = JSON.stringify([target, prop]);
    if (properties.has(pair)) fail(String(t.id), "duplicate property track");
    properties.add(pair);
    if (def.kind === "position") {
      const mapping = `${String(t.id)}.position`;
      const p = object(t.position, mapping);
      fields(p, p.mode === "anchored" ? ["mode", "anchor"] : ["mode"], mapping);
      if (p.mode === "anchored") {
        point(p.anchor, `${mapping}.anchor`);
        const a = p.anchor as { x: number; y: number };
        if (a.x < 0 || a.x > 1 || a.y < 0 || a.y > 1)
          fail(`${mapping}.anchor`, "must be in 0..1");
      } else if (p.mode !== "proportional") fail(mapping, "unknown mode");
    } else if (t.position !== undefined)
      fail(String(t.id), "only position tracks have a mapping");
    let previous = -1;
    const keys = list(t.keys, `${String(t.id)}.keys`);
    if (!keys.length) fail(String(t.id), "requires a frame-zero key");
    keys.forEach((value, i) => {
      const keyPath = `${String(t.id)}.keys[${i}]`;
      const k = object(value, keyPath);
      fields(k, ["id", "frame", "value", "curve"], keyPath);
      unique(k.id, keyPath);
      const at = time(k.frame, `${String(k.id)}.frame`);
      if (at <= previous || (i === 0 && at !== 0))
        fail(String(k.id), "keys must start at zero and strictly increase");
      previous = at;
      validateSequenceValue(k.value, def, String(k.id));
      curve(k.curve, String(k.id));
      if ((def.kind === "boolean" || def.kind === "enum") && k.curve !== "hold")
        fail(String(k.id), "discrete properties require hold interpolation");
    });
  });
  list(d.events, "events").forEach((value, eventIndex) => {
    const path = `events[${eventIndex}]`;
    const e = object(value, path);
    fields(e, ["id", "frame", "target", "event", "payload"], path);
    unique(e.id, path);
    time(e.frame, `${String(e.id)}.frame`);
    const target = name(e.target, `${String(e.id)}.target`);
    const event = name(e.event, `${String(e.id)}.event`);
    const defs = contracts.get(target)?.events;
    const def = defs && Object.hasOwn(defs, event) ? defs[event] : undefined;
    if (!def) fail(String(e.id), `unknown event ${target}.${event}`);
    const payload = object(e.payload, `${String(e.id)}.payload`);
    fields(payload, Object.keys(def), `${String(e.id)}.payload`);
    for (const [key, s] of Object.entries(def))
      validateSequenceValue(payload[key], s, `${String(e.id)}.${key}`);
  });
  const copy = JSON.parse(JSON.stringify(input)) as SequenceDocument;
  freeze(copy);
  return copy;
}
