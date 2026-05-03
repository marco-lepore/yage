import {
  Engine,
  Scene,
  Entity,
  Component,
  Transform,
  Vec2,
  serializable,
} from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { SnapshotPlugin, SnapshotServiceKey } from "@yagejs/save";
import type { SnapshotService, SnapshotResolver } from "@yagejs/save";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 640;
const HEIGHT = 360;
const container = setupContainer(WIDTH, HEIGHT);

// ---- Entities ----

@serializable
class Player extends Entity {
  setup() {
    this.add(new Transform({ position: new Vec2(100, 200) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-10, -10, 20, 20).fill({ color: 0x22c55e });
      }),
    );
  }

  afterRestore() {
    this.get(GraphicsComponent).draw((g) => {
      g.rect(-10, -10, 20, 20).fill({ color: 0x22c55e });
    });
  }
}

@serializable
class Hat extends Entity {
  setup() {
    this.add(new Transform({ position: new Vec2(0, -16) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-8, -6, 16, 6).fill({ color: 0xffe66d });
      }),
    );
  }

  afterRestore() {
    this.get(GraphicsComponent).draw((g) => {
      g.rect(-8, -6, 16, 6).fill({ color: 0xffe66d });
    });
  }
}

@serializable
class ScoreTracker extends Component {
  score = 0;

  serialize() {
    return { score: this.score };
  }

  static fromSnapshot(data: { score: number }): ScoreTracker {
    const t = new ScoreTracker();
    t.score = data.score;
    return t;
  }
}

@serializable
class Companion extends Entity {
  leaderId = -1;
  resolvedLeader: Entity | null = null;

  setup() {
    this.add(new Transform({ position: new Vec2(60, 200) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 8).fill({ color: 0x38bdf8 });
      }),
    );
  }

  serialize() {
    return { leaderId: this.leaderId };
  }

  afterRestore(data: { leaderId: number }, resolve: SnapshotResolver) {
    this.leaderId = data.leaderId;
    this.resolvedLeader = resolve.entity(data.leaderId);
    this.get(GraphicsComponent).draw((g) => {
      g.circle(0, 0, 8).fill({ color: 0x38bdf8 });
    });
  }
}

// ---- Scene ----

interface ProfileData {
  bestScore: number;
}

@serializable
class TestScene extends Scene {
  readonly name = "test-scene";

  onEnter() {
    const player = this.spawn(Player);
    const hat = this.spawn(Hat);
    player.addChild("hat", hat);

    player.add(new ScoreTracker());

    const companion = this.spawn(Companion);
    companion.leaderId = player.id;
  }

}

// ---- Boot ----

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    container,
  }),
);
engine.use(new DebugPlugin());
engine.use(new SnapshotPlugin());
await engine.start();
await engine.scenes.push(new TestScene());

// Expose save service for e2e test control
const saveService = engine.context.resolve(SnapshotServiceKey);
(window as any).__saveService__ = saveService;
