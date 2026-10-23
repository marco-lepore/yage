# Scene Transitions

Animate the handoff between scenes during `push`, `pop`, and `replace`. Both scenes coexist on the stack for the transition's duration.

## Usage

`GameScene` and `ResultsScene` below are your game’s `Scene` subclasses. Each
transition example creates a destination instance; choose the operation your
flow needs.

```ts yage-context="engine" yage-fixture="scenes"
import { Scene } from "@yagejs/core";
import {
  chessboard,
  crossFade,
  fade,
  flash,
  iris,
  irisReveal,
  slidePush,
} from "@yagejs/renderer";

import { GameScene, ResultsScene } from "./game-scenes.js";

// Push with a fade
await engine.scenes.push(new GameScene(), {
  transition: fade({ duration: 0.4 }),
});

// Pop with a flash
await engine.scenes.pop({
  transition: flash({ duration: 0.2, color: 0xff0000 }),
});

// Replace with a cross-dissolve
await engine.scenes.replace(new ResultsScene(), {
  transition: crossFade({ duration: 0.5 }),
});

// Iris-out → swap → iris-in (Zelda-style)
await engine.scenes.replace(new GameScene(), {
  transition: iris({ duration: 0.7 }),
});

// Checkerboard wipe with a custom grid
await engine.scenes.push(new GameScene(), {
  transition: chessboard({ rows: 4, cols: 6 }),
});

// Both scenes slide together (incoming pushes the previous one off)
await engine.scenes.push(new GameScene(), {
  transition: slidePush({ direction: "left" }),
});

// Per-scene default
class MenuScene extends Scene {
  readonly name = "menu";
  readonly defaultTransition = fade({ duration: 0.3 });
}

// Skip the destination's default transition for this operation
await engine.scenes.push(new MenuScene(), { transition: null });
```

`engine.scenes` is the `SceneManager`; Scene and Component code reaches it with `this.use(SceneManagerKey)` (never a module-level `engine`) and passes the same options.

`SceneTransitionOptions` is `{ transition?: SceneTransition | null }` for
`push`, `pop`, and `replace`. Omission uses the destination's
`defaultTransition`; a transition object overrides it; `null` skips it.
For `pop`, the destination is the scene revealed below the outgoing scene.
Without a transition, `replace` preloads the new scene, exits the old scene,
then enters the new one without waiting for frames.

## Contract

