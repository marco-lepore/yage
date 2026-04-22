import { useState, useMemo, useCallback, useRef } from "react";
import {
  Component,
  Engine,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
} from "@yagejs/renderer";
import {
  InputPlugin,
  InputManager,
  InputManagerKey,
  getKeyDisplayName,
} from "@yagejs/input";
import type { RebindResult } from "@yagejs/input";
import { UIPlugin } from "@yagejs/ui";
import {
  UIRoot,
  Panel,
  Text,
  Button,
  Anchor,
  useEngine,
  useStore,
  createStore,
} from "@yagejs/ui-react";
import type { Store } from "@yagejs/ui-react";
import { injectStyles, setupGameContainer } from "./shared";

injectStyles();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ACTIONS = {
  p1Up: ["KeyW"],
  p1Down: ["KeyS"],
  p1Left: ["KeyA"],
  p1Right: ["KeyD"],
  p2Up: ["ArrowUp"],
  p2Down: ["ArrowDown"],
  p2Left: ["ArrowLeft"],
  p2Right: ["ArrowRight"],
};

const GROUPS = {
  player1: ["p1Up", "p1Down", "p1Left", "p1Right"],
  player2: ["p2Up", "p2Down", "p2Left", "p2Right"],
};

// Game-side metadata (labels, colors). Not part of the engine.
const ACTION_LABELS: Record<string, string> = {
  p1Up: "Up",
  p1Down: "Down",
  p1Left: "Left",
  p1Right: "Right",
  p2Up: "Up",
  p2Down: "Down",
  p2Left: "Left",
  p2Right: "Right",
};

interface GroupMeta {
  label: string;
  color: number;
  actions: { up: string; down: string; left: string; right: string };
}

const GROUP_META: Record<string, GroupMeta> = {
  player1: {
    label: "Player 1",
    color: 0x3b82f6,
    actions: { up: "p1Up", down: "p1Down", left: "p1Left", right: "p1Right" },
  },
  player2: {
    label: "Player 2",
    color: 0x22c55e,
    actions: { up: "p2Up", down: "p2Down", left: "p2Left", right: "p2Right" },
  },
};

const PLAYER_SPEED = 120; // px/s

// ---------------------------------------------------------------------------
// Game component
// ---------------------------------------------------------------------------

interface PlayerActions {
  up: string;
  down: string;
  left: string;
  right: string;
}

class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);

  constructor(
    private readonly actions: PlayerActions,
    private readonly speed: number,
  ) {
    super();
  }

  update(dt: number): void {
    const { up, down, left, right } = this.actions;
    const dir = this.input.getVector(left, right, up, down);
    if (dir.lengthSq() > 0) {
      const move = dir.normalize().scale((this.speed * dt) / 1000);
      this.entity.get(Transform).translate(move.x, move.y);
    }
  }
}

// ---------------------------------------------------------------------------
// Conflict store — shared between side panel and center modal
// ---------------------------------------------------------------------------

interface PendingConflict {
  targetAction: string;
  key: string;
  conflictAction: string;
  slot: number;
}

type ConflictState = {
  conflict: PendingConflict | null;
  /** Incremented when a conflict is resolved via "Replace", so the panel re-reads bindings. */
  resolveVersion: number;
};

const conflictStore: Store<ConflictState> = createStore<ConflictState>({
  conflict: null,
  resolveVersion: 0,
});

// ---------------------------------------------------------------------------
// React UI — Binding row
// ---------------------------------------------------------------------------

