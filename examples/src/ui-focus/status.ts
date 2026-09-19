/**
 * The readout behind the focus example: a name per element, the account the
 * scopes give of themselves through their own callbacks, and the component
 * that writes both into the status panel each frame.
 */
import { Component } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { isCapturingInput } from "@yagejs/ui";
import type {
  FocusDirection,
  PointerFocusMode,
  UIElement,
  UIFocusScope,
  UIText,
} from "@yagejs/ui";

/** How many stops the focus trail keeps. */
const TRAIL_LENGTH = 4;

const names = new WeakMap<UIElement, string>();

/** Register the name the status panel prints for `element`, and return it. */
export function nameElement<T extends UIElement>(element: T, name: string): T {
  names.set(element, name);
  return element;
}

/** The registered name, or a placeholder. */
function nameOf(element: UIElement | null): string {
  if (element === null) return "nothing";
  return names.get(element) ?? "unnamed element";
}

/**
 * What the scopes report through `onFocusMove`, `onActivate` and
 * `onMoveBlocked`. Every field comes from a scope callback, so the panel shows
 * the focus model's own account rather than a second copy of it.
 */
export class FocusLog {
  private readonly trail: string[] = [];
  private activatedName = "nothing yet";
  private blockedDirection = "nothing yet";

  move(element: UIElement | null, previous: UIElement | null): void {
    if (this.trail.length === 0) this.trail.push(nameOf(previous));
    this.trail.push(nameOf(element));
    while (this.trail.length > TRAIL_LENGTH) this.trail.shift();
  }

  activated(element: UIElement): void {
    this.activatedName = nameOf(element);
  }

  blocked(direction: FocusDirection): void {
    this.blockedDirection = direction;
  }

  get path(): string {
    return this.trail.length === 0 ? "nothing yet" : this.trail.join(" > ");
  }

  get lastActivated(): string {
    return this.activatedName;
  }

  get lastBlocked(): string {
    return this.blockedDirection;
  }
}

/** A line written only when it changes, so an idle panel costs no layout. */
class StatusLine {
  private current = "";

  constructor(private readonly element: UIText) {}

  set(value: string): void {
    if (value === this.current) return;
    this.current = value;
    this.element.setText(value);
  }
}

/** One scope, named for the panel, reached through its host's own getter. */
export interface FocusPane {
  readonly name: string;
  readonly host: { readonly focusScope: UIFocusScope | null };
}

/** The seven `UIText` nodes the readout writes. */
export interface FocusReadoutLines {
  readonly focused: UIText;
  readonly scope: UIText;
  readonly capture: UIText;
  readonly trail: UIText;
  readonly cues: UIText;
  readonly actions: UIText;
  readonly policy: UIText;
}

/** The two pointer rules the page's own controls switch, read every frame. */
export interface PointerPolicy {
  readonly pointerFocus: PointerFocusMode;
  readonly dialogOwnsPointer: boolean;
}

export interface FocusReadoutOptions {
  readonly panes: readonly FocusPane[];
  readonly log: FocusLog;
  /** Elements that can hold their scope's input, in the order to report them. */
  readonly holders: readonly UIElement[];
  readonly policy: PointerPolicy;
  readonly lines: FocusReadoutLines;
}

/**
 * Prints the focus model's state every frame. `hasInput` and `focused` come
 * from the scopes' getters, the trail and the cues from their callbacks, and
 * the two counters from the same action map the scopes read — a scope consumes
 * nothing it polls, so a confirm press that fires a row is still counted here.
 */
export class FocusReadout extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly panes: readonly FocusPane[];
  private readonly log: FocusLog;
  private readonly holders: readonly UIElement[];
  private readonly policy: PointerPolicy;
  private readonly focused: StatusLine;
  private readonly scope: StatusLine;
  private readonly capture: StatusLine;
  private readonly trail: StatusLine;
  private readonly cues: StatusLine;
  private readonly actions: StatusLine;
  private readonly policyLine: StatusLine;
  private interacts = 0;
  private fires = 0;

  constructor(options: FocusReadoutOptions) {
    super();
    this.panes = options.panes;
    this.log = options.log;
    this.holders = options.holders;
    this.policy = options.policy;
    this.focused = new StatusLine(options.lines.focused);
    this.scope = new StatusLine(options.lines.scope);
    this.capture = new StatusLine(options.lines.capture);
    this.trail = new StatusLine(options.lines.trail);
    this.cues = new StatusLine(options.lines.cues);
    this.actions = new StatusLine(options.lines.actions);
    this.policyLine = new StatusLine(options.lines.policy);
  }

  update(): void {
    const driven = this.panes.find(
      (pane) => pane.host.focusScope?.hasInput === true,
    );
    const scope = driven?.host.focusScope ?? null;

    this.focused.set(`Focused: ${nameOf(scope?.focused ?? null)}`);
    this.scope.set(`Reading input: ${driven?.name ?? "no scope"}`);
    // An element answering the player on its own — a field with the caret, a
    // select showing its list — holds every press its scope reads, so the
    // menu behind it stays still until it lets go.
    const holder = this.holders.find((element) => isCapturingInput(element));
    this.capture.set(
      holder === undefined
        ? "Holding the keys: nothing"
        : `Holding the keys: ${nameOf(holder)}`,
    );
    this.trail.set(`Focus trail: ${this.log.path}`);
    this.cues.set(
      `Activated: ${this.log.lastActivated}   Blocked: ${this.log.lastBlocked}`,
    );

    if (this.input.isJustPressed("interact")) this.interacts += 1;
    if (this.input.isJustPressed("fire")) this.fires += 1;
    this.actions.set(
      `Gameplay hears: interact x${this.interacts}, fire x${this.fires}`,
    );

    const owns = this.policy.dialogOwnsPointer ? "dialog owns" : "shared";
    this.policyLine.set(
      `Pointer: focus on ${this.policy.pointerFocus}, ${owns}`,
    );
  }
}
