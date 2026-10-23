import {
  Component,
  devWarn,
  RandomKey,
  Transform,
  Vec2Buffer,
  type RandomService,
} from "@yagejs/core";
import {
  SceneRenderTreeKey,
  resolveTextureInput,
  setSortSource,
} from "@yagejs/renderer";
import type {
  BlendMode,
  ParticleContainer,
  SortSource,
  TextureInput,
  TextureResource,
} from "@yagejs/renderer";
import { ParticleContainer as PixiParticleContainer } from "pixi.js";
import type { Particle } from "pixi.js";
import { ParticlePool } from "./ParticlePool.js";
import {
  BURST_OVERRIDE_OPTIONS,
  UPDATE_OPTIONS,
  copyOptions,
  pickOptions,
} from "./copy.js";
import { normalizeShape, shapeTexture } from "./shapes.js";
import type { ParticleShape, ShapeConfig } from "./shapes.js";
import { isLerped, resolveRange } from "./types.js";
import { assertEmitterConfig } from "./validate.js";
import type {
  BurstOverrides,
  EmitterConfig,
  EmitterOptions,
  EmitterUpdateOptions,
  Lerped,
  NumberRange,
} from "./types.js";

/** Default bearing arc for a ring `spawnOffset` with no `angle` set. */
const FULL_CIRCLE: [number, number] = [0, Math.PI * 2];

/**
 * An emitter's options with every defaulted value filled in. `_update` reads
 * the emitter's own; `_spawn` reads whichever one it is handed, so a burst with
 * overrides spawns from a merged copy. `blendMode` is absent because the
 * container holds it, and so is the texture source, which the pool is built
 * against. Every field is readonly: a new configuration replaces the whole
 * object rather than being written into the old one.
 */
type ResolvedConfig = Readonly<
  Required<
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
      | "alphaFadeIn"
      | "alphaFadeOut"
      | "layer"
    >
  > &
    Omit<EmitterOptions, "blendMode">
>;

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
export class ParticleEmitterComponent extends Component implements SortSource {
  private readonly positionScratch = new Vec2Buffer();
  /**
   * The Pixi container the particles draw in. Game code does not write to it:
   * the emitter writes its position from the entity's `Transform` every frame,
   * and re-applies `visible` and `alpha`. Change the emitter through this
   * component; a task that needs this object is a missing component API.
   */
  readonly renderObject: ParticleContainer;
  /**
   * The visibility the game asked for. The Pixi flag is this AND the
   * component being effectively enabled, so hiding an emitter by hand
   * survives a `setActive(false)` / `setActive(true)` cycle.
   */
  private _userVisible = true;
  /** The opacity the game asked for. */
  private _userAlpha = 1;
  private _zIndex = 0;
  private _sortOffset = 0;
  /** Whether the ignored-`zIndex` development warning has fired. */
  private _warnedZIndex = false;
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

    // The texture source becomes the container's and the pool's texture, and
    // the blend mode belongs to the container, so the stored configuration
    // carries plain emission data only.
    const { texture: textureInput, shape, blendMode, ...options } = config;
    const texture = resolveSource(textureInput, shape);
    this.config = {
      maxParticles: 100,
      rate: 10,
      speed: 0,
      angle: 0,
      rotation: 0,
      rotationSpeed: 0,
      tint: 0xffffff,
      damping: 0,
      alphaFadeIn: 0,
      alphaFadeOut: 0,
      layer: "default",
      ...copyOptions(options),
    };

