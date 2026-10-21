import {
  Component,
  Entity,
  ProcessComponent,
  Sequence,
  Transform,
  Vec2,
} from "@yagejs/core";
import { TextComponent } from "@yagejs/renderer";
import { HUD_LAYER } from "./constants.js";
import type { GuardEntity } from "./guard.js";

// ---------------------------------------------------------------------------
// GuardPanel — what one guard's tree is doing, in words
// ---------------------------------------------------------------------------

/** A path without its root id: every path starts with "guard/". */
function branch(path: string): string {
  return path.slice(path.indexOf("/") + 1);
}

/** The last id of a path. */
function leafId(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

class GuardPanel extends Component {
  private readonly text = this.sibling(TextComponent);
  private shown = "";

  constructor(private readonly guard: GuardEntity) {
    super();
  }

  onAdd(): void {
    this.refresh();
    // inspect() copies the tree's diagnostics, so read it ten times a second
    // rather than every frame.
    this.sibling(ProcessComponent).run(
      new Sequence()
        .wait(0.1)
        .call(() => this.refresh())
        .loop()
        .build(),
    );
  }

  private refresh(): void {
    const { state, brain } = this.guard;
    const execution = brain.execution;
    // Leaves are running paths with no running child. Inside a parallel,
    // several run at once: show the first in full and the others by id.
    const [first, ...others] = execution.activePaths.filter(
      (path) =>
        !execution.activePaths.some((other) => other.startsWith(`${path}/`)),
    );
    const running = !brain.enabled
      ? "tree disabled (Space restarts it)"
      : first === undefined
        ? "nothing"
        : [branch(first), ...others.map(leafId)].join(" + ");
    const cooldown =
      execution.nodes.find((node) => node.id === "heavy-ready")
        ?.remainingSeconds ?? 0;
    const heavy =
      cooldown > 0
        ? `heavy attack in ${cooldown.toFixed(1)}s`
        : "heavy attack ready";
    const text = [
      `${state.lane}   HP ${state.health}   attacks ${state.attacks} (${state.heavyAttacks} heavy)   calls for help ${state.calls}`,
      `Running: ${running}`,
      `${heavy} · interrupted ${state.interruptions} · last: ${state.lastInterruption}`,
    ].join("\n");
    if (text === this.shown) return;
    this.shown = text;
    this.text.setText(text);
  }
}

// ---------------------------------------------------------------------------
// GuardPanelEntity — a screen-space panel above a guard's lane
// ---------------------------------------------------------------------------

export class GuardPanelEntity extends Entity {
  setup(params: { y: number; guard: GuardEntity }): void {
    this.add(new Transform({ position: new Vec2(30, params.y) }));
    this.add(new ProcessComponent());
    this.add(
      new TextComponent({
        text: "",
        layer: HUD_LAYER,
        style: { fontFamily: "monospace", fontSize: 14, fill: 0xcbd5e1 },
      }),
    );
    this.add(new GuardPanel(params.guard));
  }
}
