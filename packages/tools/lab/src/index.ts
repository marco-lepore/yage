/**
 * The scenario grammar — everything a `*.scenario.ts` file imports.
 *
 * Type-only where the engine is concerned, so importing this entry pulls in no
 * runtime engine code and no pixi. The browser shell lives in
 * `@yagejs-tools/lab/runner`.
 */
export {
  control,
  type BooleanControl,
  type ControlDef,
  type ControlSchema,
  type ControlValue,
  type ControlValues,
  type NumberControl,
  type SelectControl,
} from "./grammar/controls.js";

export {
  defineScenario,
  type AnyScenario,
  type ScenarioDef,
} from "./grammar/scenario.js";

export type { DriveContext, DriveInput } from "./grammar/drive.js";

export {
  defineHarness,
  type HarnessContext,
  type HarnessDef,
} from "./grammar/harness.js";
