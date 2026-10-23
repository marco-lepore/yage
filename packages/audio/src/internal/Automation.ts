import type { AudioAutomationOptions } from "../types.js";
import { assertTime } from "./validation.js";

export function automationTiming(
  context: string,
  now: number,
  options: AudioAutomationOptions = {},
): { at: number; duration: number; curve: "linear" | "exponential" } {
  const at = options.at ?? now;
  const duration = options.duration ?? 0;
  assertTime(`${context}.at`, at);
  assertTime(`${context}.duration`, duration);
  assertTime(`${context}.end`, at + duration);
  return { at: Math.max(at, now), duration, curve: options.curve ?? "linear" };
}
