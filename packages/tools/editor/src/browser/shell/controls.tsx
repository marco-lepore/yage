import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export interface ButtonProps {
  /**
   * The click. It is handed the event for the one case that needs it: a button
   * inside something else that is clickable — a hierarchy row — has to keep
   * the click from reaching it.
   */
  readonly onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly children: ReactNode;
  /** Defaults to the ordinary button. Pass a variant or a bespoke class. */
  readonly className?: string | undefined;
  readonly testId?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly title?: string | undefined;
  /** The name a screen reader reads. For a button whose content is an icon. */
  readonly ariaLabel?: string | undefined;
  /** Set on a toggle: whether this is the choice currently in effect. */
  readonly pressed?: boolean | undefined;
  /** Takes the focus when it is rendered. For the safe answer in a dialog. */
  readonly autoFocus?: boolean | undefined;
}

/**
 * Every button in the shell.
 *
 * It exists for one reason beyond consistency: a button that keeps focus after
 * a mouse click takes the next Space press, and in this shell Space is how the
 * view pans. See {@link releaseFocus}. Adding a button through this component
 * is what keeps that from being remembered one call site at a time.
 */
export function Button(props: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={props.className ?? "ye-button"}
      data-testid={props.testId}
      disabled={props.disabled ?? false}
      title={props.title}
      aria-label={props.ariaLabel}
      aria-pressed={props.pressed}
      autoFocus={props.autoFocus ?? false}
      onClick={(event) => {
        props.onClick(event);
        releaseFocus(event);
      }}
    >
      {props.children}
    </button>
  );
}

/**
 * Give the keyboard back after a pointer click.
 *
 * `Viewport` reads Space on the window and skips it while a button has focus,
 * because a button activates on Space. Without this, clicking any button in
 * the shell would leave Space doing that button again instead of panning —
 * which on Undo or Delete means a second edit rather than nothing.
 *
 * `detail` counts the clicks a pointer made, and is 0 when the keyboard
 * activated the button — so a developer tabbing through the shell keeps the
 * focus they navigated to.
 */
export function releaseFocus(event: ReactMouseEvent<HTMLElement>): void {
  if (event.detail > 0) event.currentTarget.blur();
}

/**
 * What a control shows in place of a value the selected placements do not
 * agree on. One word across the box, the dropdown and the bar's numbers, so
 * "they differ" reads the same wherever it is met.
 */
export const MIXED_LABEL = "Mixed";

/**
 * Whether the values a control was handed — one per selected placement —
 * disagree, which is what puts `MIXED_LABEL` where a value would be. Compared
 * by identity unless the caller knows a wider sameness, as a parameter value
 * does: two placements holding equal objects agree.
 */
export function isMixed<T>(
  values: readonly T[],
  same: (left: T, right: T) => boolean = Object.is,
): boolean {
  const [first, ...rest] = values;
  return rest.some((one) => !same(one, first as T));
}

/** The typed text without its surrounding spaces, or `null` when nothing is left. */
export function trimmedOrNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

export interface TextFieldProps {
  /** The word beside the box. */
  readonly label: string;
  /** What the document holds. The box shows it whenever nothing is typed. */
  readonly value: string;
  /** Runs on Enter or blur, only when the typed text differs from `value`. */
  readonly onCommit: (text: string) => void;
  readonly testId: string;
  readonly disabled?: boolean | undefined;
  /** Shown greyed when the box is empty — the value in force without one. */
  readonly placeholder?: string | undefined;
  readonly title?: string | undefined;
  /** Marks the box invalid for a reason from outside it, such as a diagnostic. */
  readonly invalid?: boolean | undefined;
  /**
   * Why the typed text cannot be committed, or `undefined` when it can. A
   * refused draft stays in the box and the reason renders next to it, so
   * nothing the developer typed disappears without saying why. Where it lands
   * is the call site's layout: under the row in the inspector, beside the box
   * in the bar.
   */
  readonly reject?: ((text: string) => string | undefined) | undefined;
  /** Defaults to the inspector's row. Pass a variant or a bespoke class. */
  readonly className?: string | undefined;
  /**
   * Set on a box that only takes numbers, so a phone shows the number pad.
   * `decimal` and not `numeric`: every one of these fields takes a fraction,
   * and the digits-only pad has no decimal separator.
   */
  readonly numeric?: boolean | undefined;
  /**
   * Offer several lines to type into rather than one. Enter then types a
   * newline, so leaving the box is what commits.
   */
  readonly multiline?: boolean | undefined;
  /** A control rendered inside the label, after the box. */
  readonly children?: ReactNode;
  /**
   * Values the box can be completed to. A box without it is the plain text
   * box it is today: no list, no toggle, and no change to any key.
   */
  readonly completion?: TextFieldCompletion | undefined;
  /**
   * How the box changes by the arrow keys and by dragging its label. A box
   * without it takes a number only by typing.
   */
  readonly stepping?: TextFieldStepping | undefined;
}

