// @vitest-environment happy-dom
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  const handle = {
    container: {},
    setReference: vi.fn(),
    setConfig: vi.fn(),
    setLayout: vi.fn(),
    invalidateLayout: vi.fn(),
    setActive: vi.fn(),
    bringToFront: vi.fn(),
    release: vi.fn(),
  };
  return { mocks: { handle } };
});

vi.mock("./reconciler.js", () => ({
  createPortal: vi.fn(() => null),
  getRootInstances: vi.fn(() => []),
}));

vi.mock("@yagejs/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@yagejs/ui")>("@yagejs/ui");
  return { ...actual, layoutFloat: vi.fn(() => ({ width: 0, height: 0 })) };
});

import { FloatingOverlayCtx } from "./floating.js";
import { useFloating } from "./use-floating.js";

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("useFloating", () => {
  it("refreshes overlay config when floating content changes", () => {
    const overlay = {
      acquire: () => mocks.handle,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Probe({ content }: { content: string }) {
      const floating = useFloating({ open: true });
      floating.renderFloating(content);
      return null;
    }

    act(() => {
      root.render(
        createElement(
          FloatingOverlayCtx.Provider,
          { value: overlay as never },
          createElement(Probe, { content: "first" }),
        ),
      );
    });
    expect(mocks.handle.setConfig).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(
        createElement(
          FloatingOverlayCtx.Provider,
          { value: overlay as never },
          createElement(Probe, { content: "updated" }),
        ),
      );
    });
    expect(mocks.handle.setConfig).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });
});