    this.renderObject = new PixiParticleContainer({
      texture,
      dynamicProperties: {
        position: true,
        rotation: true,
        color: true,
        vertex: true,
      },
    });
    if (blendMode !== undefined) this.renderObject.blendMode = blendMode;

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
   * The emitter reads only the options `EmitterUpdateOptions` lists and ignores
   * any other key, such as `maxParticles` in a spread `EmitterConfig`.
   *
   * The emitter copies what it is given, so changing the object afterwards
   * changes nothing. For a one-off variation, pass overrides to
   * {@link ParticleEmitterComponent.burst} instead.
   */
  configure(options: EmitterUpdateOptions): void {
    const { blendMode, ...rest } = pickOptions(options, UPDATE_OPTIONS);
    const candidate: ResolvedConfig = {
      ...this.config,
      ...copyOptions(rest),
    };
    assertEmitterConfig(candidate);
    this.config = candidate;
    if (blendMode !== undefined) this.blendMode = blendMode;
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

    // Resolve and check the burst's configuration once, not per particle, and
    // before the container moves, so a rejected override leaves the emitter
    // as it was. Only the BurstOverrides keys are merged, because a spread can
    // add other keys and a spawn reads some of them, such as alphaFadeIn. The
    // merged object is not kept past this call, so it needs no copy.
    let cfg = this.config;
    if (overrides !== undefined) {
      cfg = {
        ...this.config,
        ...pickOptions(overrides, BURST_OVERRIDE_OPTIONS),
      };
      assertEmitterConfig(cfg);
    }

    this._warnIfNoTransform();
    // Every spawn path syncs the container first, so a particle is never
    // written against a stale origin. A Transform-less emitter keeps the
    // container at (0, 0); its particles never move or expire, because
    // nothing ticks it.
    const origin = this.entity
      ?.tryGet(Transform)
      ?.getWorldPositionInto(this.positionScratch);
    if (origin) this._syncContainer(origin.x, origin.y);
    const { x: originX, y: originY } = this.renderObject.position;
    const x = worldX === undefined ? 0 : worldX - originX;
    const y = worldY === undefined ? 0 : worldY - originY;

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
    this.renderObject.blendMode = mode;
  }

  /** Get the particles' blend mode. */
  get blendMode(): BlendMode {
    return this.renderObject.blendMode;
  }

  /**
   * Show or hide every particle. Emission and particle ageing go on while the
   * emitter is hidden. Written while the entity is dormant, it is remembered
   * and applied when the entity is activated.
   */
  set visible(value: boolean) {
    this._userVisible = value;
    this.applyAppearance();
  }

  /** Get the requested visibility, whatever the entity's activeness. */
  get visible(): boolean {
    return this._userVisible;
  }

  /**
   * Opacity of the whole emitter, multiplied into the opacity each particle
   * gets from the `alpha`, `alphaFadeIn` and `alphaFadeOut` options. Default
   * `1`.
   */
  set alpha(value: number) {
    if (!Number.isFinite(value)) {
      throw new Error(
        `ParticleEmitterComponent.alpha: value must be finite, got ${value}.`,
      );
    }
    this._userAlpha = value;
    this.applyAppearance();
  }

  /** Get the emitter's opacity. */
  get alpha(): number {
    return this._userAlpha;
  }

  /**
   * Draw order among the visuals on the emitter's layer: higher values draw on
   * top. Default `0`. On a layer with `sort` the depth key decides the order,
   * so a non-zero `zIndex` there logs one development warning; see
   * `VisualComponent.zIndex`.
   */
  get zIndex(): number {
    return this._zIndex;
  }

  set zIndex(value: number) {
    if (!Number.isFinite(value)) {
      throw new Error(
        `ParticleEmitterComponent.zIndex: value must be finite, got ${value}.`,
      );
    }
    this._zIndex = value;
    this.renderObject.zIndex = value;
    this.warnIfZIndexIgnored();
  }

  /**
   * Pixels added to the emitter's y position when a layer's depth key reads
   * it: `ySort` keys a torch's sparks at `y + sortOffset`. Default `0`.
   */
  get sortOffset(): number {
    return this._sortOffset;
  }

  set sortOffset(value: number) {
    if (!Number.isFinite(value)) {
      throw new Error(
        `ParticleEmitterComponent.sortOffset: value must be finite, got ${value}.`,
      );
    }
    this._sortOffset = value;
  }

  onAdd(): void {
    const layer = this.use(SceneRenderTreeKey).get(this.config.layer);
    layer.container.addChild(this.renderObject);
    setSortSource(this.renderObject, this);
    this.warnIfZIndexIgnored();
    // A component is never effectively enabled during `onAdd` — `onEnable`
    // runs right after, and only for an active entity.
    this.renderObject.visible = false;
  }

