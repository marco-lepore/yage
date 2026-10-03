import {
  Component,
  ErrorBoundaryKey,
  LoggerKey,
  RendererAdapterKey,
  ServiceKey,
} from "@yagejs/core";
import type { InputManager } from "@yagejs/input";
import { finite } from "../core/validate.js";
import type { PlatformerDemand } from "./controllerViews.js";
import type { PlatformerMoves } from "./PlatformerMoves.js";

// @yagejs/input owns this key; the adapter has no runtime import of the optional peer.
const INPUT_KEY = new ServiceKey<InputManager>("inputManager");

export interface PlatformerInputTarget {
  setDirection(direction: number): void;
  setDown(down: boolean): void;
  setJumpHeld(held: boolean): void;
  jump(): void;
  dash(): void;
}

export interface InputBinding {
  bind(input: InputManager, target: PlatformerInputTarget): void;
  poll(): void;
  dispose(): void;
  actionNames?(): readonly string[];
}

export interface PlatformerActions {
  readonly left: string;
  readonly right: string;
  readonly down: string;
  readonly jump: string;
  readonly dash: string;
}
export const DEFAULT_PLATFORMER_ACTIONS: PlatformerActions = Object.freeze({
  left: "platformer:left",
  right: "platformer:right",
  down: "platformer:down",
  jump: "platformer:jump",
  dash: "platformer:dash",
});

/** Pass to InputPlugin({ actions: platformerControls() }). */
export function platformerControls(
  actions: PlatformerActions = DEFAULT_PLATFORMER_ACTIONS,
): Record<string, string[]> {
  return {
    [actions.left]: ["KeyA", "ArrowLeft", "GamepadDPadLeft"],
    [actions.right]: ["KeyD", "ArrowRight", "GamepadDPadRight"],
    [actions.down]: ["KeyS", "ArrowDown", "GamepadDPadDown"],
    [actions.jump]: ["Space", "KeyW", "ArrowUp", "GamepadA"],
    [actions.dash]: ["ShiftLeft", "ShiftRight", "GamepadB"],
  };
}

export interface PlatformerPointerViewport {
  readonly x: number;
  readonly width: number;
}

/**
 * Keyboard/gamepad plus optional pointer zones: left quarter moves left,
 * next quarter moves right, right half jumps. UI-claimed presses are skipped.
 * A custom binding replaces all devices. Use VirtualControls for a drawn overlay.
 */
export class PlatformerInputBinding implements InputBinding {
  private input: InputManager | undefined;
  private target: PlatformerInputTarget | undefined;
  private cleanups: (() => void)[] = [];
  private readonly pointers = new Map<
    number,
    { action: "left" | "right" | "jump"; generation: number }
  >();
  private readonly pendingJumps = new Map<number, number>();

  constructor(
    private readonly actions: PlatformerActions = DEFAULT_PLATFORMER_ACTIONS,
    private readonly viewport?: () => PlatformerPointerViewport | undefined,
  ) {}

  bind(input: InputManager, target: PlatformerInputTarget): void {
    this.dispose();
    this.input = input;
    this.target = target;
    this.cleanups.push(
      input.onPointerDown((pointer) => {
        if (pointer.button !== 0 || input.isPointerConsumed(pointer.id)) return;
        const rect = this.viewport?.();
        if (!rect || rect.width <= 0) return;
        const x = (pointer.screenPos.x - rect.x) / rect.width;
        if (x < 0 || x > 1) return;
        const action = x < 0.25 ? "left" : x < 0.5 ? "right" : "jump";
        this.pointers.set(pointer.id, {
          action,
          generation: pointer.generation,
        });
        if (action === "jump")
          this.pendingJumps.set(pointer.id, pointer.generation);
        input.consumePointer(pointer.id);
      }),
    );
    this.cleanups.push(
      input.onPointerUp((pointer) => {
        if (pointer.button !== 0 && pointer.button !== -1) return;
        this.pointers.delete(pointer.id);
        if (pointer.button === -1) this.pendingJumps.delete(pointer.id);
      }),
    );
    this.cleanups.push(
      input.onReset(() => {
        this.pointers.clear();
        this.pendingJumps.clear();
      }),
    );
  }

