# YAGE — Recipes Plan

> **Status:** Internal planning doc, not user-facing. Snapshot of design intent; some sections are shipped, others deferred. Cross-reference actual package source before quoting any API from here.
>
> - **Shipped (0.2.0):** scene transitions (fade/flash/crossFade currently live in `@yagejs/renderer` under `src/transitions/`, paired with core scene-stack hooks — the "Section 2" plan below framed this as `@yagejs/transitions`, which remains a possible future extraction but is not a separate package today), save/load v0 (snapshot-based in `@yagejs/save`), input remapping (`@yagejs/input` action maps + remap APIs).
> - **Deferred:** save/load contributor-scoped model (current impl is snapshot-based), the Wave-1 recipe catalog (character controller, checkpoints, interaction kit, etc.).

## Purpose

This document tracks reusable "recipes" we want to provide for real-world games, plus the implementation approach for adjacent infrastructure work (`@yagejs/input` remapping, scene transitions, save/load).

The goal is to keep the high-level API short for simple games while preserving a structured path for larger codebases.

---

## Design Goals

1. **Simple first**: default APIs should solve common cases with minimal syntax.
2. **Structured growth**: larger projects should have clear extension points (contributors, registries, services).
3. **No plugin inflation**: not every reusable pattern should be an engine plugin.
4. **Composable by default**: recipes should be regular components/services/functions, easy to modify or fork.

---

## Boundary: Engine vs Base Plugin vs Recipe

| Layer | Put features here when... | Examples |
|---|---|---|
| **Core engine** | Requires lifecycle guarantees, scheduler/scene semantics, or global events that all plugins depend on | Transition-safe scene operation queue, scene lifecycle events |
| **Base plugin (`@yagejs/*`)** | Cross-project infrastructure with stable contracts and external integration points | Input remapping/profile support, transition effects renderer, save/load service |
| **Recipe** | Reusable game logic/patterns that compose existing APIs without new engine primitives | Character controller, checkpoints, interaction system, spawn director |

---

## Planned Base-Plugin Work

### 1. Input Remapping (`@yagejs/input`)

**Problem solved**: user-rebindable controls, per-profile bindings, conflict-aware remapping.

**Target API**

```ts
export type InputConflictPolicy = "replace" | "keep-both" | "reject";

export interface InputProfile {
  id: string;
  actions: Record<string, string[]>;
  metadata?: Record<string, unknown>;
}

export interface RebindOptions {
  slot?: number;
  conflict?: InputConflictPolicy;
}

export interface InputManager {
  loadProfile(profile: InputProfile, opts?: { merge?: boolean }): void;
  exportProfile(id?: string): InputProfile;
  getBindings(action: string): readonly string[];
  rebind(action: string, key: string, opts?: RebindOptions): {
    ok: boolean;
    reason?: "conflict" | "unknown-action";
  };
  resetBindings(action?: string): void;
}
```

**Implementation notes**

- Keep existing action map as runtime source of truth.
- Add default bindings snapshot for reset behavior.
- Add deterministic conflict handling policy.
- Keep `InputManager` API valid for current simple usage (`setActionMap` stays supported).

### 2. Scene Transitions (`@yagejs/transitions` + small core hooks)

**Problem solved**: visual transitions (fade/wipe/etc.) with safe scene stack operations and no race conditions.

**Target API**

```ts
export type SceneOp =
  | { kind: "push"; scene: Scene }
  | { kind: "replace"; scene: Scene }
  | { kind: "pop" };

export interface TransitionOptions {
  effect?: string;
  durationMs?: number;
  blockInput?: boolean;
}

export interface TransitionService {
  run(op: SceneOp, opts?: TransitionOptions): Promise<void>;
}
```

**Implementation notes**

- Add a queue/lock in scene operation flow (core) so transitions serialize scene ops.
- Emit explicit transition lifecycle events for plugin/UI hooks.
- Keep visuals in `@yagejs/transitions`; core only provides ordering guarantees.

### 3. Save/Load (`@yagejs/save`)

**Problem solved**: persistent player/profile data and run/scene snapshots, without forcing one monolithic save model.

**Target API**

```ts
export type SaveScope = "settings" | "profile" | "run";

export interface SaveContributor<T = unknown> {
  id: string;
  scope: SaveScope;
  version: number;
  save(ctx: SaveContext): Promise<T> | T;
  load(data: T, ctx: SaveContext): Promise<void> | void;
  migrate?: (fromVersion: number, data: unknown) => T;
}

export interface SaveService {
  register<T>(contributor: SaveContributor<T>): void;
  save(scope: SaveScope, slot?: string): Promise<void>;
  load(scope: SaveScope, slot?: string): Promise<void>;
  quickSave(slot?: string): Promise<void>;
  quickLoad(slot?: string): Promise<void>;
}
```

