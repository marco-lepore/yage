import type {
  ControlDef,
  ControlSchema,
  ControlValue,
} from "../grammar/controls.js";
import type { RegistryProblem, ScenarioEntry } from "./ScenarioRegistry.js";

export interface PanelCallbacks {
  onSelect(id: string): void;
  onControlChange(name: string, value: ControlValue): void;
}

export interface PanelOptions {
  width: number;
  height: number;
  scenarios: readonly ScenarioEntry[];
  problems: readonly RegistryProblem[];
  callbacks: PanelCallbacks;
}

const STYLE_ID = "yage-lab-style";

const CSS = `
.yage-lab { display: flex; align-items: flex-start; gap: 16px; font: 13px/1.5 system-ui, sans-serif; color: #e2e8f0; }
.yage-lab__sidebar { flex: 0 0 240px; display: flex; flex-direction: column; gap: 20px; }
.yage-lab__heading { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #94a3b8; }
.yage-lab__list { display: flex; flex-direction: column; gap: 2px; }
.yage-lab__item { appearance: none; border: 0; border-radius: 4px; background: transparent; color: #cbd5e1; font: inherit; text-align: left; padding: 5px 8px; cursor: pointer; }
.yage-lab__item:hover { background: #1e293b; }
.yage-lab__item[aria-current="true"] { background: #334155; color: #f8fafc; }
.yage-lab__control { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
.yage-lab__control-label { display: flex; justify-content: space-between; gap: 8px; color: #94a3b8; }
.yage-lab__control-value { color: #f8fafc; font-variant-numeric: tabular-nums; }
.yage-lab__control input[type="range"] { width: 100%; }
.yage-lab__control select { background: #1e293b; color: #f8fafc; border: 1px solid #334155; border-radius: 4px; padding: 3px 6px; font: inherit; }
.yage-lab__empty { color: #94a3b8; }
.yage-lab__problems { color: #fca5a5; }
.yage-lab__problem { margin-bottom: 6px; word-break: break-word; }
.yage-lab__problem code { color: #fecaca; }
.yage-lab__stage { display: flex; flex-direction: column; gap: 8px; }
.yage-lab__title { margin: 0; font-size: 15px; color: #f8fafc; }
.yage-lab__describe { margin: 0; color: #94a3b8; max-width: 60ch; }
.yage-lab__canvas { background: #0f172a; border-radius: 6px; overflow: hidden; }
.yage-lab__error { margin: 0; padding: 6px 10px; border-radius: 4px; background: #450a0a; color: #fecaca; max-width: 60ch; }
.yage-lab__error:empty { display: none; }
`;

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Numbers read back at the control's own precision rather than 0.30000000000000004. */
function formatNumber(def: ControlDef, value: number): string {
  if (def.kind === "int") return String(Math.round(value));
  const decimals = def.kind === "number" ? decimalsOf(def.step) : 0;
  return value.toFixed(decimals);
}

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(text.length - dot - 1, 6);
}

/**
 * The lab's own chrome: the scenario list, the control widgets, and the element
 * the game's renderer mounts into.
 */
export class LabPanel {
  readonly root: HTMLElement;
  /** Passed to the harness as `HarnessContext.container`. */
  readonly container: HTMLElement;

  private readonly list: HTMLElement;
  private readonly controlsBox: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly describeEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly items = new Map<string, HTMLButtonElement>();
  private readonly widgets = new Map<string, (value: ControlValue) => void>();
  private readonly callbacks: PanelCallbacks;

  constructor(host: HTMLElement, opts: PanelOptions) {
    this.callbacks = opts.callbacks;
    injectStyle(host.ownerDocument);

    this.root = el("div", "yage-lab");
    const sidebar = el("aside", "yage-lab__sidebar");
    const stage = el("main", "yage-lab__stage");

    const listBox = el("section");
    listBox.append(el("h2", "yage-lab__heading", "Scenarios"));
    this.list = el("nav", "yage-lab__list");
    listBox.append(this.list);

    this.controlsBox = el("section");

    sidebar.append(listBox, this.controlsBox);
    if (opts.problems.length > 0) {
      sidebar.append(this.renderProblems(opts.problems));
    }

    this.titleEl = el("h1", "yage-lab__title");
    this.describeEl = el("p", "yage-lab__describe");
    this.errorEl = el("p", "yage-lab__error");
    this.errorEl.setAttribute("role", "alert");
    this.container = el("div", "yage-lab__canvas");
    this.container.style.width = `${opts.width}px`;
    this.container.style.height = `${opts.height}px`;
    stage.append(this.titleEl, this.describeEl, this.errorEl, this.container);

    this.root.append(sidebar, stage);
    host.append(this.root);

    this.renderList(opts.scenarios);
    if (opts.scenarios.length === 0) this.showEmpty();
  }

