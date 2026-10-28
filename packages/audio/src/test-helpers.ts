import {
  EngineContext,
  QueryCache,
  QueryCacheKey,
  EventBus,
  EventBusKey,
  ErrorBoundary,
  ErrorBoundaryKey,
  Logger,
  LogLevel,
  GameLoop,
  GameLoopKey,
  SystemScheduler,
  SystemSchedulerKey,
  Scene,
  Entity,
  _resetEntityIdCounter,
} from "@yagejs/core";
import type { EngineEvents } from "@yagejs/core";
import { AudioManagerKey } from "./types.js";
import type { AudioManager } from "./AudioManager.js";

class _TestScene extends Scene {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
}

export interface AudioTestContext {
  context: EngineContext;
  scene: Scene;
}

export function createAudioTestContext(
  audioManager: AudioManager,
): AudioTestContext {
  _resetEntityIdCounter();

  const ctx = new EngineContext();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();
  const logger = new Logger({ level: LogLevel.Debug });
  const gameLoop = new GameLoop();
  const boundary = new ErrorBoundary(logger);
  bus._setErrorBoundary(boundary);
  const scheduler = new SystemScheduler();
  scheduler.setErrorBoundary(boundary);

  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  ctx.register(ErrorBoundaryKey, boundary);
  ctx.register(GameLoopKey, gameLoop);
  ctx.register(SystemSchedulerKey, scheduler);
  ctx.register(AudioManagerKey, audioManager);

  const scene = new _TestScene("test-scene");
  scene._setContext(ctx);

  return { context: ctx, scene };
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}

/** Native-node test double; browser tests verify actual DSP separately. */
export class FakeParam {
  value = 1;
  readonly events: Array<{ kind: string; value: number; time: number }> = [];
  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: "set", value, time });
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: "linear", value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: "exponential", value, time });
    return this;
  }
  cancelScheduledValues(time: number): this {
    for (let i = this.events.length - 1; i >= 0; i--)
      if (this.events[i]!.time >= time) this.events.splice(i, 1);
    return this;
  }
}
export class FakeNode {
  readonly connections: FakeNode[] = [];
  disconnected = false;
  gain = new FakeParam();
  pan = new FakeParam();
  connect(node: FakeNode): FakeNode {
    this.connections.push(node);
    return node;
  }
  disconnect(): void {
    this.disconnected = true;
    this.connections.length = 0;
  }
}
export class FakeSource extends FakeNode {
  playbackRate = new FakeParam();
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  startTime = 0;
  offset = 0;
  stopTime: number | undefined;
  start(at = 0, offset = 0): void {
    this.startTime = at;
    this.offset = offset;
  }
  stop(at = 0): void {
    this.stopTime = at;
  }
  end(): void {
    this.onended?.();
  }
}
export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state: AudioContextState = "running";
  destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeNode[] = [];
  createGain(): FakeNode {
    const n = new FakeNode();
    this.gains.push(n);
    return n;
  }
  createStereoPanner(): FakeNode {
    return new FakeNode();
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  private readonly stateListeners = new Set<() => void>();
  addEventListener(type: string, listener: () => void): void {
    if (type === "statechange") this.stateListeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    if (type === "statechange") this.stateListeners.delete(listener);
  }
  /** Change state and report it as a real context does, synchronously. */
  setState(state: AudioContextState): void {
    this.state = state;
    for (const listener of [...this.stateListeners]) listener();
  }
  private queue: Promise<void> = Promise.resolve();
  /**
   * Apply a requested state once its promise settles, after the requests
   * before it. A browser reports `resume()` the same way, so `state` keeps
   * its old value until then.
   */
  private request(state: AudioContextState): Promise<void> {
    const applied = this.queue.then(() => this.setState(state));
    this.queue = applied.catch(() => {});
    return applied;
  }
  /** Resolves once every requested state change has applied. */
  settled(): Promise<void> {
    return this.queue;
  }
  resume(): Promise<void> {
    return this.request("running");
  }
  suspend(): Promise<void> {
    return this.request("suspended");
  }
  close(): Promise<void> {
    return this.request("closed");
  }
  asContext(): BaseAudioContext {
    return this as unknown as BaseAudioContext;
  }
}
export function fakeBuffer(duration = 2): AudioBuffer {
  const data = new Float32Array(Math.round(duration * 44100));
  data.fill(0.2);
  return {
    length: data.length,
    duration,
    numberOfChannels: 1,
    sampleRate: 44100,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}
