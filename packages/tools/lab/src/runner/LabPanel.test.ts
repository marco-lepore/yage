// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { control, type ControlSchema } from "../grammar/controls.js";
import { type AnyScenario, defineScenario } from "../grammar/scenario.js";
import { CLOCK_SPEEDS } from "./LabClock.js";
import { LabPanel, type PanelCallbacks } from "./LabPanel.js";
import type { ScenarioEntry } from "./ScenarioRegistry.js";

/**
 * `drive` is what the Run button keys off; `controls` is what a run locks.
 * `title` is split the way the registry splits it, so a case reads as the
 * nesting it produces.
 */
const entry = (
  id: string,
  title: string,
  extra?: Partial<Pick<AnyScenario, "controls" | "drive">>,
): ScenarioEntry => {
  const segments = title.split("/").map((part) => part.trim());
  return {
    id,
    path: `/src/${id}.scenario.ts`,
    exportName: "default",
    groups: segments.slice(0, -1),
    label: segments[segments.length - 1] as string,
    title,
    scenario: defineScenario({ title, setup: () => {}, ...extra }),
    hasDrive: typeof extra?.drive === "function",
  };
};

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
  localStorage.clear();
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

describe("the scenario filter", () => {
  const scenarios = [
    entry("loose", "Sandbox"),
    entry("drop", "Physics / Ball drop"),
    entry("stack", "Physics / Stacking"),
  ];
  const shown = (panel: { root: HTMLElement }): string[] =>
    [...panel.root.querySelectorAll<HTMLElement>(".yage-lab__item")]
      .filter((item) => !item.hidden)
      .map((item) => item.textContent ?? "");

  const type = (panel: { root: HTMLElement }, query: string): void => {
    const input =
      panel.root.querySelector<HTMLInputElement>(".yage-lab__filter");
    if (!input) throw new Error("no filter");
    input.value = query;
    input.dispatchEvent(new Event("input"));
  };

  it("keeps only what matches, group name included", () => {
    const { panel } = mountPanel(scenarios);
    type(panel, "stack");
    expect(shown(panel)).toEqual(["Stacking"]);
    // The group name reaches its scenarios through the title prefix.
    type(panel, "physics");
    expect(shown(panel)).toEqual(["Ball drop", "Stacking"]);
    type(panel, "");
    expect(shown(panel)).toEqual(["Sandbox", "Ball drop", "Stacking"]);
  });

  it("hides a group with nothing left under it", () => {
    const { panel } = mountPanel(scenarios);
    type(panel, "sandbox");
    const group = panel.root.querySelector<HTMLElement>(".yage-lab__group");
    expect(group?.hidden).toBe(true);
  });

  it("takes a row off the screen, not just out of the tree", () => {
    // The panel styles the rows itself, and a declared `display` outranks the
    // browser's rule for `[hidden]` — hiding the property alone leaves the row
    // on screen inside a group that survived the filter.
    const { panel } = mountPanel(scenarios);
    type(panel, "stacking");
    const dropped = [
      ...panel.root.querySelectorAll<HTMLElement>(".yage-lab__item"),
    ].find((item) => item.textContent === "Ball drop");
    expect(dropped?.hidden).toBe(true);
    expect(getComputedStyle(dropped as HTMLElement).display).toBe("none");
  });

  it("says so when nothing matches", () => {
    const { panel, find } = mountPanel(scenarios);
    expect(find<HTMLElement>(".yage-lab__empty").hidden).toBe(true);
    type(panel, "nothing here");
    expect(find<HTMLElement>(".yage-lab__empty").hidden).toBe(false);
  });
});

