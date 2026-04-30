import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { RendererAdapterKey } from "@yagejs/core";
import { DebugRegistryKey } from "@yagejs/debug/api";
import { InputManager } from "./InputManager.js";
import {
  InputManagerKey,
  type InputConfig,
  type PointerEventInfo,
  type PointerType,
} from "./types.js";
import { InputPollSystem } from "./InputPollSystem.js";
import { InputClearSystem } from "./InputClearSystem.js";
import { InputDebugContributor } from "./InputDebugContributor.js";

/** Input plugin — wires keyboard and pointer listeners, registers InputManager. */
export class InputPlugin implements Plugin {
  readonly name = "input";
  readonly version = "2.0.0";

  private readonly config: InputConfig;
  private manager!: InputManager;
  private context!: EngineContext;
  private cleanupFns: Array<() => void> = [];

  constructor(config?: InputConfig) {
    this.config = config ?? {};
  }

  install(context: EngineContext): void {
    this.context = context;
    this.manager = new InputManager();

    if (this.config.actions) {
      this.manager.setActionMap(this.config.actions);
    }

    if (this.config.groups) {
      this.manager.setGroups(this.config.groups);
    }

    if (this.config.deadzones) {
      this.manager.setDeadzones(this.config.deadzones);
    }

    if (this.config.triggerThreshold !== undefined) {
      this.manager.setTriggerThreshold(this.config.triggerThreshold);
    }

    if (this.config.pollGamepads === false) {
      this.manager.setPollingEnabled(false);
    }

    // Default to the well-known RendererAdapterKey so the canonical renderer
    // is picked up with no config. `rendererKey` stays as an override for
    // custom/foreign renderers registered under a different key.
    const rendererKey = this.config.rendererKey ?? RendererAdapterKey;
    const renderer = context.tryResolve(rendererKey);
    const pointerTarget: EventTarget =
      this.config.target ?? renderer?.canvas ?? document;

    // Stash the renderer adapter so the manager's drain step can call its
    // optional `hitTestUI(x, y)` for the UI auto-consume fallback.
    this.manager._setRenderer(renderer ?? null);

    // Element used to convert clientX/clientY to element-relative coordinates.
    // When `canvasToVirtual` is available, it always expects canvas-origin
    // pixels — so prefer the canvas over a custom `config.target` (which may
    // be a wrapping element). Falls back to null if neither is available.
    const coordinateElement: Element | null =
      renderer?.canvas ??
      this.config.target ??
      null;

    // When the renderer exposes canvasToVirtual, route pointer coords through
    // it so they stay correct under responsive fit or custom virtual sizes.
    // Without it, raw canvas-relative CSS pixels are passed through unchanged
    // (works only when canvas CSS size == virtual size — the default).
    const mapPointer = (cssX: number, cssY: number): { x: number; y: number } =>
      renderer?.canvasToVirtual?.(cssX, cssY) ?? { x: cssX, y: cssY };

    const preventSet = new Set(this.config.preventDefaultKeys ?? []);

    // Keyboard listeners. DOM events enqueue onto the input manager's buffer
    // and apply at the next `Phase.EarlyUpdate` drain — so any listener that
    // wants to claim the event (`consumePointer`, hit-test fallback, etc.) has
    // a chance to run before action-map edges fire.
    const onKeyDown = (e: Event): void => {
      const ke = e as KeyboardEvent;
      if (ke.repeat) return;
      if (preventSet.has(ke.code)) ke.preventDefault();
      this.manager._enqueueKeyDown(ke.code);
    };
    const onKeyUp = (e: Event): void => {
      const ke = e as KeyboardEvent;
      if (preventSet.has(ke.code)) ke.preventDefault();
      this.manager._enqueueKeyUp(ke.code);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    this.cleanupFns.push(
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
    );

    // Pointer listeners — pointerdown on target, pointerup/move/cancel on window
    // so releases outside the target element are still captured.
    const buildInfo = (pe: PointerEvent): PointerEventInfo => {
      let cssX: number;
      let cssY: number;
      if (coordinateElement) {
        const rect = coordinateElement.getBoundingClientRect();
        cssX = pe.clientX - rect.left;
        cssY = pe.clientY - rect.top;
      } else {
        cssX = pe.clientX;
        cssY = pe.clientY;
      }
      const mapped = mapPointer(cssX, cssY);
      // Browsers occasionally emit empty `pointerType` for unusual devices.
      // Fall back to `"mouse"` so downstream code never sees an invalid string.
      const rawType = pe.pointerType;
      const type: PointerType =
        rawType === "touch" || rawType === "pen" ? rawType : "mouse";
      return {
        id: pe.pointerId,
        screenX: mapped.x,
        screenY: mapped.y,
        type,
        isPrimary: pe.isPrimary,
        button: pe.button,
      };
    };
    const onPointerMove = (e: Event): void => {
      this.manager._enqueuePointerMove(buildInfo(e as PointerEvent));
    };
    const onPointerDown = (e: Event): void => {
      this.manager._enqueuePointerDown(buildInfo(e as PointerEvent));
    };
    const onPointerUp = (e: Event): void => {
      this.manager._enqueuePointerUp(buildInfo(e as PointerEvent));
    };
    const onPointerCancel = (e: Event): void => {
      const pe = e as PointerEvent;
      this.manager._enqueuePointerCancel(pe.pointerId);
    };
    // `pointerleave` covers the hover lifecycle for pen / touch pointers that
    // never receive a `pointerdown` (a stylus floating over the tablet, then
    // pulled away). Without this, the manager would accumulate undead entries
    // in `getPointers()` for every hover session. Mouse pointers ignore leave
    // by design — `_applyPointerCancel` skips removal for `type === "mouse"`.
    const onPointerLeave = (e: Event): void => {
      const pe = e as PointerEvent;
      this.manager._enqueuePointerCancel(pe.pointerId);
    };

    pointerTarget.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    pointerTarget.addEventListener("pointerleave", onPointerLeave);
    this.cleanupFns.push(
      () => pointerTarget.removeEventListener("pointerdown", onPointerDown),
      () => window.removeEventListener("pointermove", onPointerMove),
      () => window.removeEventListener("pointerup", onPointerUp),
      () => window.removeEventListener("pointercancel", onPointerCancel),
      () => pointerTarget.removeEventListener("pointerleave", onPointerLeave),
    );

    // Scroll wheel — fires `WheelUp/Down/Left/Right` action-map edges (one
    // frame each) and notifies any `onWheel` subscribers with raw deltas.
    const wheelInvertY = this.config.wheelInvertY === true;
    const preventDefaultWheel = this.config.preventDefaultWheel === true;
    const onWheel = (e: Event): void => {
      const we = e as WheelEvent;
      if (preventDefaultWheel) we.preventDefault();
      const dy = wheelInvertY ? -we.deltaY : we.deltaY;
      this.manager._enqueueWheel(we.deltaX, dy);
    };
    pointerTarget.addEventListener(
      "wheel",
      onWheel,
      preventDefaultWheel ? { passive: false } : undefined,
    );
    this.cleanupFns.push(() =>
      pointerTarget.removeEventListener("wheel", onWheel),
    );

    // Gamepad connect/disconnect — note: browsers gate this behind a first
    // button press, so a freshly-plugged pad won't fire until the user acts.
    const onGamepadConnected = (e: Event): void => {
      const ge = e as GamepadEvent;
      if (!ge.gamepad) return;
      this.manager._onGamepadConnected({
        index: ge.gamepad.index,
        id: ge.gamepad.id,
      });
    };
    const onGamepadDisconnected = (e: Event): void => {
      const ge = e as GamepadEvent;
      if (!ge.gamepad) return;
      this.manager._onGamepadDisconnected({
        index: ge.gamepad.index,
        id: ge.gamepad.id,
      });
    };
    window.addEventListener("gamepadconnected", onGamepadConnected);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);
    this.cleanupFns.push(
      () => window.removeEventListener("gamepadconnected", onGamepadConnected),
      () =>
        window.removeEventListener("gamepaddisconnected", onGamepadDisconnected),
    );

    // When the tab hides, `navigator.getGamepads()` returns stale data and a
    // touch held at the moment of hide may never receive its `pointerup`
    // (Android notification shade, iOS app switcher). Force-release both so
    // they don't appear stuck on return.
    if (typeof document !== "undefined") {
      const onVisibilityChange = (): void => {
        if (document.visibilityState === "hidden") {
          this.manager._releaseAllGamepadState();
          this.manager.clearPointerButtons();
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      this.cleanupFns.push(() =>
        document.removeEventListener("visibilitychange", onVisibilityChange),
      );
    }

    context.register(InputManagerKey, this.manager);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new InputPollSystem());
    scheduler.add(new InputClearSystem());
  }

  onStart(): void {
    const registry = this.context.tryResolve(DebugRegistryKey);
    registry?.register(new InputDebugContributor(this.manager));
  }

  onDestroy(): void {
    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
    this.cleanupFns.length = 0;
  }
}
