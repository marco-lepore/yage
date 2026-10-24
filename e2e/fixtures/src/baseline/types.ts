import type { CallbackErrorRecord, HostSnapshot } from "@yagejs/core";
import type { CaseName } from "./cases.js";
import type { CaseReading } from "./probe.js";

/**
 * What the fixture's page and the harness that drives it both say about a
 * run. The page builds these values and a driver reads them back, so the two
 * sides share one definition. Nothing here pulls in the page's own modules:
 * the harness type-checks without the browser build's environment types.
 */

/** Which entry built the page. Recorded in every reading; never branched on. */
export type BaselineTarget = "web" | "electron" | "capacitor";

/** Which build of the fixture is running. */
export type BaselineProfile = "test" | "release";

/** Everything the page reports about itself, in one object. */
export interface BaselineReading {
  target: BaselineTarget;
  profile: BaselineProfile;
  /** Random per page load; a change means the page restarted. */
  bootId: string;
  cases: CaseName[];
  /** The cases that have reached their own settled state. */
  settledCases: CaseName[];
  /** Whether every mounted case has settled. */
  settled: boolean;
  readings: Partial<Record<CaseName, CaseReading>>;
  host: HostSnapshot;
  errors: { callbackErrors: CallbackErrorRecord[] };
  /** Every `graphics:context` payload the page has seen, oldest first. */
  graphicsContext: boolean[];
  /** What the page's content security policy allows. */
  policy: { stringEvaluation: boolean };
  userAgent: string;
}

/** One point's colour, as red, green, blue and alpha from 0 to 255. */
export type BaselinePixel = [number, number, number, number];

/** What a driver can ask the page for. */
export interface BaselineExtension {
  read(): BaselineReading;
  /** Ask the renderer to enter or leave fullscreen, and report how it went. */
  fullscreen(
    active: boolean,
  ): Promise<
    { outcome: "resolved" } | { outcome: "rejected"; message: string }
  >;
  /** Viewport CSS position of a virtual point, for real input from a driver. */
  pointFor(x: number, y: number): { x: number; y: number };
  /** The colour drawn at each named point of the drawing. */
  pixels(): Record<string, BaselinePixel>;
  /**
   * Take the graphics context away and wait for the page to get one back.
   * Only a WebGL context can be taken away from the page itself.
   */
  loseContext(): Promise<void>;
}
