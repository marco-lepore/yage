import type {
  ControlDef,
  ControlSchema,
  ControlValue,
} from "../grammar/controls.js";
import { CLOCK_SPEEDS, nearestSpeedIndex } from "./LabClock.js";
import type { LabError } from "./labErrors.js";
import { buildScenarioTree, type ScenarioNode } from "./scenarioGroups.js";
import type { RegistryProblem, ScenarioEntry } from "./ScenarioRegistry.js";
import type { RunPace } from "./runDrive.js";

export interface PanelCallbacks {
  onSelect(id: string): void;
  onControlChange(name: string, value: ControlValue): void;
  /** Play if the clock is paused, pause if it is running. */
  onPlayToggle(): void;
  onStep(frames: number): void;
  onSpeedChange(speed: number): void;
  /** Run the current scenario's `drive`. */
  onRun(pace: RunPace): void;
}

export interface PanelOptions {
  width: number;
  height: number;
  scenarios: readonly ScenarioEntry[];
  problems: readonly RegistryProblem[];
  callbacks: PanelCallbacks;
}

/** What the clock section shows. */
export interface ClockView {
  readonly running: boolean;
  readonly speed: number;
  readonly frame: number;
}

/** Where a driven run got to. */
export type RunView =
  | { readonly state: "running" }
  | {
      readonly state: "pass";
      readonly framesUsed: number;
      readonly durationMs: number;
    }
  | { readonly state: "fail"; readonly message: string };

const STYLE_ID = "yage-lab-style";

