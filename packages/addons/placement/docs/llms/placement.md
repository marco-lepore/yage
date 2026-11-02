# @yagejs-addons/placement

Furniture and non-physical modular placement. Requires core, level and input.
Renderer is optional and used only by `/presenters`. Root imports work headlessly.

## Setup

```ts
import { Entity, Transform } from "@yagejs/core";
import {
  buildLevelCatalog,
  defineLevelEntity,
  defineLevelProject,
} from "@yagejs/level";
import { PlacementLayout, PlacementSession } from "@yagejs-addons/placement";

class Chair extends Entity {
  static readonly level = defineLevelEntity({ id: "chair", version: 1 });
  setup(): void {
    this.add(new Transform());
  }
}
const built = buildLevelCatalog(defineLevelProject({ entities: [Chair] }));
if (!built.ok) throw new Error(built.errors.map((e) => e.message).join("\n"));
const layout = new PlacementLayout({
  catalog: built.catalog,
  definitions: {
    chair: { footprint: [{ x: -16, y: -16, width: 32, height: 32 }] },
  },
  areas: { room: { bounds: { x: 0, y: 0, width: 512, height: 384 } } },
});
const session = new PlacementSession(layout);
session.select("chair");
session.aim({ x: 100, y: 100, rotation: 0 }, "room", { grid: 0 });
console.log(session.confirm());
```

No loop is required headlessly. With a scene, add `PlacementController` to an
entity. Pass the model, optional input, and independent `layout`, `preview`
and `catalog` channels. `createPlacementViews()` on `/presenters` returns the
three canvas defaults. `PlacementPointerInput` and `placementControls()` are
exported from the root; pass the latter to `InputPlugin({ actions })`. Omit
`input` for the default binding, pass a custom binding to replace it, or
pass `input: null` for host control without device polling. The controller's
update drives input and views. Disable cancels the draft and disposes adapters;
re-enable mounts them again. Layout state survives.

## Model contract

| Method                                 | Result                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `preview(command, execution?)`         | Immutable `PlacementResult`; no mutation or ID consumption                     |
| `commit(command, execution?)`          | Revalidates and atomically publishes a valid candidate                         |
| `undo(execution?)`, `redo(execution?)` | Revalidate current policies; refusal retains history                           |
| `snapshot()`                           | Frozen `PlacementSnapshot` with all durable domain state                       |
| `restore(snapshot, execution?)`        | Trusted load; validates invariants, bypasses rules/permissions, clears history |
| `worldPose(id, snapshot?)`             | Composed pixel position and radian rotation                                    |
| `toLevelDocument(snapshot?)`           | Existing level format, catalog type IDs, parameters, hierarchy                 |
| `subscribe(listener, execution?)`      | Disposer; committed/rejected events                                            |

`PlacementModel` is a public structural contract; sessions and controllers
accept replacements. `PlacementLayout` is the concrete default. The model owns
no ECS entity registry, save slot, physics world, input singleton or clock.

`PlacementResult`: `ok`, `revision`, `intent`, `before`, `after`, `changes`,
`issues`. A rejected candidate can still appear in `after` for preview drawing;
`snapshot()` is the committed authority. Each issue has `code`, `message` and
optional `object`, `other`, `area`, `path`, `rule`.

`PlacementCommand` variants:

- `place`: `type`, `target`, optional `variant`, `params`.
- `move` / `duplicate`: `id`, `target`. Descendants move/copy together.
- `remove`: `id`, optional `cascade` (default false).
- `modify`: `id`, optional `variant` (null clears it), replacement `params`.
- `customize`: `area`, partial `finishes` map.
- `batch`: `commands`; final candidate commits as one history entry.

`target`: `{ area, pose: { x, y, rotation }, attachment?: { parent, socket } }`.
Root poses are world-space; attached poses are socket-local. All numbers written
into state must be finite. Malformed config/commands throw at entry; expected
placement failures return issues. IDs are generated as `p1`, `p2`, etc. History
never reuses IDs. `historyLimit` is a nonnegative integer, default 50.

## Catalog and geometry

`definitions` is a plain object keyed by existing `LevelCatalog` IDs. No classes
or spawn callbacks go in it. Required `footprint`: nonempty array of local
`{ x, y, width, height }` rectangles, with positive dimensions. Optional fields:
`label`, `category`, `clearance` (default 0), `surfaces` (default `["floor"]`),
`sockets`, `params`, `variants` (named parameter patches). Combined parameters
are schema defaults, definition params, selected variant, then object params.
Explicit object params override variant values; use `params: {}` to clear overrides.
Duplication remaps catalog entity references within the copied subtree; external
references keep their targets.
Existing level schemas validate them.

