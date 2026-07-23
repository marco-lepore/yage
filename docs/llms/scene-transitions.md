# Scene Transitions

Animate the handoff between scenes during `push`, `pop`, and `replace`. Both scenes coexist on the stack for the transition's duration.

## Usage

```ts
import {
  chessboard,
  crossFade,
  fade,
  flash,
  iris,
  irisReveal,
  slidePush,
} from "@yagejs/renderer";

// Push with a fade
await engine.scenes.push(nextScene, { transition: fade({ duration: 0.4 }) });

// Pop with a flash
await engine.scenes.pop({ transition: flash({ duration: 0.2, color: 0xff0000 }) });

// Replace with a cross-dissolve
await engine.scenes.replace(newScene, { transition: crossFade({ duration: 0.5 }) });

// Iris-out → swap → iris-in (Zelda-style)
await engine.scenes.replace(nextScene, { transition: iris({ duration: 0.7 }) });

// Checkerboard wipe with a custom grid
await engine.scenes.push(nextScene, { transition: chessboard({ rows: 4, cols: 6 }) });

// Both scenes slide together (incoming pushes the previous one off)
await engine.scenes.push(nextScene, { transition: slidePush({ direction: "left" }) });

// Per-scene default
class MenuScene extends Scene {
  readonly name = "menu";
  readonly defaultTransition = fade({ duration: 0.3 });
}
```

## Contract

```ts
interface SceneTransition {
  readonly duration: number;           // Total wall-clock seconds
  begin?(ctx: SceneTransitionContext): void;
  tick(dt: number, ctx: SceneTransitionContext): void;
  end?(ctx: SceneTransitionContext): void;
}

interface SceneTransitionContext {
  readonly elapsed: number;            // Wall-clock seconds since begin()
  readonly kind: "push" | "pop" | "replace";
  readonly engineContext: EngineContext;
  readonly fromScene: Scene | undefined;
  readonly toScene: Scene | undefined;
}
```

- `begin` — set up resources, paint start state
- `tick` — called each frame with frame `dt` in seconds; `ctx.elapsed` is clamped to `duration`
- `end` — tear down; called before the old scene is removed from the stack

## Built-ins

Core ships the `SceneTransition` contract and orchestration but no concrete
transitions. All built-ins live in `@yagejs/renderer` (PIXI-based).

| Function | Description |
|---|---|
| `fade({ duration?, color?, coverScreen? })` | Triangle alpha ramp: fade out → fade in. Scene swap happens under the fully-opaque mid-point. Default 0.3s, black, play-area-only. |
| `flash({ duration?, color?, coverScreen? })` | Overlay decays from alpha 1→0. Scene swap happens under the opaque peak at begin. Default 0.2s, white, play-area-only. |
| `crossFade({ duration? })` | Cross-dissolve: outgoing alpha 1→0 while incoming alpha 0→1. Both visible throughout. Default 0.4s. |
| `iris({ duration?, color?, center?, coverScreen? })` | Circular cut-out shrinks to zero (closing iris) over the first half, then grows back (opening iris) to reveal the destination. Mask-based; redrawn each frame. `center` is in virtual pixels. Default 0.6s, black, virtual-center, play-area-only. |
| `irisReveal({ duration?, center?, easing? })` | One-way variant of `iris` — the destination scene's container is masked by an expanding circle so the new scene "blooms" over the previous one. No color overlay, no mid-point swap. Default 0.6s, virtual-center, linear. |
| `chessboard({ duration?, rows?, cols? })` | Reveals the destination through a staggered checkerboard mask painted onto the incoming scene's container. Even-parity cells grow over `[0, 0.7]`, odd-parity over `[0.3, 1]` (0.4-wide overlap, smoothstep-eased); the previous scene stays visible underneath until each cell covers it. Default 0.7s, 6×10. |
| `slidePush({ duration?, direction?, reverseOnPop?, easing? })` | Both scenes translate in lockstep — the incoming scene pushes the outgoing one off the opposite edge. `direction` is the outgoing scene's exit direction (default `"left"`). `reverseOnPop` (default `true`) mirrors the motion on `pop`. Default 0.5s, cubic ease-out. |
| `getSceneContainer(ctx, scene)` | Helper — resolves a scene's PIXI root container. Returns `undefined` if `scene` is undefined or its tree isn't materialized. |
| `getVirtualBounds(ctx)` | Helper — `{ width, height }` of the scene-root coord space (= `renderer.virtualSize`). |

`fade` / `flash` / `iris` parent their overlay to `renderer.worldRoot` and size against `renderer.visibleCanvasRect`, so under `letterbox` the overlay covers the play area (bars stay visible) and under `expand` it paints into the bars too. Pass `coverScreen: true` to parent on `app.stage` instead and cover the canvas including bars even under letterbox — useful when the host page background is jarring.

