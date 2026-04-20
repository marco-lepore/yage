# Loading Scene

`LoadingScene` (in `@yagejs/core`) is the orchestration base class for a loading screen. It preloads the target scene's assets through the engine's `AssetManager`, emits `scene:loading:progress` and `scene:loading:done` on the event bus, enforces an optional `minDuration`, and replaces itself with the target — optionally through a transition. Rendering the progress UI is not its job: spawn a visual entity (the default is `LoadingSceneProgressBar` in `@yagejs/ui`, or anything you write that subscribes to the events).

## Usage

```ts
import { LoadingScene } from "@yagejs/core";
import { fade } from "@yagejs/renderer";
import { LoadingSceneProgressBar } from "@yagejs/ui";

class Boot extends LoadingScene {
  readonly target = new GameScene();
  readonly minDuration = 500;
  readonly transition = fade({ duration: 300 });

  override onEnter() {
    this.spawn(LoadingSceneProgressBar);
    this.startLoading();
  }
}

await engine.scenes.replace(new Boot());
```

Loading does not start automatically — call `this.startLoading()` when you want it to begin (typically at the end of `onEnter`, after you've spawned the loading UI). Deferring the call lets you gate the start behind a title screen, "press any key" prompt, or intro animation.

## API

```ts
abstract class LoadingScene extends Scene {
  readonly name: string;                           // default "loading"
  abstract readonly target: Scene | (() => Scene);
  readonly minDuration: number;                    // default 0
  readonly transition?: SceneTransition;
  readonly autoContinue: boolean;                  // default true
  readonly progress: number;                       // getter, 0 → 1

  /** Kick off asset loading. Idempotent — subsequent calls are no-ops. */
  startLoading(): void;

  /** Trigger the handoff. No-op if already called. */
  continue(): void;

  onLoadError?(error: Error): void | Promise<void>;
}
```

- `target` — scene to hand off to. Instance or factory; factory is invoked exactly once, after `onEnter`.
- `minDuration` — wall-clock ms. Prevents flicker on cached loads.
- `transition` — optional `SceneTransition` for the loading→target `replace`.
- `autoContinue` — when `true` (default), `continue()` fires automatically after `minDuration`. Set `false` to gate the handoff behind a manual `continue()` call — e.g. "press any key".
- `onLoadError` — optional recovery hook. If loading rejects, the scene stays mounted either way. With a hook set, the hook fires — call `this.startLoading()` from it to retry. Without one, the error is logged via the engine logger and the scene sits in a failed state. `startLoading()` is safe to call again after a failure.

## Events

Both fire on the engine `EventBus`. Payload `scene` is the `LoadingScene` that fired the event — use strict identity (`ev.scene === this.scene`) to filter if multiple loading scenes could coexist.

| Event | Payload | When |
|---|---|---|
| `scene:loading:progress` | `{ scene, ratio }` | Every `AssetManager` progress update, 0 → 1 |
| `scene:loading:done` | `{ scene }` | After preload finishes AND `minDuration` elapses, before the handoff begins |

## Custom visual

Any component can subscribe:

```ts
import { Component, EventBusKey } from "@yagejs/core";

class MyLoadingSpinner extends Component {
  private unsub?: () => void;
  override onAdd() {
    const bus = this.scene.context.resolve(EventBusKey);
    this.unsub = bus.on("scene:loading:progress", (ev) => {
      if (ev.scene !== this.scene) return;
      this.redraw(ev.ratio);
    });
  }
  override onDestroy() { this.unsub?.(); }
  private redraw(r: number) { /* ... */ }
}
```

A constantly-animated visual (rotating spinner) does its own per-frame animation in `update(dt)` and just reads the most recent ratio from whatever source it has (the event, or `(this.scene as LoadingScene).progress`).

## Press-any-key flow

```ts
class Boot extends LoadingScene {
  readonly target = new GameScene();
  readonly autoContinue = false;        // gate the handoff

  override onEnter() {
    this.spawn(LoadingSceneProgressBar);
    this.spawn(PressAnyKeyPrompt);      // game-specific; calls scene.continue() on input
    this.startLoading();
  }
}
```

`PressAnyKeyPrompt` is a normal component: listens for `scene:loading:done` to show its "press space" text, polls input in `update()`, calls `(this.scene as LoadingScene).continue()` when the key is pressed.

## Notes

- LoadingScene is pure orchestration — no pixi dep. It lives in `@yagejs/core`.
- Assets the loading scene itself needs (fonts, logo sprites) are not handled by this API. Either use procedural UI only, or preload bootstrap assets manually before pushing the loading scene.

## LoadingSceneProgressBar (`@yagejs/ui`)

```ts
class LoadingSceneProgressBar extends Entity {
  setup(opts?: {
    width?: number;                  // default 400
    height?: number;                 // default 16
    track?: BackgroundOptions;       // default dark slate
    fill?: BackgroundOptions;        // default cyan
    backdrop?: BackgroundOptions;    // full-viewport bg; default: none (transparent)
    anchor?: Anchor;                 // default Anchor.Center
    offset?: { x: number; y: number };
    layer?: string;
  }): void;
}
```

Spawn it inside a `LoadingScene` (it throws otherwise). Subscribes to `scene:loading:progress` internally and updates a `UIProgressBar`.

Pass `backdrop` when the loading scene is used with a transition — without it the scene is transparent and the outgoing scene bleeds through during the fade.
