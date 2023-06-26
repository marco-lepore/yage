export const findRelativeIndex = (
  index: number,
  dx: number,
  dy: number,
  w: number,
  h: number,
) => {
  const x = index % w
  const y = Math.floor(index / w)

  if (x + dx >= w || x + dx < 0 || y + dy >= h || y + dy < 0) {
    return null
  }

  return index + dx + dy * w
}

export const getCoordsFromIndex = (index: number, w: number) => {
  const x = index % w
  const y = Math.floor(index / w)

  return [x, y]
}

export const getIndexFromCoords = (x: number, y: number, w: number) => {
  return y * w + x
}

export const get2xMatrix = <T>(matrix: T[], w: number, h: number) => {
  const doubleMatrix = Array.from(Array(matrix.length * 4))
  matrix.forEach((v, i) => {
    const [x, y] = getCoordsFromIndex(i, w)
    const baseIndex = y * w * 4 + x * 2
    const tl = baseIndex
    const tr = findRelativeIndex(baseIndex, 1, 0, w * 2, h * 2)
    const bl = findRelativeIndex(baseIndex, 0, 1, w * 2, h * 2)
    const br = findRelativeIndex(baseIndex, 1, 1, w * 2, h * 2)
    doubleMatrix[tl] = v
    if (tr) doubleMatrix[tr] = v
    if (bl) doubleMatrix[bl] = v
    if (br) doubleMatrix[br] = v
  })
  return doubleMatrix as T[]
}
