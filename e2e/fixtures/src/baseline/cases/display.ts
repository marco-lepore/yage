import { Entity, Transform, Vec2 } from "@yagejs/core";
import { RendererKey } from "@yagejs/renderer";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

/** What the display case reports. */
export interface DisplayReading extends CaseReading {
  fullscreenSupport: string;
  isFullscreen: boolean;
  orientation: string | null;
  orientationLockSupport: string;
  canvasSize: { width: number; height: number };
  resolution: number;
  rendererName: string;
  glVersion: string | null;
}

/** Reads what the renderer says about the screen it drew on. */
export class DisplayProbe extends CaseProbe {
  private readonly renderer = this.service(RendererKey);

  get settled(): boolean {
    return true;
  }

  reading(): DisplayReading {
    const pixi = this.renderer.application.renderer;
    return {
      fullscreenSupport: this.renderer.fullscreenSupport,
      isFullscreen: this.renderer.isFullscreen,
      orientation: this.renderer.orientation,
      orientationLockSupport: this.renderer.orientationLockSupport,
      canvasSize: { ...this.renderer.canvasSize },
      resolution: pixi.resolution,
      rendererName: pixi.name,
      glVersion: readGlVersion(pixi),
    };
  }
}

/**
 * The graphics API version the page actually got, which only a WebGL context
 * reports. A WebGPU run reads `null`.
 */
function readGlVersion(pixi: unknown): string | null {
  const gl = (pixi as { gl?: { getParameter(name: number): string } }).gl;
  const constants = gl as unknown as { VERSION?: number } | undefined;
  if (!gl || constants?.VERSION === undefined) return null;
  return gl.getParameter(constants.VERSION);
}

/** The renderer's view of fullscreen, orientation and canvas size. */
export class DisplayCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(40, 180) }));
    this.add(new DisplayProbe());
  }
}
