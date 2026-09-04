/**
 * At most four decimals, trailing zeros dropped, and no negative zero.
 *
 * Every box that steps a number rounds what the step produced: adding 0.05 ten
 * times lands on 0.5000000000000001, and that is what the box would show and
 * the document would store.
 */
export function rounded(value: number): number {
  return Number(value.toFixed(4));
}
