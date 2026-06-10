import { describe, it, expect } from "vitest";
import type { EngineContext } from "@yagejs/core";
import { UIPlugin } from "./UIPlugin.js";
import { getUIDefaultTextStyle, setUIDefaultTextStyle } from "./text-defaults.js";

// install() needs tryResolve (AssetManager is optional), resolve (the scene
// hook registry, for the floating overlay), and loads Yoga via dynamic
// import; a bare stub is enough to exercise the text-style lifecycle.
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
});
