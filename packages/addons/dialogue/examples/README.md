# @yagejs-addons/dialogue — example

`box-and-bubble.ts` is the canonical, copy-pasteable example: a small scene that
shows **box dialogue + bubble dialogue + a branching choice +
`[wave]`/`[shake]` per-glyph effects**, all from `defaultDialogueTheme()` with **zero
bundled assets**.

It is intentionally framework-agnostic: `start(container)` boots an `Engine`
into a DOM element you pass in, so it can be dropped into any host page or test
harness. `index.html` loads it into an 800×600 container.

## Run it

`index.html` imports `box-and-bubble.ts` directly, so serve this folder with
Vite, which compiles the TypeScript. From the repo root:

```bash
npx turbo build   # build the packages the example imports
npx vite packages/addons/dialogue/examples
# then open the URL Vite prints (http://localhost:5173 by default)
```

The monorepo's examples app has a separate, larger dialogue demo: a small town
where you walk up to NPCs and press F. It adds stored variables, options that
appear only when a condition holds, commands the game carries out, sound cues
timed to the text, and a follow camera. Its source is
`examples/src/dialogue-addon/`:

```bash
npm run dev --workspace=@yagejs/examples
# then open http://localhost:5199/#dialogue-addon
```

## What it demonstrates

| Feature              | Where in the script / scene                                        |
| -------------------- | ------------------------------------------------------------------ |
| Box dialogue         | narrator lines (default `view`)                                    |
| Bubble dialogue      | the `guide` line with `view: "bubble"` over a `DialogueActor`      |
| Branching choice     | the `choice` step with `target` jumps + a `goto`                   |
| `[wave]` / `[shake]` | per-glyph animated effects on narrator lines                       |
| Zero assets          | `defaultDialogueTheme()` (Graphics chrome + canvas SplitText/Text) |

The scene also adds a `DialogueProbe` component to the `dialogue-host` entity.
It records the last line, how many lines have shown, the last choice, and
whether the conversation has ended. `start()` creates the engine with
`debug: true`, so the probe is readable from the browser console through the
Inspector:

```js
window.__yage__.inspector.getComponentData("dialogue-host", "DialogueProbe");
```

The addon's Playwright tests (`e2e/specs/dialogue-addon.spec.ts`) do not load
this example. They drive their own scene, `e2e/fixtures/src/dialogue-addon.ts`.
