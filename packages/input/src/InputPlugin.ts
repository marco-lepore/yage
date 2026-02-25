import type { EngineContext, Plugin, SystemScheduler } from "@yage/core";
import { InputManager } from "./InputManager.js";
import { InputManagerKey, type InputConfig } from "./types.js";
import { InputPollSystem } from "./InputPollSystem.js";
import { InputClearSystem } from "./InputClearSystem.js";

const MOUSE_BUTTON_MAP: Record<number, string> = {
  0: "MouseLeft",
  1: "MouseMiddle",
  2: "MouseRight",
};

/** Input plugin — wires keyboard and pointer listeners, registers InputManager. */
export class InputPlugin implements Plugin {
  readonly name = "input";
  readonly version = "2.0.0";

  private readonly config: InputConfig;
  private manager!: InputManager;
  private cleanupFns: Array<() => void> = [];

  constructor(config?: InputConfig) {
    this.config = config ?? {};
  }

  install(context: EngineContext): void {
    this.manager = new InputManager();

    if (this.config.actions) {
      this.manager.setActionMap(this.config.actions);
    }

    if (this.config.cameraKey) {
      const camera = context.tryResolve(this.config.cameraKey);
      if (camera) {
        this.manager._setCamera(camera);
      }
    }

    const renderer = this.config.rendererKey
      ? context.tryResolve(this.config.rendererKey)
      : undefined;
    const pointerTarget: EventTarget =
      this.config.target ?? renderer?.canvas ?? document;

    const preventSet = new Set(this.config.preventDefaultKeys ?? []);

    // Keyboard listeners
    const onKeyDown = (e: Event): void => {
      const ke = e as KeyboardEvent;
      if (ke.repeat) return;
      if (preventSet.has(ke.code)) ke.preventDefault();
      this.manager._onKeyDown(ke.code);
    };
    const onKeyUp = (e: Event): void => {
      const ke = e as KeyboardEvent;
      if (preventSet.has(ke.code)) ke.preventDefault();
      this.manager._onKeyUp(ke.code);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    this.cleanupFns.push(
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
    );

    // Pointer listeners — pointerdown on target, pointerup/move/cancel on window
    // so releases outside the target element are still captured
    const onPointerMove = (e: Event): void => {
      const pe = e as PointerEvent;
      this.manager._onPointerMove(pe.clientX, pe.clientY);
    };
    const onPointerDown = (e: Event): void => {
      const pe = e as PointerEvent;
      this.manager._onPointerDown();
      const mouseKey = MOUSE_BUTTON_MAP[pe.button];
      if (mouseKey) this.manager._onKeyDown(mouseKey);
    };
    const onPointerUp = (e: Event): void => {
      const pe = e as PointerEvent;
      this.manager._onPointerUp();
      const mouseKey = MOUSE_BUTTON_MAP[pe.button];
      if (mouseKey) this.manager._onKeyUp(mouseKey);
    };
    const onPointerCancel = (): void => {
      this.manager._onPointerUp();
      this.manager._onKeyUp("MouseLeft");
      this.manager._onKeyUp("MouseMiddle");
      this.manager._onKeyUp("MouseRight");
    };

    pointerTarget.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    this.cleanupFns.push(
      () => pointerTarget.removeEventListener("pointerdown", onPointerDown),
      () => window.removeEventListener("pointermove", onPointerMove),
      () => window.removeEventListener("pointerup", onPointerUp),
      () => window.removeEventListener("pointercancel", onPointerCancel),
    );

    context.register(InputManagerKey, this.manager);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new InputPollSystem());
    scheduler.add(new InputClearSystem());
  }

  onDestroy(): void {
    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
    this.cleanupFns.length = 0;
  }
}
