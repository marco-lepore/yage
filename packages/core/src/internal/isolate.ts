/**
 * Build a step runner. Without a handler, a step's failure propagates as
 * usual; with one, each step is isolated and its failure is reported instead.
 *
 * Teardown that has to finish takes the second form: a spawn batch rolling
 * back still owes the caller the error that started the rollback, so a
 * throwing hook must not stop the entities after it from being torn down.
 * @internal
 */
export function isolate(
  onError?: (error: unknown) => void,
): (step: () => void) => void {
  if (!onError) return (step) => step();
  return (step) => {
    try {
      step();
    } catch (error) {
      onError(error);
    }
  };
}
