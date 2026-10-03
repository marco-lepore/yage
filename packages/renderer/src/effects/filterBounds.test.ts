import { describe, expect, it } from "vitest";
import {
  Bounds,
  Container,
  Graphics,
  updateRenderGroupTransforms,
} from "pixi.js";
import type { Filter } from "pixi.js";
import type { ScopedProcessQueue } from "@yagejs/core";
import { EffectStack } from "./EffectStack.js";
import { attachFilterBounds } from "./filterBounds.js";

const queue: ScopedProcessQueue = { run: (p) => p, cancelAll: () => {} };
function filter(padding: number): Filter {
  return { enabled: true, padding } as Filter;
}
function square(): Graphics {
  return new Graphics().rect(0, 0, 40, 40).fill(0xffffff);
}

function refresh(root: Container): void {
  root.updateLocalTransform();
  if (!root.renderGroup) throw new Error("Missing render group");
  updateRenderGroupTransforms(root.renderGroup, true);
}

describe("filter output bounds", () => {
  it("includes child filters through multiple ancestors without changing layout", () => {
    const root = new Container({ isRenderGroup: true });
    const parent = root.addChild(new Container());
    const child = parent.addChild(square());
    const original = child.getLocalBounds().rectangle.clone();
    const stack = new EffectStack(child, queue, "component");
    const f = filter(20);
    const handle = stack.add(() => ({
      filter: f,
      getIntensity: () => 1,
      setIntensity: () => {},
    }));
    refresh(root);
    expect(root.getFastGlobalBounds(true).rectangle).toMatchObject({
      x: -20,
      y: -20,
      width: 80,
      height: 80,
    });
    expect(root.getBounds().width).toBe(40);
    expect(child.getLocalBounds().rectangle).toEqual(original);
    expect(parent.getLocalBounds().rectangle).toEqual(original);
    handle.setEnabled(false);
    expect(root.getFastGlobalBounds(true).width).toBe(40);
    handle.setEnabled(true);
    f.padding = 30;
    expect(root.getFastGlobalBounds(true).width).toBe(100);
    handle.remove();
    expect(root.getFastGlobalBounds(true).width).toBe(40);
  });

  it("adds consecutive filters and preserves external filters on removal", () => {
    const root = new Container({ isRenderGroup: true });
    const host = root.addChild(square());
    const external = filter(3);
    host.filters = [external];
    const originalFast = host.getFastGlobalBounds;
    const stack = new EffectStack(host, queue, "component");
    stack.add(() => ({
      filter: [filter(5), filter(7)],
      getIntensity: () => 1,
      setIntensity: () => {},
    }));
    refresh(root);
    expect(root.getFastGlobalBounds(true).width).toBe(70);
    expect(host.getBounds().width).toBe(40);
    stack.destroy();
    expect(host.filters).toEqual([external]);
    expect(host.getFastGlobalBounds).toBe(originalFast);
  });

  it("preserves fresh and cached content bounds when scale changes before rendering", () => {
    const root = new Container({ isRenderGroup: true });
    const host = root.addChild(square());
    const control = root.addChild(square());
    const stack = new EffectStack(host, queue, "component");
    stack.add(() => ({
      filter: {
        enabled: true,
        get padding() {
          return 10 * host.worldTransform.a + 1;
        },
      } as Filter,
      getIntensity: () => 1,
      setIntensity: () => {},
    }));
    refresh(root);
    host.scale.set(2);
    control.scale.set(2);
    expect(host.getBounds(true).rectangle).toEqual(
      control.getBounds(true).rectangle,
    );
    expect(host.getBounds().rectangle).toEqual(control.getBounds().rectangle);
    expect(host.getBounds().width).toBe(80);
    expect(root.getBounds().width).toBe(80);
    refresh(root);
    expect(root.getFastGlobalBounds(true).width).toBe(122);
    expect(host.getBounds(true).width).toBe(80);
    stack.destroy();
  });

  it("excludes only the host's own padding from its input query and restores hooks", () => {
    const host = square();
    host.filters = [filter(10)];
    const effect = host.effects?.find((e) => e.pipe === "filter");
    if (!effect) throw new Error("Missing filter effect");
    const oldBounds = (bounds: Bounds): void => {
      bounds.pad(2);
    };
    effect.addBounds = oldBounds;
    host.getFastGlobalBounds = (_layers, bounds = new Bounds()) => {
      bounds.set(0, 0, 40, 40);
      effect.addBounds?.(bounds, true);
      return bounds;
    };
    const originalFast = host.getFastGlobalBounds;
    const detach = attachFilterBounds(host);
    expect(host.getFastGlobalBounds(true).width).toBe(44);
    expect(host.getBounds().width).toBe(44);
    detach();
    expect(effect.addBounds).toBe(oldBounds);
    expect(host.getFastGlobalBounds).toBe(originalFast);
  });

  it("preserves rotated render-group input bounds without an own padding contribution", () => {
    const root = new Container({ isRenderGroup: true });
    const group = root.addChild(new Container({ isRenderGroup: true }));
    group.rotation = Math.PI / 4;
    const parent = group.addChild(new Container());
    const host = parent.addChild(square());
    refresh(root);
    const input = host.getFastGlobalBounds(true).rectangle.clone();
    expect(input.width).toBeCloseTo(40 * Math.SQRT2);
    const stack = new EffectStack(host, queue, "component");
    const f = filter(0);
    stack.add(() => ({
      filter: f,
      getIntensity: () => 1,
      setIntensity: () => {},
    }));
    expect(host.getFastGlobalBounds(true).rectangle).toEqual(input);
    expect(parent.getFastGlobalBounds(true).rectangle).toEqual(input);
    // Pixi adds the host's own padding after this query, for every radius.
    f.padding = 20;
    expect(host.getFastGlobalBounds(true).rectangle).toEqual(input);
    expect(parent.getFastGlobalBounds(true).width).toBeGreaterThan(input.width);
    f.enabled = false;
    expect(parent.getFastGlobalBounds(true).rectangle).toEqual(input);
    stack.destroy();
    expect(host.getFastGlobalBounds(true).rectangle).toEqual(input);
  });

  it("restores bounds ownership after activation failure", () => {
    const host = square();
    const original = host.getFastGlobalBounds;
    const stack = new EffectStack(host, queue, "component");
    expect(() =>
      stack.add(() => ({
        filter: filter(30),
        getIntensity: () => 1,
        setIntensity: () => {},
        onActivate: () => {
          throw new Error("activation failed");
        },
      })),
    ).toThrow("activation failed");
    expect(host.getFastGlobalBounds).toBe(original);
    expect(host.getBounds().width).toBe(40);
    expect(stack.size).toBe(0);
  });
});
