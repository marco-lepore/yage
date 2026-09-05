# @yagejs-addons/quests

Headless quest log for YAGE (`@yagejs-addons` scope, independently versioned,
NOT in the engine `fixed` group). Pure `@yagejs/core` — no renderer, no
dialogue/inventory dependency, no presenters.

## Install

```bash
npm install @yagejs-addons/quests
npm install @yagejs/core
```

`@yagejs/core` is the only peer. No `./presenters` subpath.

## Catalog — `defineQuests`

Two-level id capture: quest ids from the outer map's keys, per-quest objective
ids from each quest's own `objectives` map keys. No `<T>` argument is ever
written — `QuestLog<TDefs>` infers both levels from the `defineQuests` return
value.

```ts
import { defineQuests, QuestLog } from "@yagejs-addons/quests";

const quests = defineQuests({
  gatherHerbs: {
    title: "Gather Herbs", // required, non-empty
    summary: "...", // optional
    objectives: {
      herb: { title: "...", count: 5 }, // count omitted -> default 1
      turnIn: { title: "..." },
    },
    autoComplete: false, // optional; default true
    requires: [], // optional; quest ids that must be `completed` first
  },
  thinThePack: {
    title: "Thin the Pack",
    requires: ["gatherHerbs"],
    objectives: { wolf: { count: 3 } },
  },
});
```

`ObjectiveDefInput`: `{ title?; description?; count?: number (default 1, must
be integer >= 1); optional?: boolean (default false, excluded from
auto-complete rollup) }`.

Validation (throws at `defineQuests` call time): empty `title` on a quest;
non-integer or `< 1` objective `count`; a quest with no non-`optional`
objective (an empty or all-optional objective set would never gate the
auto-complete rollup, so the quest would complete immediately); a `requires`
id naming a quest absent from the whole map (forward references to a
later-declared quest are fine).

`QuestCatalog<TDefs>`: `ids` (readonly array, authoring order), `get(id)`
(throws on unknown), `tryGet(id)` (undefined on unknown), `has(id)` (type
predicate), `objectiveIds(quest)`.

## QuestLog — the runtime model

```ts
const log = new QuestLog(quests); // TDefs inferred from `quests`, zero <T>
```

### Lifecycle

