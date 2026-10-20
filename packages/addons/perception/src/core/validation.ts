import type { Vec2Like } from "@yagejs/core";
import type { PerceptionConfig, ResolvedPerceptionConfig } from "./types.js";

export function finite(
  value: number,
  context: string,
  minimum = -Infinity,
  maximum = Infinity,
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(
      `${context}: expected a finite number in [${minimum}, ${maximum}], got ${value}`,
    );
  }
  return value;
}
export function point(value: Vec2Like, context: string): Readonly<Vec2Like> {
  return Object.freeze({
    x: finite(value.x, `${context}.x`),
    y: finite(value.y, `${context}.y`),
  });
}
export function identifier(id: string, context: string): void {
  if (typeof id !== "string" || id.length === 0)
    throw new Error(`${context}: expected a nonempty id, got ${id}`);
}
export function resolveConfig(
  config: PerceptionConfig,
): ResolvedPerceptionConfig {
  const range = finite(config.range ?? 256, "PerceptionSensor.range", 0);
  const visibilityThreshold = finite(
    config.visibilityThreshold ?? 0.01,
    "PerceptionSensor.visibilityThreshold",
    0,
    1,
  );
  if (visibilityThreshold === 0)
    throw new Error(
      "PerceptionSensor.visibilityThreshold: expected > 0, got 0",
    );
  return Object.freeze({
    range,
    loseRange: finite(
      config.loseRange ?? range,
      "PerceptionSensor.loseRange",
      range,
    ),
    fieldOfView: finite(
      config.fieldOfView ?? Math.PI * 2,
      "PerceptionSensor.fieldOfView",
      0,
      Math.PI * 2,
    ),
    memoryDuration: finite(
      config.memoryDuration ?? 3,
      "PerceptionSensor.memoryDuration",
      0,
    ),
    visibilityThreshold,
  });
}
