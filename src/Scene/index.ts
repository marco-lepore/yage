import { Assets, ResolverAssetsObject, extensions } from 'pixi.js'
import { Ticker } from './Ticker'
import { GameObject } from '../GameObject'
import { Executor } from '../Executor'
import { TypedEventTarget } from './TypedEventTarget'
import { Rapier } from './Rapier'
import { Display } from './Display'
import { Process } from '../Process'
import { IGameObject } from '../GameObject/types'
import { soundAsset } from '@pixi/sound'
import { AnyEvents, AnyState } from './types'
extensions.add(soundAsset)

export class Scene<
  State extends AnyState = AnyState,
  Events extends AnyEvents = AnyEvents,
> {
  assetsBundle: ResolverAssetsObject = {}
  assetsBundleId = 'scene_assets'
  gameObjects: IGameObject[] = []
  ticker = new Ticker()
  display!: Display

  rapier = new Rapier()

  paused = false

  protected state: State
  getState(): State {
    return this.state
  }

  destroyed = false

  constructor(initialState: State) {
    Executor.setContext({ scene: this })
    this.setup()
    this.state = initialState

    this.onBeforeFixedTick = this.onBeforeFixedTick.bind(this)
    this.onFixedTick = this.onFixedTick.bind(this)
    this.onAfterFixedTick = this.onAfterFixedTick.bind(this)
    this.onBeforeTick = this.onBeforeTick.bind(this)
    this.onTick = this.onTick.bind(this)
    this.onAfterTick = this.onAfterTick.bind(this)
  }

  protected setup() {}

  protected teardown() {
    this.ticker.destroy()
    this.gameObjects.forEach((go) => go.destroy())
    this.display.removeFromParent()
    this.display.destroy()
  }

  destroy() {
    if (this.destroyed) {
      return
    }
    this.teardown()
    this.destroyed = true
  }

  protected eventTarget = new TypedEventTarget<Events>()

  dispatch<E extends Events[keyof Events]>(event: E) {
    Executor.setContext({ scene: this })
    this.eventTarget.dispatchEvent(event)
  }

  addEventListener<T extends keyof Events>(
    type: T,
    callback: (event: Events[T]) => void,
  ) {
    this.eventTarget.addEventListener(type, callback)
    return () => this.eventTarget.removeEventListener(type, callback)
  }

  autostart = true

  onLoad() {
    Executor.setContext({ scene: this })
    window.addEventListener('focusout', this.ticker.stop)
    window.addEventListener('focusin', this.ticker.start)
    this.display = new Display()
    this.display.sortableChildren = true
    this.ticker.add(this.tickerCallback)
    if (this.autostart) {
      this.ticker.start()
    }
  }

  onTransitionCompleted() {}

  async loadAssets(
    onProgress?: (progress: number) => void,
    background = false,
  ) {
    Assets.addBundle(this.assetsBundleId, this.assetsBundle)

    if (background) {
      await Assets.backgroundLoadBundle(this.assetsBundleId)
    }
    await Assets.loadBundle(this.assetsBundleId, onProgress)
  }

  async load(onProgress?: (progress: number) => void) {
    await this.loadAssets(onProgress)
    this.onLoad()
  }

  async preload(onProgress?: (progress: number) => void, background = false) {
    if (background) {
      await this.loadAssets(undefined, true)
    }
    await this.loadAssets(onProgress, false)
  }

  tickerCallback = (dt: number) => {
    Executor.setContext({ scene: this })
    this.onBeforeTick(dt)
    this.onTick(dt)
    setTimeout(() => {
      Executor.setContext({ scene: this })
      this.onAfterTick(dt)
    }, 0)
  }
  fixedTickerCallback = (timestepMS: number) => {
    Executor.setContext({ scene: this })
    this.onBeforeFixedTick(timestepMS)
    this.onFixedTick(timestepMS)
    setTimeout(() => {
      Executor.setContext({ scene: this })
      this.onAfterFixedTick(timestepMS)
    }, 0)
  }

  filterByProcessMode = (go: GameObject) => {
    return this.paused
      ? go.processMode === 'whenPaused' || go.processMode === 'always'
      : go.processMode === 'pausable' || go.processMode === 'always'
  }

  onBeforeTick(dt: number) {
    this.gameObjects.filter(this.filterByProcessMode).forEach((go) => {
      if (go.onBeforeTick) go.onBeforeTick(dt)
    })
  }

  onTick(dt: number) {
    this.rapier.addGameTime(this.ticker.elapsedMS)
    this.rapier.simulate(this.onBeforeFixedTick, this.onFixedTick)
    this.gameObjects.filter(this.filterByProcessMode).forEach((go) => {
      if (go.onTick) go.onTick(dt)
    })
  }

  onBeforeFixedTick(timestepMS: number) {
    this.gameObjects.filter(this.filterByProcessMode).forEach((go) => {
      if (go.onBeforeFixedTick) go.onBeforeFixedTick(timestepMS)
    })
  }

  onAfterTick(timestepMS: number) {
    this.gameObjects.filter(this.filterByProcessMode).forEach((go) => {
      if (go.onAfterTick) go.onAfterTick(timestepMS)
    })
  }

  onFixedTick(timestepMS: number) {
    Process.onTick(timestepMS)

    this.gameObjects.filter(this.filterByProcessMode).forEach((go) => {
      if (go.onFixedTick) go.onFixedTick(timestepMS)
    })
    this.onAfterFixedTick(timestepMS)
  }

  onAfterFixedTick(dt: number) {
    this.gameObjects.filter(this.filterByProcessMode).forEach((go) => {
      if (go.onAfterFixedTick) go.onAfterFixedTick(dt)
    })
    this.gameObjects
      .filter(({ queuedForDestroy }) => queuedForDestroy)
      .forEach((go) => go.destroy())
  }

  onBeforeUnload() {
    Executor.setContext({ scene: this })
    window.removeEventListener('focusout', this.ticker.stop)
    window.removeEventListener('focusin', this.ticker.start)
    this.ticker.remove(this.tickerCallback)
    this.display.destroy()
    this.destroy()
  }

  getGameObjectByClass<G extends GameObject>(ctor: {
    new (): G
  }): G | undefined {
    const go = this.gameObjects.find((go) => go instanceof ctor)

    if (go) {
      return go as G
    }
  }
  getGameObjectByName<G extends GameObject>(name: string): G | undefined {
    const go = this.gameObjects.find((go) => go.name === name)

    if (go) {
      return go as G
    }
  }
  getGameObjectByTag<G extends GameObject>(tag: string): G | undefined {
    const go = this.gameObjects.find((go) => go.tags.includes(tag))

    if (go) {
      return go as G
    }
  }
  getGameObjectsByClass<G extends GameObject>(ctor: { new (): G }): G[] {
    return this.gameObjects.filter((go) => go instanceof ctor) as G[]
  }
  getGameObjectsByName<G extends GameObject>(name: string): G[] {
    return this.gameObjects.filter((go) => go.name === name) as G[]
  }
  getGameObjectsByTag<G extends GameObject>(tag: string): G[] {
    return this.gameObjects.filter((go) => go.tags.includes(tag)) as G[]
  }

  addGameObjects = (...gameObjects: IGameObject[]) => {
    this.gameObjects.push(...gameObjects)
    gameObjects.forEach((go) => {
      go.scene = this
      if (go.onAdded) go.onAdded()
    })
  }

  removeGameObjects(...gameObjects: IGameObject[]) {
    this.gameObjects = this.gameObjects.filter((c) => !gameObjects.includes(c))
    gameObjects.forEach((go) => go.destroy())
  }

  instantiateGameObject = <G extends GameObject, P extends unknown[]>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctor: { new (scene: any, ...parameters: P): G },
    ...parameters: P
  ) => {
    const go = new ctor(this, ...parameters)
    this.addGameObjects(go)
    return go
  }
}
