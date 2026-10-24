import { afterEach, describe, expect, it, vi } from "vitest";
import { stringEvaluationAllowed } from "./stringEvaluation.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stringEvaluationAllowed", () => {
  it("is true where a script may turn a string into code", () => {
    expect(stringEvaluationAllowed()).toBe(true);
  });

  it("is false where the page forbids it", () => {
    vi.stubGlobal("Function", (): never => {
      throw new EvalError("call to Function() blocked by CSP");
    });
    expect(stringEvaluationAllowed()).toBe(false);
  });
});
