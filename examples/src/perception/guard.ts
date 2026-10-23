import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  type ProcessSlot,
} from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import type { GridGraph } from "@yagejs/pathfinding";
import {
  PerceptionLostEvent,
  PerceptionSensor,
} from "@yagejs-addons/perception";
import { perceptionRaycast } from "@yagejs-addons/perception/physics";
import {
  ALLY_TAG,
  GUARD_POST,
  GUARD_RADIUS,
  PLAYER_KEY,
  SHADOW_VISIBILITY,
  SIGHT_FOV,
  SIGHT_RANGE,
  VISIBILITY_THRESHOLD,
} from "./constants.js";
import { createNavGrid, guardFits, inShadow, walkableGoal } from "./level.js";

// ---------------------------------------------------------------------------
// Awareness — gradual noticing, built on the sensor's per-sample facts
// ---------------------------------------------------------------------------

/**
 * Rises while the player is in sight, scaled by its visibility, and falls
 * while it is not. The sensor answers "is the player visible right now?";
 * how quickly a guard notices is a game rule.
 */
export class Awareness extends Component {
  private readonly sensor = this.sibling(PerceptionSensor);
  /** 0 = calm, 1 = noticed. */
  level = 0;

  private static readonly SECONDS_TO_NOTICE = 1;
  private static readonly SECONDS_TO_CALM = 4;

  update(dt: number): void {
    const player = this.scene.findByKey(PLAYER_KEY);
    const sighting = player && this.sensor.observationOf(player);
    this.level = sighting?.visible
      ? Math.min(
          1,
          this.level + (dt * sighting.visibility) / Awareness.SECONDS_TO_NOTICE,
        )
      : Math.max(0, this.level - dt / Awareness.SECONDS_TO_CALM);
  }
}

// ---------------------------------------------------------------------------
// GuardBrain — what the guard does with what it perceives
// ---------------------------------------------------------------------------

export type GuardState =
  | "watching"
  | "alerted"
  | "investigating"
  | "searching"
  | "returning";

/**
 * Once fully aware, the guard turns to follow the player. When the player
 * slips out of sight, it walks around the wall to the last known position,
 * looks around, then walks back to its post.
 */
export class GuardBrain extends Component {
  private readonly transform = this.sibling(Transform);
  private readonly sensor = this.sibling(PerceptionSensor);
  private readonly awareness = this.sibling(Awareness);
  private readonly processes = this.sibling(ProcessComponent);
  private search!: ProcessSlot;
  /** Waypoints still to walk, next first. */
  private path: Vec2[] = [];
  private searchHeading = 0;

  state: GuardState = "watching";
  /** Times the guard lost the player while alerted. */
  investigations = 0;

  private static readonly SPEED = 90;
  private static readonly SEARCH_SECONDS = 2;
  /** How far the guard turns either way while searching, in radians. */
  private static readonly SEARCH_SWEEP = 0.7;

  constructor(private readonly grid: GridGraph) {
    super();
  }

  onAdd(): void {
    this.search = this.processes.slot({
      duration: GuardBrain.SEARCH_SECONDS,
      onComplete: () => this.walkTo(GUARD_POST, "returning"),
    });
    this.listen(this.entity, PerceptionLostEvent, ({ observation }) => {
      if (this.state !== "alerted") return;
      if (observation.target.current?.key !== PLAYER_KEY) return;
      this.investigations++;
      const { x, y } = observation.lastPosition;
      // With no walkable cell near the last position, the guard searches from here.
      if (!this.walkTo(new Vec2(x, y), "investigating")) this.startSearch();
    });
  }

  update(dt: number): void {
    const player = this.scene.findByKey(PLAYER_KEY);
    const sighting = player && this.sensor.observationOf(player);
    if (sighting?.visible && this.awareness.level >= 1) {
      this.search.cancel();
      this.state = "alerted";
      this.face(sighting.lastPosition);
      return;
    }
    if (this.state === "investigating" || this.state === "returning") {
      this.walk(dt);
    } else if (this.state === "searching") {
      this.transform.setRotation(
        this.searchHeading +
          Math.sin(this.search.elapsed * 3) * GuardBrain.SEARCH_SWEEP,
      );
    }
  }

