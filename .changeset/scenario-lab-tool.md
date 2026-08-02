---
"@yagejs-tools/lab": minor
---

Add `@yagejs-tools/lab`, a scenario browser for YAGE games.

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
  controls: { bounce: control.number(0.6, { min: 0, max: 0.95, step: 0.05 }) },
  setup(scene, c) { /* spawn the balls */ },

  async drive({ scene, step, expect }) {
    const transform = scene.findByKey("ball-0").get(Transform);
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
