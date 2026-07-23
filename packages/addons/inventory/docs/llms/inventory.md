# @yagejs-addons/inventory

Slot-based inventory for YAGE (`@yagejs-addons` scope, independently versioned,
NOT in the engine `fixed` group). Headless model (stacking, actions, transfers,
snapshots) + a `@yagejs/core` Component host + one pixi slot view with swappable
icon/row cell presets and a zero-asset default theme.

## Install

```bash
npm install @yagejs-addons/inventory
# engine peers (single install, reused — not bundled):
npm install @yagejs/core @yagejs/input @yagejs/renderer
```

`@yagejs/core` + `@yagejs/input` are required peers; `@yagejs/renderer` is an
optional peer (only the `./presenters` subpath needs it). No runtime deps.

## Two entry points (export split — load-bearing)

- **`.`** (root) — headless + non-pixi. `defineItems` / `ItemCatalog`,
  `Inventory` (the model), `filteredView` (a subset projection of one model),
  comparators, `InventorySession` + channel contracts,
  `InventoryController` (a `@yagejs/core` Component), engine events,
  `@yagejs/input` bindings. **MUST NOT transitively import pixi / renderer.**
- **`./presenters`** — everything pixi. `SlotsView` + the `iconCell` / `rowCell`
  presets, `DetailView` / `ActionMenuView` / `InventoryChrome`, `PanelLayout`,
  `defaultInventoryTheme()`, the `createInventoryPanel` factory,
  `INVENTORY_LAYERS`.

```ts
import { defineItems, Inventory, InventoryController } from "@yagejs-addons/inventory";
import { createInventoryPanel, INVENTORY_LAYERS } from "@yagejs-addons/inventory/presenters";
```

Both addons (dialogue + inventory) export the input-binding classes
(`KeyboardInputBinding`, `PointerInputBinding`, `CompositeInputBinding`) and the
`InputBinding` type under the SAME names with different `bind()` shapes — in a game
using both, alias at import and never mix one addon's binding pieces into the other's
controller. The bundle factory and action preset are domain-named
(`inventoryControls`, `INVENTORY_ACTIONS`; dialogue's are `dialogueControls`,
`DEFAULT_DIALOGUE_ACTIONS`), so those don't collide.

## 5-minute setup (zero assets)

`defaultInventoryTheme()` = Graphics panel + canvas text; icon-less items render
as colored tiles with the item's initial. The scene must declare the inventory
layers.

```ts
import { Scene } from "@yagejs/core";
import {
  defineItems, Inventory, InventoryController, inventoryControls, InventoryActionEvent,
} from "@yagejs-addons/inventory";
import { createInventoryPanel, INVENTORY_LAYERS } from "@yagejs-addons/inventory/presenters";

const catalog = defineItems({
  potion: { name: "Potion", maxStack: 5, description: "Heals 25 HP." },
  sword: { name: "Iron Sword" },
});
const inventory = new Inventory({
  catalog,
  capacity: 15,
  actions: [{ id: "use", label: "Use", consumes: true }, { id: "drop", label: "Drop" }],
});

class MyScene extends Scene {
  readonly layers = [...INVENTORY_LAYERS]; // inventory-panel / -content / -overlay (screen-space)
  onEnter() {
    const bundle = createInventoryPanel(); // theme defaults to defaultInventoryTheme()
    const host = this.spawn("inventory");
    host.add(new InventoryController({ ...bundle, inventory }));
    host.on(InventoryActionEvent, (e) => {
      if (e.actionId === "use" && e.itemId === "potion") heal(25); // consequence = game's
    });
  }
}
```

The default input (when `input` is omitted) is the FULL set — keyboard/gamepad
polling `move-up/-down/-left/-right`, `interact` (confirm), `cancel`, `sort`,
and `inventory` (toggle — the ONE action polled while closed), PLUS
mouse/touch hover + click wired to the bundle's own hit-testing. Unmapped
action names silently never fire (a total miss logs a dev-mode warning);
construct `inventoryControls(bundle, { actions })` yourself only to rename them.

## The model is always live

`Inventory` is plain state + operations; the panel is an observer. Game logic
never goes through the UI:

```ts
inventory.add("potion", 3);              // pickup — full/partial/rejected result
if (keyItems.has("goldKey")) {           // door check, UI closed
  keyItems.remove("goldKey", 1);
  openDoor();
}
```

## Catalog — `defineItems`