```ts
import type {
  EngineContext,
  Scene,
  SceneTransition as BaseSceneTransition,
  SceneTransitionContext as BaseSceneTransitionContext,
} from "@yagejs/core";

interface SceneTransition extends BaseSceneTransition {
  readonly duration: number; // Total wall-clock seconds
  begin?(ctx: SceneTransitionContext): void;
  tick(dt: number, ctx: SceneTransitionContext): void;
  end?(ctx: SceneTransitionContext): void;
}

interface SceneTransitionContext extends BaseSceneTransitionContext {
  readonly elapsed: number; // Wall-clock seconds since begin()
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

| Function                                                       | Description                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fade({ duration?, color?, coverScreen? })`                    | Triangle alpha ramp: fade out → fade in. Scene swap happens under the fully-opaque mid-point. Default 0.3s, black, play-area-only.                                                                                                                                                       |
| `flash({ duration?, color?, coverScreen? })`                   | Overlay decays from alpha 1→0. Scene swap happens under the opaque peak at begin. Default 0.2s, white, play-area-only.                                                                                                                                                                   |
| `crossFade({ duration? })`                                     | Cross-dissolve: outgoing alpha 1→0 while incoming alpha 0→1. Both visible throughout. Default 0.4s.                                                                                                                                                                                      |
| `iris({ duration?, color?, center?, coverScreen? })`           | Circular cut-out shrinks to zero (closing iris) over the first half, then grows back (opening iris) to reveal the destination. Mask-based; redrawn each frame. `center` is in virtual pixels. Default 0.6s, black, virtual-center, play-area-only.                                       |
| `irisReveal({ duration?, center?, easing? })`                  | One-way variant of `iris` — the destination scene is masked by an expanding circle so the new scene "blooms" over the previous one. No color overlay, no mid-point swap. Default 0.6s, virtual-center, `easeLinear`.                                                                     |
| `chessboard({ duration?, rows?, cols? })`                      | Reveals the destination through a staggered checkerboard mask on the incoming scene. Even-parity cells grow over `[0, 0.7]`, odd-parity over `[0.3, 1]` (0.4-wide overlap, smoothstep-eased); the previous scene stays visible underneath until each cell covers it. Default 0.7s, 6×10. |
| `slidePush({ duration?, direction?, reverseOnPop?, easing? })` | Both scenes translate in lockstep — the incoming scene pushes the outgoing one off the opposite edge. `direction` is the outgoing scene's exit direction (default `"left"`). `reverseOnPop` (default `true`) mirrors the motion on `pop`. Default 0.5s, `easeOutCubic`.                  |
| `getSceneRenderTree(ctx, scene)`                               | Helper — the scene's `SceneRenderTree`, for its `alpha`, `visible`, `setOffset` and masks. Returns `undefined` if `scene` is undefined or its tree isn't materialized.                                                                                                                   |
| `createTransitionOverlay(ctx, { coverScreen? })`               | Helper — a `TransitionOverlay` drawn above every scene's world and screen layers, to cover the swap.                                                                                                                                                                                     |
| `getVirtualBounds(ctx)`                                        | Helper — `{ width, height }` of the scene-root coord space (= `renderer.virtualSize`).                                                                                                                                                                                                   |

`fade`, `flash` and `iris` cover the swap with a `createTransitionOverlay` overlay. By default the overlay covers the part of the canvas the game draws on: the play area under `letterbox`, with the bars left visible, and the bars too under `expand`. Pass `coverScreen: true` to cover the whole canvas, bars included, even under `letterbox`. Use it when the host page background shows through the bars and looks jarring.

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

Concurrent `push`/`pop`/`replace`/`popAll` calls queue and run in call order. A call from inside a scene lifecycle hook (`onEnter`, `onExit`, `onPause`, `onResume`) is queued too: it runs after the current operation finishes, and dev builds log a warning.

`popAll()` is also queued — it waits for any in-flight transition and pending ops to finish before tearing the stack down. There is no mid-run cancellation.

## Events

- `scene:transition:started { kind, fromScene, toScene }` — emitted when a transition begins (`fromScene`/`toScene` may be `undefined`)
- `scene:transition:ended { kind, fromScene, toScene }` — emitted when a transition completes

## Checking State

```ts yage-context="engine,scene"
engine.scenes.isTransitioning; // true during any active transition
scene.isTransitioning; // same, accessible from the scene
```

## Custom Transitions

A custom transition changes each scene through its render tree and covers the swap with an overlay. No Pixi object is involved.

- `getSceneRenderTree(ctx, scene): SceneRenderTree | undefined` — the scene's render tree inside `begin`/`tick`/`end`. Fade with `tree.alpha`, hide with `tree.visible`, slide with `tree.setOffset(x, y)` (virtual px), mask with `tree.setTransitionMask(graphicsMask(...))`, filter with `tree.fx`. `alpha`, `visible` and `setOffset` also reach the scene's `"canvas"` layers (the offset converted to canvas px); the mask and `fx` do not. The scene stack rewrites `visible` when the transition ends. `setTransitionMask` sets the scene's own mask aside, and the returned handle's `remove()` puts it back; call it in `end`.
- `createTransitionOverlay(ctx, { coverScreen? }): TransitionOverlay` — a drawing above every scene's world and screen layers: `area` (the region it covers), `draw(fn)`, `alpha`, `visible`, `setMask(factory)` / `clearMask()`, `destroy()`. Without `coverScreen` it sits inside the responsive fit: `area` is in virtual px (`renderer.visibleCanvasRect`), clipped to the play area under `letterbox` and reaching the bars under `expand`; canvas layers draw above it and the built-ins do not fade them. With `coverScreen: true` it covers the whole canvas including letterbox bars and canvas layers, in canvas px; convert a virtual point with `renderer.virtualToCanvas`. Destroy it in `end`.
- `getVirtualBounds(ctx)` — `{ width, height }` of a scene's virtual space, for sizing a slide or a scene mask.