**Implementation notes**

- Storage backend interface (`localStorage` first, custom adapters later).
- Separate save scopes:
  - `settings`: controls/audio/video/preferences
  - `profile`: player progression/achievements/unlocks (scene-independent)
  - `run`: active run snapshot (scene stack + runtime data)
- Scene-independent player data should live in services or contributors, not in a special "global component outside scenes".

---

## Recipe Catalog (Wave 1)

These are reusable code modules, not engine plugins.

### `characterController2D(config)`

**Problem solved**: standard platformer/top-down locomotion without rewriting movement glue.

**Ideal signature**

```ts
export interface CharacterController2DConfig {
  mode: "platformer" | "topdown";
  input: { moveX: string; moveY: string; jump?: string };
  movement: { maxSpeed: number; accel: number; decel: number };
  jump?: { velocity: number; coyoteMs?: number; bufferMs?: number };
}

export function characterController2D(
  config: CharacterController2DConfig,
): Component;
```

### `checkpointRespawn(config)`

**Problem solved**: reusable checkpoint activation + respawn flow.

**Ideal signature**

```ts
export interface CheckpointRespawnConfig {
  checkpointTag?: string;
  respawnDelayMs?: number;
  keepVelocity?: boolean;
}

export function checkpointRespawn(config: CheckpointRespawnConfig): Component;
```

### `cameraRig2D(config)`

**Problem solved**: follow/deadzone/lookahead/shake policy as a reusable rig.

**Ideal signature**

```ts
export interface CameraRig2DConfig {
  target: Entity | (() => Entity | undefined);
  deadzone?: { x: number; y: number };
  smoothing?: number;
  lookahead?: { x: number; y: number };
  bounds?: { x: number; y: number; width: number; height: number };
}

export function cameraRig2D(config: CameraRig2DConfig): Component;
```

### `interactionKit(config)`

**Problem solved**: prompts + nearest-interactable targeting + interaction events.

**Ideal signature**

```ts
export interface InteractionKitConfig {
  action: string;
  radius: number;
  interactableTag?: string;
  requireLineOfSight?: boolean;
}

export function interactionKit(config: InteractionKitConfig): Component;
```

### `spawnDirector(config)`

**Problem solved**: encounter/wave pacing without custom per-game spawn loops.

**Ideal signature**

```ts
export interface SpawnDirectorConfig {
  budgetCurve: (timeMs: number) => number;
  spawnPoints: Array<Vec2 | (() => Vec2)>;
  catalog: Array<{ id: string; cost: number; weight: number }>;
}

export function spawnDirector(config: SpawnDirectorConfig): Component;
```

### `objectPool(config)`

**Problem solved**: high-frequency spawn/despawn performance (bullets, effects, pickups).

**Ideal signature**

```ts
export interface ObjectPoolConfig<T> {
  create: () => T;
  reset: (item: T) => void;
  initialSize?: number;
  maxSize?: number;
}

export function objectPool<T>(config: ObjectPoolConfig<T>): {
  acquire(): T;
  release(item: T): void;
  stats(): { active: number; available: number };
};
```

### `fsmComponent(config)`

**Problem solved**: compact finite-state behavior without hard-coding transitions in `update`.

**Ideal signature**

```ts
export type FsmStateSpec<State extends string> = Record<State, {
  enter?: () => void;
  update?: (dt: number) => State | void;
  exit?: () => void;
}>;

export function fsmComponent<State extends string>(config: {
  initial: State;
  states: FsmStateSpec<State>;
}): Component;
```

### `procgenGrid(config)`

**Problem solved**: deterministic map/grid generation from seeds/noise.

**Ideal signature**

```ts
export interface ProcgenGridConfig<TileId> {
  width: number;
  height: number;
  seed: string | number;
  generator: (x: number, y: number, seed: number) => TileId;
}

export function procgenGrid<TileId>(
  config: ProcgenGridConfig<TileId>,
): TileId[][];
```

### `dialoguePlayer(config)`

**Problem solved**: node-graph dialogue playback (branching, typewriter reveal, per-message side effects) without hard-coding UI or flow logic into the game.

**Design notes (from v1 reference implementation)**

The v1 engine shipped a `DialoguePlayer` + `DialogueWindow` pair that's worth preserving as a recipe. Key ideas we want to keep:

