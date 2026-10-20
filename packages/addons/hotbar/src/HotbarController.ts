import { Component, ErrorBoundaryKey, LoggerKey } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import type { Hotbar } from "./core/Hotbar.js";
import type { HotbarActionResult, HotbarState } from "./core/types.js";
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

export class HotbarController<TId extends string = string>
  extends Component
  implements HotbarDriver
{
  static inspectExclude = ["options", "binding", "model", "target"];
  private readonly binding: HotbarInputBinding | null;
  private mounted = false;
  private bindingActive = false;
  private inputEnabled = true;
  private readonly target: Pick<HotbarPresenter, "slotAtPoint">;

  constructor(private readonly options: HotbarControllerOptions<TId>) {
    super();
    this.binding =
      options.input === null ? null : (options.input ?? hotbarControls());
    this.target = {
      slotAtPoint: (x, y) =>
        this.call("presenter.slotAtPoint", () =>
          options.presenter?.slotAtPoint?.(x, y),
        ),
    };
  }

  get model(): Hotbar<TId> {
    return this.options.model;
  }
  get slotCount(): number {
    return this.model.slotCount;
  }
  get selection(): number {
    return this.model.selection;
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
    this.call("presenter.mount", () =>
      this.options.presenter?.mount(this.entity),
    );
    this.call("presenter.setVisible", () =>
      this.options.presenter?.setVisible(false),
    );
    this.mounted = true;
  }

  onEnable(): void {
    this.call("presenter.setVisible", () =>
      this.options.presenter?.setVisible(true),
    );
    this.present();
    this.syncInput();
  }
  onDisable(): void {
    this.stopInput();
    this.call("presenter.setVisible", () =>
      this.options.presenter?.setVisible(false),
    );
  }
  onDestroy(): void {
    this.mounted = false;
    this.stopInput();
    this.call("presenter.dispose", () => this.options.presenter?.dispose());
  }
  update(): void {
    if (this.bindingActive) this.call("input.poll", () => this.binding?.poll());
    if (this.mounted && this.effectiveEnabled) this.present();
  }

  /** Device focus only. Direct model calls remain available. */
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    this.syncInput();
  }
  isInteractive(): boolean {
    return this.mounted && this.effectiveEnabled && !this.scene.isPaused;
  }
  select(slot: number): void {
    if (this.isInteractive()) this.model.select(slot);
  }
  cycle(direction: -1 | 1): void {
    if (this.isInteractive()) this.model.cycle(direction);
  }
  assign(slot: number, id: TId): void {
    if (this.isInteractive()) this.model.assign(slot, id);
  }
  clear(slot: number): void {
    if (this.isInteractive()) this.model.clear(slot);
  }
  swap(a: number, b: number): void {
    if (this.isInteractive()) this.model.swap(a, b);
  }
  activate(slot = this.selection): HotbarActionResult {
    return this.isInteractive()
      ? this.model.activate(slot)
      : { ok: false, reason: "inactive" };
  }

  private syncInput(): void {
    if (
      !this.mounted ||
      !this.effectiveEnabled ||
      !this.inputEnabled ||
      !this.binding
    ) {
      this.stopInput();
      return;
    }
    if (this.bindingActive) return;
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
    this.call("input.bind", () => this.binding?.bind(input, this, this.target));
    this.bindingActive = true;
  }
  private stopInput(): void {
    if (!this.bindingActive) return;
    this.call("input.dispose", () => this.binding?.dispose());
    this.bindingActive = false;
  }
  private present(): void {
    if (this.options.presenter)
      this.call("presenter.present", () =>
        this.options.presenter?.present(this.model.inspect()),
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
