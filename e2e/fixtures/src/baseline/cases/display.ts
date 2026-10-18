import { Entity, Transform, Vec2 } from "@yagejs/core";
import { RendererKey } from "@yagejs/renderer";
import type { GraphicsCapabilities } from "@yagejs/renderer";
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
  graphics: GraphicsCapabilities;
  contextLost: boolean;
  /** Every `screen:fullscreen` payload the page has seen, oldest first. */
  fullscreenEvents: boolean[];
}

/** Reads what the renderer says about the screen it drew on. */
export class DisplayProbe extends CaseProbe {
  private readonly renderer = this.service(RendererKey);
  private readonly fullscreenEvents: boolean[] = [];

  onAdd(): void {
    this.listenBus("screen:fullscreen", ({ active }) => {
      this.fullscreenEvents.push(active);
    });
  }

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
      graphics: {
        ...this.renderer.capabilities,
        rgba16float: { ...this.renderer.capabilities.rgba16float },
        rgba32float: { ...this.renderer.capabilities.rgba32float },
      },
      contextLost: this.renderer.contextLost,
      fullscreenEvents: [...this.fullscreenEvents],
    };
  }
}

/** The renderer's view of fullscreen, orientation and canvas size. */
export class DisplayCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(40, 180) }));
    this.add(new DisplayProbe());
  }
}