  poll(): void {
    const input = this.input,
      target = this.target;
    if (!input || !target) return;
    for (const [id, gesture] of this.pointers) {
      const pointer = input.getPointer(id);
      if (pointer?.generation !== gesture.generation || !pointer.buttons.has(0))
        this.pointers.delete(id);
    }
    const held = new Set(
      [...this.pointers.values()].map(({ action }) => action),
    );
    const jumpPending = this.pendingJumps.size > 0;
    const digital =
      Number(input.isPressed(this.actions.right) || held.has("right")) -
      Number(input.isPressed(this.actions.left) || held.has("left"));
    const stick = input.getStick("left");
    target.setDirection(digital || stick.x);
    target.setDown(input.isPressed(this.actions.down) || stick.y > 0.5);
    target.setJumpHeld(input.isPressed(this.actions.jump) || held.has("jump"));
    if (jumpPending || input.isJustPressed(this.actions.jump)) target.jump();
    this.pendingJumps.clear();
    if (input.isJustPressed(this.actions.dash)) target.dash();
  }

  actionNames(): readonly string[] {
    return Object.values(this.actions);
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.pointers.clear();
    this.pendingJumps.clear();
    this.input = undefined;
    this.target = undefined;
  }
}

/** Mutable input intent for device bindings, AI and scripted movement. */
export class PlatformerInput
  extends Component
  implements PlatformerDemand, PlatformerInputTarget
{
  private _direction = 0;
  private _down = false;
  private moves: PlatformerMoves | undefined;
  private binding: InputBinding | null;
  private resetSubscription: (() => void) | undefined;

  constructor(binding?: InputBinding | null) {
    super();
    this.binding =
      binding === undefined
        ? new PlatformerInputBinding(DEFAULT_PLATFORMER_ACTIONS, () => {
            const renderer = this.context.tryResolve(RendererAdapterKey);
            return (
              renderer?.visibleVirtualRect ??
              (renderer
                ? { x: 0, width: renderer.canvas.clientWidth }
                : undefined)
            );
          })
        : binding;
  }

  get direction(): number {
    return this._direction;
  }
  get down(): boolean {
    return this._down;
  }
  connect(moves: PlatformerMoves): void {
    this.moves = moves;
  }
  setDirection(direction: number): void {
    finite("PlatformerInput.setDirection", "direction", direction);
    if (Math.abs(direction) > 1)
      throw new Error(
        `PlatformerInput.setDirection: direction must be in [-1, 1], got ${direction}`,
      );
    this._direction = direction;
  }
  setDown(down: boolean): void {
    this._down = down;
  }
  setJumpHeld(held: boolean): void {
    this.moves?.setJumpHeld(held);
  }
  jump(): void {
    this.moves?.jump();
  }
  dash(): void {
    this.moves?.dash();
  }

  onEnable(): void {
    const binding = this.binding;
    if (!binding) return;
    const input = this.context.resolve(INPUT_KEY);
    this.invoke("bind", () => binding.bind(input, this));
    this.resetSubscription = input.onReset(() => {
      this._direction = 0;
      this._down = false;
      this.moves?.resetInput();
    });
    this.invoke("actionNames", () => {
      const missing =
        binding.actionNames?.().filter((name) => !input.hasAction(name)) ?? [];
      if (missing.length)
        this.context
          .tryResolve(LoggerKey)
          ?.warn(
            "character-controller",
            `Unmapped actions: ${missing.join(", ")}. Pass platformerControls() to InputPlugin or provide a custom input binding.`,
          );
    });
  }

  fixedUpdate(dt: number): void {
    finite("input.fixedUpdate", "dt", dt, 0);
    if (this.effectiveEnabled && this.binding)
      this.invoke("poll", () => this.binding?.poll());
  }

  onDisable(): void {
    if (this.binding) this.invoke("dispose", () => this.binding?.dispose());
    this.resetSubscription?.();
    this.resetSubscription = undefined;
    this._direction = 0;
    this._down = false;
    this.moves?.cancel();
  }

  private invoke(kind: string, callback: () => void): void {
    const boundary = this.context.tryResolve(ErrorBoundaryKey);
    if (boundary)
      boundary.wrapCallback(callback, {
        kind: `Platformer input ${kind}`,
        entity: this.entity.name,
        scene: this.scene.name,
      });
    else callback();
  }
}