  /** Plans a path toward `goal`; false when no cell near it is walkable. */
  private walkTo(goal: Vec2, state: "investigating" | "returning"): boolean {
    const target = walkableGoal(this.grid, goal);
    const path = target && this.grid.findPath(this.transform.position, target);
    if (!path) return false;
    // Skip the center of the cell the guard is in. End on the goal itself when
    // its cell is walkable and the guard fits there.
    this.path = path.waypoints.slice(1);
    if (target === goal && guardFits(goal)) this.path.splice(-1, 1, goal);
    this.state = state;
    return true;
  }

  private walk(dt: number): void {
    const next = this.path[0];
    if (!next) {
      this.arrive();
      return;
    }
    const position = this.transform.position;
    const offset = next.sub(position);
    const step = GuardBrain.SPEED * dt;
    if (offset.length() > step) {
      this.face(next);
      const moved = position.add(offset.normalize().scale(step));
      this.transform.setPosition(moved.x, moved.y);
      return;
    }
    this.transform.setPosition(next.x, next.y);
    this.path.shift();
    if (this.path.length === 0) this.arrive();
  }

  private arrive(): void {
    if (this.state === "investigating") {
      this.startSearch();
      return;
    }
    this.state = "watching";
    this.transform.setRotation(0);
  }

  private startSearch(): void {
    this.state = "searching";
    this.searchHeading = this.transform.rotation;
    this.search.restart();
  }

  private face(point: Vec2Like): void {
    const position = this.transform.position;
    this.transform.setRotation(
      Math.atan2(point.y - position.y, point.x - position.x),
    );
  }
}

// ---------------------------------------------------------------------------
// GuardLook — the view cone, colored by awareness
// ---------------------------------------------------------------------------
class GuardLook extends Component {
  private readonly graphics = this.sibling(GraphicsComponent);
  private readonly awareness = this.sibling(Awareness);
  private color = -1;

  update(): void {
    const level = this.awareness.level;
    const color = level >= 1 ? 0xf0716a : level > 0 ? 0xf4be69 : 0x86de9b;
    if (color === this.color) return;
    this.color = color;
    this.graphics.draw((g) => {
      g.clear();
      g.moveTo(0, 0)
        .arc(0, 0, SIGHT_RANGE, -SIGHT_FOV / 2, SIGHT_FOV / 2)
        .lineTo(0, 0)
        .fill({ color, alpha: 0.1 });
      g.circle(0, 0, GUARD_RADIUS).fill(color);
      g.moveTo(0, 0).lineTo(24, 0).stroke({ color: 0xe4ffeb, width: 3 });
    });
  }
}

// ---------------------------------------------------------------------------
// GuardEntity
// ---------------------------------------------------------------------------

/**
 * The sensor owns sight and memory; `Awareness` and `GuardBrain` are game
 * code that read it. Components update in the order they are added, so both
 * read the sample the sensor took this frame.
 */
export class GuardEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: GUARD_POST }));
    this.add(new GraphicsComponent());
    this.add(
      new PerceptionSensor({
        range: SIGHT_RANGE,
        // Once seen, the player has to get 25 px farther away to break contact.
        loseRange: SIGHT_RANGE + 25,
        fieldOfView: SIGHT_FOV,
        memoryDuration: 3,
        eligible: ({ target }) => (target.tags.has(ALLY_TAG) ? "ally" : null),
        lineOfSight: perceptionRaycast(),
        visibility: ({ position }) =>
          inShadow(position) ? SHADOW_VISIBILITY : 1,
        visibilityThreshold: VISIBILITY_THRESHOLD,
      }),
    );
    this.add(new Awareness());
    this.add(new ProcessComponent());
    this.add(new GuardBrain(createNavGrid()));
    this.add(new GuardLook());
  }
}