const CSS = `
/* Each column scrolls on its own, so a long scenario list cannot move the
   canvas out of view. */
.yage-lab { display: flex; align-items: stretch; gap: 16px; height: 100%; max-height: 100dvh; font: 13px/1.5 system-ui, sans-serif; color: #e2e8f0; }
.yage-lab__sidebar { flex: 0 0 240px; display: flex; flex-direction: column; gap: 20px; min-height: 0; overflow-y: auto; padding-right: 4px; }
/* As wide as the canvas where the window allows it, so the control widgets
   match the scene they tune. In a window too narrow for all three columns the
   stage is the one that gives way, and scrolls sideways over the canvas. */
.yage-lab__stage { flex: 0 1 auto; display: flex; flex-direction: column; gap: 8px; min-height: 0; min-width: 0; overflow: auto; padding-right: 4px; }
.yage-lab__aside { flex: 0 0 260px; min-height: 0; overflow-y: auto; padding-right: 4px; }
/* A window too short for the column scrolls it, rather than shrinking the
   canvas below the size the harness asked for. */
.yage-lab__sidebar > *, .yage-lab__stage > * { flex: none; }
.yage-lab__heading { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #94a3b8; }
.yage-lab__head { display: flex; align-items: baseline; gap: 6px; }
.yage-lab__head .yage-lab__heading { margin-right: auto; }
.yage-lab__mini { appearance: none; border: 1px solid #334155; border-radius: 4px; background: #1e293b; color: #94a3b8; font-family: inherit; font-size: 11px; padding: 1px 6px; margin-bottom: 6px; cursor: pointer; }
.yage-lab__mini:hover { background: #334155; color: #e2e8f0; }
.yage-lab__filter { width: 100%; box-sizing: border-box; margin-bottom: 8px; background: #0f172a; border: 1px solid #1e293b; border-radius: 4px; color: #e2e8f0; font: inherit; padding: 4px 8px; }
.yage-lab__filter::placeholder { color: #64748b; }
.yage-lab__list { display: flex; flex-direction: column; gap: 2px; }
/* A group is a block container, so its rows need the spacing the list's own
   gap gives the entries outside one. */
.yage-lab__group > * + * { margin-top: 2px; }
.yage-lab__group + .yage-lab__group { margin-top: 10px; }
.yage-lab__group--nested + .yage-lab__group--nested { margin-top: 4px; }
.yage-lab__group-name { margin: 0 0 2px; font-size: 11px; letter-spacing: .04em; color: #64748b; cursor: pointer; list-style: none; user-select: none; }
.yage-lab__group-name::-webkit-details-marker { display: none; }
.yage-lab__group-name::before { content: "▾ "; display: inline-block; width: 1em; }
.yage-lab__group:not([open]) > .yage-lab__group-name::before { content: "▸ "; }
.yage-lab__group-name:hover { color: #94a3b8; }
.yage-lab__item { appearance: none; border: 0; border-radius: 4px; background: transparent; color: #cbd5e1; font: inherit; text-align: left; padding: 5px 8px; cursor: pointer; display: block; width: 100%; }
/* The declared display above outranks the browser's own rule for [hidden],
   which is what the filter hides a row with. */
.yage-lab__item[hidden] { display: none; }
.yage-lab__item:hover { background: #1e293b; }
.yage-lab__item[aria-current="true"] { background: #334155; color: #f8fafc; }
.yage-lab__controls { border-top: 1px solid #1e293b; padding-top: 10px; margin-top: 2px; }
/* Four rows before it scrolls, so a scenario with many controls cannot push
   the canvas off the top of the window. Beside the stage the column scrolls
   instead, and the list can run its full length. */
.yage-lab__control-list { max-height: 216px; overflow-y: auto; padding-right: 4px; }
.yage-lab__aside .yage-lab__controls { border-top: 0; padding-top: 0; margin-top: 0; }
.yage-lab__aside .yage-lab__control-list { max-height: none; overflow-y: visible; }
.yage-lab__control { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
.yage-lab__control:last-child { margin-bottom: 0; }
.yage-lab__control-label { display: flex; justify-content: space-between; gap: 8px; color: #94a3b8; }
.yage-lab__control-value { color: #f8fafc; font-variant-numeric: tabular-nums; }
.yage-lab__control input[type="range"] { width: 100%; }
.yage-lab__control select { background: #1e293b; color: #f8fafc; border: 1px solid #334155; border-radius: 4px; padding: 3px 6px; font: inherit; }
.yage-lab__empty { color: #94a3b8; }
.yage-lab__problems { color: #fca5a5; }
.yage-lab__problem { margin-bottom: 6px; word-break: break-word; }
.yage-lab__problem code { color: #fecaca; }
.yage-lab__title { margin: 0; font-size: 15px; color: #f8fafc; }
.yage-lab__describe { margin: 0; color: #94a3b8; max-width: 60ch; }
.yage-lab__canvas { background: #0f172a; border-radius: 6px; overflow: hidden; }
.yage-lab__canvas:focus { outline: 2px solid #334155; outline-offset: 2px; }
.yage-lab__canvas:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
.yage-lab__clock { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.yage-lab__button { appearance: none; border: 1px solid #334155; border-radius: 4px; background: #1e293b; color: #e2e8f0; font: inherit; padding: 3px 10px; cursor: pointer; }
.yage-lab__button:hover { background: #334155; }
.yage-lab__button:disabled { opacity: .4; cursor: not-allowed; background: #1e293b; }
.yage-lab__play { min-width: 62px; }
.yage-lab__run-button { margin-left: 8px; }
.yage-lab__real-time { display: flex; align-items: center; gap: 4px; color: #94a3b8; cursor: pointer; }
.yage-lab__run { color: #94a3b8; max-width: 70ch; word-break: break-word; }
.yage-lab__run--pass { color: #86efac; }
.yage-lab__run--fail { color: #fca5a5; }
.yage-lab__clock input[type="range"] { width: 110px; }
.yage-lab__readout { color: #94a3b8; font-variant-numeric: tabular-nums; }
.yage-lab__errors { display: flex; flex-direction: column; gap: 6px; max-width: 70ch; }
.yage-lab__error { margin: 0; padding: 6px 10px; border-radius: 4px; background: #450a0a; color: #fecaca; word-break: break-word; }
.yage-lab__error-kind { color: #fca5a5; font-weight: 600; }
.yage-lab__error-detail { color: #f5a5a5; font-size: 12px; }
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

/** Keys the browser scrolls the page with while the canvas holds focus. */
const SCROLL_KEYS = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

const PREFS_KEY = "yage-lab:panel";

/** Layout choices, which belong to whoever is using the panel, not to a link. */
interface PanelPrefs {
  /** Controls beside the stage rather than under it. */
  controlsRight: boolean;
  /** Group paths folded away. */
  collapsed: string[];
}

function defaultPrefs(): PanelPrefs {
  return { controlsRight: false, collapsed: [] };
}

function readPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw === null) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    return {
      controlsRight: parsed.controlsRight === true,
      collapsed: Array.isArray(parsed.collapsed)
        ? parsed.collapsed.filter((path) => typeof path === "string")
        : [],
    };
  } catch {
    // Storage can be unavailable or hold something else entirely. Neither is
    // worth failing a panel over.
    return defaultPrefs();
  }
}

function writePrefs(prefs: PanelPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Same: a lab that cannot remember the layout still works.
  }
}

/** One rendered scenario row, kept so the filter can hide it without a re-render. */
interface RenderedLeaf {
  readonly kind: "scenario";
  readonly element: HTMLElement;
  /** Lowercased text the filter matches against. */
  readonly search: string;
}

/** One rendered group fold, with the rows under it. */
interface RenderedGroup {
  readonly kind: "group";
  readonly element: HTMLDetailsElement;
  /** The path the collapsed set records. */
  readonly path: string;
  readonly children: readonly RenderedNode[];
}

type RenderedNode = RenderedGroup | RenderedLeaf;

/**
 * Hides every row with no match under it. A group matches through its
 * scenarios, whose text already carries the group names as a title prefix.
 *
 * Returns whether anything under `nodes` survived.
 */
function filterNodes(
  nodes: readonly RenderedNode[],
  needle: string,
  collapsed: ReadonlySet<string>,
): boolean {
  let anyVisible = false;
  for (const node of nodes) {
    let visible: boolean;
    if (node.kind === "group") {
      visible = filterNodes(node.children, needle, collapsed);
      // A filtered list is useless behind a fold, so a search opens what it
      // matched and clearing it puts the folds back as they were left.
      node.element.open = needle === "" ? !collapsed.has(node.path) : visible;
    } else {
      visible = needle === "" || node.search.includes(needle);
    }
    node.element.hidden = !visible;
    anyVisible ||= visible;
  }
  return anyVisible;
}

function describeRun(view: RunView): string {
  switch (view.state) {
    case "running":
      return "running…";
    case "pass":
      return `pass · ${view.framesUsed} frame${
        view.framesUsed === 1 ? "" : "s"
      } · ${Math.round(view.durationMs)} ms`;
    case "fail":
      return `fail — ${view.message}`;
  }
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
  private readonly filterInput: HTMLInputElement;
  private readonly noMatchEl: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly aside: HTMLElement;
  private readonly controlsBox: HTMLElement;
  private readonly controlList: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly layoutButton: HTMLButtonElement;
  private readonly titleEl: HTMLElement;
  private readonly describeEl: HTMLElement;
  private readonly errorsBox: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly speedInput: HTMLInputElement;
  private readonly readoutEl: HTMLElement;
  private readonly clockBar: HTMLElement;
  private readonly runButton: HTMLButtonElement;
  private readonly realTimeInput: HTMLInputElement;
  private readonly runEl: HTMLElement;
  private readonly items = new Map<string, HTMLButtonElement>();
  private readonly widgets = new Map<string, (value: ControlValue) => void>();
  private readonly callbacks: PanelCallbacks;
  private nodes: readonly RenderedNode[] = [];
  private prefs: PanelPrefs;
  private collapsed: Set<string>;
  /** What the copy button writes out. */
  private values: Record<string, ControlValue> = {};
  private copyTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the current scenario declares a `drive`. */
  private driveable = false;
  private runView: RunView | undefined;
  /** Whether an ad-hoc `LabApi.drive()` holds the run lock. */
  private busy = false;

  constructor(host: HTMLElement, opts: PanelOptions) {
    this.callbacks = opts.callbacks;
    this.prefs = readPrefs();
    this.collapsed = new Set(this.prefs.collapsed);
    injectStyle(host.ownerDocument);

    this.root = el("div", "yage-lab");
    const sidebar = el("aside", "yage-lab__sidebar");
    this.stage = el("main", "yage-lab__stage");
    this.aside = el("aside", "yage-lab__aside");

    const listBox = el("section");
    listBox.append(el("h2", "yage-lab__heading", "Scenarios"));
    this.filterInput = this.renderFilter();
    listBox.append(this.filterInput);
    this.list = el("nav", "yage-lab__list");
    this.noMatchEl = el("p", "yage-lab__empty", "No scenario matches.");
    this.noMatchEl.hidden = true;
    listBox.append(this.list, this.noMatchEl);

    // Under the stage by default: the scenario list grows with the project too,
    // and sharing the sidebar means the longer of the two pushes the other away.
    this.controlsBox = el("section", "yage-lab__controls");
    // The heading sits outside the scroller so it and its buttons stay put
    // while the values under them move.
    this.copyButton = this.mini(
      "copy JSON",
      "Copy every control value as JSON",
      () => {
        void this.copyValues();
      },
    );
    this.layoutButton = this.mini(
      "→ right",
      "Move the controls beside the stage",
      () => {
        this.setControlsRight(!this.prefs.controlsRight);
      },
    );
    const head = el("div", "yage-lab__head");
    head.append(
      el("h2", "yage-lab__heading", "Controls"),
      this.copyButton,
      this.layoutButton,
    );
    this.controlList = el("div", "yage-lab__control-list");
    this.controlsBox.append(head, this.controlList);
    // Nothing to show until a scenario is set.
    this.controlsBox.hidden = true;

    sidebar.append(listBox);
    if (opts.problems.length > 0) {
      sidebar.append(this.renderProblems(opts.problems));
    }

    this.titleEl = el("h1", "yage-lab__title");
    this.describeEl = el("p", "yage-lab__describe");
    this.errorsBox = el("section", "yage-lab__errors");
    this.errorsBox.setAttribute("role", "alert");
    this.container = this.renderCanvas(opts.width, opts.height);

    this.playButton = this.button("pause", "yage-lab__play", () => {
      this.callbacks.onPlayToggle();
    });
    this.speedInput = this.renderSpeed();
    this.readoutEl = el("span", "yage-lab__readout");
    this.runButton = this.button("run", "yage-lab__run-button", () => {
      this.callbacks.onRun(this.realTimeInput.checked ? "frame" : "immediate");
    });
    const realTime = el("label", "yage-lab__real-time");
    this.realTimeInput = el("input");
    this.realTimeInput.type = "checkbox";
    realTime.append(this.realTimeInput, "real time");
    this.runEl = el("span", "yage-lab__run");
    this.runEl.setAttribute("role", "status");
    this.clockBar = el("div", "yage-lab__clock");
    this.clockBar.append(
      this.playButton,
      this.button("+1", undefined, () => {
        this.callbacks.onStep(1);
      }),
      this.button("+10", undefined, () => {
        this.callbacks.onStep(10);
      }),
      this.speedInput,
      this.readoutEl,
      this.runButton,
      realTime,
    );

    this.stage.append(
      this.titleEl,
      this.describeEl,
      this.errorsBox,
      this.container,
      this.clockBar,
      this.runEl,
    );

    this.root.append(sidebar, this.stage, this.aside);
    host.append(this.root);

    this.renderList(opts.scenarios);
    this.applyControlsPlacement();
    this.applyRun();
    if (opts.scenarios.length === 0) this.showEmpty();
  }

  /** Switches the highlighted entry and rebuilds the control widgets. */
  setCurrent(entry: ScenarioEntry, values: Record<string, ControlValue>): void {
    for (const [id, button] of this.items) {
      button.setAttribute("aria-current", String(id === entry.id));
    }
    this.titleEl.textContent = entry.title;
    this.describeEl.textContent = entry.scenario.describe ?? "";
    this.values = values;
    this.renderControls(entry.scenario.controls, values);
    this.driveable = entry.hasDrive;
    // The result belongs to the scenario that produced it.
    this.setRun(undefined);
  }

  /** Shows where a run got to. `undefined` clears the line. */
  setRun(view: RunView | undefined): void {
    this.runView = view;
    this.applyRun();
  }

  /**
   * Disables what a driven call must be the only writer of, for the
   * duration of an ad-hoc `LabApi.drive()` — the same widgets a running
   * scenario `drive` disables. Does not mean the scenario's own `drive()`
   * ran.
   */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.applyRun();
  }

  /**
   * Writes the run's state into the button, the line, and everything a run has
   * to be the only writer of — the clock bar, the controls and the scenario
   * list all steer the clock or replace the scene under a run in flight.
   */
  private applyRun(): void {
    const running = this.busy || this.runView?.state === "running";
    // The control widgets, not the whole section: copying the values or moving
    // the column changes nothing a run reads.
    for (const box of [this.clockBar, this.controlList, this.list]) {
      const fields = box.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >("button, input, select");
      for (const field of fields) field.disabled = running;
    }
    this.runButton.disabled = running || !this.driveable;
    this.runButton.title = this.driveable
      ? "Run this scenario's drive()"
      : "This scenario declares no drive()";
    this.runEl.className =
      this.runView === undefined
        ? "yage-lab__run"
        : `yage-lab__run yage-lab__run--${this.runView.state}`;
    this.runEl.textContent =
      this.runView === undefined ? "" : describeRun(this.runView);
  }

  /** Replaces the errors section. An empty list leaves nothing on screen. */
  showErrors(errors: readonly LabError[]): void {
    this.errorsBox.replaceChildren();
    for (const error of errors) {
      const box = el("div", "yage-lab__error");
      box.append(
        el("span", "yage-lab__error-kind", error.kind),
        ` — ${error.message}`,
      );
      if (error.detail !== undefined) {
        box.append(el("div", "yage-lab__error-detail", error.detail));
      }
      this.errorsBox.append(box);
    }
  }

  /** Writes the clock's state into the play button, the slider and the readout. */
  setClock(state: ClockView): void {
    this.playButton.textContent = state.running ? "pause" : "play";
    this.speedInput.value = String(nearestSpeedIndex(state.speed));
    // The slider's own value is an index into the offered speeds, which says
    // nothing read aloud.
    this.speedInput.setAttribute("aria-valuetext", `${state.speed}x`);
    this.readoutEl.textContent = `${
      state.running ? `${state.speed}x` : "paused"
    } · frame ${state.frame}`;
  }

  /**
   * Writes values back into the widgets. Needed because `LabApi.setControl` is
   * also callable from outside the panel, and because a value the control
   * clamped has to show as what was actually applied.
   */
  syncValues(values: Record<string, ControlValue>): void {
    this.values = values;
    for (const [name, apply] of this.widgets) {
      const value = values[name];
      if (value !== undefined) apply(value);
    }
  }

  private showEmpty(): void {
    this.titleEl.textContent = "No scenarios found";
    this.describeEl.textContent =
      "Add a file named *.scenario.ts exporting what defineScenario({...}) returns.";
    this.filterInput.hidden = true;
    this.list.append(el("p", "yage-lab__empty", "Nothing to show."));
  }

  /**
   * The canvas takes focus so the keys a game reads stop scrolling the page.
   * The engine's own listeners sit on `window` and still see the event —
   * only the browser's default action is dropped.
   */
  private renderCanvas(width: number, height: number): HTMLElement {
    const box = el("div", "yage-lab__canvas");
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.tabIndex = 0;
    box.addEventListener("pointerdown", () => {
      box.focus();
    });
    box.addEventListener("keydown", (event) => {
      if (SCROLL_KEYS.has(event.code)) event.preventDefault();
    });
    return box;
  }

  private renderFilter(): HTMLInputElement {
    const input = el("input", "yage-lab__filter");
    input.type = "search";
    input.placeholder = "Filter scenarios…";
    input.setAttribute("aria-label", "Filter scenarios");
    input.addEventListener("input", () => {
      this.applyFilter();
    });
    return input;
  }

  private applyFilter(): void {
    const needle = this.filterInput.value.trim().toLowerCase();
    const anyVisible = filterNodes(this.nodes, needle, this.collapsed);
    this.noMatchEl.hidden = anyVisible || this.items.size === 0;
  }

  private renderList(scenarios: readonly ScenarioEntry[]): void {
    this.nodes = this.renderNodes(
      buildScenarioTree(scenarios),
      this.list,
      0,
      "",
    );
  }

  /** Indent per level, so a deep tree still reads as a tree in a 240px column. */
  private renderNodes(
    nodes: readonly ScenarioNode[],
    parent: HTMLElement,
    depth: number,
    path: string,
  ): RenderedNode[] {
    const indent = `${8 + depth * 10}px`;
    const rendered: RenderedNode[] = [];
    for (const node of nodes) {
      if (node.kind === "group") {
        const groupPath = path === "" ? node.name : `${path}/${node.name}`;
        const box = el(
          "details",
          depth === 0
            ? "yage-lab__group"
            : "yage-lab__group yage-lab__group--nested",
        );
        box.open = !this.collapsed.has(groupPath);
        const heading = el("summary", "yage-lab__group-name", node.name);
        heading.style.paddingLeft = indent;
        // The fold is driven here rather than by the browser's own toggle, so
        // opening a group to reveal a match never overwrites what was recorded.
        heading.addEventListener("click", (event) => {
          event.preventDefault();
          this.setGroupOpen(box, groupPath, !box.open);
        });
        box.append(heading);
        const children = this.renderNodes(
          node.children,
          box,
          depth + 1,
          groupPath,
        );
        parent.append(box);
        rendered.push({
          kind: "group",
          element: box,
          path: groupPath,
          children,
        });
        continue;
      }
      const item = el("button", "yage-lab__item", node.label);
      item.type = "button";
      item.title = `${node.entry.path} · ${node.entry.exportName}`;
      item.style.paddingLeft = indent;
      item.addEventListener("click", () => {
        this.callbacks.onSelect(node.entry.id);
      });
      this.items.set(node.entry.id, item);
      parent.append(item);
      rendered.push({
        kind: "scenario",
        element: item,
        // The title carries the group names, so typing one still finds its
        // scenarios. The path finds a scenario by the file it lives in.
        search: `${node.entry.title} ${node.entry.path}`.toLowerCase(),
      });
    }
    return rendered;
  }

  private setGroupOpen(
    box: HTMLDetailsElement,
    path: string,
    open: boolean,
  ): void {
    box.open = open;
    if (open) this.collapsed.delete(path);
    else this.collapsed.add(path);
    this.savePrefs({ collapsed: [...this.collapsed] });
  }

  private mini(
    label: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const node = el("button", "yage-lab__mini", label);
    node.type = "button";
    node.title = title;
    node.addEventListener("click", onClick);
    return node;
  }

  /** Writes the current control values out for pasting into code or a prompt. */
  private async copyValues(): Promise<void> {
    const json = JSON.stringify(this.values, null, 2);
    let label = "copied";
    try {
      await navigator.clipboard.writeText(json);
    } catch (error) {
      console.error("[yage-lab]", error);
      // The values themselves, so a blocked clipboard still leaves them
      // somewhere to copy from by hand.
      console.log("[yage-lab] control values:", json);
      label = "copy failed — see console";
    }
    clearTimeout(this.copyTimer);
    this.copyButton.textContent = label;
    this.copyTimer = setTimeout(() => {
      this.copyButton.textContent = "copy JSON";
    }, 1500);
  }

  private setControlsRight(right: boolean): void {
    this.savePrefs({ controlsRight: right });
    this.applyControlsPlacement();
  }

  private applyControlsPlacement(): void {
    const right = this.prefs.controlsRight;
    (right ? this.aside : this.stage).append(this.controlsBox);
    this.aside.hidden = !right || this.controlsBox.hidden;
    this.layoutButton.textContent = right ? "↓ below" : "→ right";
    this.layoutButton.title = right
      ? "Move the controls under the stage"
      : "Move the controls beside the stage";
  }

  private savePrefs(patch: Partial<PanelPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    writePrefs(this.prefs);
  }

  private button(
    label: string,
    className: string | undefined,
    onClick: () => void,
  ): HTMLButtonElement {
    const node = el(
      "button",
      className === undefined
        ? "yage-lab__button"
        : `yage-lab__button ${className}`,
      label,
    );
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  /** The slider indexes the offered speeds, so its steps are the speeds themselves. */
  private renderSpeed(): HTMLInputElement {
    const input = el("input");
    input.type = "range";
    input.min = "0";
    input.max = String(CLOCK_SPEEDS.length - 1);
    input.step = "1";
    input.title = "Clock speed";
    input.setAttribute("aria-label", "Clock speed");
    input.addEventListener("input", () => {
      const speed = CLOCK_SPEEDS[Number(input.value)];
      if (speed !== undefined) this.callbacks.onSpeedChange(speed);
    });
    return input;
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
    this.controlList.replaceChildren();
    this.widgets.clear();
    const entries = Object.entries(controls ?? {});
    // A scenario with no controls should not leave an empty titled box under
    // the scene, nor an empty column beside it.
    this.controlsBox.hidden = entries.length === 0;
    this.applyControlsPlacement();
    for (const [name, def] of entries) {
      this.controlList.append(this.renderControl(name, def, values[name]));
    }
  }

  private renderControl(
    name: string,
    def: ControlDef,
    value: ControlValue | undefined,
  ): HTMLElement {
    const box = el("div", "yage-lab__control");
    const labelRow = el("label", "yage-lab__control-label");
    const title = def.label ?? name;
    labelRow.append(el("span", undefined, title));
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
      // Named here rather than by the label element, which wraps only the
      // title and the readout.
      select.setAttribute("aria-label", title);
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
      input.setAttribute("aria-label", title);
      box.append(input);
      this.widgets.set(name, apply);
    }

    return box;
  }
}
