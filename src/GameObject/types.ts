import { AnyScene } from '../Scene/types'
import { Component } from '../components/BaseComponent'

export interface IGameObject<ParentScene extends AnyScene = AnyScene> {
  components: Component[]

  name: string

  tags: string[]

  scene: ParentScene

  setup?(): void

  processMode: ProcessMode

  destroy(): void
  queuedForDestroy: boolean
  queueDestroy(): void

  dispatchSceneEvent<
    S extends ParentScene,
    P extends Parameters<S['dispatch']>,
  >(
    event: P[0],
  ): void

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

export type ProcessMode = 'pausable' | 'whenPaused' | 'always' | 'disabled'
