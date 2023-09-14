/**Based on https://github.com/aszecsei/ts-vector-math, adapted for Rapier vectors*/

/**
 * Copyright 2017 Alic Szecsei <aszecsei@gmail.com>

  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable unicorn/no-this-assignment */
import { Vector2 } from '@dimforge/rapier2d'
import { clamp } from './interpolation'

export class AdvancedVector2 extends Vector2 {
  private static readonly _zero = new AdvancedVector2(0, 0)
  static get zero(): AdvancedVector2 {
    this._zero.x = 0
    this._zero.y = 0
    return this._zero
  }

  static fromVector2(v: Vector2) {
    return new AdvancedVector2(v.x, v.y)
  }

  /**
   */
  get xy(): [number, number] {
    return [this.x, this.y]
  }

  set xy(xy: [number, number]) {
    this.x = xy[0]
    this.y = xy[1]
  }

  static getLength(vector: Vector2): number {
    return Math.hypot(vector.x, vector.y)
  }

  static getSquaredLength(vector: Vector2): number {
    return vector.x * vector.x + vector.y * vector.y
  }

  /**
   * Calculates the dot product of two vectors
   */
  static dot(vector: Vector2, vector2: Vector2): number {
    return vector.x * vector2.x + vector.y * vector2.y
  }

  /**
   * Calculates the distance between two vectors
   */
  static distance(vector: Vector2, vector2: Vector2): number {
    return Math.sqrt(this.squaredDistance(vector, vector2))
  }

  /**
   * Calculates the distance between two vectors squared
   */
  static squaredDistance(vector: Vector2, vector2: Vector2): number {
    const x = vector2.x - vector.x
    const y = vector2.y - vector.y
    return x * x + y * y
  }

  /**
   * Calculates a normalized vector representing the direction from one vector to another.
   * If no dest vector is specified, a new vector is instantiated.
   */
  static direction(vector: Vector2, vector2: Vector2): AdvancedVector2
  static direction<V extends Vector2>(
    vector: Vector2,
    vector2: Vector2,
    destination: V,
  ): V
  static direction<V extends Vector2>(
    vector: Vector2,
    vector2: Vector2,
    destination?: V,
  ): V | AdvancedVector2 {
    const result = destination ?? new AdvancedVector2(0, 0)

    const x = vector.x - vector2.x
    const y = vector.y - vector2.y
    let length = Math.hypot(x, y)
    if (length === 0) {
      return result
    }
    length = 1 / length
    result.x = x * length
    result.y = y * length
    return result
  }

  /**
   * Performs a linear interpolation over two vectors.
   * If no dest vector is specified, a new vector is instantiated.
   */
  static lerp(a: Vector2, b: Vector2, t: number): AdvancedVector2
  static lerp<V extends Vector2>(
    a: Vector2,
    b: Vector2,
    t: number,
    destination: V,
  ): V
  static lerp<V extends Vector2>(
    a: Vector2,
    b: Vector2,
    t: number,
    destination?: V,
  ): V | AdvancedVector2 {
    const result = destination ?? new AdvancedVector2(0, 0)
    result.x = a.x + t * (b.x - a.x)
    result.y = a.y + t * (b.y - a.y)
    return result
  }

  /**
   * Adds two vectors.
   * If no dest vector is specified, a new vector is instantiated.
   */
  static sum(vector: Vector2, vector2: Vector2): AdvancedVector2
  static sum<V extends Vector2>(
    vector: Vector2,
    vector2: Vector2,
    destination: V,
  ): V
  static sum<V extends Vector2>(
    vector: Vector2,
    vector2: Vector2,
    destination?: V,
  ): V | AdvancedVector2 {
    const result = destination ?? new AdvancedVector2(0, 0)
    result.x = vector.x + vector2.x
    result.y = vector.y + vector2.y
    return result
  }

  /**
   * Subtracts two vectors.
   * If no dest vector is specified, a new vector is instantiated.
   */
  static difference(vector: Vector2, vector2: Vector2): AdvancedVector2
  static difference<V extends Vector2>(
    vector: Vector2,
    vector2: Vector2,
    destination: V,
  ): V
  static difference<V extends Vector2>(
    vector: Vector2,
    vector2: Vector2,
    destination?: V,
  ): V | AdvancedVector2 {
    const result = destination ?? new AdvancedVector2(0, 0)

    result.x = vector.x - vector2.x
    result.y = vector.y - vector2.y

    return result
  }

