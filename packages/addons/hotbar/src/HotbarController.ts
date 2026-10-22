import { Component, ErrorBoundaryKey, LoggerKey } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import type { Hotbar } from "./core/Hotbar.js";
import type { HotbarState } from "./core/types.js";
import type {
  HotbarDriver,
  HotbarInputBinding,
  HotbarPresenter,
} from "./adapter.js";
import { hotbarControls } from "./controls.js";
import { HotbarActivationEvent, HotbarChangedEvent } from "./events.js";

export interface HotbarControllerOptions<TId extends string> {
  readonly model: Hotbar<TId>;
  readonly presenter?: HotbarPresenter;
  /** Omit for default keyboard/gamepad and pointer controls; null for host control. */
  readonly input?: HotbarInputBinding | null;
}

/** Mounts a hotbar on an entity: device input, presentation, error attribution and entity events. */
export class HotbarController<TId extends string = string> extends Component {
  static inspectExclude = ["model", "presenter", "binding", "driver", "target"];
  /** The bar's assignments and actions. Game code reads and changes the bar here. */
  readonly model: Hotbar<TId>;
  private readonly presenter: HotbarPresenter | undefined;
  private readonly binding: HotbarInputBinding | null;
  private readonly driver: HotbarDriver;
  private readonly target: Pick<HotbarPresenter, "slotAtPoint">;
  private mounted = false;
  private bindingActive = false;
  /** True while `bind()` runs. A focus change made then applies once it returns. */
  private bindingPending = false;
  private inputEnabled = true;

  constructor(options: HotbarControllerOptions<TId>) {
    super();
    const model = options.model;
    const active = (): boolean => this.isInteractive();
    this.model = model;
    this.presenter = options.presenter;
    this.binding =
      options.input === null ? null : (options.input ?? hotbarControls());
    this.target = {
      slotAtPoint: (x, y) =>
        this.call("presenter.slotAtPoint", () =>
          this.presenter?.slotAtPoint?.(x, y),
        ),
    };
    this.driver = {
      get slotCount() {
        return model.slotCount;
      },
      get selection() {
        return model.selection;
      },
      isInteractive: active,
      select: (slot) => {
        if (active()) model.select(slot);
      },
      cycle: (direction) => {
        if (active()) model.cycle(direction);
      },
      activate: (slot) =>
        active() ? model.activate(slot) : { ok: false, reason: "inactive" },
      release: (slot) => {
        model.release(slot);
      },
      clear: (slot) => {
        if (active()) model.clear(slot);
      },
      swap: (a, b) => {
        if (active()) model.swap(a, b);
      },
    };
  }

  /** Inspector-readable state uses the same live reads as the view. */
  get diagnostic(): HotbarState<TId> & {
    readonly inputEnabled: boolean;
    readonly active: boolean;
  } {
    return {
      ...this.model.inspect(),
      inputEnabled: this.inputEnabled,
      active: this.isInteractive(),
    };
  }

  onAdd(): void {
    const release = this.model._attach(this, this.use(ErrorBoundaryKey), {
      kind: "Hotbar",
      entity: this.entity.name,
      scene: this.scene.name,
    });
    this.addCleanup(release);
    this.addCleanup(
      this.model.on((event) => {
        if (event.type === "changed")
          this.entity.emit(HotbarChangedEvent, event.snapshot);
        else this.entity.emit(HotbarActivationEvent, event.activation);
      }),
    );
    this.call("presenter.mount", () => this.presenter?.mount(this.scene));
    this.call("presenter.setVisible", () => this.presenter?.setVisible(false));
    this.mounted = true;
  }

  onEnable(): void {
    this.call("presenter.setVisible", () => this.presenter?.setVisible(true));
    this.present();
    this.syncInput();
  }
  onDisable(): void {
    this.stopInput();
    this.call("presenter.setVisible", () => this.presenter?.setVisible(false));
  }
  onDestroy(): void {
    this.mounted = false;
    this.stopInput();
    this.call("presenter.dispose", () => this.presenter?.dispose());
  }
  update(): void {
    if (this.bindingActive) this.call("input.poll", () => this.binding?.poll());
    if (this.mounted && this.effectiveEnabled) this.present();
  }

  /** Device focus only. The model stays usable from game code. */
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    this.syncInput();
  }

  private isInteractive(): boolean {
    return this.mounted && this.effectiveEnabled && !this.scene.isPaused;
  }
  private wantsInput(): boolean {
    return (
      this.mounted &&
      this.effectiveEnabled &&
      this.inputEnabled &&
      this.binding !== null
    );
  }
  private syncInput(): void {
    if (!this.wantsInput()) {
      this.stopInput();
      return;
    }
    if (this.bindingActive || this.bindingPending) return;
    const input = this.use(InputManagerKey);
    const names = this.call(
      "input.actionNames",
      () => this.binding?.actionNames?.() ?? [],
    );
    if (
      names.length &&
      !names.some((name) => input.getActionNames().includes(name))
    )
      this.context
        .tryResolve(LoggerKey)
        ?.warn(
          "hotbar",
          `No hotbar actions are mapped (${names.join(", ")}). Install HOTBAR_ACTION_MAP or supply custom controls.`,
        );
    this.bindingPending = true;
    try {
      this.call("input.bind", () =>
        this.binding?.bind(input, this.driver, this.target),
      );
    } finally {
      // Only the in-progress flag is reset; no callbacks run here.
      this.bindingPending = false;
    }
    this.bindingActive = true;
    if (!this.wantsInput()) this.stopInput();
  }
  private stopInput(): void {
    if (!this.bindingActive) return;
    this.bindingActive = false;
    this.call("input.dispose", () => this.binding?.dispose());
  }
  private present(): void {
    if (this.presenter)
      this.call("presenter.present", () =>
        this.presenter?.present(this.model.inspect()),
      );
  }
  private call<T>(kind: string, fn: () => T): T {
    let value!: T;
    this.use(ErrorBoundaryKey).wrapCallback(
      () => {
        value = fn();
      },
      {
        kind: `Hotbar ${kind}`,
        entity: this.entity.name,
        scene: this.scene.name,
      },
    );
    return value;
  }
}
