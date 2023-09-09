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
export function pu<T extends string | number>(pxObject: {
  [key in T]: number
}): {
  [key in T]: number
}
export function pu<T extends string | number>(
  pxObjectOrNumber: number | { [key in T]: number },
  ...pxs: number[]
) {
  const {
    rapier: { pixelToMeterRatio },
  } = getScene()

  if (typeof pxObjectOrNumber === 'number') {
    return [pxObjectOrNumber, ...pxs].map((px) => px / pixelToMeterRatio)
  }

  return Object.entries<number>(pxObjectOrNumber).reduce(
    (previous, [key, value]) => {
      previous[key as T] = value / pixelToMeterRatio
      return previous
    },
    {} as { [key in T]: number },
  )
}

export const getPixelToPhysicsUnitConverter = () => {
  const {
    rapier: { pixelToMeterRatio },
  } = getScene()

  return (...pxs: number[]) => pxs.map((px) => px / pixelToMeterRatio)
}
