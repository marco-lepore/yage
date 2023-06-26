import { IViewportOptions, Viewport } from 'pixi-viewport'
import { getGame } from '../utils'

export class Display extends Viewport {
  constructor(options?: Omit<IViewportOptions, 'events'>) {
    const game = getGame()
    const events = game.app.renderer.events
    super({
      ...options,
      events,
      worldWidth: 2000,
      worldHeight: 2000,
      screenWidth: game.virtualScreen.width,
      screenHeight: game.virtualScreen.height,
    })
  }
}
