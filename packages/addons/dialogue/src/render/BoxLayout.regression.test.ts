import { describe, expect, it, vi } from "vitest";
import { createMockScene } from "@yagejs/core";
import { RendererKey, RendererPlugin } from "@yagejs/renderer";
import { BoxLayout, type BoxLayoutConfig } from "./BoxLayout.js";
import { parseMarkup } from "../core/markup.js";
import type { PresentedLine } from "../core/session.js";

// Deterministic font metrics: ten pixels per character, twenty per line.
vi.mock("@yagejs/renderer", async (original) => ({
  ...(await original<object>()),
  measureWrappedText: (text: string, options: { wordWrapWidth: number }) => ({
    height: Math.ceil((text.length * 10) / options.wordWrapWidth) * 20,
  }),
}));
const cfg: BoxLayoutConfig = {
  box: { marginX: 10, marginY: 10, minHeight: 40 },
  padding: 10,
  nameSize: 16,
  textSize: 16,
  lineHeight: 20,
  choiceGap: 6,
};
const line = (text: string, name?: string): PresentedLine => ({
  text: parseMarkup(text),
  speed: 1,
  ...(name !== undefined ? { speaker: { id: "hero", name } } : {}),
});
function layout(): BoxLayout {
  const result = new BoxLayout(cfg);
  result.setViewport(240, 450);
  return result;
}
describe("box content geometry", () => {
  it("binds the renderer viewport without a chrome presenter", () => {
    const { scene, context } = createMockScene();
    const renderer = new RendererPlugin({ width: 240, height: 450 });
    vi.spyOn(renderer, "virtualSize", "get").mockReturnValue({
      width: 240,
      height: 450,
    });
    context.register(RendererKey, renderer);
    const box = new BoxLayout(cfg);
    box.mount(scene);
    expect(box.frameRect()).toMatchObject({ y: 400, width: 220 });
  });
  it("requires an explicit viewport before geometry reads", () => {
    expect(() => new BoxLayout(cfg).frameRect()).toThrow(/viewport/i);
  });
  it("removes the name band for an unnamed line", () => {
    const box = layout();
    box.layoutLine(line("hello"));
    expect(box.textRegion().y - box.frameRect().y).toBe(10);
  });
  it("grows a complete say line before reveal and shrinks for the next line", () => {
    const box = layout();
    box.layoutLine(line("x".repeat(100)));
    expect(box.frameRect().height).toBe(120);
    box.layoutLine(line("hello"));
    expect(box.frameRect().height).toBe(40);
  });
  it("places choices directly below the prompt", () => {
    const box = new BoxLayout({ ...cfg, box: { ...cfg.box, minHeight: 200 } });
    box.setViewport(240, 450);
    box.layoutLine(line("hello"));
    const rows = box.layoutChoicePanel([25, 25]);
    expect(rows[0]?.y).toBe(box.textRegion().y + 20 + 6);
  });
  it("remeasures a say line after the avatar reserves width", () => {
    const box = layout();
    box.layoutLine(line("x".repeat(40)));
    expect(box.frameRect().height).toBe(60);
    box.setInset("avatar", { side: "left", width: 100 });
    expect(box.frameRect().height).toBe(100);
  });
  it("notifies a changed name band even if the frame stays at its minimum", () => {
    const box = new BoxLayout({ ...cfg, box: { ...cfg.box, minHeight: 200 } });
    box.setViewport(240, 450);
    box.layoutLine(line("hello", "Hero"));
    const changed = vi.fn();
    box.onChange(changed);
    box.layoutLine(line("hello"));
    expect(changed).toHaveBeenCalledOnce();
  });
  it("reserves the portrait height and releases it when the portrait leaves", () => {
    const box = layout();
    box.layoutLine(line("hello"));
    box.setInset("avatar", { side: "left", width: 80, height: 140 });
    expect(box.frameRect().height).toBe(160);
    box.setInset("avatar", undefined);
    expect(box.frameRect().height).toBe(40);
  });
  it("caps a long say line at the viewport margins", () => {
    const box = layout();
    box.layoutLine(line("x".repeat(1000)));
    expect(box.frameRect()).toMatchObject({ y: 10, height: 430 });
  });
  it("reserves the configured caret below text and removes its footer for choices", () => {
    const box = layout();
    box.setCaretHeight(12);
    box.layoutLine(line("hello"));
    expect(box.frameRect().height).toBe(57);
    expect(box.caretPos({ width: 7, height: 12 }).y).toBe(
      box.textRegion().y + 20 + 4,
    );
    box.layoutChoicePanel([25]);
    expect(box.frameRect().height).toBe(71);
    const before = box.frameRect();
    expect(() => box.setCaretHeight(Infinity)).toThrow(/height/);
    expect(box.frameRect()).toEqual(before);
  });
  it("reserves the caret below a tall right-side portrait", () => {
    const box = layout();
    box.setCaretHeight(5);
    box.layoutLine(line("hello"));
    box.setInset("avatar", { side: "right", width: 80, height: 140 });
    expect(box.frameRect().height).toBe(170);
    expect(box.caretPos({ width: 7, height: 5 }).y).toBe(
      box.textRegion().y + 140 + 4,
    );
  });
  it("notifies footer changes when the minimum keeps the frame unchanged", () => {
    const box = new BoxLayout({ ...cfg, box: { ...cfg.box, minHeight: 200 } });
    box.setViewport(240, 450);
    box.setCaretHeight(12);
    box.layoutLine(line("hello"));
    const changed = vi.fn();
    box.onChange(changed);
    const before = box.textRegion().height;
    box.layoutChoicePanel([25]);
    expect(box.textRegion().height).toBe(before + 17);
    expect(changed).toHaveBeenCalledOnce();
    box.layoutLine(line("hello"));
    expect(box.textRegion().height).toBe(before);
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid viewport and inset writes before changing geometry", () => {
    const box = layout();
    const before = box.frameRect();
    expect(() => box.setViewport(NaN, 450)).toThrow(/width/);
    expect(() => box.setViewport(240, Infinity)).toThrow(/height/);
    expect(() => box.setInset("avatar", { side: "left", width: 200 })).toThrow(
      /content width/,
    );
    expect(() =>
      box.setInset("avatar", { side: "left", width: 80, height: -1 }),
    ).toThrow(/height/);
    expect(box.frameRect()).toEqual(before);
    expect(box.contentWidth()).toBe(200);
  });
});
