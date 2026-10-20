# @yagejs-addons/hotbar

Typed slot assignments over arbitrary synchronous game actions. Required peers: `@yagejs/core`, `@yagejs/input`. Optional renderer peer for `@yagejs-addons/hotbar/presenters`. No dependency on abilities or inventory.

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
bar.read(0); // HotbarSlot
bar.inspect(); // slots, selected, lastActivation
const snapshot = bar.snapshot();
bar.restore(snapshot);
const unsubscribe = bar.on((event) => {
  void event.type;
});
unsubscribe();
```

`Hotbar<TId>` infers ID literals from catalog keys. `HotbarOptions<TId>`: `bindings`, `slotCount?` (default 8, integer 1–1024), `slots?` (empty by default; padded), `selected?` (default 0), `errorBoundary?` (standalone callback reporting).

`HotbarBinding`: `label: string`, `icon?: string` (registered texture key), `read?: () => HotbarBindingState`, `activate: () => HotbarActionResult`.

`HotbarBindingState`: `available?: boolean`, `reason?: string`, `count?: number`, `cooldown?: { remaining: number; total: number }`. Durations are seconds; counts/durations are finite and nonnegative; remaining <= total. `read` must be synchronous, pure and cheap; presentation/inspection/activation can each query it. Positive remaining cooldown blocks activation. Explicit unavailable reason wins; omitted reason becomes `unavailable`. Count alone never blocks. No hotbar clock exists.

Activation rereads state. Empty slots reject with `empty`. Owner callback returns `{ ok: true }` or `{ ok: false, reason: string }` with a nonempty reason; Promises are unsupported. Success means accepted, not completed. The owner performs effects and checks its own rules. Use `Abilities.canSend/send/cooldownRemaining` or inventory reads/removal inside closures; avoid copying owner state. Held ability release remains with the game's input/ability driver.

Assignments allow duplicates and replace the destination. Swap exchanges two assignments; selection stays at its index. No item transfer, cooldown reset or auto-clearing depleted slots occurs. Invalid indexes/IDs throw before mutation. `slotCount`, `selection`, `bindingIds`, `lastActivation` are readable. `cycle` takes -1 or 1.

`HotbarSnapshot`: `{ version: 1, slots: readonly (TId | null)[], selected: number }`. Restore requires matching capacity and known IDs and validates atomically. Migrate obsolete IDs in the game. Persist in an explicit game save root; items and ability state belong to their own owners. Restore clears the diagnostic last result.

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

Install RendererPlugin and InputPlugin first. `HotbarController({ model, presenter?, input? })`:

- omitted input: `hotbarControls()`; number keys 1–0 activate slots 0–9; arrows/LB/RB select; Enter/A activates selected; Delete/Y clears; mouse/touch tap on release activates; drag swaps assignments.
- `input: null`: no listeners or action polling; no InputPlugin required. Controller exposes `assign`, `clear`, `swap`, `select`, `cycle`, `activate`, `selection`, `slotCount` and `model`.
- custom `HotbarInputBinding`: `bind(inputManager, driver, hitTarget?)`, `poll()`, `dispose()`, optional `actionNames()`.

`hotbarControls({ actions?: HotbarActions, dragThreshold?: number })` defaults to `DEFAULT_HOTBAR_ACTIONS` and six virtual pixels. `HotbarActions` contains `slots: readonly string[]` and string names `previous`, `next`, `activate`, `clear`. Merge or replace `HOTBAR_ACTION_MAP` in InputPlugin; the addon does not register a second map. Pointer claims use InputManager; cancellations and releases outside the bar do nothing.

`setInputEnabled(false)` releases device input but keeps the view/direct API usable. Host chooses focus; keyboard/gamepad reads are non-consuming. Component/entity disable hides the view and releases input; enable reattaches. Paused scenes reject controller activation. Direct model calls bypass component lifecycle. Removal disposes the view/listeners but retains model assignments. A model permits only one mounted controller.

## Presenters and diagnostics

`HotbarPresenter`: `mount(owner: Entity)`, `present(state: HotbarState)`, `setVisible(boolean)`, `dispose()`, optional `slotAtPoint(x, y): number | undefined` in virtual screen pixels. One instance per controller. Custom view needs no renderer import in the model.

`HotbarView(defaultHotbarTheme())` from `/presenters` draws canvas text, optional registered icons, quantity/reason text, selection and cooldown bars. Flat theme fields: `slotWidth`, `slotHeight`, `gap`, `background`, `border`, `selected`, `cooldown`, `text`, `unavailable`, `fontFamily`, `fontSize`, `layer`, `keyLabels`; optional `x`/`y` derive centered placement and 24px bottom margin. Use a stationary identity-transform HUD host. Width must fit the viewport. Layer defaults to `hotbar`, screen order 1070, preserving existing layer order. Missing icon keys throw through the renderer's asset validation. Replace the presenter for other layouts.

`HotbarSlot`: index, bindingId (nullable), label, optional icon, available, nullable reason/count/cooldown. `HotbarState`: slots, selected, lastActivation. `controller.diagnostic` adds inputEnabled and active; read through Inspector.getComponentData. `HotbarChangedEvent` carries snapshot; `HotbarActivationEvent` carries `{ slot, bindingId, result }`; enable Inspector's event log to record both. Model `on` emits a discriminated `changed`/`activation` event and returns an unsubscribe. Callback errors use ErrorBoundary and rethrow; mounted callbacks use the scene boundary. Throwing listeners stop fan-out. No recursive activation is permitted during an owner activation callback.

The default view displays `read()` availability. Games show activation outcomes through `HotbarActivationEvent`, including owner rejections not predicted by `read()`.
