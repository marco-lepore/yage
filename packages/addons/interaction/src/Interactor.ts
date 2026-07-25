import { Component, LoggerKey, ServiceKey, Transform, isDev, type Logger } from "@yagejs/core";
import type { InputManager } from "@yagejs/input";
import { rankInteractables } from "./core/focus.js";
import { interactableRegistryFor } from "./core/registry.js";
import type { FocusQuery } from "./core/types.js";
import type { InteractorOptions } from "./core/types.js";
import type { Interactable } from "./Interactable.js";
import {
  InteractionFocusChangedEvent,
  InteractionInRangeChangedEvent,
  InteractionPerformedEvent,
} from "./events.js";

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

/** Whether two ranked snapshots hold the same interactables in the same order. */
function sameRanking(a: readonly Interactable[], b: readonly Interactable[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * The proximity detector. Each `update()` ranks every in-range, enabled
 * `Interactable` registered in the scene into one snapshot: `inRange` is that
 * snapshot and `focus` is its first element, so the two can never disagree.
 * With a non-null `action` and a resolvable `InputManager` it fires the
 * interact edge itself; headless drive (`interact()`) always works, with or
 * without input.
 *
 * `enabled` (inherited from `Component`, default `true`) doubles as the
 * tracking toggle: setting it `false` empties the snapshot (emitting the
 * transitions) and halts tracking, input polling, and `interact()`; setting it
 * `true` resumes tracking next frame. Flip it to pause one interactor during a
 * cutscene, or to switch focus tracking between several interactors.
 * Deactivating the host entity does the same thing, and reactivating it
 * resumes — an interactor on a dormant entity focuses nothing.
 */
export class Interactor extends Component {
  private readonly ownTransform = this.sibling(Transform);
  private readonly range: number;
  private readonly action: string | null;

  private logger: Logger | undefined;
  /** The single source of truth, rebuilt each `update()`. `focus` is derived
   *  from it, never stored separately — two writable fields is how they drift. */
  private _inRange: readonly Interactable[] = [];
  /** Last values actually handed to listeners, for change detection only. */
  private emittedFocus: Interactable | null = null;
  private emittedPrompt: string | null = null;
  private emittedInRange: readonly Interactable[] = [];
  private warnedMissingInput = false;
  private warnedUnmappedAction = false;

  constructor(opts: InteractorOptions = {}) {
    super();
    this.range = opts.range ?? DEFAULT_RANGE;
    this.action = opts.action === undefined ? DEFAULT_ACTION : opts.action;
    // An assignment, not a field: `Component.enabled` is an accessor whose
    // setter fires the enable hooks. Safe this early — the component has no
    // entity yet, so the effective state stays false and no hook runs.
    this.enabled = opts.enabled ?? true;
  }

  onAdd(): void {
    this.logger = this.context.tryResolve(LoggerKey);

    // The in-range test squares `range + radius`, which turns a negative reach
    // back into a positive one — distant targets would silently become
    // selectable. Caught here, at the edge, so the per-candidate test stays a
    // plain comparison.
    if (isDev() && this.range < 0) {
      this.logger?.warn(
        "interaction",
        `Interactor range is ${this.range}. Range is a distance in world px and cannot be ` +
          `negative: the in-range test squares it, so this behaves like range ${-this.range}. ` +
          `Use 0 to reach only interactables the interactor overlaps.`,
      );
    }
  }

  /**
   * Empties the snapshot the moment the interactor stops running — `enabled`
   * set false, the entity deactivated, the component removed or destroyed —
   * rather than freezing whatever happened to be in range.
   *
   * `entity.remove(Interactor)` leaves the entity alive, so the transitions
   * emitted here reach listeners normally. `entity.destroy()` marks the entity
   * destroyed before the deferred teardown that runs this hook, so
   * `Entity.emit` silently drops them — as with any post-destroy emit.
   */
  onDisable(): void {
    this.setInRange([]);
  }

  update(): void {
    if (!this.effectiveEnabled) return;

    const registry = interactableRegistryFor(this.scene);
    const position = this.ownTransform.worldPosition;
    const query: FocusQuery = { position: { x: position.x, y: position.y }, range: this.range };
    const candidates: Interactable[] = [];
    for (const interactable of registry) {
      // A destroyed host stays registered until the end-of-frame flush; skip
      // it so a target destroyed earlier this frame can't be focused or
      // receive a final interaction.
      if (interactable.isEnabled() && !interactable.entity.isDestroyed) {
        candidates.push(interactable);
      }
    }

    // One ranked snapshot, sampled from one geometry pass. `Interactable.position`
    // is a live transform read, so ranking lazily on read would let a target that
    // moved since this frame reorder the set out from under `focus`.
    this.setInRange(rankInteractables(query, candidates));

    if (this.action !== null && this.focus) {
      const input = this.resolveInputManager();
      if (input?.isJustPressed(this.action)) this.interact();
    }
  }

  /** The interactable this interactor would act on — the top of `inRange`, or
   *  `null` when nothing is in range. */
  get focus(): Interactable | null {
    return this._inRange[0] ?? null;
  }

  /** Every in-range, enabled interactable, best focus first — `inRange[0]` is
   *  `focus`. Rebuilt each `update()`; empty before the first one and while
   *  disabled. Read it to drive a "which do I interact with?" selection UI, or
   *  a per-target proximity icon, and pass a choice back to `interact(target)`. */
  get inRange(): readonly Interactable[] {
    return this._inRange;
  }

  /** Fires an interactable's `onInteract` and emits `InteractionPerformedEvent`.
   *  Targets the current `focus` by default; pass one from `inRange` to act on a
   *  chosen target instead. No-op unless the interactor is running (enabled, on
   *  an active entity) and the target is in the current `inRange` snapshot and
   *  still live (host not destroyed, component not removed or dormant,
   *  `isEnabled()` gate still true).
   *
   *  To fire an interactable the interactor can't reach — a scripted or remote
   *  trigger — call `interactable.interact()` directly. That bypasses every
   *  check here and emits no interactor event. */
  interact(target?: Interactable): void {
    if (!this.effectiveEnabled) return;

    const interactable = target ?? this.focus;
    if (
      !interactable ||
      !this._inRange.includes(interactable) ||
      interactable.entity.isDestroyed ||
      !interactable.isEnabled() ||
      !interactableRegistryFor(this.scene).has(interactable)
    ) {
      return;
    }
    interactable.interact();
    this.entity.emit(InteractionPerformedEvent, { interactable });
  }

  /**
   * Installs the new snapshot, then emits whatever changed. Entity handlers run
   * synchronously, so every field is assigned *before* the first emit — a
   * listener reading `focus`/`inRange` must see the new state, never the old.
   */
  private setInRange(next: readonly Interactable[]): void {
    this._inRange = next;

    const focus = next[0] ?? null;
    const prompt = focus?.prompt ?? null;

    // Each `emitted*` field is written immediately before its own emit, never
    // up front: an emit that gets skipped below must not leave the bookkeeping
    // claiming it announced something it did not.
    if (focus !== this.emittedFocus || prompt !== this.emittedPrompt) {
      this.emittedFocus = focus;
      this.emittedPrompt = prompt;
      this.entity.emit(InteractionFocusChangedEvent, { interactable: focus, prompt });

      // A handler can re-enter and install a newer snapshot — disabling the
      // interactor, say. `next` is then already history, so announcing it would
      // report targets this interactor has dropped. The re-entrant call (or the
      // next update) announces whatever is current.
      if (this._inRange !== next) return;
    }

    if (!sameRanking(next, this.emittedInRange)) {
      this.emittedInRange = next;
      this.entity.emit(InteractionInRangeChangedEvent, { inRange: next });
    }
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