  /**
   * Multiplies two vectors piecewise.
   * If no dest vector is specified, a new vector is instantiated.
   */
  static product(
    vector: Vector2,
    vector2OrFactor: Vector2 | number,
  ): AdvancedVector2
  static product<V extends Vector2>(
    vector: Vector2,
    vector2OrFactor: Vector2 | number,
    destination: V,
  ): V
  static product<V extends Vector2>(
    vector: Vector2,
    vector2OrFactor: Vector2 | number,
    destination?: V,
  ): V | AdvancedVector2 {
    const result = destination ?? new AdvancedVector2(0, 0)

    if (typeof vector2OrFactor === 'number') {
      const factor = vector2OrFactor
      result.x = vector.x * factor
      result.y = vector.y * factor
    } else {
      const vector2 = vector2OrFactor
      result.x = vector.x * vector2.x
      result.y = vector.y * vector2.y
    }

    return result
  }

  /**
   * Divides two vectors piecewise.
   * If no dest vector is specified, a new vector is instantiated.
   */

  static quotient<V extends Vector2>(
    vector: Vector2,
    vector2OrFactor: Vector2 | number,
    destination?: V,
  ): V | AdvancedVector2 {
    const result = destination ?? new AdvancedVector2(0, 0)

    if (typeof vector2OrFactor === 'number') {
      const factor = vector2OrFactor
      result.x = vector.x / factor
      result.y = vector.y / factor
    } else {
      const vector2 = vector2OrFactor
      result.x = vector.x / vector2.x
      result.y = vector.y / vector2.y
    }
    return result as V extends Vector2 ? V : AdvancedVector2
  }

  /**
   * Sets both the x- and y-components of the vector to 0.
   */
  reset(): void {
    this.x = 0
    this.y = 0
  }

  /**
   * Copies the x- and y-components from one vector to another.
   * If no dest vector is specified, a new vector is instantiated.
   */
  copy(destination: Vector2): Vector2
  copy(destination: AdvancedVector2): AdvancedVector2
  copy(): AdvancedVector2
  copy(destination?: Vector2 | AdvancedVector2) {
    if (!destination) destination = new AdvancedVector2(0, 0)
    destination.x = this.x
    destination.y = this.y
    return destination
  }

  /**
   * Multiplies both the x- and y-components of a vector by -1.
   * If no dest vector is specified, the operation is performed in-place.
   */
  negate(destination: Vector2): Vector2
  negate(destination: AdvancedVector2): AdvancedVector2
  negate(): AdvancedVector2
  negate(destination?: Vector2 | AdvancedVector2) {
    if (!destination) destination = this
    destination.x = -this.x
    destination.y = -this.y
    return destination
  }

  /**
   * Checks if two vectors are equal, using a threshold to avoid floating-point precision errors.
   */
  equals(
    other: Vector2 | AdvancedVector2,
    threshold: number = Number.EPSILON,
  ): boolean {
    if (Math.abs(this.x - other.x) > threshold) {
      return false
    }
    if (Math.abs(this.y - other.y) > threshold) {
      return false
    }
    return true
  }

  /**
   * Returns the distance from the vector to the origin.
   */
  length(): number {
    return Math.sqrt(this.squaredLength())
  }

  /**
   * Returns the distance from the vector to the origin, squared.
   */
  squaredLength(): number {
    const x = this.x
    const y = this.y
    return x * x + y * y
  }

  /**
   * Adds two vectors together.
   * If no dest vector is specified, the operation is performed in-place.
   */
  add(vector: Vector2 | AdvancedVector2, destination: Vector2): Vector2
  add(
    vector: Vector2 | AdvancedVector2,
    destination: AdvancedVector2,
  ): AdvancedVector2
  add(vector: Vector2 | AdvancedVector2): AdvancedVector2
  add(vector: Vector2, destination?: Vector2 | AdvancedVector2) {
    if (!destination) destination = this
    destination.x = this.x + vector.x
    destination.y = this.y + vector.y
    return destination
  }

