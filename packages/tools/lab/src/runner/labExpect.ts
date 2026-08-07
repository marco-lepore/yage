/**
 * The assertions a `drive` gets, matching the ones a vitest suite uses.
 *
 * `@vitest/expect` exports chai plugins rather than an `expect` function, and
 * re-exports chai itself. Taking both from the one package keeps chai out of
 * this package's own dependencies — nothing here declares it, so a direct
 * import would resolve through hoisting today and break under a strict
 * node_modules layout.
 */
import {
  chai,
  type ExpectStatic,
  GLOBAL_EXPECT,
  JestAsymmetricMatchers,
  JestChaiExpect,
  JestExtend,
} from "@vitest/expect";

chai.use(JestExtend);
chai.use(JestChaiExpect);
chai.use(JestAsymmetricMatchers);
// Assertion failures include the whole compared value at any length.
chai.config.truncateThreshold = 0;

// The asymmetric matchers (`expect.any`, `expect.objectContaining`, ...) are
// static members on chai's own `expect`, so a bare wrapper function would not
// carry them. `message` is chai's own second argument, which prefixes whatever
// the assertion reports.
export const expect = Object.assign(
  (value: unknown, message?: string) => chai.expect(value, message),
  chai.expect,
) as unknown as ExpectStatic;

// Where an asymmetric matcher looks for the expect it belongs to. Left alone
// when something else already owns it — a vitest run of this file has its own,
// and taking that over would strip the state its assertions read.
const globals = globalThis as Record<symbol, unknown>;
globals[GLOBAL_EXPECT] ??= expect;
