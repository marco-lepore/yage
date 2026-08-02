# @yagejs-tools/lab

Scenario browser for [YAGE](https://yage.dev) games. Mount one entity, one
scene or one mechanic in a real engine, tune it with live controls, and run the
same scenarios in a headless browser so a broken one fails the build.

`@yagejs-tools` scope, independently versioned — an engine release never forces
a bump here, and vice versa.

## Install

```bash
npm install -D @yagejs-tools/lab
```

Peers: `@yagejs/core`, `@yagejs/renderer`, `@yagejs/debug` and `vite`, all of
which a YAGE game already has. `@playwright/test` is an optional peer, needed
only by `yage-lab test`.

## Usage

Write the harness once — the engine and plugins every scenario runs against.
`init` prefills it from the `@yagejs/*` packages your project depends on:

```bash
npx yage-lab init
```

Then write scenarios as `*.scenario.ts` files, next to the code they exercise:

```ts
// src/entities/ball.scenario.ts  →  listed under entities › ball
import { Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { control, defineScenario } from "@yagejs-tools/lab";

export default defineScenario({
  describe: "Bodies falling onto a floor. Raise bounce and watch again.",

  controls: {
    count: control.int(3, { min: 1, max: 12, label: "balls" }),
    bounce: control.number(0.6, { min: 0, max: 0.95, step: 0.05 }),
  },

  setup(scene, c) {
    for (let i = 0; i < c.count; i++) {
      const ball = scene.spawn(`ball-${i}`, { key: `ball-${i}` });
      ball.add(new Transform({ position: new Vec2(80 * i + 60, 60) }));
      ball.add(
        new GraphicsComponent().draw((g) => {
          g.circle(0, 0, 16).fill({ color: 0x38bdf8 });
        }),
      );
      ball.add(new RigidBodyComponent({ type: "dynamic" }));
      ball.add(
        new ColliderComponent({
          shape: { type: "circle", radius: 16 },
          restitution: c.bounce,
        }),
      );
    }
  },
});
```

Browse them:

```bash
npx yage-lab
```

A scenario either builds a situation with `setup`, as above, or mounts a
`Scene` your game already has. Moving a control rebuilds the scene with the new
value.

Directories become the list's nesting, so the sidebar mirrors your source tree
with nothing to configure. A file can export several named scenarios that share
its helpers, and they nest under the file:

```ts
// src/entities/slime.scenario.ts  →  entities › slime › { idle, chase }
export const idle = defineScenario({ setup(scene) { arena(scene); /* ... */ } });
export const chase = defineScenario({ setup(scene) { arena(scene); /* ... */ } });
```

## Commands

| Command | What it does |
| --- | --- |
| `yage-lab init` | Write `lab/harness.ts`, prefilled from your dependencies |
| `yage-lab [dev]` | Start the scenario browser (port 5210) |
| `yage-lab build` | Build it as a static site |
| `yage-lab test` | Run every scenario headless, exiting non-zero if one failed |

Every command loads your own `vite.config.ts` and merges the lab into it, so
scenarios run under the same plugins and transforms your game uses.

## Scenarios as tests

Give a scenario a `drive` and it plays itself and checks the result. Frames
come from the run, so it advances an exact number of them rather than depending
on wall-clock timing:

```ts
async drive({ scene, input, step, expect }) {
  const ball = scene.findByKey("ball-0");
  if (!ball) throw new Error("the scenario spawned no ball-0");
  const transform = ball.get(Transform);
  const startY = transform.position.y;

  await step(120);

  expect(transform.position.y).toBeGreaterThan(startY);
}
```

The panel grows a Run button for it, and `yage-lab test` runs every one:

```
  PASS  drop                          drive    120f  240ms
  PASS  shapes                        smoke     60f  41ms

  2/2 passed
```

A scenario without a `drive` is still mounted and stepped, so the command is a
smoke test even before you have written one.

## Docs

Full documentation at [yage.dev](https://yage.dev/tooling/scenario-lab/).

## License

MIT
