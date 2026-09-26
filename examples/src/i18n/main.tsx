/**
 * Localization example — one `Localization` service (`@yagejs-addons/i18n`)
 * behind every text path: renderer text through `LocalizedTextComponent` and
 * `LocalizedSplitTextComponent`, imperative UI through `LocalizedUISurface`,
 * React UI through `<Trans>` and `useLocalization`, dialogue through its own
 * `I18nAdapter` (the controller finds the service by itself), and the
 * inventory panel through `localizeInventoryPanel`. Item, action, and quest
 * definitions keep plain strings; their ids are the catalog keys.
 *
 * Switch language with **L** (or the in-game button) at any moment: mid-reveal,
 * on a choice menu, or with the inventory action menu open. Visible text swaps
 * in place and the `LocalizationProbe` counters show nothing replayed (no new
 * line, command, reveal completion, choice, or inventory action).
 *
 * The dialogue and inventory controllers use their default keyboard + pointer
 * bindings: **Enter** advances / confirms, **↑↓** move a cursor, **I** toggles
 * the backpack, **Esc** closes it. **P** pauses the conversation and **T**
 * replays it once it has ended.
 */

import {
  Component,
  Engine,
  Entity,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { RendererPlugin, type LayerDef } from "@yagejs/renderer";
import { Anchor, UIPlugin } from "@yagejs/ui";
import { Button, Panel, Text, UIRoot, UIReactPlugin } from "@yagejs/ui-react";
import {
  createLocalization,
  LocalizationKey,
  LocalizationPlugin,
  msg,
  type Localization,
} from "@yagejs-addons/i18n";
import {
  LocalizedSplitTextComponent,
  LocalizedTextComponent,
} from "@yagejs-addons/i18n/renderer";
import { LocalizedUISurface } from "@yagejs-addons/i18n/ui";
import {
  LocalizedPixiSelect,
  Trans,
  useLocalization,
} from "@yagejs-addons/i18n/ui-react";
import { localizeInventoryPanel } from "@yagejs-addons/i18n/inventory";
import {
  DialogueChoiceMadeEvent,
  DialogueCommandEvent,
  DialogueController,
  DialogueLineEvent,
  DialogueRevealCompletedEvent,
  defineScript,
  type I18nAdapter,
} from "@yagejs-addons/dialogue";
import {
  createBoxDialogue,
  DIALOGUE_LAYERS,
} from "@yagejs-addons/dialogue/presenters";
import {
  defineItems,
  Inventory,
  InventoryActionEvent,
  InventoryController,
} from "@yagejs-addons/inventory";
import {
  createInventoryPanel,
  INVENTORY_LAYERS,
} from "@yagejs-addons/inventory/presenters";
import { defineQuests } from "@yagejs-addons/quests";
import { Graphics } from "pixi.js";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

const WIDTH = 900;
const HEIGHT = 700;
const LOCALES = ["en", "it"] as const;

const catalogs = {
  en: {
    renderer_one: "Renderer: {count} crystal",
    renderer_other: "Renderer: {count} crystals",
    imperative: "Imperative UI",
    react: "React UI",
    split: "Split text",
    language: "Language: English",
    hint: "L language · Enter advance / confirm · ↑↓ choose · I backpack · Esc close · P pause · T replay",
    paused: "❙❙ PAUSED",
    "speaker.mira": "Mira",
    "mira.greeting":
      "Welcome, {name}. This deliberately long line reveals slowly enough to change language while it is typing.",
    "mira.prompt": "Where should we go?",
    "mira.forest": "The forest",
    "mira.harbor": "The harbor",
    "mira.locked": "Requires a map",
    "inventory.title": "Backpack",
    "item.potion.name": "Potion",
    "item.potion.description": "Restores health.",
    "action.use": "Use",
    "action.inspect": "Inspect",
    "quest.observatory.title": "Find the observatory",
    "difficulty.easy": "Easy",
    "difficulty.hard": "Hard",
  },
  it: {
    renderer_one: "Renderer: {count} cristallo",
    renderer_other: "Renderer: {count} cristalli",
    imperative: "Interfaccia imperativa più lunga",
    react: "Interfaccia React",
    split: "Testo suddiviso",
    language: "Lingua: Italiano",
    hint: "L lingua · Invio avanza / conferma · ↑↓ scegli · I zaino · Esc chiudi · P pausa · T ripeti",
    paused: "❙❙ IN PAUSA",
    "speaker.mira": "Mira",
    "mira.greeting":
      "Benvenuto, {name}. Questa frase volutamente lunga permette di cambiare lingua mentre il testo appare.",
    "mira.prompt": "Dove dovremmo andare?",
    "mira.forest": "La foresta",
    "mira.harbor": "Il porto",
    "mira.locked": "Serve una mappa",
    "inventory.title": "Zaino",
    "item.potion.name": "Pozione",
    "item.potion.description": "Ripristina la salute.",
    "action.use": "Usa",
    "action.inspect": "Esamina",
    "quest.observatory.title": "Trova l’osservatorio",
    "difficulty.easy": "Facile",
    "difficulty.hard": "Difficile",
  },
};

// Definitions keep plain strings: the string is the fallback, the id is the key.
const QUESTS = defineQuests({
  observatory: {
    title: "Find the observatory",
    objectives: { arrive: { title: "Reach the forest" } },
  },
});
const ITEMS = defineItems({
  potion: {
    name: "Potion",
    description: "Restores health.",
    actions: ["use", "inspect"],
    maxStack: 9,
  },
});
const INVENTORY_KEYS = {
  item: (id: string) => `item.${id}.name`,
  description: (id: string) => `item.${id}.description`,
  action: (id: string) => `action.${id}`,
  title: "inventory.title",
};
// Dialogue text takes the same `{ key, fallback, values? }` shape `msg` returns.
const SCRIPT = defineScript({
  id: "localization",
  start: "intro",
  declare: { hasMap: false },
  speakers: { mira: { name: msg("speaker.mira", "Mira") } },
  nodes: {
    intro: {
      id: "intro",
      steps: [
        {
          kind: "say",
          speaker: "mira",
          text: msg("mira.greeting", "Welcome, {name}. This is the fallback.", {
            name: "Ari",
          }),
          speed: 0.45,
          commands: [{ type: "observe", at: "show" }],
        },
        {
          kind: "choice",
          speaker: "mira",
          text: msg("mira.prompt", "Where should we go?"),
          options: [
            { text: msg("mira.forest", "The forest"), target: "done" },
            {
              text: msg("mira.harbor", "The harbor"),
              condition: "hasMap",
              presentation: "disabled",
              disabledReason: msg("mira.locked", "Requires a map"),
              target: "done",
            },
          ],
        },
      ],
    },
    done: { id: "done", steps: [{ kind: "end" }] },
  },
});

function rect(color: number): Graphics {
  return new Graphics().roundRect(0, 0, 180, 34, 6).fill({ color });
}

// ---------------------------------------------------------------------------
// Entities: the conversation, the backpack, and the example's own keys
// ---------------------------------------------------------------------------

/** Hosts Mira's conversation in the dialogue addon's default box. The
 *  controller finds the `Localization` service by itself. */
class ConversationEntity extends Entity {
  dialogue!: DialogueController;

  setup(): void {
    this.dialogue = this.add(
      new DialogueController({
        ...createBoxDialogue(),
        commands: {
          // `observe` only marks the moment the line shows. LocalizationProbe
          // counts it from `DialogueCommandEvent`.
          observe: () => {},
        },
      }),
    );
  }
}

/** A four-slot backpack holding two potions, shown in the inventory panel
 *  with its strings localized. */
class BackpackEntity extends Entity {
  model!: Inventory<"potion">;
  controller!: InventoryController<"potion">;

  setup(): void {
    this.model = new Inventory({
      catalog: ITEMS,
      capacity: 4,
      actions: [
        { id: "use", label: "Use" },
        { id: "inspect", label: "Inspect" },
      ],
    });
    this.model.add("potion", 2);
    this.controller = this.add(
      new InventoryController({
        ...localizeInventoryPanel(
          createInventoryPanel(undefined, { columns: 2, visibleRows: 2 }),
          INVENTORY_KEYS,
        ),
        inventory: this.model,
        title: "Backpack",
      }),
    );
  }
}

/**
 * The example's own keys, on top of the controllers' default bindings:
 * `language` cycles the locale, `pause` freezes the conversation behind a
 * banner, `replay` restarts the script once it has ended. Also hands input
 * focus to whichever of the two controllers is in front: while the backpack
 * is open the dialogue stops polling `interact`, so one Enter never drives
 * both.
 */
class DemoControls extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly localization = this.service(LocalizationKey);
  paused = false;

  constructor(
    private readonly dialogue: DialogueController,
    private readonly inventory: InventoryController<"potion">,
    private readonly banner: LocalizedTextComponent,
  ) {
    super();
  }

  cycleLocale(): void {
    const index = LOCALES.indexOf(
      this.localization.locale as (typeof LOCALES)[number],
    );
    this.localization.setLocale(LOCALES[(index + 1) % LOCALES.length] ?? "en");
  }

  update(): void {
    if (this.input.isJustPressed("language")) this.cycleLocale();
    if (this.input.isJustPressed("pause")) {
      this.paused = !this.paused;
      this.dialogue.setPaused(this.paused);
      this.banner.visible = this.paused;
    }
    if (this.input.isJustPressed("replay") && !this.dialogue.isActive()) {
      this.dialogue.play(SCRIPT);
    }
    this.dialogue.setInputEnabled(!this.inventory.isOpen());
  }
}

