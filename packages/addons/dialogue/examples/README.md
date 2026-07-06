# @yagejs-addons/dialogue — example

`box-and-bubble.ts` is the canonical, copy-pasteable example: a small scene that
shows **box dialogue + bubble dialogue + a branching choice +
`[wave]`/`[shake]` per-glyph effects**, all from `defaultDialogueTheme()` with **zero
bundled assets**.

It is intentionally framework-agnostic: `start(container)` boots an `Engine`
into a DOM element you pass in, so it can be dropped into any host page or test
harness. `index.html` is a minimal Vite-style loader for it.

## Run it

The same example is surfaced in the monorepo's examples app, which already has a
Vite dev server and the workspace `@yagejs-addons/dialogue` linked:

```bash
# from the repo root
npm run dev --workspace=@yagejs/examples
# then open http://localhost:5199/dialogue-addon.html
```

See `examples/src/dialogue-addon.ts` (a thin wrapper that calls this example's
`start()`), `examples/dialogue-addon.html`, and the menu card in
`examples/index.html`.

## What it demonstrates

| Feature              | Where in the script / scene                                  |
| -------------------- | ------------------------------------------------------------ |
| Box dialogue         | narrator lines (default `view`)                              |
| Bubble dialogue      | the `guide` line with `view: "bubble"` over a `DialogueActor` |
| Branching choice     | the `choice` step with `target` jumps + a `goto`            |
| `[wave]` / `[shake]` | per-glyph animated effects on narrator lines                |
| Zero assets          | `defaultDialogueTheme()` (Graphics chrome + canvas SplitText/Text)  |

The scene also adds a `DialogueProbe` component whose `serialize()` exposes the
last line / choice / term and an `ended` flag, which the Playwright e2e
(`e2e/specs/dialogue-addon.spec.ts`) reads through the Inspector API.
