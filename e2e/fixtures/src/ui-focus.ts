import { Component, Engine, Scene, InspectorKey } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { Anchor, UICheckbox, UIPlugin, UISurface } from "@yagejs/ui";
import type {
  UIElement,
  UIFocusScope,
  UIPanel,
  UIScrollView,
} from "@yagejs/ui";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 360;
const HEIGHT = 400;
const ROW_WIDTH = 200;
const ROW_HEIGHT = 30;
const LIST_WIDTH = 180;
const LIST_HEIGHT = 84;
const LIST_ROWS = 10;

const container = setupContainer(WIDTH, HEIGHT);

/** Row label per element, so the probe can name the focused one. */
const labels = new Map<UIElement, string>();

// Module refs the probe reports. The menu starts hidden, so a spec can assert
// that the very press opening it confirms nothing.
let menu: UISurface | null = null;
let dialog: UIPanel | null = null;
let list: UIScrollView | null = null;
let checkbox: UICheckbox | null = null;
let volume = 60;
let clicks = 0;
let uploadClicks = 0;
let deleteClicks = 0;

function labelOf(element: UIElement | null | undefined): string {
  if (!element) return "";
  return labels.get(element) ?? element.constructor.name;
}

/**
 * Shows the menu on the same action the menu's confirm role reads, which is
 * what puts the scope's press latch under test.
 */
class MenuOpener extends Component {
  private readonly input = this.service(InputManagerKey);

  update(): void {
    if (menu === null || menu.visible) return;
    if (this.input.isJustPressed("interact")) menu.visible = true;
  }
}

/**
 * Reports focus, the stepper value, the list offset and the click counters as
 * getters, which the Inspector reads at the moment a spec asks. Mirroring them
 * into fields from `update()` would report the state as it stood one phase
 * before `UIFocusSystem` ran, so every read would trail the frame by one.
 */
class FocusProbe extends Component {
  /** The scope holding input: the dialog's, the menu's, or neither. */
  private get active(): { name: string; scope: UIFocusScope | null } {
    const dialogScope = dialog?.focusScope ?? null;
    if (dialogScope?.hasInput === true) {
      return { name: "dialog", scope: dialogScope };
    }
    const menuScope = menu?.focusScope ?? null;
    if (menuScope?.hasInput === true) {
      return { name: "menu", scope: menuScope };
    }
    return { name: "none", scope: null };
  }

  /** Label of the row the scope holding input has focused. */
  get focusedLabel(): string {
    return labelOf(this.active.scope?.focused);
  }

  /** Label the menu scope remembers, whether or not it holds input. */
  get menuFocusedLabel(): string {
    return labelOf(menu?.focusScope?.focused);
  }

  /** Which scope holds input: `menu`, `dialog` or `none`. */
  get activeScope(): string {
    return this.active.name;
  }

  get volume(): number {
    return volume;
  }

  get music(): boolean {
    return checkbox?.checked ?? false;
  }

  get listOffset(): number {
    return list?.scrollOffset ?? 0;
  }

  get clicks(): number {
    return clicks;
  }

  get uploadClicks(): number {
    return uploadClicks;
  }

  get deleteClicks(): number {
    return deleteClicks;
  }

  get menuVisible(): boolean {
    return menu?.visible ?? false;
  }

  get dialogVisible(): boolean {
    return dialog?.visible ?? false;
  }
}

class FocusScene extends Scene {
  readonly name = "ui-focus-scene";