function BindingRow({
  action,
  input,
  isListening,
  onRebind,
}: {
  action: string;
  input: InputManager;
  isListening: boolean;
  onRebind: (action: string, slot: number) => void;
}) {
  const bindings = input.getBindings(action);
  const label = ACTION_LABELS[action] ?? action;
  const keyLabel =
    bindings.length > 0 ? getKeyDisplayName(bindings[0]!) : "—";

  return (
    <Panel direction="row" gap={8} alignItems="center">
      <Text style={{ fontSize: 13, fill: 0xbbbbbb, wordWrapWidth: 50 }}>{label}</Text>
      <Button
        width={120}
        height={26}
        textStyle={{ fontSize: 12, fill: isListening ? 0xfacc15 : 0xffffff }}
        bg={{ color: isListening ? 0x713f12 : 0x334155, alpha: 1, radius: 3 }}
        hoverBg={{
          color: isListening ? 0x713f12 : 0x475569,
          alpha: 1,
          radius: 3,
        }}
        onClick={() => onRebind(action, 0)}
      >
        {isListening ? "Press a key..." : keyLabel}
      </Button>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// React UI — Group section
// ---------------------------------------------------------------------------

function GroupSection({
  group,
  meta,
  input,
  listeningAction,
  onRebind,
  onReset,
  onToggle,
}: {
  group: string;
  meta: GroupMeta;
  input: InputManager;
  listeningAction: string | null;
  onRebind: (action: string, slot: number) => void;
  onReset: (group: string) => void;
  onToggle: (group: string) => void;
}) {
  const enabled = input.isGroupEnabled(group);
  const actions = input.getGroupActions(group);

  return (
    <Panel direction="column" gap={6}>
      {/* Header */}
      <Panel direction="row" gap={8} alignItems="center">
        <Panel
          width={10}
          height={10}
          bg={{ color: enabled ? meta.color : 0x555555, alpha: 1, radius: 2 }}
        />
        <Text style={{ fontSize: 15, fill: enabled ? 0xffffff : 0x666666 }}>
          {meta.label}
        </Text>
        <Button
          width={50}
          height={22}
          textStyle={{ fontSize: 10, fill: 0xcccccc }}
          bg={{ color: 0x334155, alpha: 1, radius: 3 }}
          hoverBg={{ color: 0x475569, alpha: 1, radius: 3 }}
          onClick={() => onToggle(group)}
        >
          {enabled ? "Off" : "On"}
        </Button>
        <Button
          width={50}
          height={22}
          textStyle={{ fontSize: 10, fill: 0xcccccc }}
          bg={{ color: 0x334155, alpha: 1, radius: 3 }}
          hoverBg={{ color: 0x475569, alpha: 1, radius: 3 }}
          onClick={() => onReset(group)}
        >
          Reset
        </Button>
      </Panel>

      {/* Bindings */}
      {actions.map((action) => (
        <BindingRow
          key={action}
          action={action}
          input={input}
          isListening={listeningAction === action}
          onRebind={onRebind}
        />
      ))}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// React UI — Conflict modal (rendered in a separate center-anchored UIRoot)
// ---------------------------------------------------------------------------

function ConflictModal() {
  const ctx = useEngine();
  const input = useMemo(() => ctx.resolve(InputManagerKey), [ctx]);
  const conflict = useStore(conflictStore, (s) => s.conflict);

  if (!conflict) return null;

  const keyName = getKeyDisplayName(conflict.key);
  const conflictLabel =
    ACTION_LABELS[conflict.conflictAction] ?? conflict.conflictAction;

  return (
    <Panel
      direction="column"
      gap={10}
      padding={20}
      alignItems="center"
      bg={{ color: 0x451a1a, alpha: 0.97, radius: 8 }}
    >
      <Text style={{ fontSize: 14, fill: 0xf87171 }}>Key Conflict</Text>
      <Text style={{ fontSize: 12, fill: 0xdddddd }}>
        {`"${keyName}" is already bound to "${conflictLabel}"`}
      </Text>
      <Panel direction="row" gap={8}>
        <Button
          width={90}
          height={28}
          textStyle={{ fontSize: 11, fill: 0xffffff }}
          bg={{ color: 0x991b1b, alpha: 1, radius: 4 }}
          hoverBg={{ color: 0xb91c1c, alpha: 1, radius: 4 }}
          onClick={() => {
            input.rebind(conflict.targetAction, conflict.key, {
              slot: conflict.slot,
              conflict: "replace",
            });
            conflictStore.set({
              conflict: null,
              resolveVersion: conflictStore.get().resolveVersion + 1,
            });
          }}
        >
          Replace
        </Button>
        <Button
          width={90}
          height={28}
          textStyle={{ fontSize: 11, fill: 0xcccccc }}
          bg={{ color: 0x334155, alpha: 1, radius: 4 }}
          hoverBg={{ color: 0x475569, alpha: 1, radius: 4 }}
          onClick={() => conflictStore.set({ conflict: null })}
        >
          Cancel
        </Button>
      </Panel>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// React UI — Root panel
// ---------------------------------------------------------------------------

function RebindPanel() {
  const ctx = useEngine();
  const input = useMemo(() => ctx.resolve(InputManagerKey), [ctx]);

  const [version, setVersion] = useState(0);
  const [listeningAction, setListeningAction] = useState<string | null>(null);
  const listeningRef = useRef<string | null>(null);

  // Re-render when a conflict is resolved via "Replace" in the modal.
  const resolveVersion = useStore(conflictStore, (s) => s.resolveVersion);

  // Force re-read of bindings from InputManager after mutations.
  void (version + resolveVersion);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const handleRebind = useCallback(
    async (action: string, slot: number) => {
      // If already listening, cancel the current listen
      if (listeningRef.current) {
        input.cancelListen();
        listeningRef.current = null;
        setListeningAction(null);
        return;
      }

      listeningRef.current = action;
      setListeningAction(action);

      const key = await input.listenForNextKey();

      listeningRef.current = null;
      setListeningAction(null);

      if (!key) return;

      // Escape cancels without rebinding
      if (key === "Escape") return;

      const result: RebindResult = input.rebind(action, key, {
        slot,
        conflict: "reject",
      });

      if (result.ok) {
        bump();
      } else if (result.conflict) {
        conflictStore.set({
          conflict: {
            targetAction: action,
            key,
            conflictAction: result.conflict.action,
            slot,
          },
          resolveVersion: conflictStore.get().resolveVersion,
        });
      }
    },
    [input, bump],
  );

  const handleReset = useCallback(
    (group: string) => {
      const actions = input.getGroupActions(group);
      for (const action of actions) {
        input.resetBindings(action);
      }
      bump();
    },
    [input, bump],
  );

  const handleToggle = useCallback(
    (group: string) => {
      if (input.isGroupEnabled(group)) {
        input.disableGroup(group);
      } else {
        input.enableGroup(group);
      }
      bump();
    },
    [input, bump],
  );

  return (
    <Panel
      direction="column"
      gap={16}
      padding={16}
      bg={{ color: 0x1e293b, alpha: 0.95, radius: 8 }}
    >
      <Text style={{ fontSize: 16, fill: 0xffffff }}>Controls</Text>

      {Object.entries(GROUP_META).map(([group, meta]) => (
        <GroupSection
          key={group}
          group={group}
          meta={meta}
          input={input}
          listeningAction={listeningAction}
          onRebind={handleRebind}
          onReset={handleReset}
          onToggle={handleToggle}
        />
      ))}

      <Text style={{ fontSize: 10, fill: 0x666666 }}>
        Click a key to rebind. Esc to cancel.
      </Text>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

class InputRemappingScene extends Scene {
  readonly name = "input-remapping";

  onEnter(): void {
    // Spawn players
    for (const [, meta] of Object.entries(GROUP_META)) {
      const startX = meta.color === 0x3b82f6 ? 200 : 350;
      const entity = this.spawn("player");
      entity.add(new Transform({ position: new Vec2(startX, 300) }));
      entity.add(
        new GraphicsComponent().draw((g) => {
          g.roundRect(-15, -15, 30, 30, 4).fill({ color: meta.color });
        }),
      );
      entity.add(new PlayerController(meta.actions, PLAYER_SPEED));
    }

    // Label each player
    for (const [, meta] of Object.entries(GROUP_META)) {
      const startX = meta.color === 0x3b82f6 ? 200 : 350;
      const label = this.spawn("label");
      label.add(new Transform({ position: new Vec2(startX, 275) }));
      label.add(
        new GraphicsComponent().draw((g) => {
          // Small colored dot above the square
          g.circle(0, 0, 3).fill({ color: meta.color });
        }),
      );
    }

    // Mount side panel
    const panelEntity = this.spawn("ui-panel");
    const panelRoot = panelEntity.add(
      new UIRoot({ anchor: Anchor.CenterRight, offset: { x: -16, y: 0 } }),
    );
    panelRoot.render(<RebindPanel />);

    // Mount conflict modal (separate UIRoot, centered)
    const modalEntity = this.spawn("ui-modal");
    const modalRoot = modalEntity.add(
      new UIRoot({ anchor: Anchor.Center }),
    );
    modalRoot.render(<ConflictModal />);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  const engine = new Engine();

  engine.use(
    new RendererPlugin({
      width: 800,
      height: 600,
      backgroundColor: 0x0f172a,
      container: setupGameContainer(800, 600),
    }),
  );

  engine.use(
    new InputPlugin({
      actions: ACTIONS,
      groups: GROUPS,
      preventDefaultKeys: [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
      ],
    }),
  );

  engine.use(new UIPlugin());

  await engine.start();
  await engine.scenes.push(new InputRemappingScene());
}

main().catch(console.error);
