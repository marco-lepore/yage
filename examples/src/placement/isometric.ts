import type { DrawContext } from "@yagejs/renderer";
import type {
  PlacedObject,
  PlacementModel,
  PlacementPose,
  PlacementSession,
  PlacementSnapshot,
  PlacementPointerProjection,
} from "@yagejs-addons/placement";
import type { Finish, FurnitureType } from "./content.js";

type Point = Readonly<{ x: number; y: number }>;
interface Face {
  points: Point[];
  color: number;
  depth: number;
}
const cosine = Math.sqrt(3) / 2;
const origin = { x: 536, y: 128 };
export const isoBounds = { x: 0, y: 0, width: 320, height: 320 };
export const tableHeight = 40;

/** A floor coordinate projects along the two visible room edges. Height rises vertically. */
export function isoPoint(x: number, y: number, height = 0): Point {
  return { x: (x - y) * cosine, y: (x + y) / 2 - height };
}
export function isoScreen(point: Point, height = 0): Point {
  const projected = isoPoint(point.x, point.y, height);
  return { x: origin.x + projected.x, y: origin.y + projected.y };
}
export function isoFloor(point: PlacementPose): PlacementPose {
  const x = (point.x - origin.x) / cosine;
  const y = point.y - origin.y;
  return { x: y + x / 2, y: y - x / 2, rotation: point.rotation };
}
function rotate(point: Point, angle: number): Point {
  return {
    x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
  };
}
function shade(color: number, amount: number): number {
  return [16, 8, 0].reduce(
    (sum, shift) =>
      sum + (Math.round(((color >> shift) & 255) * amount) << shift),
    0,
  );
}