1. **Split state machine from rendering.** `DialoguePlayer` owns the current node/message cursor and calls `start/advance/stop` on an injected window. The window owns presentation only. This keeps branching logic testable without a renderer.
2. **Graph data shape** — flat node map keyed by id, with an `initial` entry point:
   ```ts
   type DialogueNode<M = DialogueMessage> = {
     id: string;
     messages: M[];                        // shown in sequence within a node
     next: string | DialogueChoice[] | null; // linear, branching, or terminal
     final?: boolean;
   };
   type DialogueMessage = {
     text: string;
     onEnter?: () => void;                 // side effects (flags, quests, audio)
     onExit?: () => void;
   };
   type Dialogue<M = DialogueMessage> = { data: Record<string, DialogueNode<M>>; initial: string };
   ```
3. **Lifecycle hooks on messages**, not just nodes. `onEnter`/`onExit` per message let writers trigger quest updates, sfx, or world state changes mid-node without splitting into extra nodes.
4. **Typewriter reveal via tween** (char index 0 → length, linear). First `advance()` while tweening should snap to full text; second `advance()` moves to next message. This "skip then advance" interaction is expected by players and non-obvious to reimplement.
5. **`onTextUpdate` listener** fires per revealed character with `{ complete, message }`. The v1 actor example used this to play a random "voice tone" sample per character — a cheap way to fake voice acting. Keep this hook.
6. **Template-to-messages helper.** v1 had `templateToMessages(template: string)` that split on blank lines (`\n\n`) and trimmed whitespace, so writers could author dialogue as indented multiline strings in code. Small but high-value DX win.
7. **Actor extension as a subclass, not a config flag.** v1's `DialogueWindowWithActors` added portrait + name + left/right layout as a separate class extending the base window. The base stayed minimal. For v2, consider composing via component/plugin rather than subclass, but preserve the "actors are an opt-in layer, not baked into core dialogue" boundary.

**Known v1 pain points to fix in v2 recipe**

- Window required a specific `NineSlicePlane` + `Sprite` cursor + exact padding tuple — customization meant subclassing. v2 recipe should take a simpler render callback or slot-based config.
- Choice branching (`next: DialogueChoice[]`) was typed but not actually implemented in the v1 player's `advance()`. v2 recipe must handle choices end-to-end.
- No save/load integration. The player should expose `{ currentNodeId, currentMessageIndex }` as serializable state so the `@yagejs/save` `run` scope can snapshot mid-dialogue.

**Ideal signature (sketch)**

```ts
export interface DialoguePlayerConfig<M extends DialogueMessage = DialogueMessage> {
  input: { advance: string; choose?: string };
  render: DialogueRenderer<M>;          // slot-based renderer, not a fixed window class
  onChoice?: (choices: DialogueChoice[]) => Promise<number>;
}

export function dialoguePlayer<M extends DialogueMessage>(
  config: DialoguePlayerConfig<M>,
): Component & {
  play(dialogue: Dialogue<M>): void;
  advance(): void;
  stop(): void;
};
```

---

## Packaging and Convention

Initial recommendation:

1. Start in-repo as `packages/recipes` (or `packages/recipes-*`) for faster iteration.
2. Keep each recipe small and framework-like:
   - minimal required dependencies
   - explicit config object
   - no hidden global state
3. Promote to base plugin only when a recipe consistently requires engine/plugin-level guarantees.
4. Consider extracting to a dedicated `yage-recipes` repo once API stabilizes.

---

## Implementation Milestones

1. **M1**: Input remapping MVP (`@yagejs/input`) + profile import/export. 🟡 Partial — `rebind()`, `getBindings()`, `resetBindings()` implemented with conflict policies. `loadProfile()`/`exportProfile()` not yet. Working `input-remapping` example exists.
2. **M2**: Transition-safe scene operation queue (core) + `@yagejs/transitions` fade effect.
3. **M3**: Save contributor registry (`@yagejs/save`) with `settings/profile/run` scopes. Current `@yagejs/save` is snapshot-based (scene stack + entities), not contributor-scoped.
4. **M4**: Publish first recipe wave (`characterController2D`, `cameraRig2D`, `interactionKit`, `objectPool`).
5. **M5**: Add end-to-end examples showing simple usage and scaled/structured usage.

---

## Open Decisions

1. Default input conflict policy (`replace` vs `reject`).
2. Transition request behavior while a transition is running (queue vs fail-fast).
3. Default run save granularity (active scene only vs full stack snapshot).
4. Packaging timing for recipes (same repo long-term vs dedicated repo).
