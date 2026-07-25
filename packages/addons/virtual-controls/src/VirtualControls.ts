import {
  Component,
  LoggerKey,
  RendererAdapterKey,
  type RendererAdapter,
} from "@yagejs/core";
import {
  InputManagerKey,
  type InputManager,
  type PointerInfo,
} from "@yagejs/input";
import type { VirtualButton } from "./core/button.js";
import { VirtualControlsModel } from "./core/model.js";
import type { VirtualStick } from "./core/stick.js";
import type {
  StickDigitalState,
  ViewportRect,
  VirtualControlsConfig,
} from "./core/types.js";
import { prefersTouchControls } from "./detect.js";
import {
  VirtualButtonPressEvent,
  VirtualButtonReleaseEvent,
  VirtualStickEngageEvent,
  VirtualStickReleaseEvent,
} from "./events.js";
import type { ControlsPresenter, ControlView } from "./view.js";

export interface VirtualControlsOptions extends VirtualControlsConfig {
  /**
   * Whether the overlay is on. `"auto"` (the default) turns it on when the
   * device's primary pointer is coarse ({@link prefersTouchControls}) — so a
   * phone shows controls and a desktop doesn't, with no code. Pass a boolean
   * to decide yourself, or call `setVisible` at runtime (e.g. from a
   * settings toggle).
   */
  readonly visible?: boolean | "auto";
  /**
   * Renders the controls. Pass `createControlsPresenter()` from
   * `@yagejs-addons/virtual-controls/presenters` for the built-in Graphics
   * look, or any {@link ControlsPresenter} for custom art. Pass `null` for
   * deliberately invisible controls (a DOM overlay or custom render path
   * draws them) — zones still route touches and actions still fire.
   * Omitting the option entirely warns once: active-but-invisible controls
   * are almost always a forgotten import, not a choice.
   */
  readonly presenter?: ControlsPresenter | null;
  /**
   * Layout viewport override, virtual px. Default: the renderer adapter's
   * `visibleVirtualRect`, polled every frame — the on-screen region clamped
   * to the declared virtual rect, so controls track resize / orientation /
   * fit changes and never lay out in letterbox bars. Set it when running
   * without a renderer adapter, or to confine controls to a sub-region.
   */
  readonly viewport?: ViewportRect;
}

/**
 * On-screen touch controls: virtual joystick(s) + action buttons that drive
 * the game through the `InputManager`, so gameplay code reads ordinary
 * actions (`isPressed`, `getHoldDuration`, `getVector`) and — for analog —
 * `getStick()`, with no knowledge of the overlay.
 *
 * Spawn it on a HUD entity in the scenes that want it:
 *
 * ```ts
 * import { VirtualControls } from "@yagejs-addons/virtual-controls";
 * import { createControlsPresenter } from "@yagejs-addons/virtual-controls/presenters";
 *
 * this.spawn("touch-controls").add(
 *   new VirtualControls({
 *     stick: { actions: { left: "left", right: "right", up: "up", down: "down" } },
 *     buttons: [
 *       { id: "a", action: "jump" },
 *       { id: "b", action: "dash" },
 *     ],
 *     presenter: createControlsPresenter(),
 *   }),
 * );
 * ```
 *
 * Every pointer a control claims is `consumePointer`ed, so taps on the
 * overlay never leak into gameplay `MouseLeft` edges; pointers that land on
 * `@yagejs/ui` surfaces are left alone (explicit UI wins over control
 * zones). The synthetic action state mirrors physical keys exactly —
 * press/release edges, hold durations, group enable/disable.
 *
 * The control set is fixed at construction. To change buttons or bindings
 * at runtime (a layout editor, a mode switch), destroy the host entity and
 * spawn a fresh component — teardown releases all mirrored state cleanly.
 */
export class VirtualControls extends Component {
  /** The headless model — read stick values, button state, layouts. */
  readonly model: VirtualControlsModel;

  private readonly opts: VirtualControlsOptions;
  private input: InputManager | null = null;
  private adapter: RendererAdapter | null = null;
  private views: ControlView[] = [];
  private warnedActions = new Set<string>();
  private lastDigital = new Map<VirtualStick, StickDigitalState>();
  private _visible = false;

