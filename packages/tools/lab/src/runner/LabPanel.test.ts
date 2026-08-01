// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { control, type ControlSchema } from "../grammar/controls.js";
import { type AnyScenario, defineScenario } from "../grammar/scenario.js";
import { CLOCK_SPEEDS } from "./LabClock.js";
import { LabPanel, type PanelCallbacks } from "./LabPanel.js";
import type { ScenarioEntry } from "./ScenarioRegistry.js";

/** `drive` is what the Run button keys off; `controls` is what a run locks. */
const entry = (
  id: string,
  title: string,
  extra?: Partial<Pick<AnyScenario, "controls" | "drive">>,
): ScenarioEntry => ({
  id,
  path: `/src/${id}.scenario.ts`,
  title,
  scenario: defineScenario({ title, setup: () => {}, ...extra }),
});

const drivenEntry = (
  id: string,
  title: string,
  controls?: ControlSchema,
): ScenarioEntry =>
  entry(id, title, { controls, drive: () => Promise.resolve() });

const callbacks = (): PanelCallbacks => ({
  onSelect: vi.fn(),
  onControlChange: vi.fn(),
  onPlayToggle: vi.fn(),
  onStep: vi.fn(),
  onSpeedChange: vi.fn(),
  onRun: vi.fn(),
});

function mountPanel(scenarios: readonly ScenarioEntry[] = []) {
  const host = document.createElement("div");
  document.body.append(host);
  const calls = callbacks();
  const panel = new LabPanel(host, {
    width: 320,
    height: 200,
    scenarios,
    problems: [],
    callbacks: calls,
  });
  const find = <T extends Element>(selector: string): T => {
    const node = panel.root.querySelector<T>(selector);
    if (!node) throw new Error(`no ${selector} in the panel`);
    return node;
  };
  return { panel, calls, find };
}

const text = (root: Element, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((node) => node.textContent ?? "");

beforeEach(() => {
  document.body.replaceChildren();
});

describe("the scenario list", () => {
  const stacking = entry("stack", "Physics / Stacking");
  const scenarios = [
    entry("loose", "Sandbox"),
    entry("drop", "Physics / Ball drop"),
    stacking,
  ];

  it("shows a heading per group and the title without its prefix", () => {
    const { panel } = mountPanel(scenarios);
    expect(text(panel.root, ".yage-lab__group-name")).toEqual(["Physics"]);
    expect(text(panel.root, ".yage-lab__item")).toEqual([
      "Sandbox",
      "Ball drop",
      "Stacking",
    ]);
  });

  it("selects by id, not by the label it shows", () => {
    const { panel, calls } = mountPanel(scenarios);
    panel.root
      .querySelectorAll<HTMLButtonElement>(".yage-lab__item")[1]
      ?.click();
    expect(calls.onSelect).toHaveBeenCalledWith("drop");
  });

  it("marks the current entry wherever its group is", () => {
    const { panel, find } = mountPanel(scenarios);
    panel.setCurrent(stacking, {});
    expect(find(`[aria-current="true"]`).textContent).toBe("Stacking");
  });
});

describe("the clock section", () => {
  const button = (root: Element, label: string): HTMLButtonElement => {
    const node = [
      ...root.querySelectorAll<HTMLButtonElement>(".yage-lab__clock button"),
    ].find((candidate) => candidate.textContent === label);
    if (!node) throw new Error(`no "${label}" button`);
    return node;
  };

  it("asks for a play toggle and for steps", () => {
    const { panel, calls } = mountPanel();
    button(panel.root, "pause").click();
    button(panel.root, "+1").click();
    button(panel.root, "+10").click();
    expect(calls.onPlayToggle).toHaveBeenCalledOnce();
    expect(calls.onStep).toHaveBeenNthCalledWith(1, 1);
    expect(calls.onStep).toHaveBeenNthCalledWith(2, 10);
  });

  it("reports the speed its slider position stands for", () => {
    const { calls, find } = mountPanel();
    const slider = find<HTMLInputElement>(".yage-lab__clock input");
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));
    expect(calls.onSpeedChange).toHaveBeenCalledWith(CLOCK_SPEEDS[0]);
  });

  it("reads the speed and the frame back while running", () => {
    const { panel, find } = mountPanel();
    panel.setClock({ running: true, speed: 0.25, frame: 42 });
    expect(find(".yage-lab__readout").textContent).toBe("0.25x · frame 42");
    expect(find<HTMLInputElement>(".yage-lab__clock input").value).toBe(
      String(CLOCK_SPEEDS.indexOf(0.25)),
    );
  });

  it("offers play and says paused while stopped", () => {
    const { panel, find } = mountPanel();
    panel.setClock({ running: false, speed: 1, frame: 7 });
    expect(find(".yage-lab__play").textContent).toBe("play");
    expect(find(".yage-lab__readout").textContent).toBe("paused · frame 7");
  });
});