Ids are the map keys (typed end-to-end: `Inventory<"potion" | "sword">`), defs
are frozen at load. `catalog.get(id)` throws on unknown ids; `tryGet`/`has` for
untrusted strings; `orderOf(id)` = authoring order (the default sort key).

`ItemDefInput` fields: `name` (required), `description?`, `icon?` (texture key,
presenter hint), `color?` (fallback tile tint), `category?`, `tags?`,
`maxStack?` (integer ≥ 1; default = the inventory's `defaultMaxStack`, which
defaults to **1** — unstackable unless declared), `stacking?`
(`"multi"` default | `"single"`), `actions?` (ids that apply to this item),
`data?` (opaque per-item metadata — weight, base value), `instance?`
(declares the per-STACK data type, see below).

### Typed per-stack `data`

A stack's `data` (durability, rolled stats) is typed per item via `instance`.
Declare the shape with the phantom `instanceData<T>()` helper; `defineItems`
captures each item's type, and `new Inventory({ catalog })` (no explicit type
argument) infers both the id union AND the data map:

```ts
import { defineItems, instanceData, Inventory } from "@yagejs-addons/inventory";

const catalog = defineItems({
  potion: { name: "Potion", maxStack: 5 },                                   // no instance → data is `never`
  herb:   { name: "Herb", instance: instanceData<{ quality: number }>() },
  sword:  { name: "Iron Sword", instance: instanceData<{ durability: number }>() },
});

const inv = new Inventory({ catalog });          // infers ids + typed data map
inv.add("herb", 1, { data: { quality: 90 } });   // data checked against the item
inv.count("herb", (d) => d.quality > 80);         // `d` typed — no cast
inv.find("herb", (d) => d.durability);            // ✗ compile error: no such field
inv.add("potion", 1, { data: { quality: 1 } });   // ✗ compile error: potion carries no data
```

`data`/predicate narrow by the item id passed to `add`/`count`/`has`/`find`/
`findAll`/`remove`/`transfer`. An explicit id-only type (`Inventory<ItemId>`) or
an untyped catalog keeps the permissive `Record<string, unknown>`, so existing
code is unaffected. Metadata `data` (on the def) stays opaque; only the per-stack
`instance` data is typed. Reading a typed shape off a def needs an explicit cast:
`catalog.get(id).data as ItemMeta`.

## Inventory — options

```ts
new Inventory({
  catalog,                 // required
  capacity: 15,            // slot count; omit = unbounded (grows)
  autoCompact: true,       // close gaps on REMOVALS (list-style); default false
  defaultMaxStack: 1,      // per-stack default when a def has no maxStack
  accepts: (def) => def.category === "key",   // section filter → rejected "filtered"
  constraints: [weightLimit],                 // InventoryConstraint[] (see below)
  actions: [use, drop],                       // ItemActionDef[] (see below)
});
```

## Stacking

- `"multi"` (default): fills existing non-full stacks first, then opens new
  slots, `maxStack` per stack — big adds chunk (12 potions @ maxStack 5 →
  5/5/2).
- `"single"`: at most ONE stack of the item; `maxStack` is the item's TOTAL
  cap; the excess is rejected (`"stack-cap"`). Zelda-arrows semantics.
- Stacks carrying `data` (instance payloads: durability, rolled stats) NEVER
  auto-merge; they open fresh slots. Anonymous `remove` / `transfer` drain
  fungible stacks first, then dip into data stacks — what leaves comes back in
  the result (`RemoveResult.stacks`, data intact), so nothing is silently
  destroyed. Target instances with a data predicate
  (`(data, stack) => boolean`): `count(id, (d) => d.quality > 80)`,
  `has(id, (d) => d.opens === "boss-lair")`, `remove(id, qty, where)`. Or grab a
  handle — `find(id, where?)` / `findAll(id, where?)` return a `LocatedStack`
  `{ slot, stack }` you pass to `remove(ref)` / `transfer(target, ref)`; a stale
  ref (its stack removed or shifted) is a safe no-op.

## Operations (all emit model events)