/** Which way one step goes and which modifiers are held while it is taken. */
export interface StepIntent {
  /** 1 for Up or a drag to the right, -1 for Down or a drag to the left. */
  readonly direction: 1 | -1;
  /** Shift is held: the coarse unit rather than the ordinary step. */
  readonly coarse: boolean;
  /** Alt is held: the fine unit rather than the ordinary step. */
  readonly fine: boolean;
}

/**
 * How a box changes by the arrow keys and by dragging its label.
 *
 * {@link TextFieldStepping.step} works in text on both sides, so the ladder
 * and the way a number is written stay with the call site that owns the
 * quantity. The box knows which key was pressed and nothing about what the
 * number means.
 *
 * There are no arrow buttons. A number changes by typing it, by Up and Down,
 * or by dragging the word beside it, which carries a `col-resize` cursor.
 */
export interface TextFieldStepping {
  /**
   * The text one step produces from the text the box is showing, or
   * `undefined` when that text is nothing this field can step from — which
   * also refuses the press.
   */
  readonly step: (text: string, intent: StepIntent) => string | undefined;
  /**
   * Runs with each stepped text before anything is committed, so a caller
   * whose value the viewport draws can paint it on the press rather than
   * after the box is left. Left out by a box that commits every step.
   */
  readonly onStep?: ((text: string) => void) | undefined;
  /**
   * Runs when the box gives up a draft a step produced: Escape, or a commit of
   * text the value already held. A caller that painted something in `onStep`
   * puts it back here. Text that was only typed never reaches it — nothing was
   * painted for it.
   */
  readonly onCancel?: (() => void) | undefined;
  /**
   * Commit every step instead of holding a draft until Enter or blur. For a
   * value that takes no undo entry, where waiting would only hide the press.
   */
  readonly commitEach?: boolean | undefined;
}

/**
 * Screen pixels of label drag that take one step.
 *
 * Four, which puts a whole box of a 5-unit ladder within a thumb's travel and
 * is close to what Blender and Unity ask for. The modifiers apply to a scrub
 * exactly as they do to a press, read at each move rather than at the press,
 * so a drag can change gear part-way through.
 */
const SCRUB_PIXELS = 4;

/** A label drag in progress. */
interface Scrub {
  readonly pointerId: number;
  /** Where the pointer went down, in client pixels. */
  readonly from: number;
  /** Steps taken so far, signed. */
  taken: number;
  /** The text the last step produced; the next one starts from it. */
  text: string;
}

export interface TextFieldCompletion {
  /**
   * Every value on offer. The list shows the ones containing the typed text,
   * case-insensitively, in this order.
   */
  readonly values: readonly string[];
  /**
   * Runs when the list opens, so the caller can read what it has not got. It
   * may run again on a later open; the caller decides whether that refetches.
   */
  readonly onOpen: () => void;
  /**
   * A line under the rows: what is being read, why it could not be, or what
   * the list leaves out. Undefined when the rows are the whole answer.
   */
  readonly note?: string | undefined;
}

