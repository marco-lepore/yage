# Documentation checks

`npm run typecheck --workspace @yagejs/docs` type-checks all TypeScript the
docs publish against the built package declarations, the way a game sees them:

- `tsconfig.demos.json` checks the demo modules in `src/demos/` that the site
  embeds with `GameEmbed`.
- `check-snippets.mjs` checks every authored TypeScript and TSX fence.

`npx turbo typecheck` builds the packages first and runs both. To run only the
fence check after `npx turbo build`, use `npm run docs:check`. The checker's own
tests run with `npm test --workspace @yagejs/docs`.

The fence corpus includes the human guides (excluding generated `api/` pages),
`docs/llms/`, co-located addon and tool LLM references, package READMEs,
`docs/ARCHITECTURE.md`, `docs/AGENT_GUIDE.md`, and both AGENTS files. Generated
public files, build output, changelogs and local plans are excluded. The check
validates TypeScript syntax and public types; it does not execute examples.

For local diagnosis, use
`npm run docs:check -- --filter guides/assets --json /tmp/assets.json`.
The filter matches a repository-relative path substring. Filtered runs report
their limited scope. `--json -` writes only JSON to standard output. Reports
include every fence, its status and diagnostics, and every syntax-only reason.

## Fence metadata

Checker options use `yage-` names. Values may be unquoted words, single-quoted
strings or double-quoted strings. Existing rendering options such as `title`
and highlighted line ranges remain available.

Each fence is an isolated module. Write its imports and game-specific types in
the example. To combine related fences, add `yage-group="example"`. Fences in
one group and virtual file combine in document order. Groups are local to the
page. For multiple files, add `yage-file="models.ts"` or
`yage-file="ui/panel.tsx"`; relative imports such as `./models.js` resolve to
the group's virtual TypeScript files. Paths must be relative, end in `.ts` or
`.tsx`, and contain no `..` segments. All fences for a virtual file must use
the same check mode and contexts. The default virtual file is `index.ts`
(`index.tsx` for TSX).

Every fence sees the type augmentations of every package, as a game with all
of them installed does. For example, a `Scene` subclass's `lighting` field is
checked against `@yagejs/lighting`'s options even if the fence never imports
that package. What a fence declares itself stays in that fence: a
`declare global`, a `declare module` augmentation or a triple-slash reference
reaches no other fence.

`yage-context="scene,async"` selects explicit typed hosts and one optional
syntax wrapper. Contexts never supply game entities, services, models or
imports that the example omits.

| Context         | Supplied declaration or syntax position                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| `engine`        | `engine: Engine` from `@yagejs/core`                                                         |
| `scene`         | `scene: Scene` from `@yagejs/core`                                                           |
| `entity`        | `entity: Entity` from `@yagejs/core`                                                         |
| `context`       | `context: EngineContext` from `@yagejs/core`                                                 |
| `inspector`     | `inspector: Inspector` from `@yagejs/core`                                                   |
| `browser`       | Local `window` with the engine's debug `__yage__.inspector`, `logger`, and `ready` contracts |
| `playwright`    | `test`, `expect`, and `page: Page` from `@playwright/test`                                   |
| `vitest`        | `test`, `it`, `expect`, `describe`, `vi`, `beforeEach`, `afterEach` from `vitest`            |
| `component`     | Body of a `Component.update(dt: number)` method                                              |
| `scene-enter`   | Body of a `Scene.onEnter()` async method                                                     |
| `async`         | Body of an async function                                                                    |
| `expression`    | A parenthesized expression                                                                   |
| `type`          | Right-hand side of a type alias                                                              |
| `object-member` | Members of an interface                                                                      |

Imports stay outside structural wrappers. Triple-slash type references stay at
the start of the virtual module. Authored bindings must not conflict with the
bindings selected by a context. JSX uses React's actual JSX contracts and the
automatic JSX runtime. Legacy TypeScript decorators are supported.

## Intentional errors and pseudocode

An intentional negative example declares the exact compiler codes on the next
authored line:

```text
// yage-expect-error TS2322
const count: number = "wrong";
```

Separate multiple codes with commas, without spaces. The checker fails if any
declared code disappears or appears on another line. Unrelated diagnostics
still fail. TypeScript suppression comments such as `@ts-ignore` and
`@ts-expect-error` are not allowed.

Non-executable game-local pseudocode may use `yage-check="syntax"` with a
substantive `yage-reason="..."` explaining why a truthful typed context cannot
describe it. Review each exception; API recipes need actual types. Syntax
errors still fail, and every exception appears individually in the report.
