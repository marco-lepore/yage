/** The status panel of the focus example: element names and a live readout. */
import { Component } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { isCapturingInput } from "@yagejs/ui";
import type {
  FocusDirection,
  UIElement,
  UIFocusScope,
  UIText,
} from "@yagejs/ui";

const names = new WeakMap<UIElement, string>();

/** Register the name the status panel prints for `element`, and return it. */
export function named<T extends UIElement>(element: T, name: string): T {
  names.set(element, name);
  return element;
}

function nameOf(element: UIElement | null | undefined): string {
  return element ? (names.get(element) ?? "unnamed element") : "nothing";
}

interface FocusHost {
  readonly focusScope: UIFocusScope | null;
}

export interface FocusStatusView {
  /** Each scope's name and the host whose `focusScope` getter reads it. */
  readonly scopes: readonly (readonly [string, FocusHost])[];
  /** Elements that can hold their scope's keys, such as a text field. */
  readonly holders: readonly UIElement[];
  /** The page's own pointer settings, as one sentence. */
  readonly pointer: () => string;
  /** Seven text nodes, one per status line. */
  readonly lines: readonly UIText[];
}

/** Prints which element is focused, the moves the scopes report, and input. */
export class FocusStatus extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly trail: string[] = [];
  private activated = "nothing yet";
  private blocked = "nothing yet";
  private interacts = 0;
  private fires = 0;
  private shown: string[] = [];
  private view!: FocusStatusView;

  /** Spread into a scope's `focus` options: the scope reports through these. */
  readonly callbacks = {
    onFocusMove: (element: UIElement | null, previous: UIElement | null) => {
      if (this.trail.length === 0) this.trail.push(nameOf(previous));
      this.trail.push(nameOf(element));
      while (this.trail.length > 4) this.trail.shift();
    },
    onActivate: (element: UIElement) => {
      this.activated = nameOf(element);
    },
    onMoveBlocked: (direction: FocusDirection) => {
      this.blocked = direction;
    },
  };

  connect(view: FocusStatusView): this {
    this.view = view;
    return this;
  }

  update(): void {
    const view = this.view;
    // A scope consumes nothing it polls, so gameplay still hears these.
    if (this.input.isJustPressed("interact")) this.interacts += 1;
    if (this.input.isJustPressed("fire")) this.fires += 1;

    const active = view.scopes.find(([, host]) => host.focusScope?.hasInput);
    const holder = view.holders.find((element) => isCapturingInput(element));
    const text = [
      `Focused: ${nameOf(active?.[1].focusScope?.focused)}`,
      `Reading input: ${active?.[0] ?? "no scope"}`,
      `Holding the keys: ${nameOf(holder)}`,
      `Pointer: ${view.pointer()}`,
      `Focus trail: ${this.trail.join(" > ") || "nothing yet"}`,
      `Activated: ${this.activated}   Blocked: ${this.blocked}`,
      `Gameplay hears: interact x${this.interacts}, fire x${this.fires}`,
    ];
    text.forEach((value, index) => {
      if (value !== this.shown[index]) view.lines[index]?.setText(value);
    });
    this.shown = text;
  }
}
