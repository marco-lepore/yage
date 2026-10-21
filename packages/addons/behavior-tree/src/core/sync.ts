/**
 * Behavior callbacks are typed `void`, which TypeScript also accepts for async
 * functions. A returned promise would detach its work from cancellation.
 */
export function assertSynchronous(result: unknown, label: string): void {
  if (
    typeof result === "object" &&
    result !== null &&
    typeof (result as { then?: unknown }).then === "function"
  )
    throw new Error(`${label}: callbacks must be synchronous`);
}
