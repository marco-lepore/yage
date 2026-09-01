import { Component, Transform } from "@yagejs/core";
import type { Vec2 } from "@yagejs/core";
import type { LightingWorld } from "./LightingWorld.js";
import { LightingWorldKey } from "./types.js";
import type { LightOccluderShape } from "./types.js";
import { assertPositive } from "./validation.js";

/** Options accepted by {@link LightOccluder}. */
export interface LightOccluderOptions {
  /** Renderer-neutral occluder geometry in local pixels. */
  shape: LightOccluderShape;
  /** Whether the occluder starts enabled. Default `true`. */
  enabled?: boolean;
}

/**
 * Renderer-neutral shadow geometry centred on its entity's `Transform`.
 *
 * The built-in overlay renderer does not cast shadows. Custom renderers
 * can read registered occluders from `LightingWorld.occluders`.
 */
export class LightOccluder extends Component {
  private readonly transform = this.sibling(Transform);
  private world: LightingWorld | undefined;
  readonly shape: LightOccluderShape;

  constructor(options: LightOccluderOptions) {
    super();
    validateShape(options.shape);
    this.shape = cloneShape(options.shape);
    this.enabled = options.enabled ?? true;
  }

  /** Current world-space centre. */
  get position(): Vec2 {
    return this.transform.worldPosition;
  }

  /** Current world rotation in radians. */
  get rotation(): number {
    return this.transform.worldRotation;
  }

  onEnable(): void {
    this.world ??= this.use(LightingWorldKey);
    this.world.registerOccluder(this);
  }

  onDisable(): void {
    this.world?.unregisterOccluder(this);
  }

  onDestroy(): void {
    this.world?.unregisterOccluder(this);
    this.world = undefined;
  }
}

function validateShape(shape: LightOccluderShape): void {
  switch (shape.type) {
    case "circle":
      assertPositive(shape.radius, "LightOccluder circle radius");
      break;
    case "box":
      assertPositive(shape.width, "LightOccluder box width");
      assertPositive(shape.height, "LightOccluder box height");
      break;
    case "polygon":
      if (shape.vertices.length < 3) {
        throw new RangeError(
          "LightOccluder polygon needs at least 3 vertices.",
        );
      }
      for (const vertex of shape.vertices) {
        if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
          throw new RangeError(
            "LightOccluder polygon vertices must be finite.",
          );
        }
      }
      break;
  }
}

function cloneShape(shape: LightOccluderShape): LightOccluderShape {
  if (shape.type !== "polygon") return { ...shape };
  return {
    type: "polygon",
    vertices: shape.vertices.map((vertex) => ({
      x: vertex.x,
      y: vertex.y,
    })),
  };
}
