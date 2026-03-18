import { Process } from "./Process.js";

type StepFactory = () => Process;

interface Step {
  type: "single" | "parallel";
  factories: StepFactory[];
}

/**
 * Builds a chain of Processes that run in order.
 * Supports sequential steps, waits, callbacks, and parallel groups.
 */
export class Sequence {
  private steps: Step[] = [];
  private _loop = false;
  private _repeatCount: number | undefined;

  /** Add a step (Process or factory function). */
  then(step: Process | StepFactory): this {
    this.steps.push({
      type: "single",
      factories: [typeof step === "function" ? step : wrapInstance(step)],
    });
    return this;
  }

  /** Add a delay in ms. */
  wait(ms: number): this {
    this.steps.push({
      type: "single",
      factories: [
        () =>
          new Process({
            duration: ms,
            update: () => {},
          }),
      ],
    });
    return this;
  }

  /** Add an instant callback. */
  call(fn: () => void): this {
    this.steps.push({
      type: "single",
      factories: [
        () =>
          new Process({
            update: () => {
              fn();
              return true; // complete immediately
            },
          }),
      ],
    });
    return this;
  }

  /** Run steps in parallel (all must complete before sequence continues). */
  parallel(...steps: Array<Process | StepFactory>): this {
    this.steps.push({
      type: "parallel",
      factories: steps.map((s) =>
        typeof s === "function" ? s : wrapInstance(s),
      ),
    });
    return this;
  }

  /** Loop the sequence indefinitely. */
  loop(): this {
    this._loop = true;
    return this;
  }

  /** Repeat the sequence a fixed number of times (1 = play once, 2 = play twice, etc.). */
  repeat(times: number): this {
    this._repeatCount = times;
    return this;
  }

  /**
   * Build the sequence into a Process without registering with a scene.
   * Exposed for unit testing.
   * @internal
   */
  _build(): Process {
    const steps = this.steps;
    const looping = this._loop;
    const repeatCount = this._repeatCount;
    let stepIndex = 0;
    let active: Process[] = [];
    let iteration = 1;

    return new Process({
      update: (dt) => {
        // Initialize current step if needed
        if (active.length === 0 && stepIndex < steps.length) {
          const step = steps[stepIndex];
          if (!step) return true;
          active = step.factories.map((f) => f());
        }

        // Update all active processes
        for (const proc of active) {
          proc._update(dt);
        }

        // Check if all active processes are complete
        if (active.every((p) => p.completed)) {
          active = [];
          stepIndex++;
          if (stepIndex >= steps.length) {
            // Check if we should loop/repeat
            if (looping) {
              stepIndex = 0;
              return false;
            }
            if (repeatCount !== undefined && iteration < repeatCount) {
              iteration++;
              stepIndex = 0;
              return false;
            }
            return true; // sequence complete
          }
        }

        return false;
      },
    });
  }

  /** Build and start the sequence. Returns the wrapping Process. */
  start(): Process {
    return this._build();
  }
}

/** Wrap a direct Process instance so it gets _reset() before each re-use. */
function wrapInstance(proc: Process): StepFactory {
  return () => {
    proc._reset();
    return proc;
  };
}
