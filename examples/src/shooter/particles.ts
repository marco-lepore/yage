import { Transform, Vec2, ProcessComponent, Process } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";

// ---------------------------------------------------------------------------
// Particle spawning helpers
// ---------------------------------------------------------------------------
export function spawnParticles(
  scene: Scene,
  x: number,
  y: number,
  count: number,
  color: number,
  spreadDeg: number,
  baseAngle: number,
  speedMin: number,
  speedMax: number,
  lifetimeMin: number,
  lifetimeMax: number,
  size: number,
): void {
  const spreadRad = (spreadDeg * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (Math.random() - 0.5) * spreadRad;
    const speed = speedMin + Math.random() * (speedMax - speedMin);
    const lt = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin);
    const vel = Vec2.fromAngle(angle, speed);

    const p = scene.spawn("particle");
    p.add(new Transform({ position: new Vec2(x, y) }));
    p.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.circle(0, 0, size).fill({ color });
      }),
    );
    const transform = p.get(Transform);
    const gfx = p.get(GraphicsComponent);
    const pc = p.add(new ProcessComponent());
    pc.run(
      new Process({
        duration: lt,
        update: (dt, elapsed) => {
          transform.translate(vel.x * dt, vel.y * dt);
          gfx.graphics.alpha = 1 - elapsed / lt;
        },
        onComplete: () => {
          p.destroy();
        },
      }),
    );
  }
}

export function spawnBulletImpactParticles(
  scene: Scene,
  x: number,
  y: number,
  normalAngle: number,
): void {
  spawnParticles(
    scene,
    x,
    y,
    3 + Math.floor(Math.random() * 3), // 3-5
    0x38bdf8,
    90,
    normalAngle,
    80,
    150,
    0.2,
    0.35,
    2,
  );
}

export function spawnEnemyHitParticles(scene: Scene, x: number, y: number): void {
  spawnParticles(
    scene,
    x,
    y,
    4 + Math.floor(Math.random() * 3), // 4-6
    0xef4444,
    120,
    Math.PI, // spread from left (arbitrary)
    60,
    120,
    0.25,
    0.4,
    2.5,
  );
}

export function spawnEnemyDeathParticles(
  scene: Scene,
  x: number,
  y: number,
  color: number,
): void {
  spawnParticles(
    scene,
    x,
    y,
    8 + Math.floor(Math.random() * 5), // 8-12
    color,
    360,
    0,
    50,
    200,
    0.3,
    0.5,
    3,
  );
}
