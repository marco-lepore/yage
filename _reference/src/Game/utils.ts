import { Container, Graphics } from 'pixi.js'

export function fit(
  center: boolean,
  stage: Container,
  screenWidth: number,
  screenHeight: number,
  virtualWidth: number,
  virtualHeight: number,
) {
  const screenAspectRatio = screenWidth / screenHeight
  const virtualAspectRatio = virtualWidth / virtualHeight

  let newWidth: number
  let newHeight: number

  if (screenAspectRatio >= virtualAspectRatio) {
    // The screen is wider than the game's aspect ratio
    newWidth = screenHeight * virtualAspectRatio
    newHeight = screenHeight
  } else {
    // The screen is taller than the game's aspect ratio
    newWidth = screenWidth
    newHeight = screenWidth / virtualAspectRatio
  }

  const offsetX = (screenWidth - newWidth) / 2
  const offsetY = (screenHeight - newHeight) / 2

  stage.scale.x = screenWidth / virtualWidth
  stage.scale.y = screenHeight / virtualHeight

  if (stage.scale.x < stage.scale.y) {
    stage.scale.y = stage.scale.x
  } else {
    stage.scale.x = stage.scale.y
  }

  const virtualWidthInScreenPixels = virtualWidth * stage.scale.x
  const virtualHeightInScreenPixels = virtualHeight * stage.scale.y
  const centerXInScreenPixels = screenWidth * 0.5
  const centerYInScreenPixels = screenHeight * 0.5
  if (center) {
    stage.position.x = offsetX
    stage.position.y = offsetY
  } else {
    stage.position.x = centerXInScreenPixels - virtualWidthInScreenPixels * 0.5
    stage.position.y = centerYInScreenPixels - virtualHeightInScreenPixels * 0.5
  }

  // Mask the outside of the screen
  const mask = new Graphics()
  mask.beginFill(0xffffff)
  mask.drawRect(offsetX, offsetY, virtualWidthInScreenPixels, virtualHeightInScreenPixels)
  mask.endFill()
  stage.mask = mask
}