```ts
add(itemId, qty = 1, { data? }): AddResult        // { added, rejected, reason?, constraintId?, slots }
remove(itemId, qty = 1, where?): RemoveResult     // { removed, stacks }; drains anon first, then data
remove(ref): RemoveResult                         // removes exactly find()'s stack (stale ref = no-op)
removeAt(slot, qty?): RemoveResult                // whole stack when qty omitted; result carries `stacks`
setSlot(slot, stack | null)                       // raw escape hatch (validates id + quantity only)
move(from, to): MoveResult                        // { ok, reason?, effect? }; player slot interaction
split(from, qty, to?): SplitResult                // { ok, reason? }; to defaults to the first empty slot
sort(comparator?, { consolidate? })               // compacts + consolidates + orders (see below)
compact()                                          // close gaps, keep order
clear()                                            // bulk reset (only `changed` fires)
transfer(target, itemId, qty = 1, where?): TransferResult  // moves anon then data, payload intact
transfer(target, ref): TransferResult              // moves exactly one located stack
transferSlot(target, slot, qty?): TransferResult   // carries the data payload
count(itemId, where?) / has(itemId, qty = 1, where?)   // where = (data, stack) => boolean; data stacks only
find(itemId, where?) / findAll(itemId, where?)         // LocatedStack { slot, stack } — the ref remove/transfer take
get(slot) / firstSlot(itemId) / stacks(): LocatedStack[]  // stacks() = every occupied slot as { slot, stack }, in slot order
slots / capacity / used / isFull                   // readonly state
snapshot(): InventorySnapshot                      // JSON-able whole state
restore(snapshot): { dropped }                     // unknown ids/bad qty dropped; capacity-shrink overflow re-flows into free slots, drops only when full
on(event, fn): () => void                          // model events (below)
```

Failure conventions: interaction ops REPORT (a refused gesture is a normal
outcome, not a throw). `add`/`remove`/`transfer` return count objects
(`{ added, rejected, reason? }` and similar); `move`/`split`/`invokeAction`
return an `Outcome` (`{ ok, reason? }` — always truthy, so a caller reads
`.ok` rather than the return value itself; `move` also carries `effect`).
Only the `setSlot` escape hatch and invalid arguments (non-positive
quantities) THROW.