  constructor(options: VirtualControlsOptions = {}) {
    super();
    this.opts = options;
    this.model = new VirtualControlsModel(options, {
      onStickEngage: (s) => {
        this.mirrorStick(s);
        this.entity.emit(VirtualStickEngageEvent, { id: s.id });
      },
      onStickMove: (s) => this.mirrorStick(s),
      onStickRelease: (s) => {
        this.mirrorStick(s);
        this.entity.emit(VirtualStickReleaseEvent, { id: s.id });
      },
      onButtonPress: (b) => {
        this.mirrorButton(b);
        this.entity.emit(VirtualButtonPressEvent, { id: b.id, action: b.action });
      },
      onButtonRelease: (b) => {
        this.mirrorButton(b);
        this.entity.emit(VirtualButtonReleaseEvent, { id: b.id, action: b.action });
      },
      // Gates slide-in (pressOnEnter) claims the same way handleDown gates
      // fresh presses — releases of already-claimed pointers stay ungated.
      canClaim: (pointerId) =>
        this._visible &&
        this.effectiveEnabled &&
        !this.scene.isPaused &&
        !(this.input?.isPointerConsumed(pointerId) ?? false),
    });
  }

  /** The requested overlay state (see `setVisible`), whatever the host
   *  entity's activeness. A dormant host draws and claims nothing, and the
   *  value set here comes back with it. */
  get visible(): boolean {
    return this._visible;
  }

  /** First stick, or the one with the given id. */
  stick(id?: string): VirtualStick | undefined {
    return this.model.stick(id);
  }

  button(id: string): VirtualButton | undefined {
    return this.model.button(id);
  }

  /**
   * Turn the overlay on/off at runtime (a settings toggle, a cutscene).
   * Turning it off releases every engaged control — mirrored actions get
   * their release edge, axes reset — and hides the views.
   */
  setVisible(visible: boolean): void {
    const was = this._visible;
    this._visible = visible;
    if (!visible && was) this.model.releaseAll();
    this.applyViewVisibility();
  }

  override onAdd(): void {
    const input = this.use(InputManagerKey);
    this.input = input;
    this.adapter = this.context.tryResolve(RendererAdapterKey) ?? null;
    // Eager pass so a typo warns at mount, not at first touch. Mirroring
    // re-checks live (checkAction), so a later setActionMap can add or
    // remove actions without stale-cache surprises.
    for (const name of this.boundActionNames()) this.checkAction(name);

    if (!this.opts.viewport && !this.adapter) {
      this.warn(
        "no renderer adapter and no `viewport` option — layouts resolve against a default 800×600 viewport.",
      );
    }
    this.refreshViewport();

    const presenter = this.opts.presenter;
    if (presenter) {
      presenter.mount(this.scene);
      for (const s of this.model.sticks) {
        this.views.push(presenter.createStickView(s));
      }
      for (const b of this.model.buttons) {
        this.views.push(presenter.createButtonView(b));
      }
    } else if (presenter === undefined && this.adapter) {
      this.warn(
        "no `presenter` — controls are active but draw nothing. Pass createControlsPresenter() from @yagejs-addons/virtual-controls/presenters, or `presenter: null` if invisible is intended.",
      );
    }

    this.setVisible(
      this.opts.visible === undefined || this.opts.visible === "auto"
        ? prefersTouchControls()
        : this.opts.visible,
    );

    this.addCleanup(input.onPointerDown((p) => this.handleDown(p)));
    this.addCleanup(input.onPointerMove((p) => this.handleMove(p)));
    this.addCleanup(input.onPointerUp((p) => this.handleUp(p)));
  }

  override update(dt: number): void {
    this.refreshViewport();
    for (const v of this.views) v.update(dt);
  }

  override onEnable(): void {
    this.applyViewVisibility();
  }

  /**
   * A dormant host (or `enabled = false`) takes the overlay off screen and
   * releases every engaged control, so a deactivated HUD entity leaves no
   * painted controls and no stuck action holds. The requested `visible` value
   * is untouched and applies again on reactivation.
   */
  override onDisable(): void {
    this.model.releaseAll();
    this.applyViewVisibility();
  }

  /** The views are on screen only when the overlay is on AND the component is
   *  running, so `setVisible` and the enable hooks share one place to say it. */
  private applyViewVisibility(): void {
    const on = this._visible && this.effectiveEnabled;
    for (const v of this.views) v.setVisible(on);
  }

  override onDestroy(): void {
    // Mirrored holds and axes were already reset: teardown runs `onDisable`
    // first, while input is still reachable.
    for (const v of this.views) v.dispose();
    this.views.length = 0;
    this.opts.presenter?.dispose();
    this.input = null;
  }

  private handleDown(p: PointerInfo): void {
    const input = this.input;
    if (!input || !this._visible || !this.effectiveEnabled) return;
    // While paused (e.g. a pause scene pushed on top), take no new claims —
    // but moves/releases of already-claimed pointers keep flowing above so
    // nothing sticks.
    if (this.scene.isPaused) return;
    if (input.isPointerConsumed(p.id)) return;
    // Explicit UI wins over control zones: a tap on a @yagejs/ui surface
    // inside the stick zone belongs to that UI, not the stick.
    if (this.adapter?.hitTestUI?.(p.screenPos.x, p.screenPos.y)) return;
    if (this.model.pointerDown(p.id, p.screenPos.x, p.screenPos.y)) {
      input.consumePointer(p.id);
    }
  }

