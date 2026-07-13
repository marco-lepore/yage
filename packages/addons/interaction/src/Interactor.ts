import { Component, LoggerKey, ServiceKey, Transform, isDev, type Logger } from "@yagejs/core";
import type { InputManager } from "@yagejs/input";
import { rankCandidates, selectFocus } from "./core/focus.js";
import { interactableRegistryFor } from "./core/registry.js";
import type { FocusQuery, InteractorOptions } from "./core/types.js";
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
  /** Last-`update()` snapshot backing `inRange`, kept in step with `_focus`:
   *  the enabled, non-destroyed candidates and the query they were ranked
   *  against. Cleared whenever focus is (disable, removal). */
  private _candidates: Interactable[] = [];
  private _query: FocusQuery | null = null;
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
        if (!value) this.clearFocusState();
      },
    });
  }

  onAdd(): void {
    this.logger = this.context.tryResolve(LoggerKey);
  }

  onDestroy(): void {
    // `entity.remove(Interactor)` leaves the entity alive, so the null-focus
    // emit inside `clearFocusState` reaches any listener normally.
    // `entity.destroy()` marks the entity destroyed before the deferred
    // teardown that runs this hook, so `Entity.emit` silently drops it — the
    // same as any other post-destroy emit.
    this.clearFocusState();
  }

  update(): void {
    if (!this.enabled) return;

    const registry = interactableRegistryFor(this.scene);
    const position = this.ownTransform.worldPosition;
    const query: FocusQuery = { position: { x: position.x, y: position.y }, range: this.range };
    const candidates: Interactable[] = [];
    for (const interactable of registry) {
      // A destroyed host stays registered until the end-of-frame flush;
      // skip it so a target destroyed earlier this frame can't be focused
      // or receive a final interaction.
      if (interactable.isEnabled() && !interactable.entity.isDestroyed) {
        candidates.push(interactable);
      }
    }

    // Cache the snapshot `inRange` ranks lazily, so it stays in step with the
    // focus picked from the same set. `focus === inRange[0]`.
    this._candidates = candidates;
    this._query = query;
    this.setFocus(selectFocus(query, candidates));

    if (this.action !== null && this._focus) {
      const input = this.resolveInputManager();
      if (input?.isJustPressed(this.action)) this.interact();
    }
  }

  /** The currently focused interactable, or `null` when nothing is in range.
   *  Same as `inRange[0] ?? null`. */
  get focus(): Interactable | null {
    return this._focus;
  }

  /** Every in-range, enabled interactable this frame, best focus first —
   *  `inRange[0]` is the current `focus`. Reflects the last `update()` (empty
   *  before the first one and while disabled). Read it to drive a "which do I
   *  interact with?" selection UI, or a per-target proximity icon/highlight;
   *  pass a choice back to `interact(target)`. A fresh array each call — safe to
   *  hold across frames without it changing underneath. */
  get inRange(): readonly Interactable[] {
    return this._query === null ? [] : rankCandidates(this._query, this._candidates);
  }

  /** Fires an interactable's `onInteract` and emits `InteractedEvent`. Targets
   *  the current `focus` by default; pass one from `inRange` to interact with a
   *  specific chosen target instead. No-op when there is no target, or when the
   *  target is not interactable right now — its host was destroyed, the
   *  component was removed, or its `enabled` gate is false. A custom controller
   *  or a test calls this directly instead of synthesizing device input. */
  interact(target?: Interactable): void {
    const interactable = target ?? this._focus;
    if (
      !interactable ||
      interactable.entity.isDestroyed ||
      !interactable.isEnabled() ||
      !interactableRegistryFor(this.scene).has(interactable)
    ) {
      return;
    }
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

  /** Drops focus and the `inRange` snapshot together (emitting the null-focus
   *  transition if a focus was held), so both read empty when tracking stops. */
  private clearFocusState(): void {
    this.setFocus(null);
    this._candidates = [];
    this._query = null;
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
