import { createRandomService } from "@yagejs/core";
import type { RandomService } from "@yagejs/core";
import { assertInteger, deepFreeze } from "./internal.js";
import type {
  GenerationDiagnostic,
  GenerationInspection,
  GenerationJob,
  GenerationOptions,
  GenerationStatus,
} from "./types.js";

/**
 * Operation budget and lifecycle shared by every generator. `run()` yields
 * once per operation; `step()` resumes it a bounded number of times.
 *
 * A backtracking search passes `restartLimit`: an attempt that runs that many
 * operations without finishing starts over from `run()` in a new random order,
 * and each restart doubles the limit. One early choice that leaves no room for
 * the rest otherwise holds the search for most of its budget. An attempt that
 * finishes still covers every choice, so `exhausted` stays a proof.
 */
export abstract class GenerationSearch<T> implements GenerationJob {
  readonly seed: number;
  readonly maxSteps: number;
  protected readonly random: RandomService;
  protected readonly diagnostics: GenerationDiagnostic[] = [];
  private _status: GenerationStatus = "running";
  private _result: T | null = null;
  private _steps = 0;
  private iterator: Generator<void, T | null> | undefined;
  private attemptSteps = 0;
  private restarts = 0;

  constructor(
    options: GenerationOptions,
    private restartLimit?: number,
  ) {
    assertInteger("Generation seed", options.seed, 0, 0xffff_ffff);
    this.seed = options.seed;
    this.maxSteps = options.maxSteps ?? 20_000;
    assertInteger("Generation maxSteps", this.maxSteps, 1);
    this.random = createRandomService(this.seed);
  }
  get status(): GenerationStatus {
    return this._status;
  }
  /** The immutable result once `status` is `"succeeded"`, otherwise null. */
  get result(): T | null {
    return this._result;
  }
  get steps(): number {
    return this._steps;
  }
  protected abstract run(): Generator<void, T | null>;

  /** Advances at most `operations` operations. Terminal jobs do no more work. */
  step(operations = 256): GenerationStatus {
    assertInteger("Generation step operations", operations, 1);
    for (let i = 0; i < operations && this._status === "running"; i++) {
      this.iterator ??= this.run();
      const next = this.iterator.next();
      this._steps++;
      this.attemptSteps++;
      if (next.done) {
        this.iterator = undefined;
        if (next.value === null) {
          this._status = "exhausted";
          this.diagnostics.push({
            code: "exhausted",
            message: "Every candidate for these inputs was rejected.",
          });
        } else {
          this._result = deepFreeze(next.value);
          this._status = "succeeded";
        }
      } else if (this._steps >= this.maxSteps) {
        const restarts = this.restarts
          ? ` after ${this.restarts} restarts`
          : "";
        this.stop(
          "budget-exceeded",
          "budget",
          `The ${this.maxSteps}-step budget ran out${restarts}. This does not prove the inputs impossible.`,
        );
      } else if (
        this.restartLimit !== undefined &&
        this.attemptSteps >= this.restartLimit
      ) {
        this.iterator.return(null);
        this.iterator = undefined;
        this.attemptSteps = 0;
        this.restartLimit *= 2;
        this.restarts++;
      }
    }
    return this._status;
  }
  /** Runs to a terminal status in one call. */
  generate(): T | null {
    while (this._status === "running") this.step(this.maxSteps);
    return this._result;
  }
  cancel(): void {
    if (this._status === "running")
      this.stop("cancelled", "cancelled", "Generation was cancelled.");
  }
  inspect(): GenerationInspection {
    return {
      status: this._status,
      seed: this.seed,
      steps: this._steps,
      diagnostics: [...this.diagnostics],
    };
  }
  /** Records the latest example of a diagnostic category, one per `code`. */
  protected note(code: string, message: string): void {
    const index = this.diagnostics.findIndex((d) => d.code === code);
    if (index < 0) this.diagnostics.push({ code, message });
    else this.diagnostics[index] = { code, message };
  }
  private stop(status: GenerationStatus, code: string, message: string): void {
    this.iterator?.return(null);
    this.iterator = undefined;
    this._status = status;
    this.diagnostics.push({ code, message });
  }
}

/**
 * First restart limit for a search over `regions` regions. A fifteen-room
 * layout takes a median of about 50 operations, so the first attempt gets
 * several times its expected length.
 */
export function restartAfter(regions: number): number {
  return Math.max(64, 8 * regions);
}
