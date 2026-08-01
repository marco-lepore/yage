import type { AssetHandle, Scene } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";
import type { ControlSchema, ControlValues } from "./controls.js";
import type { DriveContext } from "./drive.js";

interface ScenarioCommon<C extends ControlSchema> {
  /**
   * Shown in the scenario list. The part before the first `/` groups it, as in
   * `"Combat / Slime takes a hit"`.
   */
  title: string;
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
 * Declares one scenario. Export it as the default export of a `*.scenario.ts`
 * file.
 *
 * A scenario either mounts an existing `Scene` or builds one with `setup`.
 * Declaring both, or neither, fails to compile.
 */
export function defineScenario<const C extends ControlSchema>(
  def: ScenarioDef<C>,
): ScenarioDef<C> {
  const problem = describeScenarioProblem(def);
  if (problem) throw new Error(`defineScenario(): ${problem}`);
  return def;
}

/**
 * Returns why `value` is not a usable scenario, or `undefined` if it is one.
 * The runner uses this to report a bad module instead of failing the page —
 * a scenario file is a game developer's own code and can be wrong.
 */
export function describeScenarioProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return "expected an object.";
  }
  const def = value as Partial<Record<keyof AnyScenario, unknown>>;
  if (typeof def.title !== "string" || def.title.trim() === "") {
    return "`title` must be a non-empty string.";
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
