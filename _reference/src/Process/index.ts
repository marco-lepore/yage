import { Scene } from '../Scene'
import {
  Easing,
  Interpolatable,
  KeysOfValue,
  getScene,
  interpolate,
  isInterpolatable,
} from '../utils'

type ProcessData<S> = {
  totalElapsed: number
  progress: number
  process: Process<S>
  context: S extends () => infer C ? C : S
}

type ProcessCallback<S, WithElapsed extends boolean = false> = (
  data: WithElapsed extends true
    ? ProcessData<S> & { elapsed: number }
    : ProcessData<S>,
) => void

type ProcessOptions<S> = {
  tags?: string[]
  duration?: number
  loop?: boolean
  onComplete?: ProcessCallback<S>
  onTick?: ProcessCallback<S, true>
  setup?: S
}

export class Process<S = unknown> {
  tags: string[] = []
  duration = 0
  totalElapsed = 0
  loop = false
  paused = false
  completed = false
  onComplete?: ProcessCallback<S>
  onTick?: ProcessCallback<S, true>

  resolvePromise?: (value: ProcessData<S> | PromiseLike<ProcessData<S>>) => void
  promise?: Promise<ProcessData<S>>

  get context(): S extends () => infer C ? C : S {
    return Process.contexts.get(this) as S extends () => infer C ? C : S
  }

  set context(v) {
    Process.contexts.set(this, v)
  }

  constructor(options: ProcessOptions<S>) {
    this.duration = options.duration ?? this.duration
    this.loop = options.loop ?? this.loop
    this.onComplete = options.onComplete ?? this.onComplete
    this.onTick = options.onTick ?? this.onTick
    this.tags = options.tags ?? this.tags
    this.context =
      typeof options.setup === 'function' ? options.setup() : options.setup

    if (!this.loop) {
      this.promise = new Promise<ProcessData<S>>((resolve) => {
        this.resolvePromise = resolve
      })
    }

    this.start()
  }

  getSceneProcesses() {
    const scene = getScene()
    if (!Process.processesByScene.has(scene)) {
      Process.processesByScene.set(scene, new Set<Process>())
    }
    return Process.processesByScene.get(scene)
  }

  start() {
    Process.processes.add(this)
    const sceneProcesses = this.getSceneProcesses()
    sceneProcesses.add(this)
    this.paused = false
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
  }

  private _onTick(elapsed: number) {
    if (this.paused) {
      return
    }

    this.totalElapsed += elapsed
    if (this.onTick) {
      this.onTick({
        elapsed,
        ...this.getProcessData(),
      })
    }
    if (this.totalElapsed > this.duration) {
      this._onComplete()
    }
  }

  private _onComplete() {
    if (this.completed) {
      return
    }
    this.completed = true

    if (this.onComplete) {
      this.onComplete(this.getProcessData())
    }
    this.destroy()
    if (this.loop) {
      this.totalElapsed = 0
      this.completed = false
      this.start()
    } else if (this.resolvePromise) {
      this.resolvePromise(this.getProcessData())
    }
  }

  getProcessData(): ProcessData<S> {
    return {
      totalElapsed: this.totalElapsed,
      progress: Math.min(this.totalElapsed / this.duration, 1),
      context: this.context,
      process: this,
    }
  }

  toPromise() {
    return this.promise
  }

  destroy() {
    Process.contexts.delete(this)
    Process.processes.delete(this)
    const sceneProcesses = this.getSceneProcesses()
    sceneProcesses.delete(this)
  }

  private static processes = new Set<Process>()
  private static processesByScene = new WeakMap<Scene, Set<Process>>()
  private static contexts = new Map<Process, unknown>()
  static onTick = (dt: number) => {
    const scene = getScene()

    if (!this.processesByScene.has(scene)) {
      return
    }
    for (const p of this.processesByScene.get(scene)) {
      p._onTick(dt)
    }
  }

  static spawnTimer<S>(
    duration: number,
    onComplete: ProcessCallback<S>,
    setup?: S,
  ): Process<S> {
    return new Process({ duration, onComplete, setup })
  }

  static spawnInterval<S>(
    duration: number,
    onComplete: ProcessCallback<S>,
    setup?: S,
  ): Process<S> {
    return new Process({ duration, onComplete, setup, loop: true })
  }

  static spawn<S>(options: ProcessOptions<S>): Process<S> {
    return new Process(options)
  }

  static tween<T extends Interpolatable>(
    callback: (n: T) => void,
    from: T,
    to: T,
    duration: number,
    easing?: Easing,
  ) {
    return new Process({
      duration,
      onTick: ({ progress }) => {
        callback(interpolate(from, to, progress, easing))
      },
    })
  }

  static tweenProperty<
    O extends object,
    K extends KeysOfValue<O, number>,
    T extends Interpolatable,
  >(object: O, property: K, to: T, duration: number, easing?: Easing) {
    const value = object[property] as T
    if (!isInterpolatable(value)) {
      throw new Error('property is not a interpolatable')
    }
    return new Process({
      duration,
      onTick: ({ progress }) => {
        object[property] = interpolate(value, to, progress, easing)
      },
    })
  }
}
