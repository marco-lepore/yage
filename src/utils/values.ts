export const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max)

export const smootherstep = (x: number) => {
  return 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3
}