describe("the group folds", () => {
  const scenarios = [
    entry("drop", "Physics / Ball drop"),
    entry("stack", "Physics / Stacking"),
  ];
  const group = (panel: { root: HTMLElement }): HTMLDetailsElement => {
    const node =
      panel.root.querySelector<HTMLDetailsElement>(".yage-lab__group");
    if (!node) throw new Error("no group");
    return node;
  };

  it("folds a group away and back on its heading", () => {
    const { panel } = mountPanel(scenarios);
    expect(group(panel).open).toBe(true);
    group(panel).querySelector("summary")?.click();
    expect(group(panel).open).toBe(false);
    group(panel).querySelector("summary")?.click();
    expect(group(panel).open).toBe(true);
  });

  it("opens the next panel on what was left open", () => {
    const first = mountPanel(scenarios);
    group(first.panel).querySelector("summary")?.click();

    document.body.replaceChildren();
    const second = mountPanel(scenarios);
    expect(group(second.panel).open).toBe(false);
  });

  it("reveals a match while a filter is on and folds back after", () => {
    const { panel } = mountPanel(scenarios);
    group(panel).querySelector("summary")?.click();
    const input =
      panel.root.querySelector<HTMLInputElement>(".yage-lab__filter");
    if (!input) throw new Error("no filter");

    input.value = "stacking";
    input.dispatchEvent(new Event("input"));
    expect(group(panel).open).toBe(true);

    input.value = "";
    input.dispatchEvent(new Event("input"));
    expect(group(panel).open).toBe(false);
  });
});

describe("the controls section", () => {
  const tunable = entry("drop", "Physics / Ball drop", {
    controls: { count: control.int(3, { min: 1, max: 12 }) },
  });

  it("belongs to the stage, so the list cannot crowd it out", () => {
    // Both the list and the controls grow with the project. In one column the
    // longer of the two pushes the other out of view.
    const { panel } = mountPanel([tunable]);
    panel.setCurrent(tunable, { count: 3 });

    const controls = panel.root.querySelector(".yage-lab__controls");
    expect(controls?.closest(".yage-lab__stage")).not.toBeNull();
    expect(controls?.closest(".yage-lab__sidebar")).toBeNull();
  });

  it("hides itself for a scenario that declares none", () => {
    const { panel } = mountPanel([tunable]);
    const controls = panel.root.querySelector<HTMLElement>(
      ".yage-lab__controls",
    );

    panel.setCurrent(tunable, { count: 3 });
    expect(controls?.hidden).toBe(false);

    panel.setCurrent(entry("plain", "Sandbox"), {});
    expect(controls?.hidden).toBe(true);
  });

  it("keeps its heading out of the part that scrolls", () => {
    const { panel } = mountPanel([tunable]);
    panel.setCurrent(tunable, { count: 3 });

    const list = panel.root.querySelector(".yage-lab__control-list");
    expect(list?.querySelector(".yage-lab__heading")).toBeNull();
    expect(list?.querySelectorAll(".yage-lab__control")).toHaveLength(1);
  });
});