/** Hosts `DemoControls` and the pause banner it shows. The entity has no
 *  Transform, so the banner's position is in screen pixels. */
class ControlsEntity extends Entity {
  controls!: DemoControls;

  setup(params: {
    conversation: ConversationEntity;
    backpack: BackpackEntity;
  }): void {
    const banner = this.spawnChild("pause-banner");
    banner.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    const text = banner.add(
      new LocalizedTextComponent({
        message: msg("paused", "❙❙ PAUSED"),
        style: { fontSize: 34, fill: 0xffe08a },
        anchor: { x: 0.5, y: 0.5 },
        visible: false,
      }),
    );
    this.controls = this.add(
      new DemoControls(
        params.conversation.dialogue,
        params.backpack.controller,
        text,
      ),
    );
  }
}

/** Inspector-readable state for the e2e test and for a human poking at
 *  `localization-probe`. Counts the events the dialogue and inventory
 *  controllers emit, which bubble to the scene: a language switch must leave
 *  the counts alone. */
class LocalizationProbe extends Component {
  private readonly localization = this.service(LocalizationKey);
  dropdownSelection = 0;
  dialogueLines = 0;
  dialogueCommands = 0;
  dialogueCompletions = 0;
  dialogueChoices = 0;
  inventoryActions = 0;

