import type { DisplayContainer } from "./public-types.js";
import type { CameraBinding, CameraComponent } from "./CameraComponent.js";

/** Apply a camera's effective pose. Without a camera, restore identity. */
export function syncCameraTransform(
  target: DisplayContainer,
  camera?: CameraComponent,
  binding?: CameraBinding,
): void {
  if (!camera) {
    target.position.set(0, 0);
    target.scale.set(1, 1);
    target.rotation = 0;
    return;
  }
  const scale = 1 + (camera.effectiveZoom - 1) * (binding?.scaleRatio ?? 1);
  const rotation = camera.effectiveRotation * (binding?.rotateRatio ?? 1);
  const translated = camera.effectivePosition
    .scale(scale * (binding?.translateRatio ?? 1))
    .rotate(-rotation);
  target.position.set(
    camera.viewportWidth / 2 - translated.x,
    camera.viewportHeight / 2 - translated.y,
  );
  target.scale.set(scale);
  target.rotation = -rotation;
}
