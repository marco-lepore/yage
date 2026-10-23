import {
  Component,
  ErrorBoundaryKey,
  LoggerKey,
  RendererAdapterKey,
} from "@yagejs/core";
import { InputManagerKey, type InputManager } from "@yagejs/input";
import { finite } from "../core/validate.js";
import { PlatformerMoves } from "./PlatformerMoves.js";

export interface PlatformerInputTarget {
  setDirection(direction: number): void;
  setDown(down: boolean): void;
  setJumpHeld(held: boolean): void;
  jump(): void;
  dash(): void;
  /** Drop through the current one-way platform. Down plus jump does the same. */
  drop(): void;
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

/**
 * Mutable input intent for device bindings, AI and scripted movement. The
 * controller reads the held direction and crouch each fixed step; presses go
 * to the entity's `PlatformerMoves`, which must be added first.
 */
export class PlatformerInput
  extends Component
  implements PlatformerInputTarget
{
  static override updatePriority = -30;

  private _direction = 0;
  private _down = false;
  private moves!: PlatformerMoves;
  private binding: InputBinding | null;
  private resetSubscription: (() => void) | undefined;

  constructor(binding?: InputBinding | null) {
    super();
    this.binding =
      binding === undefined
        ? new PlatformerInputBinding(DEFAULT_PLATFORMER_ACTIONS, () => {
            const renderer = this.context.tryResolve(RendererAdapterKey);
            if (!renderer) return undefined;
            if (renderer.visibleVirtualRect) return renderer.visibleVirtualRect;
            // Pointer positions are virtual pixels; map the canvas edges.
            const width = renderer.canvas.clientWidth;
            if (!renderer.canvasToVirtual) return { x: 0, width };
            const left = renderer.canvasToVirtual(0, 0).x;
            return {
              x: left,
              width: renderer.canvasToVirtual(width, 0).x - left,
            };
          })
        : binding;
  }

  get direction(): number {
    return this._direction;
  }
  get down(): boolean {
    return this._down;
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
    this.moves.setJumpHeld(held);
  }
  jump(): void {
    this.moves.jump();
  }
  dash(): void {
    this.moves.dash();
  }
  drop(): void {
    this.moves.drop();
  }

  onAdd(): void {
    const moves = this.entity.tryGet(PlatformerMoves);
    if (!moves)
      throw new Error(
        "PlatformerInput: add PlatformerMoves to the entity before PlatformerInput",
      );
    this.moves = moves;
  }

  onEnable(): void {
    const binding = this.binding;
    if (!binding) return;
    const input = this.context.tryResolve(InputManagerKey);
    if (!input)
      throw new Error(
        "PlatformerInput: install InputPlugin or construct it with a null binding",
      );
    this.invoke("bind", () => binding.bind(input, this));
    this.resetSubscription = input.onReset(() => {
      this._direction = 0;
      this._down = false;
      this.moves.resetInput();
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

  fixedUpdate(): void {
    const binding = this.binding;
    if (binding) this.invoke("poll", () => binding.poll());
  }

  onDisable(): void {
    const binding = this.binding;
    if (binding) this.invoke("dispose", () => binding.dispose());
    this.resetSubscription?.();
    this.resetSubscription = undefined;
    this._direction = 0;
    this._down = false;
    this.moves.resetInput();
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
