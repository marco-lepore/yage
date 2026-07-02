/**
 * Pure config normalization + geometry resolution. Normalization applies
 * identity/behavior defaults once (and validates); layout resolution turns
 * placements and size fractions into virtual-px geometry for a given
 * viewport, and re-runs whenever the viewport changes.
 */

import type {
  ButtonLayout,
  ControlPlacement,
  ControlZone,
  Point,
  ResolvedButtonConfig,
  ResolvedStickConfig,
  StickLayout,
  ViewportRect,
  VirtualControlsConfig,
} from "./types.js";

/** Default stick radius as a fraction of min(viewport width, height). */
export const DEFAULT_STICK_RADIUS_FRACTION = 0.11;
/** Default button radius as a fraction of min(viewport width, height). */
export const DEFAULT_BUTTON_RADIUS_FRACTION = 0.065;
/** Resting stick center inset from the corner, in stick radii. */
const STICK_ANCHOR_INSET = 1.6;
/** Center-to-center spacing of auto-clustered buttons, in button radii. */
const CLUSTER_SPACING = 2.5;
/** Cluster anchor inset from the corner: this many radii + the slot extent. */
const CLUSTER_BASE_INSET = 1.4;

/** Default engagement zone (viewport fractions) for a floating/follow stick. */
const DEFAULT_STICK_ZONE: Record<"left" | "right", ControlZone> = {
  left: { x: 0, y: 0.3, width: 0.5, height: 0.7 },
  right: { x: 0.5, y: 0.3, width: 0.5, height: 0.7 },
};

export interface NormalizedControlsConfig {
  readonly sticks: readonly ResolvedStickConfig[];
  readonly buttons: readonly ResolvedButtonConfig[];
  readonly cluster: ControlPlacement | undefined;
}

/**
 * Apply identity/behavior defaults and validate. Throws on config errors
 * (duplicate ids, malformed placements, conflicting axes) — these are
 * programming mistakes, surfaced at construction rather than mid-gesture.
 */
export function normalizeControlsConfig(
  config: VirtualControlsConfig,
): NormalizedControlsConfig {
  if (config.stick && config.sticks) {
    throw new Error(
      "VirtualControls: set either `stick` or `sticks`, not both.",
    );
  }
  const stickConfigs = config.sticks ?? (config.stick ? [config.stick] : []);

  const takenAxes = new Set<"left" | "right">();
  for (const s of stickConfigs) {
    if (s.axes) takenAxes.add(s.axes);
  }

  const sticks: ResolvedStickConfig[] = [];
  const stickIds = new Set<string>();
  for (const [index, s] of stickConfigs.entries()) {
    let axes: "left" | "right" | false;
    if (s.axes !== undefined) {
      axes = s.axes;
    } else {
      // Prefer the conventional side for the index, else the free one.
      const preferred: "left" | "right" = index === 0 ? "left" : "right";
      const other: "left" | "right" = preferred === "left" ? "right" : "left";
      axes = !takenAxes.has(preferred)
        ? preferred
        : !takenAxes.has(other)
          ? other
          : false;
      if (axes) takenAxes.add(axes);
    }
    const side: "left" | "right" =
      axes !== false ? axes : index === 0 ? "left" : "right";
    const id = s.id ?? (index === 0 ? "left" : index === 1 ? "right" : `stick-${index}`);
    if (stickIds.has(id)) {
      throw new Error(`VirtualControls: duplicate stick id "${id}".`);
    }
    stickIds.add(id);
    if (s.placement) validatePlacement(s.placement, `stick "${id}"`);
    if (s.radius !== undefined && s.radius <= 0) {
      throw new Error(`VirtualControls: stick "${id}" radius must be > 0.`);
    }
    const deadZone = s.deadZone ?? 0.1;
    if (deadZone < 0 || deadZone >= 1) {
      throw new Error(
        `VirtualControls: stick "${id}" deadZone must be in [0, 1).`,
      );
    }
    const threshold = s.threshold ?? 0.5;
    if (threshold <= 0 || threshold > 1) {
      throw new Error(
        `VirtualControls: stick "${id}" threshold must be in (0, 1].`,
      );
    }
    sticks.push({
      id,
      mode: s.mode ?? "floating",
      placement: s.placement,
      radius: s.radius,
      deadZone,
      actions: s.actions ?? {},
      threshold,
      axes,
      zone: s.zone,
      side,
    });
  }

  // Explicit-axes duplicates are a config error (two sticks feeding leftX).
  const explicitAxes = stickConfigs
    .map((s) => s.axes)
    .filter((a): a is "left" | "right" => a === "left" || a === "right");
  if (new Set(explicitAxes).size !== explicitAxes.length) {
    throw new Error(
      "VirtualControls: two sticks mirror the same gamepad axes side.",
    );
  }

  const buttons: ResolvedButtonConfig[] = [];
  const buttonIds = new Set<string>();
  for (const b of config.buttons ?? []) {
    if (!b.id) {
      throw new Error("VirtualControls: every button needs a non-empty id.");
    }
    if (buttonIds.has(b.id)) {
      throw new Error(`VirtualControls: duplicate button id "${b.id}".`);
    }
    buttonIds.add(b.id);
    if (b.placement) validatePlacement(b.placement, `button "${b.id}"`);
    if (b.radius !== undefined && b.radius <= 0) {
      throw new Error(
        `VirtualControls: button "${b.id}" radius must be > 0.`,
      );
    }
    buttons.push({
      id: b.id,
      action: b.action,
      label: b.label ?? b.id.toUpperCase(),
      placement: b.placement,
      radius: b.radius,
      pressOnEnter: b.pressOnEnter ?? false,
      releaseOnLeave: b.releaseOnLeave ?? true,
    });
  }

  if (config.cluster) validatePlacement(config.cluster, "cluster");

  return { sticks, buttons, cluster: config.cluster };
}

