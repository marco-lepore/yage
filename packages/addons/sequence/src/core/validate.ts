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
  if (
    !["number", "vector", "position", "color", "boolean", "enum"].includes(
      String(p.kind),
    )
  )
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
  if (
    typeof value === "string" &&
    [
      "linear",
      "hold",
      "easeInQuad",
      "easeOutQuad",
      "easeInOutCubic",
      "easeOutBack",
    ].includes(value)
  )
    return;
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
      "frame",
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
  const frame = object(d.frame, "frame");
  fields(frame, ["width", "height"], "frame");
  positive(frame.width, "frame.width");
  positive(frame.height, "frame.height");
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
  const unique = (value: unknown): void => {
    const id = name(value, "id");
    if (ids.has(id)) fail(id, "duplicate id");
    ids.add(id);
  };
  const time = (value: unknown): number => {
    const n = finite(value, "frame");
    if (n < 0 || n > duration) fail("frame", `must be in 0..${duration}`);
    return n;
  };
  const properties = new Set<string>();
  for (const value of list(d.tracks, "tracks")) {
    const t = object(value, "track");
    fields(t, ["id", "target", "property", "keys", "position"], "track");
    unique(t.id);
    const target = name(t.target, "track.target");
    const prop = name(t.property, "track.property");
    const defs = contracts.get(target)?.properties;
    const def = defs && Object.hasOwn(defs, prop) ? defs[prop] : undefined;
    if (!def) fail(String(t.id), `unknown property ${target}.${prop}`);
    const pair = JSON.stringify([target, prop]);
    if (properties.has(pair)) fail(String(t.id), "duplicate property track");
    properties.add(pair);
    if (def.kind === "position") {
      const p = object(t.position, `${String(t.id)}.position`);
      fields(
        p,
        p.mode === "anchored" ? ["mode", "anchor"] : ["mode"],
        "position",
      );
      if (p.mode === "anchored") {
        point(p.anchor, "anchor");
        const a = p.anchor as { x: number; y: number };
        if (a.x < 0 || a.x > 1 || a.y < 0 || a.y > 1)
          fail("anchor", "must be in 0..1");
      } else if (p.mode !== "proportional") fail("position", "unknown mode");
    } else if (t.position !== undefined)
      fail(String(t.id), "only position tracks have a mapping");
    let previous = -1;
    const keys = list(t.keys, "keys");
    if (!keys.length) fail(String(t.id), "requires a frame-zero key");
    keys.forEach((value, i) => {
      const k = object(value, "key");
      fields(k, ["id", "frame", "value", "curve"], "key");
      unique(k.id);
      const at = time(k.frame);
      if (at <= previous || (i === 0 && at !== 0))
        fail(String(k.id), "keys must start at zero and strictly increase");
      previous = at;
      validateSequenceValue(k.value, def, String(k.id));
      curve(k.curve, String(k.id));
      if ((def.kind === "boolean" || def.kind === "enum") && k.curve !== "hold")
        fail(String(k.id), "discrete properties require hold interpolation");
    });
  }
  for (const value of list(d.events, "events")) {
    const e = object(value, "event");
    fields(e, ["id", "frame", "target", "event", "payload"], "event");
    unique(e.id);
    time(e.frame);
    const target = name(e.target, "event.target");
    const event = name(e.event, "event.event");
    const defs = contracts.get(target)?.events;
    const def = defs && Object.hasOwn(defs, event) ? defs[event] : undefined;
    if (!def) fail(String(e.id), `unknown event ${target}.${event}`);
    const payload = object(e.payload, "payload");
    fields(payload, Object.keys(def), "payload");
    for (const [key, s] of Object.entries(def))
      validateSequenceValue(payload[key], s, `${String(e.id)}.${key}`);
  }
  const copy = JSON.parse(JSON.stringify(input)) as SequenceDocument;
  freeze(copy);
  return copy;
}