describe("the run button", () => {
  const runButton = (panel: { root: HTMLElement }): HTMLButtonElement => {
    const node = panel.root.querySelector<HTMLButtonElement>(
      ".yage-lab__run-button",
    );
    if (!node) throw new Error("no run button");
    return node;
  };

  it("stays disabled for a scenario that declares no drive", () => {
    const { panel } = mountPanel();
    expect(runButton(panel).disabled).toBe(true);
    panel.setCurrent(entry("spin", "Basics / Spin"), {});
    expect(runButton(panel).disabled).toBe(true);
    expect(runButton(panel).title).toContain("no drive()");
  });

  it("offers the run and asks for it", () => {
    const { panel, calls } = mountPanel();
    panel.setCurrent(drivenEntry("hit", "Combat / Hit"), {});
    expect(runButton(panel).disabled).toBe(false);
    runButton(panel).click();
    expect(calls.onRun).toHaveBeenCalledOnce();
  });

  it("takes no second click while a run is in flight", () => {
    const { panel } = mountPanel();
    panel.setCurrent(drivenEntry("hit", "Combat / Hit"), {});
    panel.setRun({ state: "running" });
    expect(runButton(panel).disabled).toBe(true);
  });

  it("locks out everything that would steer the clock or swap the scene", () => {
    // With a control, so the widget a rebuild hangs off is in the sample too.
    const tunable = drivenEntry("hit", "Combat / Hit", {
      count: control.int(3, { min: 1, max: 9 }),
    });
    const { panel } = mountPanel([tunable, entry("spin", "Basics / Spin")]);
    panel.setCurrent(tunable, { count: 3 });
    const fields = (): (HTMLButtonElement | HTMLInputElement)[] => [
      ...panel.root.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        ".yage-lab__clock button, .yage-lab__clock input, .yage-lab__item, .yage-lab__control input",
      ),
    ];

    panel.setRun({ state: "running" });
    expect(fields().length).toBeGreaterThan(5);
    expect(fields().every((field) => field.disabled)).toBe(true);

    panel.setRun({ state: "pass", framesUsed: 4, durationMs: 1 });
    expect(fields().some((field) => field.disabled)).toBe(false);
  });

  it("reads back a pass and a failure's message", () => {
    const { panel, find } = mountPanel();
    panel.setCurrent(drivenEntry("hit", "Combat / Hit"), {});

    panel.setRun({ state: "pass", framesUsed: 16, durationMs: 12.4 });
    expect(find(".yage-lab__run").textContent).toBe("pass · 16 frames · 12 ms");
    expect(find(".yage-lab__run").className).toContain("--pass");

    panel.setRun({ state: "fail", message: "expected 1 to be 2" });
    expect(find(".yage-lab__run").textContent).toBe(
      "fail — expected 1 to be 2",
    );
    expect(find(".yage-lab__run").className).toContain("--fail");
  });

  it("drops the result when another scenario is shown", () => {
    const { panel, find } = mountPanel();
    panel.setCurrent(drivenEntry("hit", "Combat / Hit"), {});
    panel.setRun({ state: "pass", framesUsed: 1, durationMs: 1 });
    panel.setCurrent(entry("spin", "Basics / Spin"), {});
    expect(find(".yage-lab__run").textContent).toBe("");
  });
});

describe("the errors section", () => {
  it("shows every error with its kind and context", () => {
    const { panel, find } = mountPanel();
    panel.showErrors([
      { kind: "Rebuild", message: "no such control" },
      { kind: "Collision handler", message: "boom", detail: "Drop · ball-0" },
    ]);
    expect(text(find(".yage-lab__errors"), ".yage-lab__error-kind")).toEqual([
      "Rebuild",
      "Collision handler",
    ]);
    expect(find(".yage-lab__errors").textContent).toContain("Drop · ball-0");
  });

  it("clears what it showed before", () => {
    const { panel, find } = mountPanel();
    panel.showErrors([{ kind: "Rebuild", message: "boom" }]);
    panel.showErrors([]);
    expect(find(".yage-lab__errors").children).toHaveLength(0);
  });
});
