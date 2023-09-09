import { every, isArray, isObject, mapValues } from 'lodash'

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
    const [, y5] = pointInLine(x3, y3, x4, y4, t)
    return y5
  }

export const EASINGS = {
  linear: (t: number) => t,
  ease: getCubicBezierEasing(0.25, 0.1, 0.25, 1),
  easeIn: getCubicBezierEasing(0.42, 0, 1, 1),
  easeOut: getCubicBezierEasing(0, 0, 0.58, 1),
  easeInOut: getCubicBezierEasing(0.42, 0, 0.58, 1),
  holdStart: (t: number) => (t === 1 ? t : 0),
  jumpEnd: (t: number) => (t === 0 ? t : 1),
}
export type Easing = keyof typeof EASINGS | ((t: number) => number)

export type CustomInterpolatableValue<T = any> = {
  value: T
  interpolate: InterpolateFn<T>
}

export type Interpolatable<T = any> =
  | number
  | Interpolatable[]
  | { [key: string]: Interpolatable }
  | CustomInterpolatableValue<T>

export type InterpolateFn<T> = (
  from: T,
  to: T,
  t: number,
  easingFn: Easing,
) => T

export const isInterpolatable = (value: any): value is Interpolatable => {
  return (
    typeof value === 'number' ||
    isArray(value) ||
    (isObject(value) && every(value, isInterpolatable)) ||
    valuesIsCustomInterpolatableValue(value)
  )
}

const valuesAreNumbers = (values: [any, any]): values is [number, number] => {
  return typeof values[0] === 'number' && typeof values[1] === 'number'
}

const valuesAreArrays = (values: [any, any]): values is [any[], any[]] => {
  return isArray(values[0]) && isArray(values[1])
}

const valuesIsCustomInterpolatableValue = (
  value: any,
): value is CustomInterpolatableValue => {
  return (
    isObject(value) &&
    typeof (value as Partial<CustomInterpolatableValue>)?.interpolate ===
      'function' &&
    (value as Partial<CustomInterpolatableValue>)?.value !== undefined
  )
}

const valuesAreCustomInterpolatableValues = (
  values: [any, any],
): values is [CustomInterpolatableValue, CustomInterpolatableValue] => {
  const [a, b] = values
  const typeValid =
    valuesIsCustomInterpolatableValue(a) && valuesIsCustomInterpolatableValue(b)
  if (typeValid) {
    return typeof a.value === typeof b.value
  }
  return false
}

const valuesAreObjects = (
  values: [any, any],
): values is [
  { [key: string]: Interpolatable },
  { [key: string]: Interpolatable },
] => {
  return isObject(values[0]) && isObject(values[1])
}

export const interpolate = <T extends Interpolatable>(
  from: T,
  to: T,
  t: number,
  easing: Easing = 'linear',
) => {
  const easingFn = typeof easing === 'function' ? easing : EASINGS[easing]
  const easedT = easingFn(t)

  const values: [any, any] = [from, to]
  if (valuesAreNumbers(values)) {
    const [a, b] = values
    return lerp(a, b, easedT)
  } else if (valuesAreArrays(values)) {
    const [a, b] = values
    return a.map((from, i) => {
      const to = b[i]
      return interpolate(from, to, t, easing)
    })
  } else if (valuesAreCustomInterpolatableValues(values)) {
    const [a, b] = values
    return a.interpolate(a.value, b.value, t, easingFn)
  } else if (valuesAreObjects(values)) {
    const [a, b] = values
    return mapValues(a, (from, key) => {
      const to = b[key]
      return interpolate(from, to, t, easing)
    })
  }
  throw new Error('interpolation error')
}