  private handleMove(p: PointerInfo): void {
    if (this.model.pointerMove(p.id, p.screenPos.x, p.screenPos.y)) {
      // A pressOnEnter button caught a slide-in mid-cycle. The press edge of
      // this pointer already reached gameplay (it was legitimate when it
      // landed); consuming now keeps the rest of the gesture out.
      this.input?.consumePointer(p.id);
    }
  }

  private handleUp(p: PointerInfo): void {
    // A mouse fires one up per BUTTON; the gesture ends only when the last
    // button lifts. At listener time `buttons` still contains the releasing
    // button, so >1 means others are still held — keep the control engaged.
    // pointercancel arrives as button -1 and always ends the gesture.
    if (p.button >= 0 && p.buttons.size > 1) return;
    this.model.pointerUp(p.id);
  }

  /**
   * Push stick state onto the action map + synthetic gamepad axes. Runs on
   * every move event: axes writes are idempotent value sets, and the digital
   * mirror is edge-diffed — `setActionHeld` fires only on THIS stick's own
   * transitions, so a synthetic hold some other system put on the same
   * action is never force-released by a mere stick wiggle.
   */
  private mirrorStick(s: VirtualStick): void {
    const input = this.input;
    if (!input) return;
    const axes = s.config.axes;
    if (axes) {
      input.fireGamepadAxis(`${axes}X`, s.rawValue.x);
      input.fireGamepadAxis(`${axes}Y`, s.rawValue.y);
    }
    const actions = s.config.actions;
    const d = s.digital;
    const last = this.lastDigital.get(s);
    if (d.left !== (last?.left ?? false)) this.setHeld(actions.left, d.left);
    if (d.right !== (last?.right ?? false)) this.setHeld(actions.right, d.right);
    if (d.up !== (last?.up ?? false)) this.setHeld(actions.up, d.up);
    if (d.down !== (last?.down ?? false)) this.setHeld(actions.down, d.down);
    this.lastDigital.set(s, d);
  }

  private mirrorButton(b: VirtualButton): void {
    this.setHeld(b.action, b.pressed);
  }

  /**
   * Mirror one action-map write, re-validating the name LIVE — the action
   * map can be replaced at runtime (`setActionMap`), and the synthetic
   * injection throws on unknown names. Unknown → warn once and skip; the
   * binding starts working the moment the action exists.
   */
  private setHeld(action: string | undefined, held: boolean): void {
    if (!action) return;
    if (!this.checkAction(action)) return;
    this.input?.setActionHeld(action, held);
  }

  private checkAction(name: string): boolean {
    if (this.input?.hasAction(name)) return true;
    if (!this.warnedActions.has(name)) {
      this.warnedActions.add(name);
      this.warn(
        `action "${name}" is not in the InputManager action map — this binding is skipped until it exists.`,
      );
    }
    return false;
  }

  private boundActionNames(): Set<string> {
    const bound = new Set<string>();
    for (const s of this.model.sticks) {
      for (const name of Object.values(s.config.actions)) {
        if (name) bound.add(name);
      }
    }
    for (const b of this.model.buttons) {
      if (b.action) bound.add(b.action);
    }
    return bound;
  }

  private refreshViewport(): void {
    const rect = this.opts.viewport ?? this.adapterViewport();
    if (rect) this.model.setViewport(rect);
  }

  /**
   * The on-screen virtual rect the controls lay out against, polled per
   * frame (tracks resize, orientation and fit-mode changes with no event
   * wiring; `setViewport` no-ops when unchanged).
   *
   * Prefers the adapter's `visibleVirtualRect` — clamped to the declared
   * virtual rect, which matters under letterbox fit: the canvas corners map
   * into the masked bars, where drawn controls would be clipped invisible
   * while still claiming touches. The corner-mapping fallback (foreign
   * adapters without the rect) is correct only for unmasked fit modes.
   */
  private adapterViewport(): ViewportRect | undefined {
    const a = this.adapter;
    if (!a) return undefined;
    const rect = a.visibleVirtualRect;
    if (rect) {
      // Copy: the model stores + diffs the rect across frames, so a foreign
      // adapter recycling one mutable object must not alias our snapshot.
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    const w = a.canvas.clientWidth;
    const h = a.canvas.clientHeight;
    if (w <= 0 || h <= 0) return undefined;
    if (!a.canvasToVirtual) return { x: 0, y: 0, width: w, height: h };
    const tl = a.canvasToVirtual(0, 0);
    const br = a.canvasToVirtual(w, h);
    return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
  }

  private warn(message: string): void {
    this.context.tryResolve(LoggerKey)?.warn("virtual-controls", message);
  }
}
