import { AssetHandle, Component, serializable } from "@yagejs/core";
import { RenderLayerManagerKey, resolveTextureInput } from "@yagejs/renderer";
import { ParticleContainer, Texture } from "pixi.js";
import type { Particle } from "pixi.js";
import { ParticlePool } from "./ParticlePool.js";
import { isLerped, resolveRange } from "./types.js";
import type {
  EmitterConfig,
  Lerped,
  NumberRange,
  ParticleEmitterData,
} from "./types.js";

/** Internal tracking state for a single active particle. */
interface ParticleState {
  particle: Particle;
  age: number;
  lifetime: number;
  vx: number;
  vy: number;
  rotationSpeed: number;
  scaleStart: number;
  scaleEnd: number;
  alphaStart: number;
  alphaEnd: number;
}

/** Component that owns a PixiJS ParticleContainer and drives particle emission. */
@serializable
export class ParticleEmitterComponent extends Component {
  readonly container: ParticleContainer;
  /** @internal */ readonly _pool: ParticlePool;
  /** @internal */ readonly _active: ParticleState[] = [];
  /** @internal */ _accumulator = 0;

  private readonly config: Required<
    Pick<
      EmitterConfig,
      | "maxParticles"
      | "rate"
      | "lifetime"
      | "speed"
      | "angle"
      | "rotation"
      | "rotationSpeed"
      | "tint"
      | "damping"
      | "layer"
    >
  > &
    EmitterConfig;
  private readonly _rawConfig: EmitterConfig;
  private readonly _textureKey: string | null;

  private _isEmitting = false;

  constructor(config: EmitterConfig) {
    super();

    this._rawConfig = config;
    this._textureKey =
      config.textureKey ??
      (typeof config.texture === "string"
        ? config.texture
        : config.texture instanceof AssetHandle
          ? config.texture.path
          : null);

    if (!config.texture && !this._textureKey) {
      throw new Error(
        "ParticleEmitterComponent requires either `texture` or `textureKey`.",
      );
    }

    const particleTexture =
      config.texture !== undefined
        ? resolveTextureInput(config.texture)
        : Texture.from(this._textureKey!);

    this.config = {
      maxParticles: 100,
      rate: 10,
      speed: 0,
      angle: 0,
      rotation: 0,
      rotationSpeed: 0,
      tint: 0xffffff,
      damping: 0,
      layer: "default",
      ...config,
    };

    this.container = new ParticleContainer({
      texture: particleTexture,
      dynamicProperties: {
        position: true,
        rotation: true,
        color: true,
        vertex: true,
      },
    });

    this._pool = new ParticlePool(particleTexture, this.config.maxParticles);
  }

  /** Start continuous emission at `config.rate` particles/sec. */
  emit(): void {
    this._isEmitting = true;
  }

  /** Stop continuous emission. Existing particles continue to their end of life. */
  stop(): void {
    this._isEmitting = false;
    this._accumulator = 0;
  }

  /** Spawn `count` particles immediately. */
  burst(count: number, worldX = 0, worldY = 0): void {
    for (let i = 0; i < count; i++) {
      this._spawn(worldX, worldY);
    }
  }

  /** Whether continuous emission is active. */
  get isEmitting(): boolean {
    return this._isEmitting;
  }

  /** Number of currently alive particles. */
  get activeCount(): number {
    return this._active.length;
  }

  serialize(): ParticleEmitterData | null {
    if (!this._textureKey) {
      console.warn(
        `ParticleEmitterComponent on "${this.entity?.name}": created with a Texture object. ` +
          `Use a string path, texture handle, or { textureKey } for save/load support.`,
      );
      return null;
    }
    const raw = this._rawConfig;
    return {
      textureKey: this._textureKey,
      maxParticles: this.config.maxParticles,
      rate: this.config.rate,
      lifetime: raw.lifetime,
      speed: raw.speed ?? 0,
      angle: raw.angle ?? 0,
      rotation: raw.rotation ?? 0,
      rotationSpeed: raw.rotationSpeed ?? 0,
      tint: this.config.tint,
      damping: this.config.damping,
      layer: this.config.layer,
      ...(raw.scale != null && { scale: raw.scale }),
      ...(raw.alpha != null && { alpha: raw.alpha }),
      ...(raw.gravity && { gravity: raw.gravity }),
      ...(raw.spawnOffset && { spawnOffset: raw.spawnOffset }),
    };
  }

