import type { Scene } from "@yagejs/core";
import { CameraComponent } from "@yagejs/renderer";

/** Highest-priority enabled camera on an active entity; ties keep the first. */
export function findSceneCamera(scene: Scene): CameraComponent | undefined {
  let selected: CameraComponent | undefined;
  for (const entity of scene.getEntities()) {
    if (!entity.isActive) continue;
    const camera = entity.tryGet(CameraComponent);
    if (camera?.enabled && (!selected || camera.priority > selected.priority))
      selected = camera;
  }
  return selected;
}

/** Scenes are in bottom-to-top order. Callers select which scenes are visible. */
export function findTopmostCamera(
  scenes: readonly Scene[],
): CameraComponent | undefined {
  for (let index = scenes.length - 1; index >= 0; index--) {
    const camera = findSceneCamera(scenes[index]!);
    if (camera) return camera;
  }
  return undefined;
}
