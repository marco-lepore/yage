import type { ReactNode } from "react";
import { releaseFocus } from "./controls.js";

export interface PanelProps {
  readonly title: string;
  /** Shown at the right of the header — a count, usually. */
  readonly note?: string | undefined;
  readonly testId?: string | undefined;
  /** Added to the panel's own class, for a panel laid out differently. */
  readonly className?: string | undefined;
  /**
   * Whether the body is shown. Pass it with {@link PanelProps.onToggle} to
   * make the panel collapsible; a panel without both is always open.
   */
  readonly open?: boolean | undefined;
  /** Called when the header is activated by a click or by the keyboard. */
  readonly onToggle?: (() => void) | undefined;
  readonly children: ReactNode;
}

/**
 * One section of the shell: a header that reads as a header, and a body that
 * scrolls on its own.
 *
 * Every panel uses the same treatment, which is what makes the boundary
 * between two of them visible without a developer hunting for it.
 *
 * A collapsible panel puts a button in the header, so a closed one is still a
 * labelled strip that Tab reaches and Enter opens.
 */
export function Panel(props: PanelProps): React.JSX.Element {
  const collapsible = props.onToggle !== undefined;
  const open = !collapsible || props.open === true;
  const heading = (
    <>
      {props.title}
      {props.note === undefined ? null : (
        <span className="ye-panel__count">{props.note}</span>
      )}
    </>
  );

  return (
    <section
      className={panelClass(props.className)}
      data-testid={props.testId}
      aria-label={props.title}
    >
      <h2 className="ye-panel__header">
        {collapsible ? (
          <button
            type="button"
            className="ye-panel__toggle"
            data-testid={
              props.testId === undefined ? undefined : `${props.testId}-toggle`
            }
            aria-expanded={open}
            onClick={(event) => {
              props.onToggle?.();
              // Space pans the viewport, and a button that kept focus after a
              // click would take that press instead.
              releaseFocus(event);
            }}
          >
            <span className="ye-panel__chevron" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
            {heading}
          </button>
        ) : (
          heading
        )}
      </h2>
      {open ? <div className="ye-panel__body">{props.children}</div> : null}
    </section>
  );
}

function panelClass(extra: string | undefined): string {
  return extra === undefined ? "ye-panel" : `ye-panel ${extra}`;
}

/** What a panel shows when it has nothing to list. */
export function PanelEmpty({
  testId,
  children,
}: {
  testId?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <p className="ye-panel__empty" data-testid={testId}>
      {children}
    </p>
  );
}
