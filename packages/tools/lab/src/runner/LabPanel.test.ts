// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineScenario } from "../grammar/scenario.js";
import { CLOCK_SPEEDS } from "./LabClock.js";
import { LabPanel, type PanelCallbacks } from "./LabPanel.js";
import type { ScenarioEntry } from "./ScenarioRegistry.js";

const entry = (id: string, title: string): ScenarioEntry => ({
  id,
  path: `/src/${id}.scenario.ts`,
  title,
  scenario: defineScenario({ title, setup: () => {} }),
});

const callbacks = (): PanelCallbacks => ({
  onSelect: vi.fn(),
  onControlChange: vi.fn(),
  onPlayToggle: vi.fn(),
  onStep: vi.fn(),
  onSpeedChange: vi.fn(),
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
