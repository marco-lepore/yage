import { FlagTester } from './flags'
import { findRelativeIndex } from './matrix'

type TilesDirection = 'TL' | 'T' | 'TR' | 'L' | 'R' | 'BL' | 'B' | 'BR'

const enum Tiles {
  TL = 2,
  T = 4,
  TR = 8,
  L = 16,
  R = 32,
  BL = 64,
  B = 128,
  BR = 256,
}

const TILES_DATA: Record<
  TilesDirection,
  { value: number; offset: [number, number] }
> = {
  TL: { value: 2, offset: [-1, -1] },
  T: { value: 4, offset: [0, -1] },
  TR: { value: 8, offset: [1, -1] },
  L: { value: 16, offset: [-1, 0] },
  R: { value: 32, offset: [1, 0] },
  BL: { value: 64, offset: [-1, 1] },
  B: { value: 128, offset: [0, 1] },
  BR: { value: 256, offset: [1, 1] },
}

export type TileType =
  | 'Empty'
  | 'Full'
  | 'TLJunction'
  | 'TRJunction'
  | 'BLJunction'
  | 'BRJunction'
  | 'TLCorner'
  | 'TRCorner'
  | 'BLCorner'
  | 'BRCorner'
  | 'LSide'
  | 'TSide'
  | 'RSide'
  | 'BSide'

export const getTileTypeByValue = (v: number): TileType => {
  if (v === 0) {
    return 'Empty'
  }
  const value = new FlagTester(v)
  // Full tile, needs land on all sides
  if (
    value.has(
      Tiles.B,
      Tiles.BL,
      Tiles.BR,
      Tiles.L,
      Tiles.R,
      Tiles.T,
      Tiles.TL,
      Tiles.TR,
    )
  ) {
    return 'Full'
  }

  // TL junction, needs land on all sides except TL
  if (
    value.has(Tiles.B, Tiles.BL, Tiles.BR, Tiles.L, Tiles.R, Tiles.T, Tiles.TR)
  ) {
    return 'TLJunction'
  }

  // TR junction, needs land on all sides except TR
  if (
    value.has(Tiles.B, Tiles.BL, Tiles.BR, Tiles.L, Tiles.R, Tiles.T, Tiles.TL)
  ) {
    return 'TRJunction'
  }

  // BR junction, needs land on all sides except BR
  if (
    value.has(Tiles.B, Tiles.BL, Tiles.L, Tiles.R, Tiles.T, Tiles.TL, Tiles.TR)
  ) {
    return 'BRJunction'
  }

  // BL junction, needs land on all sides except BL
  if (
    value.has(Tiles.B, Tiles.BR, Tiles.L, Tiles.R, Tiles.T, Tiles.TL, Tiles.TR)
  ) {
    return 'BLJunction'
  }

  // L side, needs land on all sides except TL L BL
  if (value.has(Tiles.B, Tiles.BR, Tiles.R, Tiles.T, Tiles.TR)) {
    return 'LSide'
  }

  // T side, needs land on all sides except TL T TR
  if (value.has(Tiles.B, Tiles.BL, Tiles.BR, Tiles.L, Tiles.R)) {
    return 'TSide'
  }

  // R side, needs land on all sides except TR R BR
  if (value.has(Tiles.B, Tiles.BL, Tiles.L, Tiles.T, Tiles.TL)) {
    return 'RSide'
  }

  // B side, needs land on all sides except BL B BR
  if (value.has(Tiles.L, Tiles.R, Tiles.T, Tiles.TL, Tiles.TR)) {
    return 'BSide'
  }

  // TL corner, needs land on R BR B
  if (value.has(Tiles.B, Tiles.BR, Tiles.R)) {
    return 'TLCorner'
  }

  // TR corner, needs land on L BL B
  if (value.has(Tiles.B, Tiles.BL, Tiles.L)) {
    return 'TRCorner'
  }

  // BR corner, needs land on L TL T
  if (value.has(Tiles.L, Tiles.T, Tiles.TL)) {
    return 'BRCorner'
  }

  // BL corner, needs land on R TR T
  if (value.has(Tiles.R, Tiles.T, Tiles.TR)) {
    return 'BLCorner'
  }

  throw new Error('unhandled value: ' + v)
}

export const getTileTypeMatrix = (matrix: number[], w: number, h: number) => {
  return matrix.map((v, index) => {
    if (v === 0) return 'Empty'
    let flags = 0
    Object.values(TILES_DATA).forEach(({ value, offset }) => {
      const adjacentIndex = findRelativeIndex(index, ...offset, w, h)
      const adjacentValue = adjacentIndex === null ? 0 : matrix[adjacentIndex]

      if (adjacentValue) {
        flags += value
      }
    })
    return getTileTypeByValue(flags)
  })
}