Areas: `bounds` rectangle; optional `surface` (default `floor`), `categories`,
`capacity`, `permissions`, `finishes`. Whole padded footprints must fit.
Permissions are per operation: place/move/remove/modify/customize. Moves check
both areas and every descendant. Missing permissions allow the operation.
Finish channels contain nonempty arrays of allowed strings; first is default.

Sockets: required `pose` and `surface`; optional `accepts` type IDs, `capacity`
(default 1), `bounds`, `radius` (default 24 px), `priority` (default 0). Fixed
sockets require zero local x/y. Bounded sockets contain every padded footprint
rectangle and allow surface adjustment. Parents and children share an area.
Cycles, missing parents, incompatible surfaces and full sockets are rejected.

Occupancy compares rotated rectangles. Touching edges pass. Solid/padded
intersection fails; empty clearance margins can overlap. Objects on different
surface labels do not collide. Ancestors and descendants can overlap. Checks
are pairwise within a layout; split independent plots for large worlds.

## Session and input

`PlacementSession(model, execution?)`: `select(type, target?)`, `move(id)`,
`duplicate(id)`, `setCommand(command)`, `aim(worldPose, area, options?)`,
`rotate(radians = PI/2)`, `confirm()`, `cancel()`, `remove(id, cascade = false)`,
`undo()`, `redo()`, `refresh()`, `inspect()`.

Aim options: `grid` defaults to 16; zero is free placement. `snap` defaults to
true. Socket priority, distance, then authored order resolve ties; full sockets
and the moving subtree are excluded. Direct commands do not snap. Refresh
reevaluates policies even when the pointer has not moved. Rejected confirm keeps
the draft; successful confirm clears it. Cancel never changes committed state.

`placementControls()` maps Enter, Escape, R, Z, Y, D, Delete/Backspace and G to
prefixed action names, plus gamepad A/B/Y/X and LB/RB for confirm/cancel/rotate/
duplicate/undo/redo. The pointer adapter uses world positions for objects and
screen positions for the catalog, skips claimed presses, and claims handled
presses. Game code must arbitrate focus by enabling the intended controller.
Default views draw footprints and catalog labels; they do not instantiate
catalog artwork or interpret finish names.

`PlacementPointerInput(options?: PlacementPointerInputOptions)` accepts optional
callbacks:

- `toLayout(pose: PlacementPose): PlacementPose`: renderer world to layout
  coordinates, before area selection, aiming and default footprint picking.
- `project(pose: PlacementPose, session: PlacementSession): PlacementPointerProjection`:
  returns `{ pose: PlacementPose, snap?: boolean }` after `toLayout`, before
  grid/socket snapping. Omit `snap` for normal socket snapping; false keeps
  an aim on the projected plane when it misses a visible support.
- `hitTest(pose: PlacementPose, session: PlacementSession): string | null`:
  replace footprint picking, using original renderer world coordinates.
  Return an existing object ID or `null` for an explicit miss.

All callbacks are pure and synchronous, and run through the host error boundary.
Non-finite coordinates and unknown picked IDs throw before draft/selection changes.
Catalog picking always uses screen coordinates.
Keep support
validation in model rules too. The side-view example projects onto floors and
tabletops; its rule rejects floating or rotated furniture.

## Rules, consequences and saving

Rules are `{ id, evaluate(evaluation) => readonly PlacementIssue[] }`. They are
pure/synchronous and run after built-in invariants pass. Evaluation includes
before/after snapshots and all affected descendants. Read inventory/permissions
from game-owned state. Commit events are consequences; spend/refund there,
including undo/redo. The component mirrors `PlacementCommittedEvent` and
`PlacementRejectedEvent`. Supply an `ErrorBoundary` for headless inspection;
the controller passes its engine boundary. Throws stop dispatch. State/history
already published by a successful commit remain published after a listener
throws. Same-layout reentrant operations are rejected.

Snapshot includes version 1, nextId, objects (IDs/types/params/variants/poses/
attachments/area) and area finishes. Draft and history are transient. The game
wraps layout and economy in an explicit `Serializable` root for `@yagejs/save`.
Restore is trusted and bypasses gameplay permissions/costs, but validates
structural, spatial and catalog constraints. It preserves current state on
rejection and clears history on success. Cancel sessions before a load.
Migrate saves in the game when schemas or definitions change.

`toLevelDocument()` does not include area finishes or editing metadata. Keep
the snapshot for editing. Prepare exported levels, preload their assets, then
instantiate them using the normal level lifecycle. Live artwork is game-owned;
The top-down, side-view and isometric examples use catalog entity classes,
with the same artwork in thumbnails and previews. The isometric example keeps
layout coordinates on the floor plane and projects visuals, artwork picking
and tabletop targeting in game code.

No structural simulation, physics destruction, construction timer, economy
transaction, proximity grouping, multiplayer authority or separate blueprint
registry. Batches, subtree duplication and saved layouts provide object groups.
