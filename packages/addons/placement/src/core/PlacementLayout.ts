import { ErrorBoundary, Logger } from "@yagejs/core";
import {
  defaultParams,
  describeParams,
  prepareLevel,
  readLevel,
} from "@yagejs/level";
import type { JsonObject, LevelCatalog, LevelDocument } from "@yagejs/level";
import {
  compose,
  copy,
  corners,
  finite,
  freeze,
  inside,
  overlaps,
  pose,
  rect,
} from "./geometry.js";
import type {
  PlacedObject,
  PlacementArea,
  PlacementChange,
  PlacementCommand,
  PlacementDefinition,
  PlacementEvent,
  PlacementExecution,
  PlacementIntent,
  PlacementIssue,
  PlacementModel,
  PlacementOptions,
  PlacementPose,
  PlacementResult,
  PlacementRule,
  PlacementSnapshot,
  PlacementSocket,
} from "./types.js";

function fail(path: string, message: string): never {
  throw new Error(`Placement.${path}: ${message}`);
}
function nonnegative(value: number, path: string): void {
  finite(value, path);
  if (value < 0) fail(path, `expected a nonnegative number, got ${value}`);
}
function integer(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    fail(path, `expected a nonnegative safe integer, got ${value}`);
}
function json(value: unknown, path: string, seen = new Set<object>()): void {
  if (typeof value === "number") finite(value, path);
  else if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  )
    return;
  else if (typeof value === "object") {
    if (seen.has(value)) fail(path, "JSON must not contain cycles");
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      fail(path, "expected plain JSON data");
    seen.add(value);
    for (const [key, child] of Object.entries(value))
      json(child, `${path}.${key}`, seen);
    seen.delete(value);
  } else fail(path, `expected JSON data, got ${typeof value}`);
}
function objectJson(value: unknown, path: string): asserts value is JsonObject {
  json(value, path);
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "expected a JSON object");
}
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A layout owns durable objects and finishes. Preview never writes to it. */
export class PlacementLayout implements PlacementModel {
  readonly definitions: Readonly<Record<string, PlacementDefinition>>;
  readonly areas: Readonly<Record<string, PlacementArea>>;
  private readonly catalog: LevelCatalog;
  private readonly rules: readonly PlacementRule[];
  private readonly execution: PlacementExecution;
  private readonly limit: number;
  private state: PlacementSnapshot;
  private serial = 0;
  private busy = false;
  private validated:
    | { state: PlacementSnapshot; command: string; result: PlacementResult }
    | undefined;
  private poses:
    | { snapshot: PlacementSnapshot; values: Map<string, PlacementPose> }
    | undefined;
  private past: PlacementSnapshot[] = [];
  private future: PlacementSnapshot[] = [];
  private listeners = new Set<{
    fn: (event: PlacementEvent) => void;
    execution: PlacementExecution;
  }>();

