import { Component, RandomKey, Transform, type Scene } from "@yagejs/core";
import {
  ParticleEmitterComponent,
  type EmitterConfig,
} from "@yagejs/particles";

/** Persistent pooled emitters for the scene's combat effects. */
export class VfxHub extends Component {
  private readonly random = this.service(RandomKey);
  constructor(
    private readonly rightImpact: ParticleEmitterComponent,
    private readonly leftImpact: ParticleEmitterComponent,
    private readonly hit: ParticleEmitterComponent,
    private readonly death: ParticleEmitterComponent,
  ) {
    super();
  }

  bulletImpact(x: number, y: number, direction: number): void {
    const emitter = direction > 0 ? this.rightImpact : this.leftImpact;
    emitter.burst(this.random.int(3, 5), x, y);
  }

  enemyHit(x: number, y: number): void {
    this.hit.burst(this.random.int(4, 6), x, y);
  }

  enemyDeath(x: number, y: number): void {
    this.death.burst(this.random.int(8, 12), x, y);
  }
}

export function createVfxHub(scene: Scene): VfxHub {
  const emitter = (
    name: string,
    config: EmitterConfig,
  ): ParticleEmitterComponent => {
    const host = scene.spawn(name);
    host.add(new Transform());
    return host.add(new ParticleEmitterComponent(config));
  };
  const common = {
    maxParticles: 128,
    rate: 0,
    simulationSpace: "world",
    layer: "world",
    alpha: { start: 1, end: 0 },
  } as const;
  const impact = {
    ...common,
    shape: { type: "circle", size: 4 },
    speed: [80, 150],
    lifetime: [0.2, 0.35],
    tint: 0x38bdf8,
  } satisfies EmitterConfig;
  const rightImpact = emitter("vfx-impact-right", {
    ...impact,
    angle: [-Math.PI / 4, Math.PI / 4],
  });
  return rightImpact.entity.add(
    new VfxHub(
      rightImpact,
      emitter("vfx-impact-left", {
        ...impact,
        angle: [(3 * Math.PI) / 4, (5 * Math.PI) / 4],
      }),
      emitter("vfx-enemy-hit", {
        ...common,
        shape: { type: "circle", size: 5 },
        angle: [(2 * Math.PI) / 3, (4 * Math.PI) / 3],
        speed: [60, 120],
        lifetime: [0.25, 0.4],
        tint: 0xef4444,
      }),
      emitter("vfx-enemy-death", {
        ...common,
        shape: { type: "circle", size: 6 },
        angle: [0, 2 * Math.PI],
        speed: [50, 200],
        lifetime: [0.3, 0.5],
        tint: 0xe11d48,
      }),
    ),
  );
}
