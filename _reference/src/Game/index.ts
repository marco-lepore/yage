import {
  Application as PixiApplication,
  IApplicationOptions,
  Assets,
  ResolverAssetsArray,
  ResolverAssetsObject,
} from 'pixi.js'
import { Scene } from '../Scene'
import { Executor } from '../Executor'
import { delayP } from '../utils/time'
import { fit } from './utils'
import { Process } from '../Process'

const DEFAULT_OPTIONS = {
  width: 512,
  height: 384,
  unit: 1,
  virtualWidth: 512,
  virtualHeight: 384,
  resizeTo: document.body,
}

export class Game<GameScene extends Scene> {
  scene?: GameScene
  app: PixiApplication<HTMLCanvasElement>
  virtualScreen = {
    width: 512,
    height: 384,
  }
  constructor(
    gameOptions: Partial<IApplicationOptions> & {
      virtualWidth?: number
      virtualHeight?: number
    },
  ) {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...gameOptions }
    this.app = new PixiApplication({ ...mergedOptions })
    this.app.stage.sortableChildren = true
    this.virtualScreen.height =
      mergedOptions.virtualHeight ?? mergedOptions.height
    this.virtualScreen.width = mergedOptions.virtualWidth ?? mergedOptions.width
    this.handleResize(window.innerWidth, window.innerHeight)
    window.addEventListener('resize', () =>
      this.handleResize(window.innerWidth, window.innerHeight),
    )
  }

  handleResize = (w: number, h: number) => {
    fit(
      true,
      this.app.stage,
      w,
      h,
      this.virtualScreen.width,
      this.virtualScreen.height,
    )
  }

  private setup() {
    document.body.append(this.app.view)
    this.addPlayerInputEvents()
  }

  private teardown() {}

  async init() {
    await import('@dimforge/rapier2d')
    Executor.setContext({ game: this })
    if (document.readyState === 'complete') {
      this.setup()
    } else {
      document.addEventListener('readystatechange', (event) => {
        if (document.readyState === 'complete') {
          this.setup()
        }
      })
    }
    return this
  }

  async loadScene<S extends GameScene>(scene: S) {
    this.scene = scene
    await scene.load()
    this.app.stage.addChild(scene.display)
  }

  setScene<S extends GameScene>(scene: S) {
    this.scene = scene
    this.app.stage.addChild(scene.display)
  }

  render() {
    this.app.render()
  }

  async loadAssets(
    assetsBundle: ResolverAssetsArray | ResolverAssetsObject,
    assetsBundleName: string,
  ): Promise<void> {
    console.log('assets')
    Assets.addBundle(assetsBundleName, assetsBundle)
    await Assets.loadBundle(assetsBundleName)
  }

  async unloadScene() {
    if (!this.scene) {
      return
    }
    this.scene.onBeforeUnload()
    await delayP()
    this.app.stage.removeChild(this.scene?.display)
    this.scene = undefined
  }

  async linearTransition(
    fromScene?: GameScene,
    toScene?: GameScene,
    duration: number = 1000,
  ): Promise<void> {
    const halfDuration = duration / 2
    if (fromScene) {
      await new Promise<void>((resolve) => {
        Executor.setContext({ scene: fromScene })
        Process.spawn({
          onTick({ totalElapsed }) {
            const t = totalElapsed / halfDuration
            fromScene.display.alpha = 1 - t
          },
          duration: halfDuration,
          onComplete: () => resolve(),
        })
      })
    }
    if (toScene) {
      await new Promise<void>((resolve) => {
        Executor.setContext({ scene: toScene })
        Process.spawn({
          onTick({ totalElapsed }) {
            const t = totalElapsed / halfDuration
            toScene.display.alpha = t
          },
          duration: halfDuration,
          onComplete: () => resolve(),
        })
      })
    }
  }

  async transitionTo(
    scene: GameScene,
    duration = 750,
    transitionFunction: (
      fromScene: GameScene,
      toScene: GameScene,
      duration: number,
    ) => Promise<void> = this.linearTransition,
  ) {
    await scene.load()
    scene.display.alpha = 0
    this.app.stage.addChild(scene.display)
    await transitionFunction(this.scene, scene, duration)
    const oldScene = this.scene
    this.scene = scene
    if (oldScene) {
      this.app.stage.removeChild(oldScene.display)
      oldScene.onBeforeUnload()
      oldScene.destroy()
    }
    Executor.setContext({ scene })
    scene.onTransitionCompleted()
  }

  playerInput: Record<string, boolean> = {}
  addPlayerInputEvents() {
    window.addEventListener('keydown', (keyEvent) => {
      this.playerInput[keyEvent.code] = true
      keyEvent.preventDefault()
    })
    window.addEventListener('keyup', (keyEvent) => {
      this.playerInput[keyEvent.code] = false
      keyEvent.preventDefault()
    })
  }
}
