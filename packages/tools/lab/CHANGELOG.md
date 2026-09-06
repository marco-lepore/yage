# @yagejs-tools/lab

## 0.2.0

### Minor Changes

- [#328](https://github.com/marco-lepore/yage/pull/328) [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Keep diagnostic frames, clock control, and scene state consistent.
  - Use Inspector time leases for play, stepping, and driven runs. Competing clock commands reject, and `whileStopped` passes its lease to the callback.
  - Clear retained events after the old scene exits and before the new scene enters, preserving new entry events for event waits. Skip default transitions on first mount and rebuilds so the scene reaches its initial state without advancing the frozen clock.
  - Reject non-finite control bounds and steps, including overflowing default ranges, before storing a control definition.

### Patch Changes

- [#301](https://github.com/marco-lepore/yage/pull/301) [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Let `input.whileHolding` return its callback's value

  `whileHolding(codes, fn)` typed `fn` as `() => Promise<void>`, so wrapping a
  verb that reports something needed a block that threw the value away:

  ```ts
  await ctx.input.whileHolding(["KeyS"], async () => {
    await ctx.until(() => grounded());
  });
  ```

  It is now generic over what `fn` resolves with and passes that value through,
  so the direct form works and the measurement survives:

  ```ts
  const frames = await ctx.input.whileHolding(["KeyS"], () =>
    ctx.until(() => grounded()),
  );
  ```

  Holding, release and nesting are unchanged. Existing calls keep compiling — a
  callback resolving with `void` still gives a `Promise<void>`.

- [#320](https://github.com/marco-lepore/yage/pull/320) [`0ca4c91`](https://github.com/marco-lepore/yage/commit/0ca4c91b46a7d147da803d0d6db54e8e1b5489ce) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Make input lifetimes explicit and keep every edge on the shared input path.

  Drive sustained scenario actions through one action source per drive context, preserving press, hold, and release behavior with the current input API. Release the source after recording the drive result so a held action cannot affect a later drive.

- [#290](https://github.com/marco-lepore/yage/pull/290) [`037d3db`](https://github.com/marco-lepore/yage/commit/037d3db86ef41840056e2eb8a1ce035a795dc3f7) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `LabApi.drive(fn, opts?)` runs a callback against the currently mounted
  scenario, from `window.__yageLab__` in the browser console. `fn` gets the same
  context a scenario's own `drive` receives — `step`, `until`, `input`,
  `events`, `expect`, `capture` — so code tried at the console can be pasted
  straight into a scenario's `drive` unchanged.

  Unlike `run()`, `drive()` does not rebuild the scene first: it drives the
  scene as it stands, after a `run()`, after manual play, or after a previous
  `drive()` call, mutations included. Pass `{ rebuild: true }` to rebuild first,
  the way `run()` does. The scenario does not need its own declared `drive`,
  and a throw inside the callback — including a failed `expect` — resolves with
  `ok: false` rather than rejecting the promise.

  `DriveResult`'s `ok: true` branch now carries a `value` field with whatever
  the driven callback returned.

- [#295](https://github.com/marco-lepore/yage/pull/295) [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add a frame budget and scoped key holds to the lab drive context

  `__yageLab__.drive(fn, { maxFrames })` bounds an ad-hoc run: once the budget is
  spent the callback is stopped and the result is `{ ok: false, timedOut: true }`.
  It defaults to 10,000 frames and takes `Infinity` to disable it; any other
  value has to be a non-negative integer, and one the guard could not act on is
  rejected at the call rather than leaving the run unbounded. A scenario's
  own `drive` is unbounded, as before.

  Every drive result carries `state` — the keys and actions held when the run
  ended, plus the scene stack — captured before synthetic input is released.

  The context gains `input.whileHolding(codes, fn)`, which holds `codes` for the
  duration of `fn` and then restores what was held before, even when `fn` throws,
  and `framesUsed`, a live count of the frames the run has spent:

  ```ts
  await ctx.input.whileHolding(["KeyD"], async () => {
    while (ctx.framesUsed < 900 && !atExit()) {
      if (ground.grounded && gapAhead(body, 48)) {
        await jumpGap(ctx);
        continue;
      }
      await ctx.step(1);
    }
  });
  ```

  Nesting `whileHolding` layers holds by scope even when the code sets overlap:
  a code already down on entry is left alone at both ends, so an inner maneuver
  adds keys without dropping the ones already held.

- Updated dependencies [[`d2adfed`](https://github.com/marco-lepore/yage/commit/d2adfedb0e5d15269fe941a3a24f23ddb0126aa4), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`9b9fe07`](https://github.com/marco-lepore/yage/commit/9b9fe07d7f32219c0e9aa37265b526cdc5924ce8), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`aa5b78e`](https://github.com/marco-lepore/yage/commit/aa5b78e18b56d17bdca4ffb8299c8ea83979e05a), [`439d0e2`](https://github.com/marco-lepore/yage/commit/439d0e205228bee15d8d79607abdba5731b0873b), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`b64cd45`](https://github.com/marco-lepore/yage/commit/b64cd453a65a83899b9e8d5fecf4ad43bf1eb3d4), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/renderer@0.11.0
  - @yagejs/core@0.11.0
  - @yagejs/debug@0.11.0

## 0.1.1

### Patch Changes

- [#242](https://github.com/marco-lepore/yage/pull/242) [`b842574`](https://github.com/marco-lepore/yage/commit/b842574da58dacbb367adcf5ed27a061e73a381d) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Panel changes for tuning a scenario without losing your place.
  - The sidebar, the stage and the controls column each scroll on their own and
    the page never scrolls, so a long scenario list no longer moves the canvas.
  - A filter box above the scenario list matches a scenario's title, the group
    names in it, and its file path.
  - Group headings fold. A filter opens whatever groups hold a match and
    clearing it restores the folds.
  - `copy JSON` on the Controls heading puts every current control value on the
    clipboard as one JSON object.
  - `→ right` moves the controls into a column beside the stage, where the whole
    list is visible instead of four rows at a time.
  - The canvas takes keyboard focus when clicked. While it has focus the browser
    does not scroll on space, the arrow keys, page up and down, or home and end;
    the game still receives those keys.

- [#254](https://github.com/marco-lepore/yage/pull/254) [`2e161fd`](https://github.com/marco-lepore/yage/commit/2e161fdeb90ce45ec179e7c242e44b1301ad2abc) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Four fixes to what a scenario run reports and how it plays.
  - A failed assertion prints the values it compared in full. A message carrying a
    joined list or a serialized object reaches the `yage-lab test` report whole
    instead of stopping at 40 characters.
  - `step(frames, { dtMs })` and `until(predicate, { maxFrames, dtMs })` set the
    milliseconds one frame simulates, for that call only. A drive can exercise a
    frame rate that does not divide into the fixed 1/60s step, which is what it
    takes to catch a reader sampling the simulated pose rather than the
    interpolated one.
  - The panel's **real time** checkbox, beside **Run**, plays a driven run at one
    engine frame per browser animation frame, so a long drive shows its motion
    rather than its end state. `yage-lab test` runs every drive unpaced.
  - `--screenshot-view camera` captures the camera's virtual viewport at the
    game's virtual resolution, so a PNG's size does not follow the scene's drawn
    extents. The default `content` view keeps those extents and warns when the
    image it would produce exceeds the GPU texture limit. Past that limit a
    capture comes back blank while every scenario still reports passing.

## 0.1.0

### Minor Changes

- [#234](https://github.com/marco-lepore/yage/pull/234) [`ddf0702`](https://github.com/marco-lepore/yage/commit/ddf07024339af358091a580880c31a05a8b53d6a) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `@yagejs-tools/lab`, a scenario browser for YAGE games.

  Scenarios live in `*.scenario.ts` files next to the code they exercise, and
  either build a situation with `setup` or mount a `Scene` the game already has.
  The lab finds them, boots one engine from the project's `lab/harness.ts`, and
  rebuilds the scene whenever a control changes — so one entity, one scene or one
  mechanic can be looked at and tuned without running the whole game. Directories
  become the list's nesting, and a file can hold several scenarios that share its
  helpers.

  ```ts
  // src/entities/ball.scenario.ts  →  listed under entities › ball
  export default defineScenario({
    controls: {
      bounce: control.number(0.6, { min: 0, max: 0.95, step: 0.05 }),
    },
    setup(scene, c) {
      /* spawn the balls */
    },

    async drive({ scene, step, expect }) {
      const ball = scene.findByKey("ball-0");
      if (!ball) throw new Error("no ball-0");
      const transform = ball.get(Transform);
      const startY = transform.position.y;
      await step(120);
      expect(transform.position.y).toBeGreaterThan(startY);
    },
  });
  ```

  The `yage-lab` command has four subcommands: `init` writes the harness,
  prefilled from the project's `@yagejs/*` dependencies; `dev` serves the
  browser; `build` writes it as a static site; and `test` runs every scenario in
  headless chromium and exits non-zero if one failed. All four extend the
  project's own `vite.config.ts`, so scenarios run under the same plugins and
  transforms the game uses.

  A scenario carrying a `drive` plays itself and asserts on the result, over an
  exact number of frames rather than wall-clock time. One without is still
  mounted and stepped, so `yage-lab test` is a smoke test before any drive
  exists.

  Three entry points: the grammar (`defineScenario`, `defineHarness`, `control`),
  `./runner` for the browser shell, and `./vite` for the plugin. Engine packages
  are peer dependencies; `@playwright/test` is an optional peer, needed only by
  `yage-lab test`.
