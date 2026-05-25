/**
 * Diegetic UI test — React `<Tooltip>` on world-space namecards.
 *
 * Each enemy is a world-space entity that orbits. A separate nameplate
 * entity uses `ScreenFollow` (world→screen projection via the camera) +
 * a `positioning: "transform"` `<UIRoot>` to glue a React namecard above
 * it. The namecard is the tooltip trigger; the stats bubble is portaled
 * into the scene's screen-space overlay yet must stay anchored to the
 * moving namecard every frame — the world→screen anchoring path.
 */
import { Engine, Scene, Component, Transform, Vec2 } from "@yagejs/core";
import {
  RendererPlugin,
  CameraEntity,
  ScreenFollow,
  GraphicsComponent,
} from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { UIPlugin } from "@yagejs/ui";
import {
  UIReactPlugin,
  UIRoot,
  Panel,
  Text,
  Tooltip,
  ProgressBar,
  Anchor,
} from "@yagejs/ui-react";
import { getContainer } from "./shared.js";

const WIDTH = 900;
const HEIGHT = 600;

interface Stats {
  lvl: number;
  atk: number;
  def: number;
  spd: number;
}
interface EnemySpec {
  name: string;
  color: number;
  hp: number;
  stats: Stats;
  cx: number;
  cy: number;
  radius: number;
  speed: number;
  phase: number;
}

const ENEMIES: EnemySpec[] = [
  { name: "Grunt", color: 0xff6b6b, hp: 0.8, stats: { lvl: 3, atk: 12, def: 8, spd: 5 }, cx: 300, cy: 300, radius: 90, speed: 0.5, phase: 0 },
  { name: "Scout", color: 0x4ecdc4, hp: 0.55, stats: { lvl: 5, atk: 9, def: 4, spd: 11 }, cx: 600, cy: 320, radius: 70, speed: 0.8, phase: 2 },
  { name: "Brute", color: 0xffe66d, hp: 1, stats: { lvl: 7, atk: 18, def: 14, spd: 3 }, cx: 470, cy: 430, radius: 55, speed: 0.35, phase: 4 },
];

/** Orbit the entity around a center so its namecard glides across-screen. */
class Patrol extends Component {
  private t: number;
  constructor(
    private readonly center: Vec2,
    private readonly radius: number,
    private readonly speed: number,
    phase: number,
  ) {
    super();
    this.t = phase;
  }
  update(dt: number): void {
    this.t += (dt / 1000) * this.speed;
    this.entity
      .get(Transform)
      .setPosition(
        this.center.x + Math.cos(this.t) * this.radius,
        this.center.y + Math.sin(this.t) * this.radius,
      );
  }
}

function Namecard(props: EnemySpec) {
  const { name, color, hp, stats } = props;
  return (
    <Tooltip
      placement="top"
      content={
        <Panel
          direction="column"
          gap={3}
          padding={{ left: 10, right: 10, top: 7, bottom: 7 }}
          bg={{ color: 0x1f2430, alpha: 0.97, radius: 6 }}
        >
          <Text style={{ fill: color, fontSize: 12 }}>
            {`${name} · Lv ${stats.lvl}`}
          </Text>
          <Text style={{ fill: 0x9ca3af, fontSize: 11 }}>
            {`ATK ${stats.atk}   DEF ${stats.def}   SPD ${stats.spd}`}
          </Text>
        </Panel>
      }
    >
      <Panel
        direction="column"
        gap={3}
        padding={6}
        alignItems="center"
        bg={{ color: 0x0b1220, alpha: 0.75, radius: 4 }}
      >
        <Text style={{ fill: color, fontSize: 12 }}>{name}</Text>
        <ProgressBar
          value={hp}
          width={70}
          height={6}
          trackBackground={{ color: 0x334155, alpha: 1, radius: 3 }}
          fillBackground={{ color: 0x22c55e, alpha: 1, radius: 3 }}
        />
      </Panel>
    </Tooltip>
  );
}

class DemoScene extends Scene {
  readonly name = "world-ui-react";
  readonly layers: readonly LayerDef[] = [
    { name: "bg", order: -10 },
    { name: "world", order: 0 },
  ];

  onEnter(): void {
    const cam = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
    });

    const grid = this.spawn("grid");
    grid.add(new Transform());
    grid.add(
      new GraphicsComponent({ layer: "bg" }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x0f172a, alpha: 1 });
        for (let x = 0; x <= WIDTH; x += 100)
          g.moveTo(x, 0).lineTo(x, HEIGHT).stroke({ color: 0x1e293b, width: 1 });
        for (let y = 0; y <= HEIGHT; y += 100)
          g.moveTo(0, y).lineTo(WIDTH, y).stroke({ color: 0x1e293b, width: 1 });
      }),
    );

    for (const spec of ENEMIES) {
      const body = this.spawn(`enemy-${spec.name}`);
      body.add(new Transform({ position: new Vec2(spec.cx, spec.cy) }));
      body.add(
        new GraphicsComponent({ layer: "world" }).draw((g) => {
          g.circle(0, 0, 14).fill({ color: spec.color });
          g.circle(0, 0, 14).stroke({ color: 0xffffff, width: 2 });
        }),
      );
      body.add(
        new Patrol(
          new Vec2(spec.cx, spec.cy),
          spec.radius,
          spec.speed,
          spec.phase,
        ),
      );

      const plate = this.spawn(`plate-${spec.name}`);
      plate.add(new Transform());
      plate.add(
        new ScreenFollow({
          target: body,
          camera: cam,
          offset: new Vec2(0, -42),
        }),
      );
      plate
        .add(new UIRoot({ positioning: "transform", anchor: Anchor.BottomCenter }))
        .render(<Namecard {...spec} />);
    }
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    container: getContainer(),
  }),
);
engine.use(new UIPlugin());
engine.use(new UIReactPlugin());
await engine.start();
await engine.scenes.push(new DemoScene());
