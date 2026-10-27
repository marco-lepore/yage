import { Component } from "@yagejs/core";

/** What one case reports. Plain values only; an absent value is `null`. */
export type CaseReading = Record<string, unknown>;

/**
 * The component every case entity carries: it owns the case's rules and
 * answers what the case observed. `settled` is the case's own "ready", so a
 * reader waits for the engine rather than for a timeout.
 */
export abstract class CaseProbe extends Component {
  /** Whether this case reached the state it is meant to report on. */
  abstract get settled(): boolean;

  /** The case's observations. */
  abstract reading(): CaseReading;
}