describe("the copy button", () => {
  const tunable = entry("drop", "Physics / Ball drop", {
    controls: {
      count: control.int(3, { min: 1, max: 12 }),
      bouncy: control.boolean(true),
    },
  });
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  const copyButton = (panel: { root: HTMLElement }): HTMLButtonElement => {
    const node =
      panel.root.querySelectorAll<HTMLButtonElement>(".yage-lab__mini")[0];
    if (!node) throw new Error("no copy button");
    return node;
  };

  it("writes out what the widgets are worth, not what they started at", async () => {
    const { panel } = mountPanel([tunable]);
    panel.setCurrent(tunable, { count: 3, bouncy: true });
    panel.syncValues({ count: 7, bouncy: false });

    copyButton(panel).click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        JSON.stringify({ count: 7, bouncy: false }, null, 2),
      );
    });
  });

  it("stays usable while a run is in flight", () => {
    const { panel } = mountPanel([tunable]);
    panel.setCurrent(tunable, { count: 3, bouncy: true });
    panel.setRun({ state: "running" });
    expect(copyButton(panel).disabled).toBe(false);
  });

  it("says so and prints the values when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { panel } = mountPanel([tunable]);
    panel.setCurrent(tunable, { count: 3, bouncy: true });

    copyButton(panel).click();
    await vi.waitFor(() => {
      expect(copyButton(panel).textContent).toContain("copy failed");
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[yage-lab]"),
      JSON.stringify({ count: 3, bouncy: true }, null, 2),
    );
    expect(error).toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  it("goes back to offering the copy", async () => {
    vi.useFakeTimers();
    try {
      const { panel } = mountPanel([tunable]);
      panel.setCurrent(tunable, { count: 3, bouncy: true });
      copyButton(panel).click();
      await vi.waitFor(
        () => {
          expect(copyButton(panel).textContent).toBe("copied");
        },
        { interval: 0 },
      );
      vi.advanceTimersByTime(1500);
      expect(copyButton(panel).textContent).toBe("copy JSON");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the stored layout choices", () => {
  const scenarios = [entry("drop", "Physics / Ball drop")];

  it("starts from the defaults when storage holds something else", () => {
    localStorage.setItem("yage-lab:panel", "not json at all");
    const { panel } = mountPanel(scenarios);
    const group =
      panel.root.querySelector<HTMLDetailsElement>(".yage-lab__group");
    expect(group?.open).toBe(true);
    expect(
      panel.root.querySelector(".yage-lab__aside .yage-lab__controls"),
    ).toBeNull();
  });

  it("mounts even where storage cannot be read", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      expect(() => mountPanel(scenarios)).not.toThrow();
    } finally {
      getItem.mockRestore();
    }
  });
});

describe("the controls column toggle", () => {
  const tunable = entry("drop", "Physics / Ball drop", {
    controls: { count: control.int(3, { min: 1, max: 12 }) },
  });
  const layoutButton = (panel: { root: HTMLElement }): HTMLButtonElement => {
    const node =
      panel.root.querySelectorAll<HTMLButtonElement>(".yage-lab__mini")[1];
    if (!node) throw new Error("no layout button");
    return node;
  };
  const controlsBox = (panel: { root: HTMLElement }): HTMLElement => {
    const node = panel.root.querySelector<HTMLElement>(".yage-lab__controls");
    if (!node) throw new Error("no controls section");
    return node;
  };

  it("moves the controls beside the stage and back", () => {
    const { panel } = mountPanel([tunable]);
    panel.setCurrent(tunable, { count: 3 });
    expect(controlsBox(panel).closest(".yage-lab__stage")).not.toBeNull();

    layoutButton(panel).click();
    expect(controlsBox(panel).closest(".yage-lab__aside")).not.toBeNull();

    layoutButton(panel).click();
    expect(controlsBox(panel).closest(".yage-lab__stage")).not.toBeNull();
  });

  it("opens the next panel where the last one was left", () => {
    const first = mountPanel([tunable]);
    first.panel.setCurrent(tunable, { count: 3 });
    layoutButton(first.panel).click();

    document.body.replaceChildren();
    const second = mountPanel([tunable]);
    second.panel.setCurrent(tunable, { count: 3 });
    expect(
      controlsBox(second.panel).closest(".yage-lab__aside"),
    ).not.toBeNull();
  });

  it("leaves no column for a scenario that declares no controls", () => {
    const { panel } = mountPanel([tunable]);
    panel.setCurrent(tunable, { count: 3 });
    layoutButton(panel).click();
    const aside = panel.root.querySelector<HTMLElement>(".yage-lab__aside");
    expect(aside?.hidden).toBe(false);

    panel.setCurrent(entry("plain", "Sandbox"), {});
    expect(aside?.hidden).toBe(true);
  });
});

describe("the canvas", () => {
  it("takes focus and drops the key defaults that scroll", () => {
    const { panel } = mountPanel();
    expect(panel.container.tabIndex).toBe(0);

    const press = (code: string): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", {
        code,
        bubbles: true,
        cancelable: true,
      });
      panel.container.dispatchEvent(event);
      return event;
    };
    expect(press("Space").defaultPrevented).toBe(true);
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    // Anything the page does not scroll with is the game's business alone.
    expect(press("KeyA").defaultPrevented).toBe(false);
  });

  it("still lets the key through to the engine's own listener", () => {
    const { panel } = mountPanel();
    const seen: string[] = [];
    const listener = (event: Event): void => {
      seen.push((event as KeyboardEvent).code);
    };
    window.addEventListener("keydown", listener);
    panel.container.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "Space",
        bubbles: true,
        cancelable: true,
      }),
    );
    window.removeEventListener("keydown", listener);
    expect(seen).toEqual(["Space"]);
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
