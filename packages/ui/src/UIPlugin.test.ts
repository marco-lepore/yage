import { describe, it, expect } from "vitest";
import { ErrorBoundaryKey } from "@yagejs/core";
import type { EngineContext, ErrorBoundary } from "@yagejs/core";
import { UIPlugin } from "./UIPlugin.js";
import {
  getUIDefaultTextStyle,
  setUIDefaultTextStyle,
} from "./text-defaults.js";
import { getUIErrorBoundary, setUIErrorBoundary } from "./error-boundary.js";

// install() resolves the optional error boundary and the scene hook registry,
// then loads Yoga. This stub is enough to exercise its process-scoped state.
const stubContext = {
  tryResolve: () => undefined,
  resolve: () => ({ register: () => () => {} }),
} as unknown as EngineContext;

describe("UIPlugin default text style lifecycle", () => {
  it("sets the UI default on install and restores the prior value on destroy", async () => {
    setUIDefaultTextStyle({ fontFamily: "Prev" });
    const plugin = new UIPlugin({ defaultTextStyle: { fontFamily: "UI" } });

    await plugin.install(stubContext);
    expect(getUIDefaultTextStyle()).toMatchObject({ fontFamily: "UI" });

    plugin.onDestroy();
    expect(getUIDefaultTextStyle()).toMatchObject({ fontFamily: "Prev" });

    setUIDefaultTextStyle(undefined);
  });

  it("restores to undefined when there was no prior default", async () => {
    setUIDefaultTextStyle(undefined);
    const plugin = new UIPlugin({ defaultTextStyle: { fontFamily: "UI" } });

    await plugin.install(stubContext);
    expect(getUIDefaultTextStyle()).toMatchObject({ fontFamily: "UI" });

    plugin.onDestroy();
    expect(getUIDefaultTextStyle()).toBeUndefined();
  });

  it("sets the UI callback boundary and restores the prior value", async () => {
    const previous = {} as ErrorBoundary;
    const boundary = {} as ErrorBoundary;
    setUIErrorBoundary(previous);
    const plugin = new UIPlugin();
    const context = {
      tryResolve: (key: unknown) =>
        key === ErrorBoundaryKey ? boundary : undefined,
      resolve: () => ({ register: () => () => {} }),
    } as unknown as EngineContext;

    await plugin.install(context);
    expect(getUIErrorBoundary()).toBe(boundary);

    plugin.onDestroy();
    expect(getUIErrorBoundary()).toBe(previous);
    setUIErrorBoundary(undefined);
  });
});
