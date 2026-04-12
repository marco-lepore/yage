import { ServiceKey } from "@yage/core";

/**
 * Minimal subset of PixiJS Graphics used by debug drawing.
 * Avoids a runtime pixi.js dependency in the ./api subpath.
 */
export interface DebugGraphics {
  position: { x: number; y: number };
  rotation: number;
  visible: boolean;
  clear(): DebugGraphics;
  rect(x: number, y: number, width: number, height: number): DebugGraphics;
  circle(x: number, y: number, radius: number): DebugGraphics;
  moveTo(x: number, y: number): DebugGraphics;
  lineTo(x: number, y: number): DebugGraphics;
  stroke(style: { width: number; color: number; alpha?: number }): DebugGraphics;
  fill(style: { color: number; alpha?: number }): DebugGraphics;
}

/** Camera-space drawing API passed to contributors. */
export interface WorldDebugApi {
  acquireGraphics(): DebugGraphics | undefined;
  isFlagEnabled(flag: string): boolean;
  readonly cameraZoom: number;
}

/** Screen-space HUD API passed to contributors. */
export interface HudDebugApi {
  addLine(text: string): void;
  isFlagEnabled(flag: string): boolean;
  readonly screenWidth: number;
  readonly screenHeight: number;
}

/** Rolling-window statistics collector. */
export interface StatsApi {
  push(key: string, value: number): void;
  average(key: string): number;
  latest(key: string): number;
  min(key: string): number;
  max(key: string): number;
}

/** A debug contributor that registers drawing/sampling callbacks. */
export interface DebugContributor {
  readonly name: string;
  readonly flags: readonly string[];
  drawWorld?(api: WorldDebugApi): void;
  drawHud?(api: HudDebugApi): void;
  sample?(stats: StatsApi, dt: number): void;
  dispose?(): void;
}

/** Service interface for the debug registry. */
export interface DebugRegistry {
  register(contributor: DebugContributor): void;
  isEnabled(): boolean;
  isFlagEnabled(contributorName: string, flag: string): boolean;
}

/** Service key for resolving the DebugRegistry via DI. */
export const DebugRegistryKey = new ServiceKey<DebugRegistry>("debugRegistry");