function validatePlacement(p: ControlPlacement, what: string): void {
  const horizontal = (p.left !== undefined ? 1 : 0) + (p.right !== undefined ? 1 : 0);
  const vertical = (p.top !== undefined ? 1 : 0) + (p.bottom !== undefined ? 1 : 0);
  if (horizontal !== 1 || vertical !== 1) {
    throw new Error(
      `VirtualControls: placement for ${what} needs exactly one of left/right and one of top/bottom.`,
    );
  }
}

/** Resolve an edge-relative placement to an absolute center point. */
export function resolvePlacement(p: ControlPlacement, vp: ViewportRect): Point {
  const x =
    p.left !== undefined ? vp.x + p.left : vp.x + vp.width - (p.right ?? 0);
  const y =
    p.top !== undefined ? vp.y + p.top : vp.y + vp.height - (p.bottom ?? 0);
  return { x, y };
}

function zoneToRect(zone: ControlZone, vp: ViewportRect): ViewportRect {
  return {
    x: vp.x + zone.x * vp.width,
    y: vp.y + zone.y * vp.height,
    width: zone.width * vp.width,
    height: zone.height * vp.height,
  };
}

export function resolveStickLayout(
  cfg: ResolvedStickConfig,
  vp: ViewportRect,
): StickLayout {
  const minSide = Math.min(vp.width, vp.height);
  // Floor of 1: a transiently collapsed viewport must not produce a zero
  // radius (deflection divides by it).
  const radius =
    cfg.radius ??
    Math.max(1, Math.round(minSide * DEFAULT_STICK_RADIUS_FRACTION));
  const inset = radius * STICK_ANCHOR_INSET;
  const placement: ControlPlacement =
    cfg.placement ??
    (cfg.side === "left"
      ? { left: inset, bottom: inset }
      : { right: inset, bottom: inset });
  const center = resolvePlacement(placement, vp);
  const zone = cfg.zone
    ? zoneToRect(cfg.zone, vp)
    : cfg.mode === "fixed"
      ? undefined
      : zoneToRect(DEFAULT_STICK_ZONE[cfg.side], vp);
  return { center, radius, zone };
}

/**
 * Slot offsets for the auto-placed cluster, in spacing units around the
 * anchor (+x right, +y down). 1 = on the anchor; 2 = diagonal pair with the
 * primary toward the corner; 3 = corner-hugging arc (primary at the corner,
 * the others fanning left and up); 4 = A/B/X/Y diamond (bottom, right,
 * left, top); anything else fans out in a ring.
 */
function clusterSlots(count: number): readonly (readonly [number, number])[] {
  switch (count) {
    case 1:
      return [[0, 0]];
    case 2:
      return [
        [0.45, 0.45],
        [-0.45, -0.45],
      ];
    case 3:
      return [
        [0.55, 0.55],
        [-0.7, 0.1],
        [0.1, -0.7],
      ];
    case 4:
      return [
        [0, 0.9],
        [0.9, 0],
        [-0.9, 0],
        [0, -0.9],
      ];
    default: {
      const slots: [number, number][] = [];
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
        slots.push([Math.cos(angle), Math.sin(angle)]);
      }
      return slots;
    }
  }
}

/**
 * Resolve button geometry, order-aligned with `buttons`. Buttons without an
 * explicit placement are arranged around the cluster anchor.
 */
export function resolveButtonLayouts(
  buttons: readonly ResolvedButtonConfig[],
  cluster: ControlPlacement | undefined,
  vp: ViewportRect,
): ButtonLayout[] {
  const minSide = Math.min(vp.width, vp.height);
  const defaultRadius = Math.max(
    1,
    Math.round(minSide * DEFAULT_BUTTON_RADIUS_FRACTION),
  );

  const auto = buttons.filter((b) => !b.placement);
  const slots = clusterSlots(auto.length);
  let maxAutoRadius = 0;
  for (const b of auto) {
    maxAutoRadius = Math.max(maxAutoRadius, b.radius ?? defaultRadius);
  }
  const spacing = CLUSTER_SPACING * maxAutoRadius;
  let maxExtent = 0;
  for (const [sx, sy] of slots) {
    maxExtent = Math.max(maxExtent, Math.abs(sx), Math.abs(sy));
  }
  const clusterInset = maxAutoRadius * CLUSTER_BASE_INSET + spacing * maxExtent;
  const anchor = resolvePlacement(
    cluster ?? { right: clusterInset, bottom: clusterInset },
    vp,
  );

  let autoIndex = 0;
  return buttons.map((b) => {
    const radius = b.radius ?? defaultRadius;
    if (b.placement) {
      return { center: resolvePlacement(b.placement, vp), radius };
    }
    const slot = slots[autoIndex++] ?? [0, 0];
    return {
      center: {
        x: anchor.x + slot[0] * spacing,
        y: anchor.y + slot[1] * spacing,
      },
      radius,
    };
  });
}