  constructor(options: PlacementOptions) {
    this.catalog = options.catalog;
    this.execution = {
      errorBoundary: options.errorBoundary ?? new ErrorBoundary(new Logger()),
      ...(options.errorContext ? { errorContext: options.errorContext } : {}),
    };
    this.limit = options.historyLimit ?? 50;
    integer(this.limit, "historyLimit");
    this.definitions = freeze(copy(options.definitions));
    this.areas = freeze(copy(options.areas));
    this.rules = (options.rules ?? []).map((rule) => ({ ...rule }));
    const ruleIds = new Set<string>();
    for (const rule of this.rules) {
      if (!rule.id || ruleIds.has(rule.id))
        fail("rules", `duplicate or empty rule ID ${rule.id}`);
      ruleIds.add(rule.id);
    }
    for (const [type, definition] of Object.entries(this.definitions)) {
      if (!this.catalog.get(type))
        fail("definitions", `unknown catalog type ${type}`);
      if (!definition.footprint.length)
        fail(type, "footprint must contain a rectangle");
      definition.footprint.forEach((r, i) => rect(r, `${type}.footprint.${i}`));
      nonnegative(definition.clearance ?? 0, `${type}.clearance`);
      objectJson(definition.params ?? {}, `${type}.params`);
      for (const [name, params] of Object.entries(definition.variants ?? {}))
        objectJson(params, `${type}.variants.${name}`);
      for (const [name, socket] of Object.entries(definition.sockets ?? {})) {
        pose(socket.pose, `${type}.${name}`);
        if (socket.bounds) rect(socket.bounds, `${type}.${name}.bounds`);
        integer(socket.capacity ?? 1, `${type}.${name}.capacity`);
        nonnegative(socket.radius ?? 24, `${type}.${name}.radius`);
        finite(socket.priority ?? 0, `${type}.${name}.priority`);
        for (const accepted of socket.accepts ?? [])
          if (!Object.hasOwn(this.definitions, accepted))
            fail(`${type}.${name}`, `unknown accepted type ${accepted}`);
      }
    }
    const finishes: Record<string, Record<string, string>> = Object.create(
      null,
    ) as Record<string, Record<string, string>>;
    for (const [id, area] of Object.entries(this.areas)) {
      rect(area.bounds, `areas.${id}`);
      if (area.capacity !== undefined)
        integer(area.capacity, `areas.${id}.capacity`);
      finishes[id] = Object.fromEntries(
        Object.entries(area.finishes ?? {}).map(([channel, values]) => {
          if (!values.length || values.some((value) => !value))
            fail(`areas.${id}.${channel}`, "finishes need nonempty choices");
          return [channel, values[0]!];
        }),
      );
    }
    this.state = freeze({ version: 1, nextId: 1, objects: [], finishes });
  }

