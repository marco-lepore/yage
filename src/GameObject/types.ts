import { Scene } from '../Scene'
import { Component } from '../components/BaseComponent'

export interface IGameObject<
  ParentScene extends Scene<any, any> = Scene<any, any>,
> {
  components: Component[]

  name: string

  tags: string[]

  scene: ParentScene

  setup?(): void

  dispatchSceneEvent<
    S extends ParentScene,
    P extends Parameters<S['dispatch']>,
  >(
    ev: P[0],
  ): void

  addSceneEventListener<
    S extends ParentScene,
    P extends Parameters<S['addEventListener']>,
  >(
    type: P[0],
    callback: P[1],
  ): () => void

  destroy(): void
  onAdded?(): void
  onBeforeTick?(dt: number): void
  onTick?(dt: number): void
  onBeforeFixedTick?(dt: number): void
  onFixedTick?(dt: number): void
  onAfterFixedTick?(dt: number): void
  onAfterTick?(dt: number): void
  onRemoved?(): void
}

export type GameObjectFactory<ParentScene extends Scene<any, any>> = {
  new (scene: ParentScene, ...args: any[]): IGameObject
}