  constructor(
    private readonly conversation: ConversationEntity,
    private readonly backpack: BackpackEntity,
    private readonly controls: DemoControls,
  ) {
    super();
  }

  onAdd(): void {
    this.listenScene(DialogueLineEvent, () => this.dialogueLines++);
    this.listenScene(DialogueCommandEvent, () => this.dialogueCommands++);
    this.listenScene(
      DialogueRevealCompletedEvent,
      () => this.dialogueCompletions++,
    );
    this.listenScene(DialogueChoiceMadeEvent, () => this.dialogueChoices++);
    this.listenScene(InventoryActionEvent, () => this.inventoryActions++);
  }

  get locale(): string {
    return this.localization.locale;
  }
  get paused(): boolean {
    return this.controls.paused;
  }
  get dialogueActive(): boolean {
    return this.conversation.dialogue.isActive();
  }
  get dialogueChoosing(): boolean {
    return this.conversation.dialogue.isChoosing();
  }
  get inventoryOpen(): boolean {
    return this.backpack.controller.isOpen();
  }
  get inventoryMenuOpen(): boolean {
    return this.backpack.controller.isMenuOpen();
  }
  get inventoryQuantity(): number {
    return this.backpack.model.count("potion");
  }
  get inventorySelection(): number {
    return this.backpack.controller.selection();
  }
}

/** The React corner: `<Trans>` for labels, `useLocalization` where a string
 *  is needed (a button label), `LocalizedPixiSelect` for a dropdown. */
function Hud({
  controls,
  probe,
}: {
  controls: DemoControls;
  probe: LocalizationProbe;
}): React.JSX.Element {
  const { t } = useLocalization();
  return (
    <Panel direction="column" gap={7} alignItems="stretch">
      <Button
        onClick={() => controls.cycleLocale()}
        bg={{ color: 0x44475a, radius: 6 }}
        hoverBg={{ color: 0x6272a4, radius: 6 }}
        textStyle={{ fill: 0xf8f8f2, fontSize: 15 }}
      >
        {t(msg("language", "Language: English"))}
      </Button>
      <Trans
        message={msg("react", "React UI")}
        style={{ fill: 0xbd93f9, fontSize: 17 }}
      />
      <Trans
        message={msg(
          "quest.observatory.title",
          QUESTS.get("observatory").title,
        )}
        style={{ fill: 0xf8f8f2, fontSize: 15 }}
      />
      <Text style={{ fill: 0xf8f8f2, fontSize: 13 }}>
        Literal stays literal
      </Text>
      <LocalizedPixiSelect
        closedBG={rect(0x44475a)}
        openBG={rect(0x282a36)}
        textStyle={{ fill: 0xf8f8f2, fontSize: 16 }}
        itemBG={0x282a36}
        itemHoverBG={0x44475a}
        itemTextStyle={{ fill: 0xf8f8f2, fontSize: 16 }}
        items={[msg("difficulty.easy", "Easy"), msg("difficulty.hard", "Hard")]}
        onSelect={(index) => (probe.dropdownSelection = index)}
      />
    </Panel>
  );
}

