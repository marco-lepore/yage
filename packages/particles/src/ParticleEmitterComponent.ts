import {
  Component,
  RandomKey,
  Transform,
  Vec2Buffer,
  type RandomService,
} from "@yagejs/core";
import { SceneRenderTreeKey, resolveTextureInput } from "@yagejs/renderer";
import type {
  BlendMode,
  ParticleContainer,
  TextureResource,
} from "@yagejs/renderer";
import { ParticleContainer as PixiParticleContainer } from "pixi.js";
import type { Particle } from "pixi.js";
import { ParticlePool } from "./ParticlePool.js";
import { copyOptions } from "./copy.js";
import { normalizeShape, shapeTexture } from "./shapes.js";
import { isLerped, resolveRange } from "./types.js";
import { assertEmitterConfig } from "./validate.js";
import type {
  BurstOverrides,
  EmitterConfig,
  EmitterOptions,
  EmitterUpdate,
  Lerped,
  NumberRange,
} from "./types.js";

/** Default bearing arc for a ring `spawnOffset` with no `angle` set. */
const FULL_CIRCLE: [number, number] = [0, Math.PI * 2];

/**
 * An emitter's options with every defaulted value filled in. `_spawn` and
 * `_update` read one of these: the emitter's own, or a burst's merged copy.
 */
type ResolvedConfig = Required<
  Pick<
    EmitterOptions,
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
  EmitterOptions;

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

interface EmissionRequestEntry {
  active: boolean;
}

/** Temporary continuous-emission request. */
export interface ParticleEmissionHandle {
  /** Whether this request is still active. */
  readonly active: boolean;
  /** Remove only this request. Safe to call more than once. */
  release(): void;
}

/**
 * Component that owns a PixiJS ParticleContainer and drives particle emission.
 * Requires a `Transform` on the same entity: the system that ticks emitters
 * queries for both, so an emitter without one never emits and never ages the
 * particles a `burst` already spawned.
 *
 * The container follows the entity's world position, so particles carry
 * container-local coordinates and the container's own `position` is the depth
 * key a layer sort such as `ySort` reads.
 */
export class ParticleEmitterComponent extends Component {
  private readonly positionScratch = new Vec2Buffer();
  readonly container: ParticleContainer;
  /** Container visibility to restore on enable, so a hand-set hide survives. */
  private _visibleWhenActive = true;
  /** @internal */ readonly _pool: ParticlePool;
  /** @internal */ readonly _active: ParticleState[] = [];
  /** @internal */ _accumulator = 0;

  private config: ResolvedConfig;
  private _manualEmission = false;
  private readonly _emissionRequests = new Set<EmissionRequestEntry>();
  private _destroyed = false;
  private _random = this.service(RandomKey);
  private _warnedNoTransform = false;

  constructor(config: EmitterConfig) {
    super();

    assertEmitterConfig(config);
    const texture = resolveSource(config);

    const options = copyOptions<EmitterOptions>(config);
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
      ...options,
    };

    this.container = new PixiParticleContainer({
      texture,
      dynamicProperties: {
        position: true,
        rotation: true,
        color: true,
        vertex: true,
      },
    });
    if (this.config.blendMode !== undefined) {
      this.container.blendMode = this.config.blendMode;
    }

