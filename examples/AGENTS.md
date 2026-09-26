# Writing YAGE examples

Audience: agents adding or changing an example under `examples/`. Read this
before writing example code.

People and agents copy examples. An example teaches every pattern it uses, not
only the feature it shows, so example code follows the same rules as game code
in the root `AGENTS.md`. "It's only a demo" is not an exception. Where an
example and this file disagree, this file is right and the example needs
fixing.

The files and wiring (HTML page, catalogue entry, e2e auto-discovery) are in
the "Add a New Example" section of `docs/AGENT_GUIDE.md`.

## Start from the reference

`src/platformer/` is the reference example. Copy its layout:

| File           | Holds                                                        |
| -------------- | ------------------------------------------------------------ |
| `constants.ts` | Sizes, collision layers, `defineEvent` tokens, asset handles |
| `level.ts`     | One `Entity` subclass per entity type, and its components    |
| `player.ts`    | The player entity and its controller component               |
| `hud.ts`       | The HUD entity and the component that holds the run's state  |
| `scene.ts`     | The `Scene` subclass; `onEnter` only spawns                  |
| `main.ts`      | Engine, plugins, `engine.scenes.push(...)`                   |

A small example can keep everything in `main.ts`, in the same order.

## Rules

### Entities

- **An entity type is an `Entity` subclass with `setup(params)`.** Spawn it
  with `this.spawn(PlayerEntity, { camera })`. A function that builds and
  returns an entity (`spawnEnemy(scene, x, y)`) is a subclass instead.
- **A named spawn is only for a one-off entity:** spawned once, with no
  behaviour of its own, such as a UI root, a background or a HUD host.
  `this.spawn("background").add(new GraphicsComponent(...))` is fine;
  `this.spawn("enemy")` in a loop is not.
- Child entities (`this.spawnChild("label")`) are destroyed with their parent.
  Use them instead of destroying helper entities by hand.

### Logic

- **Components hold the rules.** Game logic lives in a component's
  `update(dt)` / `fixedUpdate(dt)`, its event handlers and its methods.
- **`onEnter` assembles the scene:** it spawns entities, sets up the camera and
  starts music. It may connect an event to a component method in one line
  (`this.on(PlayerDied, () => player.get(Respawn).respawn())`), but it holds no
  state and no rules. Prefer a component that listens for itself
  (`this.listenScene(PlayerDied, ...)`), as the platformer's player does.
- **Events:** declare with `defineEvent`, emit on the entity
  (`this.entity.emit(CoinCollected)`), and listen from a component with
  `this.listen(entity, Token, fn)` or `this.listenScene(Token, fn)`. Entity
  events bubble to the scene. `EventBus` is for engine events only.
- No `System` subclasses for game rules. Systems are engine infrastructure.

### Game state

- **Score, lives, a quest log or a run timer live in a component on a host
  entity.** Spawn the host with a key and reach it with `scene.findByKey`, a
  query, or the reference `spawn()` returned:

  ```ts
  this.spawn(HudEntity, { key: HUD_KEY });
  // elsewhere
  const progress = this.scene.findByKey<HudEntity>(HUD_KEY)?.progress;
  ```

- Not a module-level `let`, not a field on the `Scene`, not a `ServiceKey`.
  Module-level `createStore` / `createRecord` is only for state that
  `@yagejs/save` persists.
- Components reach engine services through `this.use(Key)` or
  `this.service(Key)`, such as `SceneManagerKey` to push a scene. Never a
  module-level `engine` variable, and never a cast of `this.scene` to a scene
  class to read its fields.

### Time

- **No `setTimeout` or `setInterval`** (lint rejects them). Browser timers keep
  running while the game is paused and ignore time scale.
- Cooldowns and windows (coyote time, invulnerability, a toast's lifetime) are
  `ProcessComponent` slots: `pc.slot({ duration })`, then `restart()`,
  `running` and `cancel()`. Not a number counted down by hand in `update`, and
  not a boolean flag.
- A one-off delay is `pc.run(Process.delay(seconds, fn))`. Something that
  repeats every few seconds is a looping sequence:
  `pc.run(new Sequence().wait(2).call(fn).loop().build())`. A slot with
  `loop: true` never completes, so its `onComplete` never runs. A scene-level
  timer with no natural owner is a `TimerEntity`.
- `dt` is in seconds. Durations are in seconds (`cam.shake(8, 0.3)`).

### Randomness

- **No `Math.random`** (lint rejects it). Use the scene's generator,
  `this.use(RandomKey)`, from a component or from the scene's `onEnter`. It
  returns a `RandomService` (`float()`, `range(min, max)`, `int(min, max)`,
  `pick(arr)`, `shuffle(arr)`). The `?test` harness seeds it, so e2e runs are
  reproducible.

### Rendering and assets

- Change a visual through its component: `text.setText(...)`,
  `visual.visible`, `visual.alpha`. Not the Pixi object underneath
  (`.text.text`, `.graphics.alpha`), which the component can overwrite.
- Pass asset handles as they are: `audio.play(CoinSfx)`, `sheet: HeroSheet`.
  Not `CoinSfx.path`.
- Register textures with the renderer's asset API (`texture(...)`,
  `registerTexture`), not `Assets.cache.set` or `Texture.from`.
- Game state and gameplay feedback (score, win and lose banners, toasts)
  render in the canvas, on a screen-space layer. The DOM holds static
  instructions and controls only.

### Cleanup and tests

- Subscriptions made with `listen`, `listenScene` and `listenBus` end with
  the component. For anything else, pass the unsubscribe to
  `this.addCleanup(fn)`. No hand-kept arrays of disposers.
- To expose state to e2e tests, add a small probe component whose fields or
  getters hold it (`TavernProbe` in `src/yarn-dialogue/main.ts`). Tests read
  it with `inspector.getComponentData(entity, "TavernProbe")`. Not
  `window.__something__` globals.
- No deprecated APIs (`defineBlueprint`), and no shims kept "so existing call
  sites still work".
- Comments describe what the code does now. No changelog notes ("the bug we
  fixed", "PR #66") and no links to documents that don't exist.

## Before you finish

```bash
npm run lint -w @yagejs/examples       # the rules above that lint can check
npm run typecheck -w @yagejs/examples
npx playwright test e2e/specs/examples.spec.ts -g "<slug>"   # boots cleanly
```

The e2e smoke test only proves the page boots without errors. It can't see a
unit mistake such as `dt / 1000`, so run the example and watch it.