The built-in `fade`, `flash`, `crossFade`, `iris`, `irisReveal`, `chessboard` and `slidePush` are built on the same three helpers.

```ts
import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import {
  createTransitionOverlay,
  getSceneRenderTree,
  getVirtualBounds,
} from "@yagejs/renderer";
import type { SceneRenderTree, TransitionOverlay } from "@yagejs/renderer";

/** Slide the incoming scene in from the right. */
function slideIn(duration: number): SceneTransition {
  let to: SceneRenderTree | undefined;
  let width = 0;
  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      to = getSceneRenderTree(ctx, ctx.toScene);
      width = getVirtualBounds(ctx).width;
      to?.setOffset(width, 0);
    },
    tick(_dt, ctx) {
      const t = Math.min(ctx.elapsed / duration, 1);
      to?.setOffset(width * (1 - t), 0);
    },
    end() {
      to?.setOffset(0, 0);
      to = undefined;
    },
  };
}

/** Dip to black, swapping the scenes at the half-way mark. */
function dip(duration: number): SceneTransition {
  let overlay: TransitionOverlay | undefined;
  let to: SceneRenderTree | undefined;
  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      overlay = createTransitionOverlay(ctx);
      const { x, y, width, height } = overlay.area;
      overlay.draw((g) => g.rect(x, y, width, height).fill(0x000000));
      overlay.alpha = 0;
      to = getSceneRenderTree(ctx, ctx.toScene);
      if (to) to.visible = false;
    },
    tick(_dt, ctx) {
      const t = Math.min(ctx.elapsed / duration, 1);
      if (overlay) overlay.alpha = t < 0.5 ? t * 2 : (1 - t) * 2;
      if (to && t >= 0.5) to.visible = true;
    },
    end() {
      overlay?.destroy();
      overlay = undefined;
      if (to) to.visible = true;
      to = undefined;
    },
  };
}
```

Notes:

- `begin` fires synchronously when `SceneManager` starts the transition, before any frame is rendered — paint your start state here (hide incoming scene, offset it, etc.) to avoid a flash.
- `end` always fires at the end of the duration, never mid-run. Restore any persistent properties (offset, alpha) on surviving scenes. Leave an outgoing scene on pop/replace as it is: `end` runs before the frame renders, so restoring it would draw it for one last frame.
- **Size by the space you draw in.** A scene mask or slide is in the scene's virtual pixels (`getVirtualBounds`). An overlay reports its own `area`: virtual pixels by default, canvas pixels under `coverScreen`.

## Composition with LoadingScene

`LoadingScene` (core) carries its own `transition` — the one used for the handoff to its target. That transition composes with any call-site transition passed to `push`/`replace`:

```ts yage-context="engine"
import { LoadingScene, Scene } from "@yagejs/core";
import { fade } from "@yagejs/renderer";

class GameScene extends Scene {
  readonly name = "game";
}

class Boot extends LoadingScene {
  readonly target = () => new GameScene();
  readonly transition = fade({ duration: 0.3 });
}

await engine.scenes.replace(new Boot(), {
  transition: fade({ duration: 0.4 }), // mount Boot with this fade
});
// Boot.transition fires separately when Boot hands off to its target.
```

See `loading-scene.md` for the full Boot scene contract.

## pop() is async

`SceneManager.pop()` returns `Promise<Scene | undefined>`: the removed scene, once the queued pop and its transition have run. `await` it, or mark an unawaited call with `void`.