  /** Switches the highlighted entry and rebuilds the control widgets. */
  setCurrent(entry: ScenarioEntry, values: Record<string, ControlValue>): void {
    for (const [id, button] of this.items) {
      button.setAttribute("aria-current", String(id === entry.id));
    }
    this.titleEl.textContent = entry.title;
    this.describeEl.textContent = entry.scenario.describe ?? "";
    this.renderControls(entry.scenario.controls, values);
  }

  /** Shows why the last rebuild failed, or clears it with `null`. */
  showError(message: string | null): void {
    this.errorEl.textContent = message ?? "";
  }

  /**
   * Writes values back into the widgets. Needed because `LabApi.setControl` is
   * also callable from outside the panel, and because a value the control
   * clamped has to show as what was actually applied.
   */
  syncValues(values: Record<string, ControlValue>): void {
    for (const [name, apply] of this.widgets) {
      const value = values[name];
      if (value !== undefined) apply(value);
    }
  }

  private showEmpty(): void {
    this.titleEl.textContent = "No scenarios found";
    this.describeEl.textContent =
      "Add a file named *.scenario.ts exporting a default defineScenario({...}).";
    this.list.append(el("p", "yage-lab__empty", "Nothing to show."));
  }

  private renderList(scenarios: readonly ScenarioEntry[]): void {
    for (const entry of scenarios) {
      const button = el("button", "yage-lab__item", entry.title);
      button.type = "button";
      button.title = entry.path;
      button.addEventListener("click", () => {
        this.callbacks.onSelect(entry.id);
      });
      this.items.set(entry.id, button);
      this.list.append(button);
    }
  }

  private renderProblems(problems: readonly RegistryProblem[]): HTMLElement {
    const box = el("section", "yage-lab__problems");
    box.append(el("h2", "yage-lab__heading", `Skipped (${problems.length})`));
    for (const problem of problems) {
      const line = el("div", "yage-lab__problem");
      line.append(el("code", undefined, problem.path), ` — ${problem.message}`);
      box.append(line);
    }
    return box;
  }

  private renderControls(
    controls: ControlSchema | undefined,
    values: Record<string, ControlValue>,
  ): void {
    this.controlsBox.replaceChildren();
    this.widgets.clear();
    const entries = Object.entries(controls ?? {});
    if (entries.length === 0) return;

    this.controlsBox.append(el("h2", "yage-lab__heading", "Controls"));
    for (const [name, def] of entries) {
      this.controlsBox.append(this.renderControl(name, def, values[name]));
    }
  }

  private renderControl(
    name: string,
    def: ControlDef,
    value: ControlValue | undefined,
  ): HTMLElement {
    const box = el("div", "yage-lab__control");
    const labelRow = el("label", "yage-lab__control-label");
    labelRow.append(el("span", undefined, def.label ?? name));
    const readout = el("span", "yage-lab__control-value");
    labelRow.append(readout);
    box.append(labelRow);

    const emit = (next: ControlValue): void => {
      this.callbacks.onControlChange(name, next);
    };

    if (def.kind === "boolean") {
      const input = el("input");
      input.type = "checkbox";
      const apply = (next: ControlValue): void => {
        input.checked = next === true;
        readout.textContent = input.checked ? "on" : "off";
      };
      apply(value ?? def.value);
      input.addEventListener("change", () => {
        apply(input.checked);
        emit(input.checked);
      });
      labelRow.prepend(input);
      this.widgets.set(name, apply);
    } else if (def.kind === "select") {
      const select = el("select");
      for (const option of def.options) {
        const node = el("option", undefined, option);
        node.value = option;
        select.append(node);
      }
      const apply = (next: ControlValue): void => {
        select.value = typeof next === "string" ? next : def.value;
      };
      apply(value ?? def.value);
      select.addEventListener("change", () => {
        emit(select.value);
      });
      box.append(select);
      this.widgets.set(name, apply);
    } else {
      const input = el("input");
      input.type = "range";
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      const apply = (next: ControlValue): void => {
        const numeric = typeof next === "number" ? next : def.value;
        input.value = String(numeric);
        readout.textContent = formatNumber(def, numeric);
      };
      apply(value ?? def.value);
      input.addEventListener("input", () => {
        apply(Number(input.value));
        emit(Number(input.value));
      });
      box.append(input);
      this.widgets.set(name, apply);
    }

    return box;
  }
}
