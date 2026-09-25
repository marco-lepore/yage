---
"@yagejs-addons/dialogue": minor
---

Play Yarn Spinner dialogue. The new `@yagejs-addons/dialogue/yarn` entry exports `loadYarn`, which compiles `.yarn` files — one source, or a whole folder read with `import.meta.glob`, with its `.yarnproject` — into one validated script every `DialogueController` plays. Pick the node per conversation with `controller.play(story, { start: "Shopkeeper" })`.

`loadYarn` covers lines with characters, `{$expressions}`, markup and hashtags; options with bodies, conditions and `<<once>>`; `<<if>>` / `<<elseif>>` / `<<else>>`; `<<once>>` blocks; `<<jump>>` (also to `{$expression}`), `<<detour>>`, `<<return>>`, `<<stop>>`; `<<declare>>` with types, `<<set>>` with `to` and `+= -= *= /= %=`, smart variables, enums, and implied declarations; `visited()` / `visited_count()`; line groups, node groups and `has_any_content()`; `<<wait>>`; and game commands, whose words arrive as `args`. The project's `sourceFiles` / `excludeFiles` pick the sources, and each localisation strings table becomes a catalog in `story.catalogs`, keyed by `#line:` id, ready for `@yagejs-addons/i18n`. Errors throw `DialogueYarnError` with the file and line.

To run Yarn content natively, the dialogue model grows these general features:

- `play(script, { start })` begins at any node; an unknown node throws `DialoguePlayError` before anything changes.
- `detour` and `return` steps run a node as a subroutine; `goto` takes `leaveDetours`. A `goto` or `detour` target can be an expression (`StepTarget`), evaluated when the step runs; a value naming no node is reported through `onError` and ends the conversation.
- A `select` step lets the runtime pick one option: available ones, then the least picked (each option's `counter` variable), then the highest `priority`, then at random.
- `say` steps, choice prompts, and choice options take `expressions`: computed `{name}` tokens evaluated each time the text shows.
- A command's `args` are positional values; expressions among them are evaluated when the command fires. `CommandHandler`, `onCommand`, `DialogueCommandEvent`, and extra channels now receive a `FiredCommand`, whose `args` are plain values. An argument that fails to evaluate (a function that throws) is reported through `onError`, and that command is skipped.
- `{ type: "wait", seconds }` (or `args: [seconds]`) holds the conversation on its own clock with no handler. A game's own `wait` handler, or its `fallbackCommand`, still takes precedence. When this default runs a `wait`, a literal duration that isn't a number of seconds >= 0 makes `play()` throw `DialoguePlayError`; one computed by an expression is reported through `onError`.
- Built-in functions — Yarn Spinner's standard library (`random`, `random_range`, `dice`, `round`, `floor`, `ceil`, `min`, `max`, `format`, …) — work in any script without installing them; an installed function of the same name wins. Randomness, including `select`, comes from the new `DialogueSessionOptions.random`; `DialogueController` passes its scene's seeded `RandomService`.
- `parseExpr` now parses `*`, `/`, `%`, and `xor` / `^`.
- Markup accepts `[/]` (close every span), whitespace before `/]`, quoted values holding spaces or `/`, tag names with digits and `_`, and `[nomarkup]…[/nomarkup]`. The replacement markers `[select …/]`, `[plural …/]` and `[ordinal …/]` become text, using the `I18nAdapter`'s locale for plural forms; `parseMarkup` and `stripMarkup` take `{ locale }`.
- A `set` whose value is not a finite number is reported through `onError` and not written.

Behaviour changes: text such as `[sfx2/]` or `[nomarkup]` that used to render as written or as an effect span now parses as markup, and a `[select …/]`, `[plural …/]`, or `[ordinal …/]` marker becomes text instead of firing `DialogueRevealMarkerEvent`. A `wait` command with no handler no longer fails `play()`, and a `wait` now holds the conversation while its handler runs unless it sets `blocking: false` (a game's own promise-returning `wait` handler used to be fire-and-forget without `blocking: true`). A node id is matched as an own key only: a `goto` to an inherited name such as `toString` is now a load error, and a node named `__proto__` loads as a node.