For multi-step sequences (delayed fades, strobing flashes, etc.) write a
custom transition against the contract — it's usually simpler and more
correct than composing the built-ins, each of which manages its own
scene-visibility and would conflict with each other if chained.

## Lifecycle

### Push

1. New scene enters (`onEnter`)
2. Old scene receives `onPause` if applicable (fires before the transition begins)
3. `transition.begin()` fires
4. Per-frame `transition.tick(dt, ctx)` advances
5. `transition.end()` fires

### Pop

1. `transition.begin()` fires
2. Per-frame ticking
3. `transition.end()` fires
4. Top scene exits (`onExit`), revealed scene receives `onResume`

### Replace

1. New scene pushed (suppress event), `onEnter` fires
2. Transition runs with both scenes on the stack
3. `transition.end()` fires
4. Old scene removed (`onExit`), `scene:replaced` emitted

## Queueing

Concurrent `push`/`pop`/`replace`/`popAll` calls queue via `_pendingChain`. Re-entrant calls from lifecycle hooks throw.

`popAll()` is also queued — it waits for any in-flight transition and pending ops to finish before tearing the stack down. There is no mid-run cancellation.

## Events

- `scene:transition:started { kind, fromScene, toScene }` — emitted when a transition begins (`fromScene`/`toScene` may be `undefined`)
- `scene:transition:ended { kind, fromScene, toScene }` — emitted when a transition completes

## Checking State

```ts
engine.scenes.isTransitioning  // true during any active transition
scene.isTransitioning           // same, accessible from the scene
```

## Custom Transitions

Two helpers cover most needs:

- `getSceneContainer(ctx, scene)` — reach a scene's PIXI root container inside `begin`/`tick`/`end`. Manipulate `alpha`, `visible`, `position`, `filters` directly.
- `getVirtualBounds(ctx)` — `{ width, height }` of the scene-root coordinate space. Use this to size masks / translations / geometry parented to a scene root (or any descendant of `_worldRoot`, which carries the responsive-fit transform).

Coordinate-space rule: pick the parent and size source for what your transition needs to cover.

| Parent                       | Coord space        | Size source                               | Covers                                |
| ---------------------------- | ------------------ | ----------------------------------------- | ------------------------------------- |
| Scene root                   | virtual pixels     | `getVirtualBounds(ctx)`                   | one scene only (clipped to virtual)   |
| `renderer.worldRoot`         | virtual pixels     | `renderer.visibleCanvasRect`              | virtual rect under letterbox; virtual + bars under expand |
| `app.stage` (direct)         | canvas / CSS px    | `app.screen.width / .height`              | full canvas including letterbox bars  |

`worldRoot`-parented overlays are the safer default for full-screen effects because they paint into the bars under `expand` (where the game treats them as drawable area) and stay clipped to the play area under `letterbox`. Use `app.stage` only when you also need to obscure the letterbox bars — e.g., the host page background is jarring during a dip-to-black. The built-in `fade` / `flash` / `iris` expose this via `coverScreen?: boolean`.

```ts
import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import type { Container } from "pixi.js";
import { getSceneContainer, getVirtualBounds } from "@yagejs/renderer";

function slideIn(duration: number): SceneTransition {
  let toRoot: Container | undefined;
  let width = 0;
  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      toRoot = getSceneContainer(ctx, ctx.toScene);
      width = getVirtualBounds(ctx).width;
      if (toRoot) toRoot.x = width;
    },
    tick(_dt, ctx) {
      if (!toRoot) return;
      const t = Math.min(ctx.elapsed / duration, 1);
      toRoot.x = width * (1 - t);
    },
    end() {
      if (toRoot) toRoot.x = 0;
      toRoot = undefined;
    },
  };
}
```

Notes:
- `begin` fires synchronously when `SceneManager` starts the transition, before any frame is rendered — paint your start state here (hide incoming scene, offset it, etc.) to avoid a flash.
- `end` always fires at the end of the duration, never mid-run. Restore any persistent properties (visibility, alpha) on surviving scenes as good practice.
- **Read the right dimension source for the right parent.** Stage-direct overlays (fade / flash / iris) live in canvas pixels — size them from `app.screen`. Scene-root masks and translations (chessboard / irisReveal / slidePush) live in virtual pixels — size them from `getVirtualBounds(ctx)`. Mixing the two silently mis-scales under non-1.0 fit ratios.

## Composition with LoadingScene

`LoadingScene` (core) carries its own `transition` — the one used for the handoff to its target. That transition composes with any call-site transition passed to `push`/`replace`:

```ts
await engine.scenes.replace(new Boot(), {
  transition: fade({ duration: 0.4 }),    // mount Boot with this fade
});
// Boot.transition fires separately when Boot hands off to its target.
```

See `loading-scene.md` for the full Boot scene contract.

## Breaking Change

`SceneManager.pop()` returns `Promise<Scene | undefined>` (was synchronous). Update all call sites to `await` or `void`.
