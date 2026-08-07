import type { TilesetData } from "./types.js";

/** A tile animation in the form the renderer can play. */
export interface TileAnimation {
  /**
   * Tile id of the first frame. The renderer steps the texture coordinate
   * forward from whatever image the tile is drawn with, so the cycle has to
   * start on this frame's image — which Tiled does not require to be the tile
   * the animation is authored on.
   */
  firstFrameId: number;
  /** Pixel stride between consecutive frames in the tileset image. */
  strideX: number;
  strideY: number;
  frameCount: number;
  /** How long one frame is shown, in milliseconds. */
  frameDurationMs: number;
}

export type TileAnimationSupport =
  | { supported: true; animation: TileAnimation }
  | { supported: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatValues(values: unknown[]): string {
  return values.map((value) => String(value)).join(", ");
}

/**
 * The animation authored on a tile, and whether the renderer can play it.
 * Returns `null` when the tile has no animation, or fewer than two frames.
 */
export function readTileAnimation(
  tileset: TilesetData,
  localId: number,
): TileAnimationSupport | null {
  const tiles = tileset.tiles;
  if (!Array.isArray(tiles)) return null;

  const tile = tiles.find(
    (entry) => isRecord(entry) && entry.id === localId,
  ) as Record<string, unknown> | undefined;
  if (!tile || !Array.isArray(tile.animation) || tile.animation.length < 2) {
    return null;
  }

  const frames = tile.animation;
  if (typeof tileset.image !== "string" || tileset.image.length === 0) {
    return {
      supported: false,
      reason: "Each tile is stored in a separate image.",
    };
  }

  const durations = frames.map((frame) =>
    isRecord(frame) ? frame.duration : undefined,
  );
  if (
    durations.some(
      (duration) =>
        typeof duration !== "number" ||
        !Number.isFinite(duration) ||
        duration <= 0,
    )
  ) {
    return {
      supported: false,
      reason: `Frame durations must be positive numbers (${formatValues(durations)} ms).`,
    };
  }

  const firstDuration = durations[0];
  if (
    typeof firstDuration !== "number" ||
    durations.some((duration) => duration !== firstDuration)
  ) {
    return {
      supported: false,
      reason: `Frame durations differ (${formatValues(durations)} ms).`,
    };
  }

  const frameIds = frames.map((frame) =>
    isRecord(frame) ? frame.tileid : undefined,
  );
  for (const frameId of frameIds) {
    if (
      typeof frameId !== "number" ||
      !Number.isInteger(frameId) ||
      frameId < 0 ||
      frameId >= tileset.tilecount
    ) {
      return {
        supported: false,
        reason: `Frame tile id ${String(frameId)} is outside this tileset.`,
      };
    }
  }

  const columns = tileset.columns;
  const tileWidth = tileset.tilewidth;
  const tileHeight = tileset.tileheight;
  const margin = tileset.margin ?? 0;
  const spacing = tileset.spacing ?? 0;
  if (
    !Number.isInteger(columns) ||
    columns <= 0 ||
    !Number.isFinite(tileWidth) ||
    !Number.isFinite(tileHeight) ||
    !Number.isFinite(margin) ||
    !Number.isFinite(spacing)
  ) {
    return {
      supported: false,
      reason: "The tileset grid does not have usable dimensions.",
    };
  }

  const positions = frameIds.map((frameId) => {
    const id = frameId as number;
    const col = id % columns;
    const row = Math.floor(id / columns);
    return {
      x: margin + col * (tileWidth + spacing),
      y: margin + row * (tileHeight + spacing),
    };
  });
  // Two frames minimum, checked above, so every index below is populated.
  const first = positions[0]!;
  const second = positions[1]!;

  const strideX = second.x - first.x;
  const strideY = second.y - first.y;
  for (let index = 2; index < positions.length; index++) {
    const previous = positions[index - 1]!;
    const current = positions[index]!;
    const currentStrideX = current.x - previous.x;
    const currentStrideY = current.y - previous.y;
    if (currentStrideX !== strideX || currentStrideY !== strideY) {
      return {
        supported: false,
        reason: `Frame stride varies: expected (${strideX}, ${strideY}), found (${currentStrideX}, ${currentStrideY}).`,
      };
    }
  }

  if (strideX < 0 || strideY < 0) {
    return {
      supported: false,
      reason: `Frame stride cannot be negative (${strideX}, ${strideY}).`,
    };
  }
  if (strideX >= 2048 || strideY >= 2048) {
    return {
      supported: false,
      reason: `Frame stride must stay below 2048 pixels (${strideX}, ${strideY}).`,
    };
  }

  return {
    supported: true,
    animation: {
      firstFrameId: frameIds[0] as number,
      strideX,
      strideY,
      frameCount: frames.length,
      frameDurationMs: firstDuration,
    },
  };
}
