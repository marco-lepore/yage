import { Executor } from '../Executor'
import { Game } from '../Game'
import { Scene } from '../Scene'

export const getScene = <S extends Scene<any, any> = Scene<any, any>>() => {
  return Executor.ctx.scene as S
}

export const getGame = <G extends Game<any> = Game<any>>() => {
  return Executor.ctx.game as G
}

export const getRapier = () => {
  return (Executor.ctx.scene as Scene<any, any>).rapier
}

export const getWorld = () => {
  return (Executor.ctx.scene as Scene<any, any>).rapier.world
}
