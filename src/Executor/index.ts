import type { Game } from '../Game'
import type { Scene } from '../Scene'
import { AnyScene } from '../Scene/types'

export class Executor {
  test = true
  static _ctx: {
    game?: Game<AnyScene>
    scene?: Scene
  } = {}

  static get ctx() {
    if (!this._ctx.game || !this._ctx.scene) {
      throw new Error('game or scene not defined in Executor context')
    }
    return this._ctx as { game: Game<AnyScene>; scene: Scene }
  }

  static set ctx(context: { game?: Game<AnyScene>; scene?: Scene }) {
    if (context.game) {
      this._ctx.game = context.game
    }
    if (context.scene) {
      this._ctx.scene = context.scene
    }
  }

  static setContext<S extends AnyScene>(context: {
    game?: Game<AnyScene>
    scene?: S
  }) {
    if (context.game) {
      this._ctx.game = context.game
    }
    if (context.scene) {
      this._ctx.scene = context.scene
    }
  }

  static execute(game: Game<AnyScene>) {
    return game.init()
  }
}