  /**
   * Subtracts one vector from another.
   * If no dest vector is specified, the operation is performed in-place.
   */
  subtract(vector: Vector2 | AdvancedVector2, destination: Vector2): Vector2
  subtract(
    vector: Vector2 | AdvancedVector2,
    destination: AdvancedVector2,
  ): AdvancedVector2
  subtract(vector: Vector2 | AdvancedVector2): AdvancedVector2
  subtract(vector: Vector2, destination?: Vector2 | AdvancedVector2) {
    if (!destination) destination = this
    destination.x = this.x - vector.x
    destination.y = this.y - vector.y
    return destination
  }

  /**
   * Multiplies two vectors together piecewise.
   * If no dest vector is specified, the operation is performed in-place.
   */
  multiply(vector: Vector2 | AdvancedVector2, destination: Vector2): Vector2
  multiply(
    vector: Vector2 | AdvancedVector2,
    destination: AdvancedVector2,
  ): AdvancedVector2
  multiply(vector: Vector2 | AdvancedVector2): AdvancedVector2
  multiply(vector: Vector2, destination?: Vector2 | AdvancedVector2) {
    if (!destination) destination = this
    destination.x = this.x * vector.x
    destination.y = this.y * vector.y
    return destination
  }

  /**
   * Divides two vectors piecewise.
   */
  divide(vector: Vector2 | AdvancedVector2, destination: Vector2): Vector2
  divide(
    vector: Vector2 | AdvancedVector2,
    destination: AdvancedVector2,
  ): AdvancedVector2
  divide(vector: Vector2 | AdvancedVector2): AdvancedVector2
  divide(vector: Vector2, destination?: Vector2 | AdvancedVector2) {
    if (!destination) destination = this
    destination.x = this.x / vector.x
    destination.y = this.y / vector.y
    return destination
  }

  /**
   * Scales a vector by a scalar parameter.
   * If no dest vector is specified, the operation is performed in-place.
   */
  scale(value: number, destination: Vector2): Vector2
  scale(value: number, destination: AdvancedVector2): AdvancedVector2
  scale(value: number): AdvancedVector2
  scale(value: number, destination?: Vector2 | AdvancedVector2): Vector2 {
    if (!destination) destination = this
    destination.x = this.x * value
    destination.y = this.y * value
    return destination
  }

  /**
   * Normalizes a vector.
   * If no dest vector is specified, the operation is performed in-place.
   */
  normalize(destination: Vector2): Vector2
  normalize(destination: AdvancedVector2): AdvancedVector2
  normalize(): AdvancedVector2
  normalize(destination?: Vector2 | AdvancedVector2) {
    if (!destination) destination = this

    const length = AdvancedVector2.getLength(destination)
    if (length === 1 || length === 0) {
      return destination
    }
    const invLength = 1 / length
    destination.x *= invLength
    destination.y *= invLength

    return destination
  }

  setLength(length: number, destination: Vector2): Vector2
  setLength(length: number, destination: AdvancedVector2): AdvancedVector2
  setLength(length: number): AdvancedVector2
  setLength(length: number, destination?: Vector2 | AdvancedVector2) {
    if (!destination) destination = this
    const oldLength = AdvancedVector2.getLength(destination)
    AdvancedVector2.quotient(destination, oldLength, destination)
    AdvancedVector2.product(destination, length, destination)
    return destination
  }

  clampLength(min: number, max: number, destination: Vector2): Vector2
  clampLength(
    min: number,
    max: number,
    destination: AdvancedVector2,
  ): AdvancedVector2
  clampLength(min: number, max: number): AdvancedVector2
  clampLength(
    min: number = Number.NEGATIVE_INFINITY,
    max: number = Number.POSITIVE_INFINITY,
    destination?: Vector2 | AdvancedVector2,
  ) {
    if (!destination) destination = this
    const oldLength = AdvancedVector2.getLength(destination)
    const length = clamp(oldLength, min, max)
    if (oldLength !== 0) {
      AdvancedVector2.quotient(destination, oldLength, destination)
    }
    AdvancedVector2.product(destination, length, destination)
    return destination
  }

  toString(): string {
    return '(' + this.x + ', ' + this.y + ')'
  }
}