Reject reasons: `add`/`transfer` return `"filtered"` (`accepts` predicate),
`"capacity"` (no slot), `"stack-cap"` (single-stacking total), or `"constraint"`
(the last one also carries `constraintId`, the most limiting constraint's
`id`, so a weight toast and a quest-gate toast can differ); from `add`/`transfer`
these fire the `rejected` model event. `move`/`split`/`invokeAction` return
`"empty"` (source/slot holds nothing), `"same-slot"` (source and target are
the same), `"out-of-range"` (target outside `capacity`), `"occupied"`
(`split` target already holds a stack), `"indivisible"` (`split` quantity
would take the whole stack or more), or `"no-action"` (`invokeAction` id
isn't currently offered for that slot); `split` also returns `"capacity"` when
an auto target finds no empty slot. These gesture returns fire no model event.
All ten reasons share one `RejectReason` union; each method only ever emits its
own subset.

Sorting: `sort()` defaults to `byCatalogOrder` and `consolidate: true`
(re-packs partial dataless multi-stacks into full ones — the Sort-button
tidy-up). Comparators see `SortEntry { stack, def, order }`; built-ins:
`byCatalogOrder`, `byName`, `byCategory`, `byQuantity`.

## Constraints — extensible limits beyond slots

Slot capacity is structural; anything else (weight, currency caps) is an
injected `InventoryConstraint`:

```ts
interface InventoryConstraint<TId extends string = string> {
  id?: string; // surfaced as `constraintId` on rejections
  maxAcceptable(def: ItemDef<TId>, inv: InventoryReader<TId>): number; // how many MORE may enter
}
```

Return `Infinity` for "no limit from this constraint". A `NaN` return is
treated as 0 (the add rejects with `"constraint"` instead of corrupting the
result).

## Item actions — rules in, consequences out

```ts
interface ItemActionDef {
  id: string;
  label: string;
  available?(ctx: { slot, stack, def, inventory }): boolean; // per-stack gate
  consumes?: boolean;  // model removes 1 AFTER the action event (don't also remove in the handler)
  closes?: boolean;    // UI hint: close the panel after invoking
}
```

Declared per-inventory (`actions: [...]`); `ItemDef.actions` narrows which
apply to an item; `available` gates per-stack at menu time
(`available: (ctx) => state.equipped !== ctx.stack.itemId`). Resolution:
`inventory.getActions(slot)`; invocation: `inventory.invokeAction(id, slot):
ActionResult` emits the `"action"` model event / `InventoryActionEvent` — the
game applies what the action MEANS in that handler. The action menu UI drives
this automatically.

## Model events / engine events

Model (`inventory.on(...)`): `changed { slots }` (every mutation, the
re-render signal) · `itemAdded { itemId, quantity, slots }` ·
`itemRemoved { itemId, quantity }` ·
`rejected { itemId, quantity, reason, constraintId? }` ·
`action { actionId, slot, itemId, quantity, consumes }` — `consumes: true`
means the model removes one unit itself right after the event; branch on it
instead of removing in the handler, or you consume two.

Engine (entity → scene, via the controller — fire with the panel closed too):
`InventoryItemAddedEvent`, `InventoryItemRemovedEvent`, `InventoryRejectedEvent`
(the "inventory full!" toast hook), `InventoryChangedEvent`,
`InventoryActionEvent`, plus UI events `InventoryOpenedEvent`,
`InventoryClosedEvent`, `InventorySelectionChangedEvent { slot, itemId | null }`.

Engine-bus payloads carry `string` item ids (event tokens can't be generic);
`catalog.has(e.itemId)` is a type predicate that narrows them back to the
catalog's id union — or handle on `inventory.on(...)`, which is `TId`-typed
end to end.

## InventoryController (the Component host)

```ts
host.add(new InventoryController({
  ...bundle,                    // slots (required) + chrome/detail/actionMenu (optional)
  inventory,
  title: "Backpack",
  closeOnCancel: true,          // default; false = embedded (host owns the escape route)
  sortComparator: byCategory,   // default byCatalogOrder
  // omit `input` = full default (keyboard/gamepad + pointer, hit-testing
  // wired to THIS bundle); null = NO device input (host drives); or pass
  // inventoryControls(bundle, { actions }) to rename the action names.
  openOnAdd: false,
  onConfirm: (e) => {},         // browse-level confirm (picker flows)
  onCancel: () => {},           // browse-level cancel (embedded host returns to its menu)
}));
```

API: `open() / close() / toggle() / isOpen() / isMenuOpen()` ·
`setSource(source, { title? })` (tabbed menus swap the source in place —
a plain `Inventory` or a `filteredView` of one) ·
`setTitle` · `inventory` getter (the source currently presented) · `setInputEnabled(bool)`
(focus seam: an unfocused panel stays visible + live but polls no input, and
an open action menu closes when focus leaves) · the input-agnostic driving
seam `move(dir) / select(slot) / selection() / confirm() / cancel() / sort()`
— the same calls the bindings make, for host menus and tests. `sort()` works
while closed too (the model is live; the panel picks the order up on open).

Guards: methods refuse (dev-warn) after the component is removed; `open()`
before `onAdd` throws.

## Presenters, factory, themes (`./presenters`)

ONE factory, ONE view. The `cell` preset decides what a cell looks like; flat
geometry options decide the layout. A "list" is `columns: 1` with `rowCell`; a
text menu is `columns: 2`; the default is a 5-column `iconCell` grid.

```ts
createInventoryPanel(theme?, {
  cell: iconCell,               // or rowCell (text rows). Default iconCell.
  columns: 5, visibleRows: 4,   // cells per row / scroll-window rows
  cellWidth: 56, cellHeight: 56,// cell extents (per axis; need not be square)
  gap: 6,                       // number (both axes) or { x, y }
  wrap: false,                  // cursor wrap at edges
  chrome: true, detail: true, actionMenu: true,   // subtract pieces for embedding
  bounds: { x, y, width, height },                // pin the panel; missing knobs derive from it
}): InventoryBundle
```

Cell geometry is NOT in the theme — it is per-instance layout. Each option's
default comes from the chosen preset (`iconCell`: 5×4 of 56×56, gap 6;
`rowCell`: 1 column of wide short rows). Pass presets UNCALLED: `{ cell: rowCell }`.

Geometry solves per axis: whatever you leave unset the preset fills; an explicit
`bounds` pins the panel and derives the missing count or extent to fit. Giving
BOTH a count and an extent on an axis alongside `bounds` is overdetermined — the
declared values win, the window centers, and it logs a dev-mode warning. A window
still larger than the bounds logs the overflow warning instead of silently
clipping.

A bundle is `{ slots, chrome?, detail?, actionMenu? }` — spread it into the
controller and override any piece. All presenters share ONE `PanelLayout`
(panel/header/content/detail rects). `iconCell`: windowed cells + icon
(`ItemDef.icon` texture key) or colored-tile fallback with the item's initial +
quantity badges. `rowCell`: `Name ×qty` rows + a highlight bar (pairs with
`autoCompact`). Both scroll by integer rows with ▲/▼ hints; the action menu
anchors beside the selected cell. `INVENTORY_LAYERS` (screen-space, orders
1050–1070) sit BELOW the dialogue addon's 1100+ so a conversation plays over an
open inventory.

`InventoryTheme` is a flat data object: every field a built-in renderer reads.
It covers colors, sizes, alphas, radii, layer names, and texture keys/insets.
Cell geometry (columns, cell size, gaps) is NOT here — it lives on the factory
options. Optional fields derive a default when omitted: `borderWidth` (panel
stroke → `1.5`), `cellRadius` (cell bg + tile radius → `cornerRadius / 2`),
`highlightRadius` (row/menu bar radius → `max(cellRadius − 1, 0)`),
`rowHighlightAlpha` (row bar fill alpha → `0.22`), `hintAlpha` (scroll-hint
alpha → `0.6`), `menu.highlightAlpha` (menu bar fill alpha → `0.45`),
`descriptionSize` (`textSize - 2`), `menu.padding` / `menu.rowGap` (10 / 6),
`headerGap` / `detailGap` (10 / 10), `tileLetterColor` (`0x1a1a2e`).
`frameAlpha` applies to both the panel chrome and the action-menu popup.

`textured?: { panel?, menu? }` opts into nine-slice frames per surface. A
present key replaces that surface's drawn Graphics frame with a stretched
texture (`{ texture, insets: { left, top, right, bottom } }`, insets in
source-texture px); the panel keeps its divider lines, the menu keeps its bar +
labels. Omit the field (or a key) for the Graphics default. Textures are
`TextureInput` (asset key or `Texture`), so the theme stays serializable:

```ts
createInventoryPanel({
  ...defaultInventoryTheme(),
  textured: { panel: { texture: "ui/panel.png", insets: { left: 12, top: 12, right: 12, bottom: 12 } } },
});
```

Beyond theme dials, drawing is swappable via three render-delegate presets on
the factory options — the view computes rects, placement, and hit-tests; the
preset only draws, so hit-targets never desync from a custom look:
`{ cell }` (a cell — `iconCell`/`rowCell`), `{ menuSkin }` (the action-menu
frame/rows/highlight bar), `{ hints }` (the ▲/▼ scroll affordance). Pass them
UNCALLED (`{ menuSkin: myMenuSkin }`); the factory calls each with the theme.
`layoutActionMenu(...)` is exported for a wholesale menu replacement (the
`cellGeometry` role for the popup: menu size, anchored/flipped/clamped
placement, row rects). Changing placement, windowing, or navigation means
replacing the whole view (`SlotsPresenter`, `ActionMenuPresenter`).
Spread-and-tweak the default theme:

```ts
import { createInventoryPanel, defaultInventoryTheme } from "@yagejs-addons/inventory/presenters";
const bundle = createInventoryPanel({ ...defaultInventoryTheme(), highlightColor: 0xff5555 });
```

## Embedded in an existing menu (no separate API)

Standalone vs embedded is configuration:

```ts
const bundle = createInventoryPanel(theme, {
  chrome: false,                        // the host menu draws its own frame
  bounds: { x: 320, y: 96, width: 344, height: 300 },  // sit inside the host layout
});
const ctrl = host.add(new InventoryController({
  ...bundle, inventory,
  input: null,                          // the host menu owns the devices
  closeOnCancel: false,                 // Esc returns to the host's tab bar
  onCancel: () => menu.focusTabs(),
}));
// The host's focus handling drives the panel:
menu.onTabFocus("items", () => ctrl.open());
menu.onKey("down", () => ctrl.move("down"));
menu.onKey("confirm", () => ctrl.confirm());
```

Custom UI entirely? Implement the channel contracts (`SlotsPresenter` is the
only required one — `present/setSelected/navigate/setVisible/clear` + Mountable
`mount(scene)/dispose`, optional `slotAtPoint` for pointer support) and skip
`./presenters` altogether; `InventorySession` (headless) does the orchestration
either way.

## Multiple inventories

Each `Inventory` is independent — sections are separate models
(`accepts` filters what each takes), presented by separate controllers or one
controller swapping via `setSource`. Two visible panels at once (transfer
screens): give ONE input focus via `setInputEnabled`, move stacks with
`transfer` / `transferSlot`.

## Filtered views (`filteredView`)

A `filteredView` shows a SUBSET of one `Inventory`'s stacks — a hotbar that
shows only usable items while staying a live mirror of the same backpack, or a
tabbed menu showing one category at a time. Unlike a second `Inventory` with
`accepts`, it's not a separate container: an add or a `use` on either surface
is the same mutation, because it's one shared model.

```ts
const usable = filteredView(backpack, (stack, def) => def.actions?.includes("use") ?? false);
host.add(new InventoryController({ ...bundle, inventory: usable })); // or ctrl.setSource(usable)
usable.invokeAction("use", 0);        // presented index 0 -> whatever model slot it maps to
usable.modelSlot(0);                  // the escape hatch back to the real slot
usable.source;                        // the underlying Inventory
```

Both `Inventory` and `filteredView`'s return value implement `InventorySource`
— the surface `InventorySession`/`InventoryController` consume (`slots`,
`capacity`, `used`, `catalog`, `on`, `getActions`, `invokeAction`, `sort`).
`InventoryController.inventory`'s type is `InventorySource`, so pass either a
plain `Inventory` or a `filteredView` to the `inventory` option.

Projection semantics: `slots` is hole-free and compacted (only matching
stacks, in slot order); `capacity` is always `undefined` (the view has no size
of its own); `used` is the filtered count; `getActions`/`invokeAction` take
PRESENTED indices, remapped to the model slot underneath; `sort` forwards to
the whole model (one shared array — a projection can't reorder only its
subset). Every event but `"changed"` forwards straight from the model (real
item ids/quantities); the view's own `"changed"` is a pure re-render signal —
its `slots` payload is always `[]` (a compacted projection has no stable slot
diff), so a controller backed by a filtered view emits `InventoryChangedEvent`
with empty `slots`. The view only subscribes to the model while at least one
listener is attached, so pre-built, currently-inactive tab views cost nothing.

## Save seam

`snapshot()` / `restore()` round-trip the whole state as JSON. Wire it to
`@yagejs/save` as a snapshot extra (no dependency needed):

```ts
snapshotService.registerSnapshotExtra("inventory", {
  serialize: () => inventory.snapshot(),
  restore: (data) => inventory.restore(data as InventorySnapshot),
});
```

`restore` drops entries the catalog no longer declares or with bad quantities
(returned in `{ dropped }`); it never resurrects unknown ids. If capacity shrank
since the snapshot, entries past the new capacity re-flow into the earliest free
slots and are dropped only when no slot is left — so shrinking a bag never loses
items that still fit. Valid entries transplant verbatim (no `maxStack`/`accepts`
re-check), same trust level as `setSlot`.

## Gotchas

- Default `maxStack` is **1** — declare `maxStack` on stackable defs.
- EVERY default action name (`move-up/-down/-left/-right`, `interact`,
  `cancel`, `sort`, `inventory`) must exist in the game's `InputPlugin` map or
  that control silently does nothing (`inventory` is the toggle key — without
  it the panel never opens from the keyboard); a TOTAL mismatch warns in dev,
  a partial one is treated as intentional.
- Scene must spread `INVENTORY_LAYERS` (undeclared layers fall back to the
  default layer with a warning — the panel would render under the world).
- YAGE input is non-consuming: a click handled by the panel still reaches
  gameplay actions bound to the same button; claim pointers in game code if
  needed (`InputManager.consumePointer`).
- Running the DIALOGUE addon too? Both bind `interact` by default, and both
  react to one press while both are active — give one focus
  (`setInputEnabled(false)` on the other) or remap one addon's actions.
- The panel's confirm is the `interact` action, a common gameplay action name.
  Freezing the world while the panel is open by disabling its input group
  (`InputManager.disableGroup("gameplay")`) also silences the panel's own
  confirm when `interact` is in that group. Keep the panel's actions out of any
  group you disable, rename the confirm action, or drive the panel host-side
  (`input: null`). The panel confirm and the world interactor can't share one
  disabled `interact` action — a group toggle reads a single global state, so it
  can't separate the two consumers.
- `consumes: true` removes the unit itself — the action event's `consumes`
  flag says so; don't also remove in the handler.
- Anonymous `remove()`/`transfer()` drain fungible stacks first, then data
  stacks; what leaves rides out in `RemoveResult.stacks` (data intact) rather
  than being destroyed. To target a specific instance, pass a data predicate
  (`remove(id, qty, (d) => …)`) or a `find()` handle (`remove(ref)`).