class LocalizationScene extends Scene {
  readonly name = "localization-example";
  readonly layers: LayerDef[] = [...DIALOGUE_LAYERS, ...INVENTORY_LAYERS];

  // The scene only assembles the page. The controllers, DemoControls and the
  // probe hold the rules and the counts.
  onEnter(): void {
    const renderer = this.spawn("renderer-localized");
    renderer.add(new Transform({ position: { x: 24, y: 24 } }));
    renderer.add(
      new LocalizedTextComponent({
        message: msg("renderer", "Renderer fallback: {count}", { count: 2 }),
        style: { fill: 0xffffff, fontSize: 20 },
      }),
    );
    const fallback = this.spawn("literal-and-fallback");
    fallback.add(new Transform({ position: { x: 24, y: 54 } }));
    fallback.add(
      new LocalizedTextComponent({
        message: msg("missing", "Missing-key fallback stays visible"),
        style: { fill: 0xffb86c, fontSize: 15 },
      }),
    );
    const split = this.spawn("renderer-split");
    split.add(new Transform({ position: { x: 24, y: 80 } }));
    split.add(
      new LocalizedSplitTextComponent({
        message: msg("split", "Split text"),
        autoSplit: false,
        style: { fill: 0xffd866, fontSize: 17 },
      }),
    );
    const surface = this.spawn("imperative-ui").add(
      new LocalizedUISurface({
        anchor: Anchor.TopLeft,
        offset: { x: 24, y: 115 },
        padding: 8,
      }),
    );
    surface.text(msg("imperative", "Imperative UI"), {
      fill: 0x8be9fd,
      fontSize: 17,
    });
    const hint = this.spawn("controls-hint");
    hint.add(new Transform({ position: { x: 24, y: 160 } }));
    hint.add(
      new LocalizedTextComponent({
        message: msg("hint", "L language · Enter advance"),
        style: { fill: 0x8888aa, fontSize: 13 },
      }),
    );

    const conversation = this.spawn(ConversationEntity);
    const backpack = this.spawn(BackpackEntity);
    const { controls } = this.spawn(ControlsEntity, { conversation, backpack });
    const probe = this.spawn("localization-probe").add(
      new LocalizationProbe(conversation, backpack, controls),
    );

    const root = this.spawn("react-ui").add(
      new UIRoot({ anchor: Anchor.TopRight, offset: { x: -24, y: 20 } }),
    );
    root.render(<Hud controls={controls} probe={probe} />);

    conversation.dialogue.play(SCRIPT);
  }
}

async function main(): Promise<void> {
  // Dialogue uses this service as its `I18nAdapter` with no wrapper; the
  // annotation fails to typecheck if the two contracts drift apart.
  const localization: Localization & I18nAdapter = await createLocalization({
    locale: "en",
    fallbackLocale: "en",
    catalogs,
  });
  const engine = new Engine({ debug: true });
  engine.use(new LocalizationPlugin(localization));
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      virtualWidth: WIDTH,
      virtualHeight: HEIGHT,
      backgroundColor: 0x0b0c18,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        // The controllers' default bindings read these names.
        interact: ["Enter", "Space", "KeyE"],
        "move-up": ["ArrowUp", "KeyW"],
        "move-down": ["ArrowDown", "KeyS"],
        "move-left": ["ArrowLeft", "KeyA"],
        "move-right": ["ArrowRight", "KeyD"],
        cancel: ["Escape"],
        sort: ["KeyR"],
        inventory: ["KeyI"],
        // The example's own keys (DemoControls).
        language: ["KeyL"],
        pause: ["KeyP"],
        replay: ["KeyT"],
      },
      preventDefaultKeys: [
        "Space",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ],
    }),
  );
  engine.use(new UIPlugin());
  engine.use(new UIReactPlugin());
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new LocalizationScene());
}
main().catch(console.error);