  onEnter(): void {
    const entity = this.spawn("ui-state");
    entity.add(new MenuOpener());
    entity.add(new FocusProbe());

    const surface = entity.add(
      new UISurface({
        anchor: Anchor.Center,
        direction: "column",
        gap: 4,
        padding: 12,
        background: { color: 0x101018, alpha: 1, radius: 8 },
        focus: { wrap: true },
      }),
    );
    surface.visible = false;
    menu = surface;

    const menuRow = (
      label: string,
      disabled: boolean,
      onPress?: () => void,
    ): void => {
      const button = surface.button(label, {
        width: ROW_WIDTH,
        height: ROW_HEIGHT,
        disabled,
        onClick: () => {
          clicks += 1;
          onPress?.();
        },
      });
      labels.set(button, label);
    };

    menuRow("Resume", false);
    menuRow("Delete save", false, () => {
      if (dialog) dialog.visible = true;
    });
    menuRow("Upload to cloud", true, () => {
      uploadClicks += 1;
    });
    menuRow("Quit", false);

    // A stepper row: left and right change the value and keep focus, while up
    // and down still move between rows.
    const stepper = surface.panel({
      direction: "row",
      width: ROW_WIDTH,
      height: ROW_HEIGHT,
      padding: 4,
      background: { color: 0x222230, radius: 4 },
      focusable: true,
      focusId: "volume",
      onAdjust: (direction) => {
        volume = Math.max(0, Math.min(100, volume + direction * 5));
        readout.setText(`Volume ${volume}`);
      },
    });
    const readout = stepper.text(`Volume ${volume}`);
    labels.set(stepper, "Volume");

    const music = new UICheckbox({
      label: "Music",
      checked: true,
      width: ROW_WIDTH,
      height: ROW_HEIGHT,
    });
    surface.addElement(music);
    labels.set(music, "Music");
    checkbox = music;

    const scrollView = surface.scrollView({
      width: ROW_WIDTH,
      height: LIST_HEIGHT,
      gap: 4,
      background: { color: 0x0b1220, radius: 4 },
    });
    for (let i = 1; i <= LIST_ROWS; i++) {
      const label = `Row ${i}`;
      const row = scrollView.button(label, {
        width: LIST_WIDTH,
        height: ROW_HEIGHT,
        onClick: () => {
          clicks += 1;
        },
      });
      labels.set(row, label);
    }
    list = scrollView;

    // A confirm dialog: hidden, and a scope of its own. Showing it hands the
    // keys over; hiding it hands them back on the row the menu had.
    const confirm = surface.panel({
      direction: "column",
      width: ROW_WIDTH,
      gap: 4,
      padding: 4,
      visible: false,
      background: { color: 0x2a1020, radius: 4 },
      focus: {
        onCancel: () => {
          confirm.visible = false;
        },
      },
    });
    confirm.text("Delete this save?");
    const remove = confirm.button("Delete", {
      width: LIST_WIDTH,
      height: ROW_HEIGHT,
      onClick: () => {
        deleteClicks += 1;
        confirm.visible = false;
      },
    });
    labels.set(remove, "Delete");
    const keep = confirm.button("Keep", {
      width: LIST_WIDTH,
      height: ROW_HEIGHT,
      onClick: () => {
        confirm.visible = false;
      },
    });
    labels.set(keep, "Keep");
    dialog = confirm;
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    virtualWidth: WIDTH,
    virtualHeight: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container,
  }),
);
engine.use(
  new InputPlugin({
    actions: {
      "move-up": ["ArrowUp", "GamepadLeftStickUp", "GamepadDPadUp"],
      "move-down": ["ArrowDown", "GamepadLeftStickDown", "GamepadDPadDown"],
      "move-left": ["ArrowLeft", "GamepadLeftStickLeft", "GamepadDPadLeft"],
      "move-right": ["ArrowRight", "GamepadLeftStickRight", "GamepadDPadRight"],
      interact: ["Enter", "GamepadA"],
      cancel: ["Escape", "GamepadB"],
    },
  }),
);
engine.use(new UIPlugin());
engine.use(new DebugPlugin());
await engine.start();
// Injected pad state stays applied: real polling reconciles every gamepad code
// against the pads the browser reports, and a test machine reports none.
engine.context.resolve(InputManagerKey).setPollingEnabled(false);
engine.context.resolve(InspectorKey).time.freeze();
await engine.scenes.push(new FocusScene());
