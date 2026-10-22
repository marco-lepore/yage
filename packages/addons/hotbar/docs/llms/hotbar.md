# @yagejs-addons/hotbar

Typed slot assignments over synchronous game actions whose state stays with their owner. Required peers: `@yagejs/core`, `@yagejs/input`. Optional renderer peer for `@yagejs-addons/hotbar/presenters`. No package dependency on abilities or inventory: `hotbarAbility` and `hotbarItem` accept structural owners that `Abilities` and `Inventory` match.

## Model

```ts
import { Hotbar } from "@yagejs-addons/hotbar";

const bar = new Hotbar({
  bindings: { ping: { label: "Ping", activate: () => ({ ok: true }) } },
  slots: ["ping"],
  slotCount: 8,
});
bar.assign(1, "ping");
bar.swap(0, 1);
bar.clear(1);
bar.select(0);
bar.cycle(1);
bar.activate(0); // { ok: true } | { ok: false, reason: string }
bar.release(0); // ends a held action this slot activated
bar.read(0); // HotbarSlot
bar.inspect(); // slots, selected, lastActivation
const { dropped } = bar.restore(bar.snapshot());
const unsubscribe = bar.on((event) => {
  void event.type;
});
unsubscribe();
void dropped;
```

`Hotbar<TId>` infers ID literals from the `bindings` keys. `HotbarOptions<TId>`: `bindings`, `slotCount?` (default 8, positive integer), `slots?` (empty by default; padded with empty slots), `selected?` (default 0), `errorBoundary?` (standalone callback reporting).

`HotbarBinding`: `label: string`, `icon?: string` (registered texture key), `read?: () => HotbarBindingState`, `activate: () => HotbarActionResult`, `release?: () => void`.

`HotbarBindingState`: `available?: boolean`, `reason?: string`, `count?: number`, `cooldown?: HotbarCooldown`. `HotbarCooldown`: `{ remaining: number; ratio: number }`; `remaining` in seconds, finite and nonnegative; `ratio` is elapsed progress 0–1, the scale of `ProcessSlot.ratio` and `Abilities.cooldownRatio()`. Count finite and nonnegative. Out-of-range values throw at the read. `read` is synchronous, pure and cheap; presentation, inspection and activation each call it. Reason resolution: `available: false` uses the owner's `reason`, else `"cooldown"` while `remaining > 0`, else `"unavailable"`; an available slot with `remaining > 0` reports `"cooldown"` and blocks. Count alone never blocks. The hotbar has no clock.

Activation rereads state. Empty slots reject with `"empty"`. `activate` returns `{ ok: true }` or `{ ok: false, reason }`; a Promise throws. Success means accepted, not completed. The owner performs effects and applies its own rules. A binding's `activate()` may activate other slots. Activating a slot again while its `activate()` is running (directly or through a cycle) throws, naming the slot.

`release(slot)` calls `release()` on the binding that slot last activated successfully, even after reassignment, once. No-op when nothing releasable is held. A slot holds one action: activating it again, once `read()` reports it available, releases the earlier hold before the binding's `activate()` runs; a slot `read()` rejects keeps its hold.

Assignments allow duplicates and replace the destination. Swap exchanges two assignments; selection stays at its index. Nothing moves items, resets cooldowns or clears depleted slots. Invalid indexes and unknown IDs throw before mutation. Readable: `slotCount`, `selection`, `bindingIds`, `lastActivation`. `cycle` takes -1 or 1 and wraps.

`HotbarSnapshot`: `{ version: 1, slots: readonly (TId | null)[], selected: number }`. `restore(snapshot): HotbarRestoreResult` (`{ dropped: { slot, bindingId }[] }`): entries naming undeclared bindings or past `slotCount` are left empty and returned; an out-of-range selection becomes 0. A version other than 1, a non-array `slots`, or an entry that is neither a string nor `null` throws before mutation. Restore clears `lastActivation`. Persist the snapshot in an explicit game save root; items and ability state belong to their owners.

## Ability and item bindings

```ts
import { Entity, ProcessComponent, Transform } from "@yagejs/core";
import { Abilities } from "@yagejs-addons/abilities";
import { Inventory, defineItems } from "@yagejs-addons/inventory";
import {
  Hotbar,
  HotbarController,
  hotbarAbility,
  hotbarItem,
} from "@yagejs-addons/hotbar";
import { HotbarView } from "@yagejs-addons/hotbar/presenters";

const items = defineItems({ potion: { name: "Potion", maxStack: 9 } });

export class PlayerEntity extends Entity {
  setup() {
    this.add(new Transform());
    this.add(new ProcessComponent());
    const abilities = this.add(
      new Abilities([{ id: "zap", duration: 0.3, cooldown: 2, timeline: [] }]),
    );
    const bag = new Inventory({
      catalog: items,
      actions: [{ id: "drink", label: "Drink", consumes: true }],
    });
    const model = new Hotbar({
      bindings: {
        zap: hotbarAbility(abilities, "zap", { label: "Zap" }),
        potion: hotbarItem(bag, "potion", { action: "drink" }),
      },
      slots: ["zap", "potion"],
    });
    this.add(new HotbarController({ model, presenter: new HotbarView() }));
  }
}
```

`hotbarAbility(source: HotbarAbilitySource, id, { label, icon? })`: available = `canSend(id, { interrupts: true })`, with no cooldown reported while available, so a combo step or linger window that `send` accepts during the cooldown stays usable; when blocked, cooldown = `cooldownRemaining(id)` + `cooldownRatio(id)` with reason `"cooldown"`, else reason `"busy"`; activate = `send(id)`; release = `release(id)` (ends a hold phase; no-op otherwise). `id` is the def id, which is also its entry intent.

