// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  DiagnosticSource,
  EditorDiagnostic,
} from "../../shared/diagnostics/index.js";
import { EditorStore, type DraftApi } from "../store/index.js";
import { Problems } from "./Problems.js";

/** The band sends nothing itself, so none of the store's calls are made. */
const unusedApi: DraftApi = {
  sendCommand: () => Promise.reject(new Error("not used")),
  undo: () => Promise.reject(new Error("not used")),
  redo: () => Promise.reject(new Error("not used")),
};

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function finding(message: string): EditorDiagnostic {
  return {
    code: "placement-excluded",
    severity: "error",
    source: "preview",
    message,
    revision: 1,
  };
}

function createHarness() {
  const store = new EditorStore({
    api: unusedApi,
    epoch: "epoch-1",
    projectId: "project-1",
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  act(() => {
    root.render(<Problems store={store} />);
  });
  const report = (source: DiagnosticSource, ...messages: string[]): void => {
    act(() => {
      store.dispatch({
        type: "diagnostics-replaced",
        source,
        diagnostics: messages.map((message) => ({
          ...finding(message),
          source,
        })),
      });
    });
  };
  const press = (testId: string): void => {
    const button = host.querySelector<HTMLButtonElement>(
      `[data-testid="${testId}"]`,
    );
    if (!button) throw new Error(`no ${testId}`);
    act(() => {
      button.click();
    });
  };
  return { store, host, root, report, press };
}

let harness: ReturnType<typeof createHarness>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  harness = createHarness();
});

afterEach(() => {
  act(() => {
    harness.root.unmount();
  });
  harness.host.remove();
});

describe("Problems", () => {
  it("shows nothing while the level has no findings", () => {
    expect(harness.host.querySelector(".ye-problems")).toBeNull();
  });

  it("counts every finding, whichever source reported it", () => {
    harness.report("preview", "a", "b");
    harness.report("validation", "c");

    expect(harness.host.querySelector(".ye-panel__count")?.textContent).toBe(
      "3",
    );
  });

  it("puts the list away and keeps saying how many there are", () => {
    harness.report("preview", "a", "b");

    harness.press("problems-toggle");

    expect(
      harness.host.querySelector('[data-testid="diagnostics"]'),
    ).toBeNull();
    expect(harness.host.querySelector(".ye-panel__count")?.textContent).toBe(
      "2",
    );

    harness.press("problems-toggle");

    expect(
      harness.host.querySelector('[data-testid="diagnostics"]')?.textContent,
    ).toContain("a");
  });
});