  static fromSnapshot(data: ParticleEmitterData): ParticleEmitterComponent {
    return new ParticleEmitterComponent({
      textureKey: data.textureKey,
      maxParticles: data.maxParticles,
      rate: data.rate,
      lifetime: data.lifetime,
      speed: data.speed,
      angle: data.angle,
      rotation: data.rotation,
      rotationSpeed: data.rotationSpeed,
      tint: data.tint,
      damping: data.damping,
      layer: data.layer,
      ...(data.scale != null && { scale: data.scale }),
      ...(data.alpha != null && { alpha: data.alpha }),
      ...(data.gravity && { gravity: data.gravity }),
      ...(data.spawnOffset && { spawnOffset: data.spawnOffset }),
    });
  }

  onAdd(): void {
    const layers = this.use(RenderLayerManagerKey);
    const layer = layers.get(this.config.layer);
    layer.container.addChild(this.container);
  }

  onDestroy(): void {
    this.container.removeFromParent();
    this.container.destroy();
  }

  /**
   * Called by ParticleSystem each frame.
   * @internal
   */
  _update(dt: number, worldX: number, worldY: number): void {
    const cfg = this.config;

    // 1. Accumulate continuous emission
    if (this._isEmitting) {
      this._accumulator += cfg.rate * dt;
      while (this._accumulator >= 1) {
        this._accumulator -= 1;
        this._spawn(worldX, worldY);
      }
    }

    // 2. Update active particles
    const active = this._active;
    let i = 0;
    while (i < active.length) {
      const s = active[i]!;
      s.age += dt;

      // Kill expired
      if (s.age >= s.lifetime) {
        this.container.removeParticle(s.particle);
        this._pool.release(s.particle);
        // Swap-remove
        active[i] = active[active.length - 1]!;
        active.pop();
        continue;
      }

      // Apply gravity
      if (cfg.gravity) {
        s.vx += cfg.gravity.x * dt;
        s.vy += cfg.gravity.y * dt;
      }

      // Frame-rate-independent damping
      if (cfg.damping > 0) {
        const factor = (1 - cfg.damping) ** dt;
        s.vx *= factor;
        s.vy *= factor;
      }

      // Move
      s.particle.x += s.vx * dt;
      s.particle.y += s.vy * dt;

      // Rotate
      s.particle.rotation += s.rotationSpeed * dt;

      // Lerp scale & alpha
      const t = s.age / s.lifetime;
      const scale = s.scaleStart + (s.scaleEnd - s.scaleStart) * t;
      s.particle.scaleX = scale;
      s.particle.scaleY = scale;
      s.particle.alpha = s.alphaStart + (s.alphaEnd - s.alphaStart) * t;

      i++;
    }
  }

  /** @internal */
  _spawn(worldX: number, worldY: number): void {
    const particle = this._pool.acquire();
    if (!particle) return; // at capacity

    const cfg = this.config;

    // Position with spawn offset
    let x = worldX;
    let y = worldY;
    if (cfg.spawnOffset) {
      if (cfg.spawnOffset.x !== undefined) x += resolveRange(cfg.spawnOffset.x);
      if (cfg.spawnOffset.y !== undefined) y += resolveRange(cfg.spawnOffset.y);
    }
    particle.x = x;
    particle.y = y;

    // Velocity from speed + angle
    const speed = resolveRange(cfg.speed);
    const angle = resolveRange(cfg.angle);
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    // Rotation
    particle.rotation = resolveRange(cfg.rotation);
    const rotationSpeed = resolveRange(cfg.rotationSpeed);

    // Scale
    const { start: scaleStart, end: scaleEnd } = resolveLerped(cfg.scale ?? 1);
    particle.scaleX = scaleStart;
    particle.scaleY = scaleStart;

    // Alpha
    const { start: alphaStart, end: alphaEnd } = resolveLerped(cfg.alpha ?? 1);
    particle.alpha = alphaStart;

    // Tint
    particle.tint = cfg.tint;

    // Lifetime
    const lifetime = resolveRange(cfg.lifetime);

    this._active.push({
      particle,
      age: 0,
      lifetime,
      vx,
      vy,
      rotationSpeed,
      scaleStart,
      scaleEnd,
      alphaStart,
      alphaEnd,
    });

    this.container.addParticle(particle);
  }
}

function resolveLerped(v: NumberRange | Lerped): { start: number; end: number } {
  if (isLerped(v)) {
    return { start: resolveRange(v.start), end: resolveRange(v.end) };
  }
  const val = resolveRange(v);
  return { start: val, end: val };
}
