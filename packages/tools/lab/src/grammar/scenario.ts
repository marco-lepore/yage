import type { AssetHandle, Scene } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";
import type { ControlSchema, ControlValues } from "./controls.js";
import type { DriveContext } from "./drive.js";

interface ScenarioCommon<C extends ControlSchema> {
  /**
   * Where the scenario sits in the list, as a `/`-separated path. Defaults to
   * the file's own location, so `src/entities/slime.scenario.ts` lands under
   * `entities` › `slime`. Set it to place a scenario somewhere else.
   */
  title?: string | undefined;
  /** The list entry's own label. Defaults to the export name. */
  name?: string | undefined;
  /** One or two sentences under the title, saying what to look at. */
  describe?: string | undefined;
  /** Tunable inputs, built with `control.number` / `int` / `boolean` / `select`. */
  controls?: C | undefined;
  /**
   * Runs after the scene is on the stack, on every rebuild. Use it to reach a
   * value the target does not accept as a parameter — a field on a component
   * the scenario looks up with `scene.findByKey(...)`.
   */
  onMounted?: ((scene: Scene, controls: ControlValues<C>) => void) | undefined;
  /**
   * Plays the scenario and asserts on the result. The panel's Run button
   * rebuilds the scene, stops the clock and executes it, so a run is a fixed
   * sequence of frames rather than something wall-clock timing decides.
   *
   * Every call in it that advances a frame is async and has to be awaited.
   */
  drive?: ((ctx: DriveContext<C>) => Promise<void>) | undefined;
}

/** Mounts a `Scene` the game already has. */
interface SceneScenario<C extends ControlSchema> {
  scene(controls: ControlValues<C>): Scene;
  setup?: never;
  layers?: never;
  preload?: never;
}

/**
 * Builds a situation in a blank scene. `layers` and `preload` exist on this
 * form only, because the `scene` form gets both from the `Scene` itself.
 */
interface SetupScenario<C extends ControlSchema> {
  setup(scene: Scene, controls: ControlValues<C>): void;
  scene?: never;
  layers?: readonly LayerDef[] | undefined;
  preload?: readonly AssetHandle<unknown>[] | undefined;
}

export type ScenarioDef<C extends ControlSchema = ControlSchema> =
  ScenarioCommon<C> & (SceneScenario<C> | SetupScenario<C>);

/** A scenario after the runner has checked its shape. */
export type AnyScenario = ScenarioDef<ControlSchema>;

/**
 * Marks what `defineScenario` returns.
 *
 * A `*.scenario.ts` file may export helpers its scenarios share, and the
 * registry has to tell those apart from scenarios without guessing at their
 * shape. `Symbol.for` so the mark survives a second copy of this package.
 */
const SCENARIO_MARK = Symbol.for("yage-lab.scenario");

/**
 * Declares one scenario. Export it from a `*.scenario.ts` file, either as the
 * default export or as a named one — a file can hold several.
 *
 * A scenario either mounts an existing `Scene` or builds one with `setup`.
 * Declaring both, or neither, fails to compile.
 */
export function defineScenario<const C extends ControlSchema>(
  def: ScenarioDef<C>,
): ScenarioDef<C> {
  const problem = describeScenarioProblem(def);
  if (problem) throw new Error(`defineScenario(): ${problem}`);
  Object.defineProperty(def, SCENARIO_MARK, {
    value: true,
    configurable: true,
  });
  return def;
}

/** Whether `value` came from {@link defineScenario}. */
export function isScenario(value: unknown): boolean {
  return typeof value === "object" && value !== null && SCENARIO_MARK in value;
}

/** Returns why `value` is not a usable scenario, or `undefined` if it is one. */
export function describeScenarioProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return "expected an object.";
  }
  const def = value as Partial<Record<keyof AnyScenario, unknown>>;
  for (const field of ["title", "name"] as const) {
    const declared = def[field];
    if (declared === undefined) continue;
    if (typeof declared !== "string" || declared.trim() === "") {
      return `\`${field}\` must be a non-empty string.`;
    }
  }
  // A title is a path, and the list needs a segment to name the entry by.
  if (typeof def.title === "string" && !/[^/\s]/.test(def.title)) {
    return "`title` must name at least one path segment.";
  }
  const hasScene = typeof def.scene === "function";
  const hasSetup = typeof def.setup === "function";
  if (hasScene && hasSetup) {
    return "declare either `scene` or `setup`, not both.";
  }
  if (!hasScene && !hasSetup) {
    return "declare either `scene` or `setup`.";
  }
  if (def.drive !== undefined && typeof def.drive !== "function") {
    return "`drive` must be a function.";
  }
  return undefined;
}
