import { Scene } from "../Scene";
import { getScene } from "../utils";

type ProcessCallback<S> = (data: {
  elapsed: number;
  totalElapsed: number;
  process: Process<S>;
  context: S extends () => infer C ? C : S;
}) => void;

type ProcessOptions<S> = {
  tags?: string[];
  duration?: number;
  loop?: boolean;
  onComplete?: ProcessCallback<S>;
  onTick?: ProcessCallback<S>;
  setup?: S;
};

export class Process<S> {
  tags: string[] = [];
  duration = 0;
  totalElapsed = 0;
  loop = false;
  paused = false;
  completed = false;
  onComplete?: ProcessCallback<S>;
  onTick?: ProcessCallback<S>;
  get context(): S extends () => infer C ? C : S {
    return Process.contexts.get(this) as S extends () => infer C ? C : S;
  }

  set context(v) {
    Process.contexts.set(this, v);
  }

  constructor(options: ProcessOptions<S>) {
    this.duration = options.duration ?? this.duration;
    this.loop = options.loop ?? this.loop;
    this.onComplete = options.onComplete ?? this.onComplete;
    this.onTick = options.onTick ?? this.onTick;
    this.tags = options.tags ?? this.tags;
    this.context =
      typeof options.setup === "function" ? options.setup() : options.setup;

    this.start();
  }

  getSceneProcesses() {
    const scene = getScene();
    if (!Process.processesByScene.has(scene)) {
      Process.processesByScene.set(scene, new Set<Process<any>>());
    }
    return Process.processesByScene.get(scene);
  }

  start() {
    Process.processes.add(this);
    const sceneProcesses = this.getSceneProcesses();
    sceneProcesses.add(this);
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  private _onTick(elapsed: number) {
    if (this.paused) {
      return;
    }

    this.totalElapsed += elapsed;
    if (this.onTick) {
      this.onTick({
        elapsed,
        totalElapsed: this.totalElapsed,
        context: this.context,
        process: this,
      });
    }
    if (this.totalElapsed > this.duration) {
      this._onComplete(elapsed);
    }
  }

  private _onComplete(elapsed: number) {
    if (this.completed) {
      return;
    }
    this.completed = true;

    if (this.onComplete) {
      this.onComplete({
        elapsed,
        totalElapsed: this.totalElapsed,
        context: this.context,
        process: this,
      });
    }
    this.destroy();
    if (this.loop) {
      this.totalElapsed = 0;
      this.start();
    }
  }

  destroy() {
    Process.contexts.delete(this);
    Process.processes.delete(this);
    const sceneProcesses = this.getSceneProcesses();
    sceneProcesses.delete(this);
  }

  private static processes = new Set<Process<any>>();
  private static processesByScene = new WeakMap<
    Scene<any, any>,
    Set<Process<any>>
  >();
  private static contexts = new Map<Process<any>, any>();
  static onTick = (dt: number) => {
    const scene = getScene();

    if (!this.processesByScene.has(scene)) {
      return;
    }
    for (const p of this.processesByScene.get(scene)) {
      p._onTick(dt);
    }
  };

  static spawnTimer<S>(
    duration: number,
    onComplete: ProcessCallback<S>,
    setup?: S
  ): Process<S> {
    return new Process({ duration, onComplete, setup });
  }

  static spawnInterval<S>(
    duration: number,
    onComplete: ProcessCallback<S>,
    setup?: S
  ): Process<S> {
    return new Process({ duration, onComplete, setup, loop: true });
  }

  static spawn<S>(options: ProcessOptions<S>): Process<S> {
    return new Process(options);
  }
}
