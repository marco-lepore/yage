import type { ProcessSlot, Transform, Vec2 } from "@yagejs/core";
import { arrive } from "@yagejs-addons/steering";
import type { SteeringAgent } from "@yagejs-addons/steering";
import { behaviorNodes } from "@yagejs-addons/behavior-tree";
import type { GuardState } from "./state.js";

// ---------------------------------------------------------------------------
// GuardContext — what the tree may read and do
// ---------------------------------------------------------------------------

/**
 * The tree's view of one guard. Game state stays on `GuardState`: the tree
 * reads it through `read()` and changes it only through `commands`.
 */
export interface GuardContext {
  readonly read: () => Readonly<Pick<GuardState, "health" | "target" | "home">>;
  readonly commands: Pick<
    GuardState,
    | "setPhase"
    | "prepareAttack"
    | "strike"
    | "heal"
    | "callForHelp"
    | "finishAction"
  >;
  readonly movement: SteeringAgent;
  readonly position: Transform;
  readonly attack: ProcessSlot;
  readonly recovery: ProcessSlot;
}

const bt = behaviorNodes<GuardContext>();

// ---------------------------------------------------------------------------
// Reusable actions
// ---------------------------------------------------------------------------

/** Steer to a point. Exit removes the steering request however it ends. */
function travel(
  id: "approach" | "retreat",
  destination: (guard: GuardContext) => Vec2,
) {
  return bt.action(id, (guard) => ({
    enter: () => {
      guard.commands.setPhase(id);
      guard.movement.setBehaviors([
        arrive(destination(guard), { slowRadius: 40, arriveRadius: 3 }),
      ]);
    },
    tick: () =>
      guard.position.position.distance(destination(guard)) < 4
        ? "success"
        : "running",
    exit: (result) => {
      guard.movement.setBehaviors([]);
      guard.movement.stop();
      guard.commands.finishAction(id, result);
    },
  }));
}

/**
 * Wind up, then strike. Callbacks are synchronous, so the action polls the
 * attack slot each tick instead of awaiting it, and cancels it on exit.
 */
function attack(id: string, tactic: "normal" | "heavy") {
  return bt.action(id, (guard) => ({
    enter: () => {
      guard.commands.prepareAttack(tactic);
    },
    tick: () => {
      if (guard.attack.running) return "running";
      guard.commands.strike();
      return "success";
    },
    exit: (result) => {
      guard.attack.cancel();
      guard.commands.finishAction("attack", result);
    },
  }));
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

/** Walk to the gate, react, pick a tactic, strike, recover. */
const combat = bt.sequence("attack-cycle", [
  travel("approach", (guard) => guard.read().target),
  bt.call("react", (guard) => guard.commands.setPhase("react")),
  bt.randomWait("reaction", 0.1, 0.3),
  bt.weightedSelector("tactic", [
    { weight: 3, child: attack("attack", "normal") },
    {
      weight: 1,
      child: bt.cooldown(
        "heavy-ready",
        4,
        bt.chance("commit-heavy", 0.75, attack("heavy-attack", "heavy")),
      ),
    },
  ]),
  bt.action("recover", (guard) => ({
    enter: () => {
      guard.commands.setPhase("recover");
      guard.recovery.restart();
    },
    tick: () => (guard.recovery.running ? "running" : "success"),
    exit: (result) => {
      guard.recovery.cancel();
      guard.commands.finishAction("recover", result);
    },
  })),
]);

/** Run home while calling for help, then rest and heal. */
const safety = bt.sequence("safety", [
  // Both children run together. Reaching home ends the parallel, which
  // cancels the calls.
  bt.parallel(
    "flee",
    [
      travel("retreat", (guard) => guard.read().home),
      bt.repeat(
        "calling",
        Infinity,
        bt.sequence("call", [
          bt.call("shout", (guard) => guard.commands.callForHelp()),
          bt.wait("breath", 0.7),
        ]),
      ),
    ],
    { success: "any" },
  ),
  bt.call("rest", (guard) => guard.commands.setPhase("rest")),
  bt.wait("heal-delay", 2),
  bt.call("heal", (guard) => guard.commands.heal()),
]);

/**
 * One definition shared by every guard. The reactive selector checks the
 * low-health guard on every tick, so retreat interrupts combat at once.
 */
export const guardBehavior = bt.selector(
  "guard",
  [
    bt.guard("low-health", (guard) => guard.read().health < 30, safety),
    bt.subtree("combat", combat),
  ],
  { reactive: true },
);