/** Faces supply both drawing and picking, so raised artwork remains clickable. */
export function isoFaces(
  type: FurnitureType,
  finish: Finish,
  rotation = 0,
): Face[] {
  const parts: { bottom: number; depth: number; faces: Face[] }[] = [];
  const wood = { oak: 0xc89560, teal: 0x66b8ac, rose: 0xd9969e }[finish];
  const box = (
    x: number,
    y: number,
    w: number,
    d: number,
    z: number,
    h: number,
    color: number,
  ): void => {
    const faces: Face[] = [];
    const corners = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + d },
      { x, y: y + d },
    ].map((p) => rotate(p, rotation));
    const add = (
      points: { x: number; y: number; z: number }[],
      tint: number,
    ): void => {
      faces.push({
        points: points.map((p) => isoPoint(p.x, p.y, p.z)),
        color: tint,
        depth:
          points.reduce((sum, p) => sum + p.x + p.y + p.z, 0) / points.length,
      });
    };
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!,
        b = corners[(i + 1) % 4]!;
      const normalX = b.y - a.y,
        normalY = a.x - b.x;
      if (normalX + normalY <= 1e-7) continue;
      add(
        [
          { ...a, z },
          { ...b, z },
          { ...b, z: z + h },
          { ...a, z: z + h },
        ],
        shade(color, normalX > normalY ? 0.72 : 0.86),
      );
    }
    add(
      corners.map((p) => ({ ...p, z: z + h })),
      color,
    );
    const center = rotate({ x: x + w / 2, y: y + d / 2 }, rotation);
    parts.push({ bottom: z, depth: center.x + center.y, faces });
  };
  if (type === "table") {
    for (const x of [-43, 35])
      for (const y of [-23, 15]) box(x, y, 8, 8, 0, tableHeight - 6, wood);
    box(-48, -28, 96, 56, tableHeight - 6, 6, wood);
  } else if (type === "chair") {
    for (const x of [-17, 11])
      for (const y of [-17, 11]) box(x, y, 6, 6, 0, 20, wood);
    box(-20, -22, 40, 44, 20, 6, wood);
    box(-20, -22, 40, 7, 26, 26, wood);
    box(-20, -10, 5, 30, 26, 8, wood);
    box(15, -10, 5, 30, 26, 8, wood);
  } else if (type === "lamp") {
    box(-8, -8, 16, 16, 0, 3, 0x97744f);
    box(-2, -2, 4, 4, 3, 22, 0x97744f);
    box(-10, -10, 20, 20, 25, 13, 0xf3d391);
  } else if (type === "plant") {
    box(-9, -9, 18, 18, 0, 16, 0xbd805e);
    box(-2, -2, 4, 4, 16, 13, 0x458367);
    box(-13, -8, 15, 14, 20, 7, 0x72a887);
    box(0, -6, 14, 14, 24, 8, 0x458367);
    box(-7, -12, 12, 13, 30, 7, 0x8abd8c);
  }
  // Upper parts cover the tops of their supports, including legs under a tabletop.
  return parts
    .sort((a, b) => a.bottom - b.bottom || a.depth - b.depth)
    .flatMap((part) => part.faces.sort((a, b) => a.depth - b.depth));
}
export function drawIsoFurniture(
  g: DrawContext,
  type: FurnitureType,
  finish: Finish,
  rotation = 0,
): void {
  g.clear();
  for (const face of isoFaces(type, finish, rotation))
    g.poly(face.points.flatMap((p) => [p.x, p.y]))
      .fill(face.color)
      .stroke({ color: 0x534336, alpha: 0.65, width: 1 });
}
export function isoArtBounds(type: FurnitureType): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const points = isoFaces(type, "oak").flatMap((face) => face.points);
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
export function isoPresentation(
  item: PlacedObject,
  snapshot: PlacementSnapshot,
  model: PlacementModel,
): {
  position: Point;
  height: number;
  depth: number;
} {
  let root = item,
    height = 0,
    level = 0;
  while (root.attachment) {
    const parent = snapshot.objects.find(
      (o) => o.id === root.attachment!.parent,
    )!;
    if (parent.type === "table" && root.attachment.socket === "top")
      height += tableHeight;
    level++;
    root = parent;
  }
  const base = model.worldPose(root.id, snapshot);
  return {
    position: isoScreen(model.worldPose(item.id, snapshot), height),
    height,
    depth: base.x + base.y + level * 0.01,
  };
}
function contains(point: Point, polygon: readonly Point[]): boolean {
  let positive = false,
    negative = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross > 1e-7) positive = true;
    if (cross < -1e-7) negative = true;
  }
  return !(positive && negative);
}
/** The same stable order controls committed art, ghosts and pointer picking. */
export function isoPaintOrder(
  snapshot: PlacementSnapshot,
  model: PlacementModel,
) {
  return snapshot.objects
    .map((item) => ({ item, ...isoPresentation(item, snapshot, model) }))
    .sort((a, b) => a.depth - b.depth);
}
export function pickIsoFurniture(
  point: PlacementPose,
  session: PlacementSession,
): string | null {
  const snapshot = session.model.snapshot();
  const items = isoPaintOrder(snapshot, session.model).reverse();
  for (const { item, position } of items) {
    const local = { x: point.x - position.x, y: point.y - position.y };
    if (
      isoFaces(
        item.type as FurnitureType,
        "oak",
        session.model.worldPose(item.id).rotation,
      ).some((face) => contains(local, face.points))
    )
      return item.id;
  }
  return null;
}
export function projectIsoSupport(
  point: PlacementPose,
  session: PlacementSession,
): PlacementPointerProjection {
  const command = session.inspect().command;
  const snapshot = session.model.snapshot();
  const current =
    command && "id" in command
      ? snapshot.objects.find((o) => o.id === command.id)
      : undefined;
  const type = command?.kind === "place" ? command.type : current?.type;
  if (type !== "lamp" && type !== "plant") return { pose: point, snap: false };
  // Undo the vertical lift before testing the tabletop in the layout's plane.
  const raised = {
    ...point,
    x: point.x + tableHeight,
    y: point.y + tableHeight,
  };
  for (const table of snapshot.objects) {
    if (table.type !== "table") continue;
    const world = session.model.worldPose(table.id);
    const local = rotate(
      { x: raised.x - world.x, y: raised.y - world.y },
      -world.rotation,
    );
    if (Math.abs(local.x) <= 42 && Math.abs(local.y) <= 22)
      return { pose: raised };
  }
  return { pose: point, snap: false };
}
export function drawIsoRoom(g: DrawContext, floor: number, wall: number): void {
  const polygon = (points: [number, number, number][], color: number): void => {
    g.poly(
      points.flatMap(([x, y, z]) => {
        const p = isoScreen({ x, y }, z);
        return [p.x, p.y];
      }),
    )
      .fill(color)
      .stroke({ color: 0x648075, width: 1 });
  };
  g.clear();
  polygon(
    [
      [0, 0, 0],
      [320, 0, 0],
      [320, 0, 32],
      [0, 0, 32],
    ],
    wall,
  );
  polygon(
    [
      [0, 0, 0],
      [0, 320, 0],
      [0, 320, 32],
      [0, 0, 32],
    ],
    shade(wall, 0.85),
  );
  polygon(
    [
      [0, 0, 0],
      [320, 0, 0],
      [320, 320, 0],
      [0, 320, 0],
    ],
    floor,
  );
  polygon(
    [
      [320, 0, 0],
      [320, 320, 0],
      [320, 320, -8],
      [320, 0, -8],
    ],
    shade(floor, 0.72),
  );
  polygon(
    [
      [0, 320, 0],
      [320, 320, 0],
      [320, 320, -8],
      [0, 320, -8],
    ],
    shade(floor, 0.86),
  );
  for (let i = 16; i < 320; i += 16) {
    for (const [a, b] of [
      [
        { x: i, y: 0 },
        { x: i, y: 320 },
      ],
      [
        { x: 0, y: i },
        { x: 320, y: i },
      ],
    ] as const) {
      const start = isoScreen(a),
        end = isoScreen(b);
      g.moveTo(start.x, start.y)
        .lineTo(end.x, end.y)
        .stroke({ color: 0x86745e, alpha: i % 32 ? 0.12 : 0.25, width: 1 });
    }
  }
}
