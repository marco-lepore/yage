# @yagejs-tools/lab

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
