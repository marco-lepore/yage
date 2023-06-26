import type { Game } from '../Game'
import type { Scene } from '../Scene'

export class Executor {
  test = true
  static _ctx: {
    game?: Game<any>
    scene?: Scene<any, any>
  } = {}

  static get ctx() {
    if (!this._ctx.game || !this._ctx.scene) {
      throw new Error('game or scene not defined in Executor context')
    }
    return this._ctx as { game: Game<any>; scene: Scene<any, any> }
  }

  static set ctx(ctx: { game?: Game<any>; scene?: Scene<any, any> }) {
    if (ctx.game) {
      this._ctx.game = ctx.game
    }
    if (ctx.scene) {
      this._ctx.scene = ctx.scene
    }
  }

  static setContext(ctx: { game?: Game<any>; scene?: Scene<any, any> }) {
    if (ctx.game) {
      this._ctx.game = ctx.game
    }
    if (ctx.scene) {
      this._ctx.scene = ctx.scene
    }
  }

  static execute(game: Game<any>) {
    return game.init()
  }
}
