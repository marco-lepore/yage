import { Component, LoggerKey, ServiceKey, Transform, isDev, type Logger } from "@yagejs/core";
import type { InputManager } from "@yagejs/input";
import { selectFocus } from "./core/focus.js";
import { interactableRegistryFor } from "./core/registry.js";
import type { InteractorOptions } from "./core/types.js";
import type { Interactable } from "./Interactable.js";
import { InteractedEvent, InteractionFocusChangedEvent } from "./events.js";

const DEFAULT_RANGE = 48;
const DEFAULT_ACTION = "interact";

/**
 * `@yagejs/input` is an optional peer — this addon must work with the
 * package absent from the consumer's install. Re-declaring the well-known
 * service id here (instead of importing the `InputManagerKey` value from
 * `@yagejs/input`) means the root entry carries no runtime dependency on the
 * package; only the type is imported, which is erased at build.
 */
const INPUT_MANAGER_KEY = new ServiceKey<InputManager>("inputManager");

/**
 * The proximity detector. Tracks the nearest in-range, enabled `Interactable`
 * registered in the scene, exposes it as `focus`, and — with a non-null
 * `action` and a resolvable `InputManager` — fires the interact edge itself.
 * Headless drive (`interact()`) always works, with or without input.
 *
 * `enabled` (inherited from `Component`, default `true`) doubles as the
 * tracking toggle: setting it `false` emits a null-focus transition (if a
 * focus was held) and halts tracking + input polling; setting it `true`
 * resumes tracking next frame. Flip it to pause one interactor during a
 * cutscene, or to switch focus tracking between several interactors.
 */
export class Interactor extends Component {
  private readonly ownTransform = this.sibling(Transform);
  private readonly range: number;
  private readonly action: string | null;

  private logger: Logger | undefined;
  private _focus: Interactable | null = null;
  private _focusPrompt: string | null = null;
  private warnedMissingInput = false;
  private warnedUnmappedAction = false;

  constructor(opts: InteractorOptions = {}) {
    super();
    this.range = opts.range ?? DEFAULT_RANGE;
    this.action = opts.action === undefined ? DEFAULT_ACTION : opts.action;

    // `Component.enabled` is a plain inherited field (ComponentUpdateSystem's
    // update-gate) with no assignment hook, and TS forbids overriding a
    // field with an accessor at the class level (TS2611). Defining it as an
    // own-instance accessor here instead lets toggling `interactor.enabled`
    // emit the null-focus transition immediately rather than silently
    // freezing whatever focus was live when tracking stopped.
    let trackingEnabled = opts.enabled ?? true;
    Object.defineProperty(this, "enabled", {
      configurable: true,
      enumerable: true,
      get: (): boolean => trackingEnabled,
      set: (value: boolean): void => {
        if (value === trackingEnabled) return;
        trackingEnabled = value;
        if (!value) this.setFocus(null);
      },
    });
  }

  onAdd(): void {
    this.logger = this.context.tryResolve(LoggerKey);
  }

  onDestroy(): void {
    // `entity.remove(Interactor)` leaves the entity alive, so this emit
    // reaches any listener normally. `entity.destroy()` marks the entity
    // destroyed before the deferred teardown that runs this hook, so
    // `Entity.emit` silently drops it — the same as any other post-destroy
    // emit.
    if (this._focus) {
      this.entity.emit(InteractionFocusChangedEvent, { interactable: null, prompt: null });
    }
    this._focus = null;
    this._focusPrompt = null;
  }

  update(): void {
    if (!this.enabled) return;

    const registry = interactableRegistryFor(this.scene);
    const query = { position: this.ownTransform.worldPosition, range: this.range };
    const candidates: Interactable[] = [];
    for (const interactable of registry) {
      if (interactable.isEnabled()) candidates.push(interactable);
    }

    this.setFocus(selectFocus(query, candidates));

    if (this.action !== null && this._focus) {
      const input = this.resolveInputManager();
      if (input?.isJustPressed(this.action)) this.interact();
    }
  }

  /** The currently focused interactable, or `null` when nothing is in range. */
  get focus(): Interactable | null {
    return this._focus;
  }

  /** Fires the current focus's `onInteract` and emits `InteractedEvent`.
   *  No focus → no-op. A custom controller or a test calls this directly
   *  instead of synthesizing device input. */
  interact(): void {
    const interactable = this._focus;
    if (!interactable) return;
    interactable.interact();
    this.entity.emit(InteractedEvent, { interactable });
  }

  private setFocus(next: Interactable | null): void {
    const nextPrompt = next?.prompt ?? null;
    if (next === this._focus && nextPrompt === this._focusPrompt) return;
    this._focus = next;
    this._focusPrompt = nextPrompt;
    this.entity.emit(InteractionFocusChangedEvent, {
      interactable: next,
      prompt: nextPrompt,
    });
  }

  private resolveInputManager(): InputManager | undefined {
    const input = this.context.tryResolve(INPUT_MANAGER_KEY);
    if (!isDev()) return input;

    if (!input) {
      if (!this.warnedMissingInput) {
        this.warnedMissingInput = true;
        this.logger?.warn(
          "interaction",
          `Interactor has action "${this.action}" but no InputManager is resolvable — is ` +
            `@yagejs/input installed and its plugin registered? Falling back to manual ` +
            `interact() calls only.`,
        );
      }
      return input;
    }

    // Dev-only, once: the default action name (or a custom one) may not
    // exist in the game's action map — the silent-no-op trap, mirroring
    // the inventory addon's `warnIfActionsUnmapped`.
    if (this.action !== null && !this.warnedUnmappedAction && !input.hasAction(this.action)) {
      this.warnedUnmappedAction = true;
      this.logger?.warn(
        "interaction",
        `Interactor action "${this.action}" is absent from the InputManager action map; ` +
          `auto-input will do nothing. Add "${this.action}" to your action map, or pass a ` +
          `different \`action\` to Interactor.`,
      );
    }

    return input;
  }
}
