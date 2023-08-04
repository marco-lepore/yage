export const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max)

export const smootherstep = (x: number) => {
  return 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const pointInLine = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
) => {
  return [lerp(x1, x2, t), lerp(y1, y2, t)]
}

export const getCubicBezierEasing =
  (x1: number, y1: number, x2: number, y2: number) => (t: number) => {
    const [x3, y3] = pointInLine(0, 0, x1, y2, t)
    const [x4, y4] = pointInLine(x2, y2, 1, 1, t)
    const [x5, y5] = pointInLine(x3, y3, x4, y4, t)
    return y5
  }