/** How many matches the list draws before it asks for a narrower filter. */
const MAX_COMPLETION_ROWS = 50;

/** The element a text field types into: one line, or several. */
type EntryElement = HTMLInputElement | HTMLTextAreaElement;

/** How tall a multiline box starts. It grows by the browser's own handle. */
const MULTILINE_ROWS = 4;

/**
 * Every text box in the shell.
 *
 * Enter or blur commits, Escape puts back what the box was showing, and text
 * equal to what it was showing commits nothing — so tabbing through a panel
 * of fields writes only where something was typed. The box holds a draft
 * while it is being edited, which is what keeps a half-typed `6` on the way
 * to `64` from taking effect.
 *
 * A box given a {@link TextFieldCompletion} also offers what it may be
 * completed to: a toggle opens a list under it, the typed text narrows the
 * list, and a click or Enter on a row commits that row. The typed text is
 * still committed on its own, so a path that does not exist yet can be typed
 * in full.
 *
 * A box given {@link TextFieldStepping} also changes by Up and Down and by
 * dragging its label. A completion list owns both arrow keys, so a box given
 * both leaves them to the list and steps only by its label.
 *
 * A `multiline` box is a text area: Enter types a newline there, so leaving
 * the box is what commits, and Escape still puts back what it was showing.
 */