    this._pool = new ParticlePool(texture, this.config.maxParticles);
  }

  /** Start continuous emission at `config.rate` particles/sec. */
  emit(): void {
    this._warnIfNoTransform();
    this._manualEmission = true;
  }

  /**
   * Stop emission started by {@link emit}. Active emission requests remain in
   * effect. Existing particles continue to their end of life.
   */
  stop(): void {
    this._manualEmission = false;
    if (!this.isEmitting) this._accumulator = 0;
  }

  /**
   * Keep continuous emission active until the returned handle is released.
   * Several callers can hold requests without stopping one another.
   */
  requestEmission(): ParticleEmissionHandle {
    if (this._destroyed) {
      throw new Error(
        "ParticleEmitterComponent: cannot request emission after destruction.",
      );
    }
    this._warnIfNoTransform();
    const entry: EmissionRequestEntry = { active: true };
    this._emissionRequests.add(entry);
    return {
      get active() {
        return entry.active;
      },
      release: () => {
        if (!entry.active) return;
        entry.active = false;
        this._emissionRequests.delete(entry);
        if (!this.isEmitting) this._accumulator = 0;
      },
    };
  }

  /**
   * Warn once when the entity has no Transform: `ParticleSystem` queries
   * `[Transform, ParticleEmitterComponent]`, so such an emitter never ticks.
   * Checked on first use rather than on add, because adding the emitter
   * before the Transform is legitimate and would warn spuriously.
   */
  private _warnIfNoTransform(): void {
    if (this._warnedNoTransform || this.entity?.tryGet(Transform)) return;
    this._warnedNoTransform = true;
    console.warn(
      `ParticleEmitterComponent on "${this.entity?.name}": the entity has no Transform, ` +
        `so the emitter never runs — no continuous emission, and burst particles stay frozen. ` +
        `Add a Transform to the entity.`,
    );
  }

  /**
   * Change the emitter's configuration from now on. When a change reaches a
   * particle depends on where the emitter reads the option. The spawn-time
   * options — `lifetime`, `speed`, `angle`, `scale`, `alpha`, `rotation`,
   * `rotationSpeed`, `tint`, `spawnOffset` and `radialSpeed` — are resolved
   * once per particle, so a particle already in flight keeps what it was
   * spawned with and the next particle spawned uses the new value. `gravity`,
   * `damping`, `alphaFadeIn` and `alphaFadeOut` are read from this
   * configuration every frame for every live particle, so they reach particles
   * already in flight on the next frame. `rate` applies to the next frame of
   * continuous emission, and `blendMode` is a property of the container every
   * particle is drawn in.
   *
   * The whole merged configuration is checked, and a rejected call leaves every
   * previous value in force.
   *
   * The emitter copies what it is given, so changing the object afterwards
   * changes nothing. For a one-off variation, pass overrides to
   * {@link ParticleEmitterComponent.burst} instead.
   */
  configure(options: EmitterUpdate): void {
    const candidate: ResolvedConfig = {
      ...this.config,
      ...copyOptions(options),
    };
    assertEmitterConfig(candidate);
    this.config = candidate;
    if (options.blendMode !== undefined) {
      this.container.blendMode = options.blendMode;
    }
  }

  /** Spawn `count` particles at the entity's world position. */
  burst(count: number, overrides?: BurstOverrides): void;
  /** Spawn `count` particles at an explicit world position. */
  burst(
    count: number,
    worldX: number,
    worldY: number,
    overrides?: BurstOverrides,
  ): void;
  burst(
    count: number,
    worldXOrOverrides?: number | BurstOverrides,
    worldY?: number,
    trailingOverrides?: BurstOverrides,
  ): void {
    const positioned = typeof worldXOrOverrides === "number";
    const worldX = positioned ? worldXOrOverrides : undefined;
    const overrides = positioned ? trailingOverrides : worldXOrOverrides;

    this._warnIfNoTransform();
    // Every spawn path syncs the container first, so a particle is never
    // written against a stale origin. A Transform-less emitter keeps the
    // container at (0, 0); its particles never move or expire, because
    // nothing ticks it.
    const origin = this.entity
      ?.tryGet(Transform)
      ?.getWorldPositionInto(this.positionScratch);
    if (origin) this._syncContainer(origin.x, origin.y);
    const { x: originX, y: originY } = this.container.position;
    const x = worldX === undefined ? 0 : worldX - originX;
    const y = worldY === undefined ? 0 : worldY - originY;

    // Resolve and check the burst's configuration once, not per particle. The
    // merged object is not kept past this call, so it needs no copy.
    let cfg = this.config;
    if (overrides !== undefined) {
      cfg = { ...this.config, ...overrides };
      assertEmitterConfig(cfg);
    }

    for (let i = 0; i < count; i++) {
      this._spawn(x, y, cfg);
    }
  }

  /** Whether continuous emission is active. */
  get isEmitting(): boolean {
    return this._manualEmission || this._emissionRequests.size > 0;
  }

  /** Number of currently alive particles. */
  get activeCount(): number {
    return this._active.length;
  }

  /** Set how the particles combine with what is drawn beneath them. */
  set blendMode(mode: BlendMode) {
    this.container.blendMode = mode;
  }

  /** Get the particles' blend mode. */
  get blendMode(): BlendMode {
    return this.container.blendMode;
  }

  onAdd(): void {
    const layer = this.use(SceneRenderTreeKey).get(this.config.layer);
    layer.container.addChild(this.container);
    // A component is never effectively enabled during `onAdd` — `onEnable`
    // runs right after, and only for an active entity.
    this.container.visible = false;
  }

  /**
   * Hide the live particles. Emission stops on its own — a dormant entity is
   * out of the query `ParticleSystem` iterates — and the pooled particles are
   * kept, so the emitter picks up mid-flight when the entity comes back.
   */
  onDisable(): void {
    this._visibleWhenActive = this.container.visible;
    this.container.visible = false;
  }

  onEnable(): void {
    this.container.visible = this._visibleWhenActive;
  }

  onDestroy(): void {
    this._destroyed = true;
    for (const request of this._emissionRequests) request.active = false;
    this._emissionRequests.clear();
    this._manualEmission = false;
    this.container.removeFromParent();
    // No destroy options: the particle texture may be a built-in shape or
    // `Texture.WHITE`, both shared by every other emitter using them.
    this.container.destroy();
  }

  /**
   * Called by ParticleSystem each frame.
   * @internal
   */
  _update(dt: number, worldX: number, worldY: number): void {
    const cfg = this.config;

    // 1. Follow the entity, then accumulate continuous emission
    this._syncContainer(worldX, worldY);
    if (this.isEmitting) {
      this._accumulator += cfg.rate * dt;
      while (this._accumulator >= 1) {
        this._accumulator -= 1;
        this._spawn(0, 0, cfg);
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
      s.particle.alpha =
        (s.alphaStart + (s.alphaEnd - s.alphaStart) * t) * fadeEnvelope(t, cfg);

      i++;
    }
  }

  /**
   * Move the container to the entity's world position. In world space, live
   * particles shift by the inverse delta so they keep the position they were
   * drawn at; in local space they follow the container.
   * @internal
   */
  _syncContainer(worldX: number, worldY: number): void {
    const { x, y } = this.container.position;
    const dx = worldX - x;
    const dy = worldY - y;
    if (dx === 0 && dy === 0) return;
    this.container.position.set(worldX, worldY);
    if (this.config.simulationSpace === "local") return;
    for (const state of this._active) {
      state.particle.x -= dx;
      state.particle.y -= dy;
    }
  }

  /**
   * Spawn one particle at container-local coordinates, reading `cfg` for every
   * spawn-time value. Continuous emission passes the emitter's own
   * configuration; a burst with overrides passes its merged copy.
   * @internal
   */
  _spawn(localX: number, localY: number, cfg: ResolvedConfig): void {
    const particle = this._pool.acquire();
    if (!particle) return; // at capacity

    // Position with spawn offset
    let offsetX = 0;
    let offsetY = 0;
    const offset = cfg.spawnOffset;
    if (offset) {
      if (offset.radius !== undefined) {
        const radius = resolveRange(offset.radius, this._random);
        const bearing = resolveRange(offset.angle ?? FULL_CIRCLE, this._random);
        offsetX = Math.cos(bearing) * radius;
        offsetY = Math.sin(bearing) * radius;
      } else {
        if (offset.x !== undefined) {
          offsetX = resolveRange(offset.x, this._random);
        }
        if (offset.y !== undefined) {
          offsetY = resolveRange(offset.y, this._random);
        }
      }
    }
    particle.x = localX + offsetX;
    particle.y = localY + offsetY;

    // Velocity from speed + angle, plus the radial term along the spawn
    // offset. A particle that resolved to the origin has no direction, so it
    // takes no radial term.
    const speed = resolveRange(cfg.speed, this._random);
    const angle = resolveRange(cfg.angle, this._random);
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    if (cfg.radialSpeed !== undefined) {
      const distance = Math.hypot(offsetX, offsetY);
      if (distance > 0) {
        const radialSpeed = resolveRange(cfg.radialSpeed, this._random);
        vx += (offsetX / distance) * radialSpeed;
        vy += (offsetY / distance) * radialSpeed;
      }
    }

    // Rotation
    particle.rotation = resolveRange(cfg.rotation, this._random);
    const rotationSpeed = resolveRange(cfg.rotationSpeed, this._random);

    // Scale
    const { start: scaleStart, end: scaleEnd } = resolveLerped(
      cfg.scale ?? 1,
      this._random,
    );
    particle.scaleX = scaleStart;
    particle.scaleY = scaleStart;

    // Alpha
    const { start: alphaStart, end: alphaEnd } = resolveLerped(
      cfg.alpha ?? 1,
      this._random,
    );
    // A fade-in starts at zero, so the envelope applies at spawn too: without
    // it the particle would show at full alpha for one frame.
    particle.alpha = alphaStart * fadeEnvelope(0, cfg);

    // Tint
    particle.tint = cfg.tint;

    // Lifetime
    const lifetime = resolveRange(cfg.lifetime, this._random);

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

/**
 * Pick the emitter's texture. The two sources are mutually exclusive in the
 * type, so the order below only matters for callers coming from plain JS:
 * `texture` wins, then `shape`, then the `"pixel"` default.
 */
function resolveSource(config: EmitterConfig): TextureResource {
  if (config.texture !== undefined) {
    return resolveTextureInput(config.texture);
  }
  const shape = normalizeShape(
    config.shape ?? "pixel",
    "ParticleEmitterComponent",
  );
  return shapeTexture(shape);
}

/**
 * The alpha fade envelope at `t`, a particle's age over its lifetime. It
 * multiplies whatever `alpha` produces, and is 1 with neither fade set.
 * Branches rather than `Math.min`, so the default path does no division and
 * `t === 0` with no fade-in cannot produce `NaN`.
 */
function fadeEnvelope(t: number, cfg: ResolvedConfig): number {
  let envelope = 1;
  const { alphaFadeIn, alphaFadeOut } = cfg;
  if (alphaFadeIn !== undefined && alphaFadeIn > 0 && t < alphaFadeIn) {
    envelope *= t / alphaFadeIn;
  }
  if (alphaFadeOut !== undefined && alphaFadeOut > 0 && t > 1 - alphaFadeOut) {
    envelope *= (1 - t) / alphaFadeOut;
  }
  return envelope;
}

function resolveLerped(
  v: NumberRange | Lerped,
  random: RandomService,
): { start: number; end: number } {
  if (isLerped(v)) {
    return {
      start: resolveRange(v.start, random),
      end: resolveRange(v.end, random),
    };
  }
  const val = resolveRange(v, random);
  return { start: val, end: val };
}