- `start(quest): QuestStartResult` — `{ ok: true }` from `available`. Else
  `{ ok: false, reason }`: `"locked"` (a `requires` quest isn't `completed`),
  `"already-active"`, `"already-completed"` (also covers a `failed` quest —
  terminal states share this reason), `"unknown-quest"` (id absent from the
  catalog — never throws; a boundary check).
- `advance(quest, objective, amount = 1): void` — active-only. Clamps to the
  target; **silent no-op** (no event) if the quest isn't `active`, or if
  `amount <= 0`. Progress never decreases via `advance`.
- `setProgress(quest, objective, count): void` — active-only. Sets the count
  absolutely, `clamp(count, 0, target)` — CAN decrease. Silent no-op if
  inactive.
- `complete(quest, objective): void` — active-only; drives straight to the
  target. No-op if already done or inactive.
- `completeQuest(quest): void` — completes only when the quest is active and
  every non-optional objective is currently done. Does not alter progress.
- `forceCompleteQuest(quest): void` — escape hatch: marks every objective done
  and completes any non-terminal known quest regardless of prerequisites or
  progress.
- `fail(quest): void` — `active` or `available` -> `failed`. No-op if already
  terminal. Terminal in v1 (no re-open/retry) — a failed quest never reaches
  `completed`, so any quest that `requires` it stays `locked` permanently.

Unknown **objective** id (unreachable through the typed API) throws. Unknown
**quest** id behaves exactly like "not active" everywhere except `start`
(silent no-op, since a nonexistent quest is never active).

### Reads

- `status(quest): "locked" | "available" | "active" | "completed" | "failed"`
  — pure function of stored phase; no separate stored "locked". A quest never
  started is `locked` unless every `requires` quest is `completed`.
- `isActive(quest)` / `isCompleted(quest)`: boolean.
- `canComplete(quest): boolean` — active and every non-optional objective is
  currently done.
- `progress(quest, objective): number` (0 if untouched).
- `objectiveDone(quest, objective): boolean`.
- `available() / active() / completed(): QuestId[]` — authoring order.
- `get(quest): QuestState` — `{ status, objectives: Record<objId, number> }`,
  frozen, every declared objective present (0 default).

### Auto-complete rollup

With `autoComplete: true` (default), after any objective crosses from
below-target to at-or-above it: emits
`objectiveCompleted`, then — if every **non-`optional`** objective on that
quest is now done — the quest transitions to `completed` and emits
`questCompleted`, all before the trailing `changed`. `optional` objectives
never gate completion.

### Events — `log.on(event, fn): () => void`

`questStarted { questId }` · `objectiveProgressChanged { questId, objectiveId,
progress, count, done }` · `objectiveCompleted { questId, objectiveId }` ·
`questCompleted { questId }` · `questFailed { questId }` · `changed { questId
}` (coarse re-render signal, fires once per mutating call, after the
fine-grained event(s)).

### Save

```ts
log.snapshot(): QuestSnapshot; // { quests: Record<questId, { phase, objectives }> } — plain JSON
log.restore(snapshot): void;
```

Only started quests appear in a snapshot. `restore` drops quest ids the
current catalog no longer declares, drops objective ids no longer declared
within a restored quest, clamps surviving counts to the current target, and
installs the complete restored log before notifying listeners. An active quest
whose current targets are all satisfied auto-completes unless `autoComplete`
is `false`. It emits `questCompleted` before that quest's `changed`, so completion
listeners can start dependent quests against the full restored state. Restore
does not replay `objectiveCompleted`. Completed, failed, and manual-completion
quests keep their saved status. It emits one `changed` per restored (and known)
quest, in addition to changes made by listeners. Not-started quests
re-derive `locked`/`available` from `requires`. `@yagejs/save` is not a
dependency. Include this domain snapshot in the game's explicit save state and
call `restore` after loading it.

## QuestController (optional L2a)

```ts
import { QuestController, QuestCompletedEvent } from "@yagejs-addons/quests";

player.add(new QuestController({ log })); // TDefs inferred from `log`
scene.on(QuestCompletedEvent, ({ questId }) => {});
```

Mirrors the log's six model events onto the host entity as engine-bus events
(`QuestStartedEvent`, `QuestObjectiveProgressChangedEvent`,
`QuestObjectiveCompletedEvent`, `QuestCompletedEvent`, `QuestFailedEvent`,
`QuestChangedEvent`) — bubble entity -> scene. Bus payloads carry `string`
ids (event tokens can't be generic). No per-frame `update`. `.log` exposes the
hosted model. Entirely optional — `log.on(...)` alone reaches the same
consequences.

Disabling `QuestController`, or deactivating its entity, stops the event mirror.
The standalone `QuestLog` remains live and keeps every model change. Events
that occur while the controller is dormant are not replayed when it enables.

## Binding objectives to other addons — no addon dependency

Quests declares only `@yagejs/core`. The game subscribes to whatever events it
likes and calls `advance`/`complete` directly — the silent-no-op-on-inactive
contract means no active-state guard is needed in the adapter:

```ts
import { InventoryItemAddedEvent } from "@yagejs-addons/inventory";
player.on(InventoryItemAddedEvent, (e) => {
  if (e.itemId === "redHerb") log.advance("gatherHerbs", "herb", e.quantity);
});
```

For a current-inventory requirement, set `autoComplete: false` on the quest
and synchronize absolute progress on both inventory additions and removals:

```ts
const syncWood = () =>
  log.setProgress("bringWood", "wood", inventory.count("wood"));
inventory.on("itemAdded", syncWood);
inventory.on("itemRemoved", syncWood);
log.start("bringWood");
syncWood();

if (log.canComplete("bringWood")) log.completeQuest("bringWood");
```

## Deferred to v1.x

Journal/tracker presenter (`./presenters`), published per-addon adapters
(`./adapters`), auto-start/auto-offer chaining, quest abandon/reset/retry,
timed objectives, hidden objectives, "any N of M" branching, prerequisite
cycle detection, reward payloads, i18n resolver (text is addressable by
`(questId, objectiveId)` already).