`hotbarItem(source: HotbarItemSource<TItem>, item, { action, label?, icon? })`: label/icon default to `catalog.get(item).name/icon`; count = `count(item)`; no stack → `{ available: false, reason: "empty" }`; available while `getActions(firstSlot(item))` includes `action`, else `"unavailable"`; activate = `invokeAction(action, firstSlot(item))`, failures mapped to `"empty"` or `"unavailable"`. The inventory's `consumes` removes the unit; apply the effect from the inventory `"action"` event.

## Controller and input

```ts
import { Entity } from "@yagejs/core";
import { InputPlugin } from "@yagejs/input";
import {
  HOTBAR_ACTION_MAP,
  Hotbar,
  HotbarController,
} from "@yagejs-addons/hotbar";
import { HotbarView } from "@yagejs-addons/hotbar/presenters";

export const inputPlugin = new InputPlugin({ actions: HOTBAR_ACTION_MAP });
export class Hud extends Entity {
  setup() {
    const model = new Hotbar({
      bindings: { ping: { label: "Ping", activate: () => ({ ok: true }) } },
      slots: ["ping"],
    });
    this.add(new HotbarController({ model, presenter: new HotbarView() }));
  }
}
```

Install RendererPlugin and InputPlugin first. `HotbarController({ model, presenter?, input? })` exposes `model`, `diagnostic` and `setInputEnabled(enabled)`. Game code mutates through `controller.model`.

- omitted input: `hotbarControls()`. Number keys 1–0 select and activate slots 0–9 and release on key-up; arrows/LB/RB select; Enter/A activates the selection and releases on key-up; Delete/Y clears; a mouse/touch press on a slot selects and activates it, and lifting or cancelling that pointer releases it (a tap does both at once). With drag-to-swap on, dragging between slots swaps them, a tap activates and releases at once, and a pointer gives a held action no hold time. The input that activated a slot last owns its hold, and its release ends the slot's hold even if game code activated the slot since. An activation that disposes the binding (for example by calling `setInputEnabled(false)`) releases its own hold at once.
- `input: null`: no listeners or polling; no InputPlugin required.
- custom `HotbarInputBinding`: `bind(inputManager, driver: HotbarDriver, hitTarget?)`, `poll()`, `dispose()` (release held actions here), optional `actionNames()`. `HotbarDriver`: `slotCount`, `selection`, `isInteractive()`, `select`, `cycle`, `activate`, `release`, `clear`, `swap`; while inactive, everything except `release` is ignored and `activate` returns `{ ok: false, reason: "inactive" }`.

`hotbarControls(options?: HotbarControlsOptions): HotbarControls`. Options: `actions?: HotbarActions` (default `DEFAULT_HOTBAR_ACTIONS`), `dragToSwap?: boolean` (default `false`), `dragThreshold?: number` (virtual pixels before a press counts as a drag, default 6). `HotbarControls` extends `HotbarInputBinding` with `readonly dragToSwap` and `setDragToSwap(enabled)`, which works while the game runs and applies from the next pointer press; a press in progress keeps its mode. Keep the object and pass it as the controller's `input` to switch it, for example for an edit mode. One controls object per controller; binding it to a second controller throws. `HotbarActions`: `slots: readonly string[]`, `previous`, `next`, `activate`, `clear`. Merge or replace `HOTBAR_ACTION_MAP` in InputPlugin. Pointer claims use InputManager. In drag-to-swap mode, a drag cancelled or released outside the bar does nothing.

`setInputEnabled(false)` disposes device input (releasing held actions) and keeps the view. Keyboard/gamepad reads are non-consuming; the host picks focus. Component/entity disable hides the view and releases input; enable restores both. Paused scenes ignore device input. Model calls ignore component state. Removal disposes the view and listeners and keeps assignments. One mounted controller per model.

## Presenters and diagnostics

`HotbarPresenter`: `mount(scene: Scene)`, `present(state: HotbarState)`, `setVisible(boolean)`, `dispose()`, optional `slotAtPoint(x, y): number | undefined` in virtual screen pixels. Display entities spawn at scene level, so the controller's entity may move. One instance per controller.

`new HotbarView(theme?: Partial<HotbarTheme>)` from `/presenters`; omitted fields keep `defaultHotbarTheme()`. Draws canvas text, optional registered icons, count, reason or remaining seconds, selection and a cooldown bar sized by `1 - ratio`. Fields: `slotWidth`, `slotHeight`, `gap`, `background`, `border`, `selected`, `cooldown`, `text`, `unavailable`, `fontFamily`, `fontSize`, `layer`, `keyLabels`; optional `x`/`y` (default: centered, 24px above the bottom). Layer defaults to `hotbar`, screen space, order 1070; an existing layer keeps its order. Missing icon keys throw through the renderer's asset validation on every frame until the key is registered.

`HotbarSlot`: `index`, `bindingId` (nullable), `label`, optional `icon`, `available`, nullable `reason`/`count`/`cooldown`. `HotbarState`: `slots`, `selected`, `lastActivation`. `controller.diagnostic` adds `inputEnabled` and `active`; read through `Inspector.getComponentData`. `HotbarChangedEvent` carries the snapshot; `HotbarActivationEvent` carries `{ slot, bindingId, result }`; both bubble to the scene. Model `on` emits `changed`/`activation` and returns an unsubscribe. Callback errors (read, activate, release, listeners) are recorded on the ErrorBoundary and rethrown; a mounted controller uses the scene boundary. A throwing listener stops the fan-out.

The view displays `read()` availability. Show activation outcomes from `HotbarActivationEvent`, including owner rejections `read()` could not predict.
