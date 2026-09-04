import type { EasingFunction } from "@yagejs/core";
import type { FeelEffectContext } from "../core/types.js";

/** @internal Invoke and validate one easing callback through Feel attribution. */
export function invokeFeelEasing(
  context: FeelEffectContext,
  easing: EasingFunction,
  progress: number,
  callbackLabel: string,
  errorSubject: string,
  deriveAmount: (eased: number) => number = (eased) => eased,
): number {
  let amount = 0;
  context.invoke(callbackLabel, () => {
    const eased = easing(progress);
    if (!Number.isFinite(eased)) {
      throw new Error(
        `${errorSubject} must return a finite number, got ${eased}.`,
      );
    }
    amount = deriveAmount(eased);
    if (!Number.isFinite(amount)) {
      throw new Error(
        `${errorSubject} must produce a finite amount, got ${amount}.`,
      );
    }
  });
  return amount;
}
