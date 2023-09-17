import type { Component } from '../components/BaseComponent'
import { AnyScene } from '../Scene/types'
import { IGameObject, ProcessMode } from './types'

export class GameObject<ParentScene extends AnyScene = AnyScene>
  implements IGameObject<ParentScene>
{
  components: Component[] = []

  processMode: ProcessMode = 'pausable'

  private _scene!: ParentScene
  get scene() {
    if (!this._scene) {
      throw new Error(`GameObject ${this.name} is orphan`)
    }
    return this._scene
  }
  set scene(p: ParentScene) {
    this._scene = p
  }

  name = 'gameobject'
  tags: string[] = []
  constructor(parentScene: ParentScene) {
    this.scene = parentScene
  }

  private destroyed = false
  destroy() {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.unregisterComponent(...this.components)
    this.scene.removeGameObjects(this)
  }

  dispatchSceneEvent<
    S extends ParentScene,
    P extends Parameters<S['dispatch']>,
  >(event: P[0]) {
    return this.scene.dispatch(event)
  }

  queuedForDestroy = false
  queueDestroy() {
    this.queuedForDestroy = true
  }

  onAdded() {}

  onBeforeTick(dt: number) {
    this.components.forEach((c) => c.onBeforeTick(dt))
  }

  onTick(dt: number) {
    this.components.forEach((c) => c.onTick(dt))
  }

  onBeforeFixedTick(elapsedMS: number) {
    this.components.forEach((c) => c.onBeforeFixedTick(elapsedMS))
  }

  onFixedTick(elapsedMS: number) {
    this.components.forEach((c) => c.onFixedTick(elapsedMS))
  }

  onAfterFixedTick(elapsedMS: number) {
    this.components.forEach((c) => c.onAfterFixedTick(elapsedMS))
  }

  onAfterTick(dt: number) {
    this.components.forEach((c) => c.onAfterTick(dt))
  }

  // Memoize these?
  getComponentByClass<C extends Component>(ctor: {
    new (...arguments_: unknown[]): C
  }): C | undefined {
    const go = this.components.find((component) => component instanceof ctor)

    if (go) {
      return go as C
    }
  }
  getComponentByName<C extends Component>(name: string): C | undefined {
    const go = this.components.find((component) => component.name === name)

    if (go) {
      return go as C
    }
  }
  getComponentByTag<C extends Component>(tag: string): C | undefined {
    const go = this.components.find((component) => component.tags.includes(tag))

    if (go) {
      return go as C
    }
  }
  getComponentsByClass<C extends Component>(ctor: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (...parameters: any[]): C
  }): C[] {
    return this.components.filter(
      (component) => component instanceof ctor,
    ) as C[]
  }
  getComponentsByName<C extends Component>(name: string): C[] {
    return this.components.filter((component) => component.name === name) as C[]
  }
  getComponentsByTag<C extends Component>(tag: string): C[] {
    return this.components.filter((component) =>
      component.tags.includes(tag),
    ) as C[]
  }

  registerComponents = (...components: Component[]) => {
    this.components.push(...components)
    components.forEach((c) => {
      c.onAdded()
    })
  }

  unregisterComponent(...components: Component[]) {
    this.components = this.components.filter((c) => !components.includes(c))
    components.forEach((c) => {
      c.onRemoved()
      c.destroy()
    })
  }

  addComponent = <C extends Component, P extends unknown[]>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctor: { new (gameobject: any, ...parameters: P): C },
    ...parameters: P
  ) => {
    const comp = new ctor(this, ...parameters)
    this.registerComponents(comp)
    return comp
  }
}
