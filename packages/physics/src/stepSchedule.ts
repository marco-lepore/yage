import { SceneTimeKey } from "@yagejs/core";
import type { Scene } from "@yagejs/core";

/**
 * The most physics steps a scene runs per fixed update. Above this time
 * scale, physics advances this many steps per update, more slowly than the
 * scene clock that component updates receive.
 */
export const MAX_PHYSICS_STEPS_PER_UPDATE = 8;

/**
 * The scene's effective time scale: the persistent `scene.timeScale` composed
 * with active freeze and slow-motion requests.
 */
export function sceneTimeScale(scene: Scene): number {
  return (
    scene.tryResolveScoped(SceneTimeKey)?.effectiveScale ?? scene.timeScale
  );
}

/**
 * Scene time a world has to simulate once an update adds its share: the
 * `remainder` earlier updates left, plus `dt` at `timeScale`, capped at the
 * steps one update may run at that scale.
 */
export function pendingPhysicsTime(
  remainder: number,
  dt: number,
  timeScale: number,
): number {
  const maxSteps = Math.min(
    Math.ceil(timeScale) + 1,
    MAX_PHYSICS_STEPS_PER_UPDATE,
  );
  return Math.min(remainder + dt * timeScale, dt * maxSteps);
}
