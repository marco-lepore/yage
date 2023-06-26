import { getGame, getScene } from './context'

export const getPlayAreaBounds = () => {
  const game = getGame()

  const pu2px = getPixelToPhysicsUnitConverter()

  const [pWidth, pHeight] = pu2px(
    game.virtualScreen.width,
    game.virtualScreen.height,
  )

  return {
    top: 0,
    left: 0,
    width: game.virtualScreen.width,
    height: game.virtualScreen.height,
    pWidth,
    pHeight,
  }
}

export function pu<H extends number, R extends number[]>(
  px: H,
  ...pxs: R
): [H, ...R]
export function pu<T extends string | number>(pxObj: { [key in T]: number }): {
  [key in T]: number
}
export function pu<T extends string | number>(
  pxObjOrNumber: number | { [key in T]: number },
  ...pxs: number[]
) {
  const {
    rapier: { pixelToMeterRatio },
  } = getScene()

  if (typeof pxObjOrNumber === 'number') {
    return [pxObjOrNumber, ...pxs].map((px) => px / pixelToMeterRatio)
  }

  return Object.entries<number>(pxObjOrNumber).reduce((prev, [key, value]) => {
    prev[key as T] = value / pixelToMeterRatio
    return prev
  }, {} as { [key in T]: number })
}

export const getPixelToPhysicsUnitConverter = () => {
  const {
    rapier: { pixelToMeterRatio },
  } = getScene()

  return (...pxs: number[]) => pxs.map((px) => px / pixelToMeterRatio)
}