  /** Warn once when the emitter's layer sorts, which ignores `zIndex`. */
  private warnIfZIndexIgnored(): void {
    if (this._zIndex === 0 || this._warnedZIndex || !this.renderObject.parent) {
      return;
    }
    const layer = this.use(SceneRenderTreeKey).tryGet(this.config.layer);
    if (!layer?.sort) return;
    this._warnedZIndex = true;
    devWarn(
      `ParticleEmitterComponent on entity "${this.entity.name}": zIndex ` +
        `${this._zIndex} has no effect on layer "${layer.name}", which has a ` +
        `sort, because the depth key orders the children every frame. Shift ` +
        `the key with sortOffset, or emit on a layer without sort.`,
    );
  }

  /**
   * Hide the live particles. Emission stops on its own — a dormant entity is
   * out of the query `ParticleSystem` iterates — and the pooled particles are
   * kept, so the emitter picks up mid-flight when the entity comes back.
   */
  onDisable(): void {
    this.renderObject.visible = false;
  }

  onEnable(): void {
    this.applyAppearance();
  }

  onDestroy(): void {
    this._destroyed = true;
    for (const request of this._emissionRequests) request.active = false;
    this._emissionRequests.clear();
    this._manualEmission = false;
    setSortSource(this.renderObject, undefined);
    this.renderObject.removeFromParent();
    // No destroy options: the particle texture may be a built-in shape or
    // `Texture.WHITE`, both shared by every other emitter using them.
    this.renderObject.destroy();
  }

  private applyAppearance(): void {
    this.renderObject.alpha = this._userAlpha;
    this.renderObject.visible = this._userVisible && this.effectiveEnabled;
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
    const { alphaFadeIn, alphaFadeOut } = cfg;
    const fades = alphaFadeIn > 0 || alphaFadeOut > 0;
    const active = this._active;
    let i = 0;
    while (i < active.length) {
      const s = active[i]!;
      s.age += dt;

      // Kill expired
      if (s.age >= s.lifetime) {
        this.renderObject.removeParticle(s.particle);
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
      const alpha = s.alphaStart + (s.alphaEnd - s.alphaStart) * t;
      s.particle.alpha = fades
        ? alpha * fadeEnvelope(t, alphaFadeIn, alphaFadeOut)
        : alpha;

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
    const { x, y } = this.renderObject.position;
    const dx = worldX - x;
    const dy = worldY - y;
    if (dx === 0 && dy === 0) return;
    this.renderObject.position.set(worldX, worldY);
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
    particle.alpha =
      alphaStart * fadeEnvelope(0, cfg.alphaFadeIn, cfg.alphaFadeOut);

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

    this.renderObject.addParticle(particle);
  }
}

/**
 * Pick the emitter's texture. The two sources are mutually exclusive in the
 * type, so the order below only matters for callers coming from plain JS:
 * `texture` wins, then `shape`, then the `"pixel"` default.
 */
function resolveSource(
  texture: TextureInput | undefined,
  shape: ParticleShape | ShapeConfig | undefined,
): TextureResource {
  if (texture !== undefined) {
    return resolveTextureInput(texture);
  }
  return shapeTexture(
    normalizeShape(shape ?? "pixel", "ParticleEmitterComponent"),
  );
}

/**
 * The alpha fade envelope at `t`, a particle's age over its lifetime, as a
 * multiplier on whatever `alpha` produces. Each fraction is 0 when its fade is
 * off, and each guard keeps the division away from that case, so a particle at
 * `t === 0` with no fade-in gets 1 rather than `NaN`.
 */
function fadeEnvelope(t: number, fadeIn: number, fadeOut: number): number {
  let envelope = 1;
  if (fadeIn > 0 && t < fadeIn) envelope *= t / fadeIn;
  if (fadeOut > 0 && t > 1 - fadeOut) envelope *= (1 - t) / fadeOut;
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