export function TextField(props: TextFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | undefined>();
  const [refused, setRefused] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | undefined>();
  const inputRef = useRef<EntryElement | null>(null);
  const scrub = useRef<Scrub | undefined>(undefined);
  /** Whether the drag that just ended took a step, so its click is not a click. */
  const dragged = useRef(false);
  /** Whether the draft came from a step, so `onCancel` speaks only for one. */
  const stepped = useRef(false);
  const listId = useId();
  const completion = props.completion;
  const stepping = props.stepping;
  const disabled = props.disabled ?? false;

  // The typed text, and only the typed text: pressing the toggle without
  // typing offers the whole list rather than what the field already holds.
  const filter = (draft ?? "").trim().toLowerCase();
  const matches =
    completion === undefined
      ? []
      : completion.values.filter((value) =>
          value.toLowerCase().includes(filter),
        );
  const rows = matches.slice(0, MAX_COMPLETION_ROWS);
  const beyond = matches.length - rows.length;
  const notes = [
    completion?.note,
    beyond > 0
      ? `+ ${String(beyond)} more. Keep typing to narrow it.`
      : undefined,
    completion !== undefined &&
    completion.values.length > 0 &&
    matches.length === 0
      ? "Nothing matches."
      : undefined,
  ].filter((line): line is string => line !== undefined);

  const clear = (): void => {
    setDraft(undefined);
    setRefused(undefined);
    stepped.current = false;
  };
  const close = (): void => {
    setOpen(false);
    setActive(undefined);
  };
  const show = (): void => {
    setOpen(true);
    setActive(undefined);
    completion?.onOpen();
  };
  /**
   * Refuse the press that would move focus out of the box.
   *
   * Every part of the completion widget needs this — the ▾ toggle, the list
   * with its scrollbar and its border, and the note under it — because a blur
   * commits the draft, so a press meant to read or scroll the list would write
   * the half-typed filter as the value. Anything added to the widget carries
   * this handler too.
   */
  const keepFocus = (event: ReactMouseEvent): void => {
    event.preventDefault();
  };
  const commitText = (text: string): void => {
    if (text === props.value) {
      // Back where it started. A stepped draft is also being held and drawn by
      // the caller, so it goes with the text.
      if (stepped.current) stepping?.onCancel?.();
      clear();
      return;
    }
    const reason = props.reject?.(text);
    if (reason !== undefined) {
      setRefused(reason);
      return;
    }
    clear();
    props.onCommit(text);
  };
  const commit = (): void => {
    if (draft === undefined) {
      clear();
      return;
    }
    commitText(draft);
  };
  /**
   * Take one step from `from`, and either commit it or hold it as the draft.
   * Answers the text the step produced, so a scrub can step again from it
   * before React has re-rendered.
   */
  const takeStep = (from: string, intent: StepIntent): string | undefined => {
    if (!stepping || disabled) return undefined;
    const next = stepping.step(from, intent);
    if (next === undefined) return undefined;
    if (stepping.commitEach === true) {
      // Drafted first, so a step the call site refuses stays in the box with
      // its reason. A step it takes clears the draft on its way through.
      setDraft(next);
      // A ladder at its own limit answers the text it was given. Compared here
      // rather than in `commitText`, which reads the value React last
      // rendered — a fast label drag takes several steps before it does.
      if (next !== from) commitText(next);
      return next;
    }
    setDraft(next);
    stepped.current = true;
    // The reason goes as soon as the text it was about does.
    setRefused(undefined);
    stepping.onStep?.(next);
    return next;
  };
  const onKeyDown = (event: ReactKeyboardEvent<EntryElement>): void => {
    if (event.key === "Enter" && props.multiline !== true) {
      event.preventDefault();
      const picked = active === undefined ? undefined : rows[active];
      if (picked === undefined) commit();
      else commitText(picked);
      close();
    } else if (event.key === "Escape") {
      event.preventDefault();
      // While the list is open Escape puts the list away and leaves the text
      // alone, so narrowing it is not the same gesture as abandoning the edit.
      if (open) close();
      else {
        if (stepped.current) stepping?.onCancel?.();
        clear();
      }
    } else if (completion !== undefined && event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) show();
      else if (rows.length > 0) {
        setActive((current) =>
          current === undefined ? 0 : Math.min(current + 1, rows.length - 1),
        );
      }
    } else if (completion !== undefined && open && event.key === "ArrowUp") {
      event.preventDefault();
      // Above the first row the caret is back in charge of the box.
      setActive((current) =>
        current === undefined || current === 0 ? undefined : current - 1,
      );
    } else if (
      // A completion list owns both arrow keys for moving its highlight, so a
      // box that offers one never steps from the keyboard.
      completion === undefined &&
      stepping !== undefined &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      takeStep(draft ?? props.value, {
        direction: event.key === "ArrowUp" ? 1 : -1,
        coarse: event.shiftKey,
        fine: event.altKey,
      });
    }
  };

  /**
   * Drag the word beside the box to change the number.
   *
   * The label and not the box: the caret and the text selection stay the
   * developer's, which is what Blender and Unity do. The press takes pointer
   * capture so the drag survives leaving the label.
   *
   * A drag never moves focus to the box, so its release is what commits since
   * no blur will. That takes `cancelActivation` below as well as the
   * `preventDefault` here: this one suppresses the compatibility mouse press
   * and the focus that comes with it, and the click that follows the release
   * can focus the box through the label it sits in — which would leave every
   * one-letter shortcut in the shell typed into the number instead.
   */
  const startScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || !stepping || disabled) return;
    // Refuses the text selection a drag over a word would otherwise start.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragged.current = false;
    scrub.current = {
      pointerId: event.pointerId,
      from: event.clientX,
      taken: 0,
      text: draft ?? props.value,
    };
  };
  const moveScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    const session = scrub.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const wanted = Math.trunc((event.clientX - session.from) / SCRUB_PIXELS);
    while (session.taken !== wanted) {
      const direction = wanted > session.taken ? 1 : -1;
      const next = takeStep(session.text, {
        direction,
        coarse: event.shiftKey,
        fine: event.altKey,
      });
      // Nothing to step from, so the rest of this drag has nothing to do
      // either until the text changes.
      if (next === undefined) break;
      session.text = next;
      session.taken += direction;
      dragged.current = true;
    }
  };
  const endScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    const session = scrub.current;
    if (!session || session.pointerId !== event.pointerId) return;
    scrub.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // The text the drag left behind, whatever route it took to get there. It
    // goes through the ordinary commit, which writes nothing when it equals
    // the value — so a drag that came back to where it started, or one that
    // never crossed a step, leaves the document alone. A press on the label of
    // a box that already held typed text commits that text, which is what its
    // blur would have written anyway.
    if (stepping?.commitEach !== true) commitText(session.text);
  };
  /**
   * The pointer was taken away rather than released, so there is no final
   * value to commit. A caller that painted the steps puts them back.
   */
  const cancelScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    const session = scrub.current;
    if (!session || session.pointerId !== event.pointerId) return;
    scrub.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (stepped.current) stepping?.onCancel?.();
    clear();
  };
  /**
   * Cancel the label's own behaviour after a drag: a click inside a `<label>`
   * can focus the box it wraps, and a drag ends in a click. A press that took
   * no step is an ordinary click and still focuses the box.
   */
  const cancelActivation = (event: ReactMouseEvent<HTMLElement>): void => {
    if (!dragged.current) return;
    dragged.current = false;
    event.preventDefault();
  };
  const scrubHandlers =
    stepping === undefined || disabled
      ? {}
      : {
          onPointerDown: startScrub,
          onPointerMove: moveScrub,
          onPointerUp: endScrub,
          onPointerCancel: cancelScrub,
          onClick: cancelActivation,
        };

  /**
   * What the box needs whether it is one line or several. Written once so the
   * two elements cannot drift apart; only `type` and the row count differ.
   */
  const entryProps = {
    ref: (node: EntryElement | null) => {
      inputRef.current = node;
    },
    ...(props.numeric === true ? { inputMode: "decimal" as const } : {}),
    ...(completion === undefined
      ? {}
      : {
          role: "combobox",
          "aria-autocomplete": "list" as const,
          "aria-expanded": open,
          "aria-controls": listId,
          ...(open && active !== undefined
            ? { "aria-activedescendant": `${listId}-${String(active)}` }
            : {}),
        }),
    "data-testid": props.testId,
    value: draft ?? props.value,
    placeholder: props.placeholder,
    disabled,
    "aria-invalid": props.invalid === true || refused !== undefined,
    spellCheck: false,
    onChange: (event: ReactChangeEvent<EntryElement>) => {
      setDraft(event.currentTarget.value);
      // The reason goes as soon as the text it was about does.
      setRefused(undefined);
      setActive(undefined);
      if (completion !== undefined && !open) show();
    },
    onBlur: () => {
      commit();
      close();
    },
    onKeyDown,
  };

  return (
    <>
      <label className={props.className ?? "ye-field"} title={props.title}>
        <span
          className={
            stepping === undefined || disabled
              ? "ye-field__label"
              : "ye-field__label ye-field__label--scrub"
          }
          data-testid={`${props.testId}-label`}
          {...scrubHandlers}
        >
          {props.label}
        </span>
        {props.multiline === true ? (
          <textarea {...entryProps} rows={MULTILINE_ROWS} />
        ) : (
          <input {...entryProps} type="text" />
        )}
        {completion === undefined ? null : (
          <button
            type="button"
            className="ye-complete__toggle"
            data-testid={`${props.testId}-browse`}
            title="Show the list"
            aria-expanded={open}
            disabled={disabled}
            onMouseDown={keepFocus}
            onClick={() => {
              inputRef.current?.focus();
              if (open) close();
              else show();
            }}
          >
            ▾
          </button>
        )}
        {props.children}
      </label>
      {completion !== undefined && open ? (
        <ul
          className="ye-complete"
          role="listbox"
          id={listId}
          data-testid={`${props.testId}-options`}
          // On the list rather than on each row, because the scrollbar and the
          // border are not rows.
          onMouseDown={keepFocus}
        >
          {rows.map((value, index) => (
            <li
              key={value}
              className="ye-complete__item"
              role="option"
              id={`${listId}-${String(index)}`}
              aria-selected={index === active}
              onMouseDown={(event) => {
                // Right and middle presses go to the context menu and to
                // paste, and neither is a pick.
                if (event.button !== 0) return;
                commitText(value);
                close();
              }}
            >
              {value}
            </li>
          ))}
        </ul>
      ) : null}
      {completion !== undefined && open && notes.length > 0 ? (
        <p
          className="ye-complete__note"
          data-testid={`${props.testId}-options-note`}
          onMouseDown={keepFocus}
        >
          {notes.join(" ")}
        </p>
      ) : null}
      {refused === undefined ? null : (
        <small
          className="ye-field__reason"
          data-testid={`${props.testId}-reason`}
        >
          {refused}
        </small>
      )}
    </>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps {
  /** Read by assistive technology; the control carries no visible label. */
  readonly label: string;
  /** The option in force. An empty string selects the placeholder. */
  readonly value: string;
  readonly options: readonly SelectOption[];
  /**
   * The text of the option shown and selected while `value` is empty. That
   * option is never choosable, and is not rendered once a value is chosen.
   */
  readonly placeholder?: string | undefined;
  readonly onChange: (value: string) => void;
  readonly testId: string;
  readonly disabled?: boolean | undefined;
  readonly title?: string | undefined;
  /**
   * Marks the control invalid for a reason from outside it, such as a
   * diagnostic against the field it stands for. It is what {@link TextField}'s
   * own `invalid` does, so a bad choice and bad text look alike.
   */
  readonly invalid?: boolean | undefined;
  /** Defaults to `ye-select`. Pass a variant or a bespoke class. */
  readonly className?: string | undefined;
}

/**
 * Every closed set of choices in the shell.
 *
 * It gives the keyboard back the moment a choice is made, for the reason
 * {@link releaseFocus} exists and one more: `ownsTextEntry` counts a `select`,
 * so a focused one swallows every single-letter shortcut — `W`, `E`, `R`, `S`,
 * `G`, `F` — and a native closed select changes its value on each arrow key,
 * which here would open a level per keystroke. Blurring on change ends both.
 */
export function Select(props: SelectProps): React.JSX.Element {
  return (
    <select
      className={props.className ?? "ye-select"}
      data-testid={props.testId}
      aria-label={props.label}
      title={props.title}
      aria-invalid={props.invalid === true}
      disabled={props.disabled ?? false}
      value={props.value}
      onChange={(event) => {
        const select = event.currentTarget;
        props.onChange(select.value);
        select.blur();
      }}
    >
      {props.value === "" ? (
        // Rendered exactly while the value is empty: a controlled value
        // always has an option to match, and a list of real choices carries
        // no row that stands for none of them.
        <option value="" disabled>
          {props.placeholder ?? ""}
        </option>
      ) : null}
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export interface CheckboxProps {
  /** Read by assistive technology; the control carries no visible label. */
  readonly label: string;
  readonly checked: boolean;
  /**
   * No value at all, which is neither on nor off. Drawn as the box's own mixed
   * state, so an optional field that holds nothing does not read as `false`.
   */
  readonly mixed?: boolean | undefined;
  readonly onChange: (checked: boolean) => void;
  readonly testId: string;
  readonly disabled?: boolean | undefined;
  readonly invalid?: boolean | undefined;
}

/**
 * Every switch in the shell.
 *
 * It gives the keyboard back on each change for the reason {@link Select}
 * does: a focused box counts as text entry, so it would swallow every
 * single-letter shortcut, and Space would toggle it rather than pan the view.
 */
export function Checkbox(props: CheckboxProps): React.JSX.Element {
  const box = useRef<HTMLInputElement>(null);
  // `indeterminate` is a property with no attribute behind it, so it is set
  // here rather than in the markup.
  useEffect(() => {
    if (box.current) box.current.indeterminate = props.mixed === true;
  });
  return (
    <input
      ref={box}
      type="checkbox"
      className="ye-checkbox"
      data-testid={props.testId}
      aria-label={props.label}
      aria-invalid={props.invalid === true}
      disabled={props.disabled ?? false}
      checked={props.checked}
      onChange={(event) => {
        const input = event.currentTarget;
        props.onChange(input.checked);
        input.blur();
      }}
    />
  );
}
