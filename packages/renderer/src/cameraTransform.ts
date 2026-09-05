import { Vec2Buffer } from "@yagejs/core";
import type { DisplayContainer } from "./public-types.js";
import type { CameraBinding, CameraComponent } from "./CameraComponent.js";

const positionScratch = new Vec2Buffer();

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
  const position = camera.getEffectivePositionInto(positionScratch);
  const translationScale = scale * (binding?.translateRatio ?? 1);
  const x = position.x * translationScale;
  const y = position.y * translationScale;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  target.position.set(
    camera.viewportWidth / 2 - (x * cos - y * sin),
    camera.viewportHeight / 2 - (x * sin + y * cos),
  );
  target.scale.set(scale);
  target.rotation = -rotation;
}
