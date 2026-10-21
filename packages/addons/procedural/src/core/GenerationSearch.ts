import { assertInteger, freezeCopy } from "./geometry.js";
import type {
  GenerationDiagnostic,
  GenerationInspection,
  GenerationOptions,
  GenerationStatus,
} from "./types.js";

/** Shared operation budget and lifecycle for headless generation jobs. */
export abstract class GenerationSearch<T> {
  readonly seed: number;
  readonly maxSteps: number;
  protected _status: GenerationStatus = "running";
  protected _result: T | null = null;
  protected readonly diagnostics: GenerationDiagnostic[] = [];
  private iterator: Generator<void, T | null> | undefined;
  private _steps = 0;
  constructor(options: GenerationOptions) {
    assertInteger("GenerationSearch seed", options.seed, 0, 0xffff_ffff);
    assertInteger(
      "GenerationSearch maxSteps",
      options.maxSteps ?? 20_000,
      1,
      10_000_000,
    );
    this.seed = options.seed;
    this.maxSteps = options.maxSteps ?? 20_000;
  }
  get status(): GenerationStatus {
    return this._status;
  }
  get result(): T | null {
    return this._result;
  }
  get steps(): number {
    return this._steps;
  }
  protected abstract run(): Generator<void, T | null>;
  step(operations = 256): GenerationStatus {
    assertInteger(
      "GenerationSearch.step operations",
      operations,
      1,
      10_000_000,
    );
    for (let i = 0; i < operations && this.status === "running"; i++) {
      this.iterator ??= this.run();
      const next = this.iterator.next();
      this._steps++;
      if (next.done) {
        this._result = next.value === null ? null : freezeCopy(next.value);
        this._status = this.result === null ? "exhausted" : "succeeded";
        if (!this.result)
          this.diagnostics.push({
            code: "exhausted",
            message: "All supported candidates for this input were rejected.",
          });
        this.iterator = undefined;
      } else if (this.steps >= this.maxSteps) {
        this.stop(
          "budget-exceeded",
          "budget",
          "Search budget ended. This does not prove the input impossible.",
        );
      }
    }
    return this.status;
  }
  generate(): T | null {
    while (this.status === "running") this.step();
    return this.result;
  }
  cancel(): void {
    if (this.status === "running")
      this.stop(
        "cancelled",
        "cancelled",
        "Generation cancelled; no completed result was published.",
      );
  }
  private stop(status: GenerationStatus, code: string, message: string): void {
    this.iterator?.return(null);
    this.iterator = undefined;
    this._status = status;
    this.diagnostics.push({ code, message });
  }
  inspect(): GenerationInspection {
    return freezeCopy({
      status: this.status,
      steps: this.steps,
      diagnostics: this.diagnostics,
    });
  }
}