  get revision(): number {
    return this.serial;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  snapshot(): PlacementSnapshot {
    return this.state;
  }

  subscribe(
    fn: (event: PlacementEvent) => void,
    execution: PlacementExecution = {},
  ): () => void {
    const listener = { fn, execution };
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  preview(
    command: PlacementCommand,
    execution: PlacementExecution = {},
  ): PlacementResult {
    return this.guard(() => this.evaluate(command, execution));
  }

  commit(
    command: PlacementCommand,
    execution: PlacementExecution = {},
  ): PlacementResult {
    return this.guard(() => {
      const result = this.evaluate(command, execution);
      if (result.ok && !equal(this.state, result.after)) {
        if (this.limit)
          this.past = [...this.past, this.state].slice(-this.limit);
        this.future = [];
        this.state = result.after;
        this.serial++;
      }
      return this.publish(result, execution);
    });
  }

  undo(execution: PlacementExecution = {}): PlacementResult {
    return this.history("undo", execution);
  }
  redo(execution: PlacementExecution = {}): PlacementResult {
    return this.history("redo", execution);
  }

  /** Trusted load: validates domain invariants, bypasses gameplay rules, clears history. */
  restore(
    snapshot: PlacementSnapshot,
    execution: PlacementExecution = {},
  ): PlacementResult {
    return this.guard(() => {
      this.checkSnapshot(snapshot);
      const after = freeze(copy(snapshot));
      const result = this.check("restore", after, execution, false);
      if (result.ok) {
        this.state = after;
        this.serial++;
        this.past = [];
        this.future = [];
      }
      return this.publish(result, execution);
    });
  }

  /** Read-only; unknown IDs throw. */
  worldPose(id: string, snapshot = this.state): PlacementPose {
    return (
      this.resolvePoses(snapshot).get(id) ??
      fail("worldPose", `unknown object ${id}`)
    );
  }

  /** Uses the existing level format, schemas, entity types and hierarchy. */
  toLevelDocument(snapshot = this.state): LevelDocument {
    return {
      format: "yage-level",
      version: 1,
      id: "placement-layout",
      metadata: {},
      extensions: {},
      entities: snapshot.objects.map((item) => {
        const parent = item.attachment
          ? snapshot.objects.find((p) => p.id === item.attachment?.parent)
          : undefined;
        const socket =
          parent && item.attachment
            ? this.socket(parent.type, item.attachment.socket)
            : undefined;
        const local = socket ? compose(socket.pose, item.pose) : item.pose;
        return {
          id: item.id,
          type: item.type,
          typeVersion: this.catalog.get(item.type)!.declaration.version,
          ...(item.attachment ? { parent: item.attachment.parent } : {}),
          active: true,
          transform: {
            position: { x: local.x, y: local.y },
            rotation: local.rotation,
            scale: { x: 1, y: 1 },
          },
          params: this.params(item),
          extensions: {},
        };
      }),
    };
  }

  private params(item: PlacedObject): JsonObject {
    const definition = this.definition(item.type);
    const schema = this.catalog.get(item.type)!.declaration.params;
    return {
      ...(schema ? defaultParams(schema) : {}),
      ...definition.params,
      ...(item.variant ? definition.variants?.[item.variant] : {}),
      ...item.params,
    };
  }

  private definition(type: string): PlacementDefinition {
    if (!Object.hasOwn(this.definitions, type))
      fail("definition", `unknown type ${type}`);
    return this.definitions[type]!;
  }

  private socket(type: string, name: string): PlacementSocket | undefined {
    const sockets = this.definition(type).sockets;
    return sockets && Object.hasOwn(sockets, name) ? sockets[name] : undefined;
  }

  private guard<T>(fn: () => T): T {
    if (this.busy)
      fail(
        "operation",
        "reentrant layout operations are not allowed; rules must be pure and listeners must schedule later edits",
      );
    this.busy = true;
    try {
      return fn();
    } finally {
      this.busy = false;
    }
  }

  private invoke<T>(
    kind: string,
    execution: PlacementExecution,
    fn: () => T,
  ): T {
    let value!: T;
    (execution.errorBoundary ?? this.execution.errorBoundary)!.wrapCallback(
      () => {
        return (value = fn());
      },
      {
        ...this.execution.errorContext,
        ...execution.errorContext,
        kind: `Placement ${kind}`,
      },
    );
    return value;
  }

  private evaluate(
    command: PlacementCommand,
    execution: PlacementExecution,
  ): PlacementResult {
    // The clone detaches commands from caller mutation before any policy runs.
    json(command, "command");
    const key = JSON.stringify(command);
    if (this.validated?.state === this.state && this.validated.command === key)
      return this.withRules(this.validated.result, execution);
    const candidate = this.apply(copy(command));
    if (candidate.issues.length)
      return freeze({
        intent: command.kind,
        before: this.state,
        after: this.state,
        changes: [],
        ok: false,
        revision: this.serial,
        issues: candidate.issues,
      });
    this.checkSnapshot(candidate.state);
    const result = this.check(
      command.kind,
      freeze(candidate.state),
      execution,
      true,
      false,
    );
    this.validated = { state: this.state, command: key, result };
    return this.withRules(result, execution);
  }

  private apply(command: PlacementCommand): {
    state: PlacementSnapshot;
    issues: PlacementIssue[];
  } {
    let objects = [...this.state.objects];
    let nextId = this.state.nextId;
    let finishes = this.state.finishes;
    const issues: PlacementIssue[] = [];
    const descendants = (id: string): Set<string> => {
      const ids = new Set([id]);
      for (let i = 0; i < objects.length; i++)
        for (const item of objects)
          if (item.attachment && ids.has(item.attachment.parent))
            ids.add(item.id);
      return ids;
    };
    const allocate = (): string => {
      integer(nextId + 1, "nextId");
      return `p${nextId++}`;
    };
    const run = (action: PlacementCommand, depth: number): void => {
      if (depth > 32) fail("batch", "nesting exceeds 32");
      if (action.kind === "batch") {
        for (const child of action.commands) run(child, depth + 1);
        return;
      }
      if (action.kind === "place") {
        this.definition(action.type);
        objects.push({
          id: allocate(),
          type: action.type,
          ...action.target,
          ...(action.variant !== undefined ? { variant: action.variant } : {}),
          params: action.params ?? {},
        });
        return;
      }
      if (action.kind === "customize") {
        if (!Object.hasOwn(this.areas, action.area))
          fail("customize", `unknown area ${action.area}`);
        finishes = {
          ...finishes,
          [action.area]: { ...finishes[action.area], ...action.finishes },
        };
        return;
      }
      const item = objects.find((o) => o.id === action.id);
      if (!item) {
        issues.push({
          code: "missing-object",
          object: action.id,
          message: `Object ${action.id} no longer exists.`,
        });
        return;
      }
      if (action.kind === "modify") {
        objects = objects.map((o) => {
          if (o.id !== item.id) return o;
          const updated = { ...o, params: action.params ?? o.params };
          if (action.variant === null) delete updated.variant;
          else if (action.variant !== undefined)
            updated.variant = action.variant;
          return updated;
        });
        return;
      }
      const ids = descendants(item.id);
      if (action.kind === "remove") {
        if (ids.size > 1 && !action.cascade)
          issues.push({
            code: "has-dependents",
            object: item.id,
            message:
              "Remove attached objects first, or explicitly request cascade removal.",
          });
        else objects = objects.filter((o) => !ids.has(o.id));
        return;
      }
      if (action.kind === "move") {
        objects = objects.map((o) => {
          if (o.id === item.id) {
            const base = { ...o };
            delete base.attachment;
            return { ...base, ...action.target };
          }
          return ids.has(o.id) ? { ...o, area: action.target.area } : o;
        });
        return;
      }
      const originals = objects.filter((o) => ids.has(o.id));
      const remap = new Map(originals.map((o) => [o.id, allocate()]));
      for (const original of originals) {
        const base = { ...original, params: { ...original.params } };
        const schema = this.catalog.get(original.type)!.declaration.params;
        const effective = this.params(original);
        for (const field of schema ? describeParams(schema) : []) {
          if (field.kind !== "entityRef") continue;
          const target = effective[field.name];
          if (typeof target === "string" && remap.has(target))
            Object.defineProperty(base.params, field.name, {
              value: remap.get(target)!,
              enumerable: true,
              writable: true,
              configurable: true,
            });
        }
        delete base.attachment;
        const attachment = original.attachment;
        objects.push(
          original.id === item.id
            ? { ...base, id: remap.get(original.id)!, ...action.target }
            : {
                ...base,
                id: remap.get(original.id)!,
                area: action.target.area,
                ...(attachment
                  ? {
                      attachment: {
                        ...attachment,
                        parent: remap.get(attachment.parent)!,
                      },
                    }
                  : {}),
              },
        );
      }
    };
    run(command, 0);
    return { state: { version: 1, nextId, objects, finishes }, issues };
  }

  private checkSnapshot(snapshot: PlacementSnapshot): void {
    objectJson(snapshot, "snapshot");
    if (snapshot.version !== 1 || !Array.isArray(snapshot.objects))
      fail("snapshot", "expected version 1 and objects array");
    integer(snapshot.nextId, "snapshot.nextId");
    if (snapshot.nextId === 0)
      fail("snapshot.nextId", "expected a positive safe integer, got 0");
    const ids = new Set<string>();
    for (const item of snapshot.objects) {
      if (!/^p[1-9]\d*$/.test(item.id) || ids.has(item.id))
        fail("snapshot", `invalid or duplicate object ID ${item.id}`);
      if (Number(item.id.slice(1)) >= snapshot.nextId)
        fail("snapshot.nextId", `must exceed ${item.id}`);
      ids.add(item.id);
      this.definition(item.type);
      pose(item.pose, `snapshot.${item.id}.pose`);
      objectJson(item.params, `snapshot.${item.id}.params`);
      if (!Object.hasOwn(this.areas, item.area))
        fail("snapshot", `unknown area ${item.area}`);
    }
    objectJson(snapshot.finishes, "snapshot.finishes");
  }

  private resolvePoses(
    snapshot: PlacementSnapshot,
  ): Map<string, PlacementPose> {
    if (this.poses?.snapshot === snapshot) return this.poses.values;
    const objects = new Map(snapshot.objects.map((item) => [item.id, item]));
    const result = new Map<string, PlacementPose>();
    const active = new Set<string>();
    const visit = (item: PlacedObject): PlacementPose => {
      const cached = result.get(item.id);
      if (cached) return cached;
      if (active.has(item.id)) fail("attachments", `cycle at ${item.id}`);
      active.add(item.id);
      let world = item.pose;
      if (item.attachment) {
        const parent = objects.get(item.attachment.parent);
        if (!parent)
          fail("attachments", `missing parent ${item.attachment.parent}`);
        const socket = this.socket(parent.type, item.attachment.socket);
        if (!socket)
          fail(
            "attachments",
            `unknown socket ${item.attachment.socket} on ${parent.id}`,
          );
        world = compose(compose(visit(parent), socket.pose), item.pose);
      }
      active.delete(item.id);
      result.set(item.id, freeze({ ...world }));
      return world;
    };
    for (const item of snapshot.objects) visit(item);
    if (snapshot === this.state || snapshot === this.validated?.result.after)
      this.poses = { snapshot, values: result };
    return result;
  }

  private changes(after: PlacementSnapshot): PlacementChange[] {
    const changes: PlacementChange[] = [];
    const oldPoses = this.resolvePoses(this.state),
      newPoses = this.resolvePoses(after);
    for (const before of this.state.objects) {
      const item = after.objects.find((o) => o.id === before.id);
      if (!item) changes.push({ operation: "remove", before });
      else {
        if (
          !equal(oldPoses.get(before.id), newPoses.get(before.id)) ||
          before.area !== item.area ||
          !equal(before.attachment, item.attachment)
        )
          changes.push({ operation: "move", before, after: item });
        if (
          before.variant !== item.variant ||
          !equal(before.params, item.params)
        )
          changes.push({ operation: "modify", before, after: item });
      }
    }
    for (const item of after.objects)
      if (!this.state.objects.some((o) => o.id === item.id))
        changes.push({ operation: "place", after: item });
    for (const area of Object.keys(this.areas))
      if (!equal(this.state.finishes[area], after.finishes[area]))
        changes.push({ operation: "customize", area });
    return changes;
  }

  private check(
    intent: PlacementIntent,
    after: PlacementSnapshot,
    execution: PlacementExecution,
    policies: boolean,
    rules = policies,
  ): PlacementResult {
    const issues = this.invariants(after);
    const changes = issues.some((i) => i.code === "attachment")
      ? []
      : this.changes(after);
    const evaluation = freeze({ intent, before: this.state, after, changes });
    if (policies) {
      for (const change of changes) {
        const areas = new Set([
          change.before?.area,
          change.after?.area,
          change.area,
        ]);
        for (const area of areas)
          if (
            area &&
            this.areas[area]?.permissions?.[change.operation] === false
          )
            issues.push({
              code: "permission",
              area,
              message: `${change.operation} is not allowed in ${area}.`,
            });
      }
    }
    const result = freeze({
      ...evaluation,
      ok: issues.length === 0,
      revision: this.serial,
      issues,
    });
    return rules ? this.withRules(result, execution) : result;
  }

  private withRules(
    result: PlacementResult,
    execution: PlacementExecution,
  ): PlacementResult {
    if (!result.ok || !this.rules.length) return result;
    const issues: PlacementIssue[] = [];
    for (const rule of this.rules) {
      const found = this.invoke(`rule ${rule.id}`, execution, () =>
        rule.evaluate(result),
      );
      json(found, `rules.${rule.id}`);
      if (
        !Array.isArray(found) ||
        found.some((issue) => !issue.code || !issue.message)
      )
        fail(`rules.${rule.id}`, "expected issues with code and message");
      issues.push(...found.map((issue) => ({ ...copy(issue), rule: rule.id })));
    }
    return freeze({
      ...result,
      ok: issues.length === 0,
      revision: this.serial,
      issues,
    });
  }

  private invariants(snapshot: PlacementSnapshot): PlacementIssue[] {
    const issues: PlacementIssue[] = [];
    const add = (
      code: string,
      message: string,
      item?: PlacedObject,
      other?: string,
    ): void => {
      issues.push({
        code,
        message,
        ...(item ? { object: item.id, area: item.area } : {}),
        ...(other ? { other } : {}),
      });
    };
    const byId = new Map(snapshot.objects.map((item) => [item.id, item]));
    // Validate links before deriving transforms, so cycles are inspectable refusals.
    for (const item of snapshot.objects) {
      const seen = new Set([item.id]);
      let node = item;
      while (node.attachment) {
        const parent = byId.get(node.attachment.parent);
        if (
          !parent ||
          seen.has(parent.id) ||
          !this.socket(parent.type, node.attachment.socket)
        ) {
          add(
            "attachment",
            "Attachment is missing, cyclic, or names an unknown socket.",
            item,
          );
          break;
        }
        seen.add(parent.id);
        node = parent;
      }
    }
    if (issues.length) return issues;
    const positions = this.resolvePoses(snapshot);
    const surfaces = new Map<string, string>();
    const geometry = new Map<string, ReturnType<typeof corners>[]>();
    const clearance = new Map<string, ReturnType<typeof corners>[]>();
    const bounds = new Map<
      string,
      { left: number; top: number; right: number; bottom: number }
    >();
    for (const item of snapshot.objects) {
      const definition = this.definition(item.type),
        area = this.areas[item.area]!;
      const world = positions.get(item.id)!;
      const solid = definition.footprint.map((r) => corners(r, world));
      const padded = definition.footprint.map((r) =>
        corners(r, world, definition.clearance ?? 0),
      );
      geometry.set(item.id, solid);
      clearance.set(item.id, padded);
      const points = padded.flat();
      bounds.set(item.id, {
        left: Math.min(...points.map((p) => p.x)),
        top: Math.min(...points.map((p) => p.y)),
        right: Math.max(...points.map((p) => p.x)),
        bottom: Math.max(...points.map((p) => p.y)),
      });
      if (padded.some((points) => !inside(points, area.bounds)))
        add(
          "outside-area",
          "The footprint and its clearance must fit inside the editable area.",
          item,
        );
      if (
        area.categories &&
        !area.categories.includes(definition.category ?? "")
      )
        add(
          "category",
          `Category ${definition.category ?? "(none)"} is not allowed.`,
          item,
        );
      if (
        item.variant !== undefined &&
        !Object.hasOwn(definition.variants ?? {}, item.variant)
      )
        add("variant", `Unknown variant ${item.variant}.`, item);
      let surface = area.surface ?? "floor";
      if (item.attachment) {
        const parent = byId.get(item.attachment.parent)!;
        const socket = this.socket(parent.type, item.attachment.socket)!;
        surface = socket.surface;
        if (parent.area !== item.area)
          add(
            "attachment-area",
            "Attached objects must share their parent's area.",
            item,
            parent.id,
          );
        if (socket.accepts && !socket.accepts.includes(item.type))
          add(
            "socket-type",
            "This socket does not accept this type.",
            item,
            parent.id,
          );
        if (socket.bounds) {
          if (
            definition.footprint.some(
              (r) =>
                !inside(
                  corners(r, item.pose, definition.clearance ?? 0),
                  socket.bounds!,
                ),
            )
          )
            add(
              "socket-bounds",
              "The object must fit on its attachment surface.",
              item,
              parent.id,
            );
        } else if (item.pose.x !== 0 || item.pose.y !== 0)
          add(
            "socket-position",
            "A fixed socket requires a zero local position.",
            item,
          );
        const count = snapshot.objects.filter(
          (o) =>
            o.attachment?.parent === parent.id &&
            o.attachment.socket === item.attachment?.socket,
        ).length;
        if (count > (socket.capacity ?? 1))
          add(
            "socket-occupied",
            "The socket has no capacity for another object.",
            item,
            parent.id,
          );
      }
      surfaces.set(item.id, surface);
      if (!(definition.surfaces ?? ["floor"]).includes(surface))
        add("surface", `This object cannot attach to ${surface}.`, item);
    }
    const ancestor = (parent: string, child: PlacedObject): boolean => {
      let current = child;
      while (current.attachment) {
        if (current.attachment.parent === parent) return true;
        current = byId.get(current.attachment.parent)!;
      }
      return false;
    };
    for (let i = 0; i < snapshot.objects.length; i++) {
      const a = snapshot.objects[i]!;
      for (let j = i + 1; j < snapshot.objects.length; j++) {
        const b = snapshot.objects[j]!;
        if (
          surfaces.get(a.id) !== surfaces.get(b.id) ||
          ancestor(a.id, b) ||
          ancestor(b.id, a)
        )
          continue;
        const aBounds = bounds.get(a.id)!,
          bBounds = bounds.get(b.id)!;
        if (
          aBounds.right <= bBounds.left ||
          bBounds.right <= aBounds.left ||
          aBounds.bottom <= bBounds.top ||
          bBounds.bottom <= aBounds.top
        )
          continue;
        const intersects = (one: string, two: string): boolean =>
          clearance
            .get(one)!
            .some((pa) => geometry.get(two)!.some((pb) => overlaps(pa, pb)));
        if (intersects(a.id, b.id) || intersects(b.id, a.id))
          add(
            "occupied",
            "Objects overlap or obstruct required clearance.",
            a,
            b.id,
          );
      }
    }
    for (const [id, area] of Object.entries(this.areas)) {
      if (
        area.capacity !== undefined &&
        snapshot.objects.filter((o) => o.area === id).length > area.capacity
      )
        issues.push({
          code: "area-capacity",
          area: id,
          message: "The editable area is full.",
        });
      const values = snapshot.finishes[id];
      if (
        !values ||
        Object.entries(values).some(
          ([key, value]) =>
            !Object.hasOwn(area.finishes ?? {}, key) ||
            !area.finishes?.[key]?.includes(value),
        ) ||
        Object.keys(area.finishes ?? {}).some(
          (key) => values[key] === undefined,
        )
      )
        issues.push({
          code: "finish",
          area: id,
          message: "Unknown or missing area finish.",
        });
    }
    for (const area of Object.keys(snapshot.finishes))
      if (!Object.hasOwn(this.areas, area))
        issues.push({
          code: "finish",
          area,
          message: "Unknown area in finishes.",
        });
    const document = this.toLevelDocument(snapshot);
    const structural = readLevel(document);
    if (!structural.ok)
      for (const problem of structural.errors)
        issues.push({
          code: "level-structure",
          path: problem.path,
          message: problem.message,
        });
    else
      for (const problem of prepareLevel(structural.document, this.catalog)
        .diagnostics)
        issues.push({
          code: `level-${problem.code}`,
          object: problem.placementId,
          path: problem.path.join("."),
          message: problem.message,
        });
    return issues;
  }

  private history(
    intent: "undo" | "redo",
    execution: PlacementExecution,
  ): PlacementResult {
    return this.guard(() => {
      const source = intent === "undo" ? this.past : this.future;
      const target = source.at(-1);
      if (!target)
        return this.publish(
          freeze({
            intent,
            before: this.state,
            after: this.state,
            changes: [],
            ok: false,
            revision: this.serial,
            issues: [
              { code: "empty-history", message: `Nothing to ${intent}.` },
            ],
          }),
          execution,
        );
      // IDs are never reused by undo/redo, even after a new branch of edits.
      const after = freeze({
        ...target,
        nextId: Math.max(this.state.nextId, target.nextId),
      });
      const result = this.check(intent, after, execution, true);
      if (result.ok) {
        source.pop();
        (intent === "undo" ? this.future : this.past).push(this.state);
        this.state = after;
        this.serial++;
      }
      return this.publish(result, execution);
    });
  }

  private publish(
    result: PlacementResult,
    execution: PlacementExecution,
  ): PlacementResult {
    const completed = freeze({ ...result, revision: this.serial });
    const event: PlacementEvent = {
      kind: result.ok ? "committed" : "rejected",
      result: completed,
    };
    for (const listener of [...this.listeners])
      if (this.listeners.has(listener))
        this.invoke("listener", { ...execution, ...listener.execution }, () =>
          listener.fn(event),
        );
    return completed;
  }
}
