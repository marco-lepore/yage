import { describe, it, expect, vi } from "vitest";
import { LocalizationPlugin } from "./LocalizationPlugin.js";
import { LocalizedTextController, resolveStatic } from "./LocalizedTextController.js";
import { msg } from "./types.js";
import type { LocalizationAdapter } from "./types.js";

class FakeAdapter implements LocalizationAdapter {
  locale = "en";
  private readonly listeners = new Set<() => void>();
  constructor(private readonly table: Record<string, Record<string, string>>) {}
  t(id: string, fallback: string | undefined): string {
    return this.table[this.locale]?.[id] ?? fallback ?? id;
  }
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  setLocale(next: string): void {
    this.locale = next;
    for (const l of this.listeners) l();
  }
}

function makeLocalization(
  table: Record<string, Record<string, string>>,
): LocalizationPlugin {
  return new LocalizationPlugin({ adapter: new FakeAdapter(table) });
}

describe("resolveStatic", () => {
  it("passes a string through", () => {
    expect(resolveStatic("hi")).toBe("hi");
  });

  it("renders a binding's default, interpolating tokens", () => {
    expect(resolveStatic(msg("n", "{n} coins", { n: 3 }))).toBe("3 coins");
  });

  it("falls back to the id when there is no default", () => {
    expect(resolveStatic(msg("hud.score"))).toBe("hud.score");
  });
});

describe("LocalizedTextController", () => {
  it("seed retains a binding without applying", () => {
    const applied: string[] = [];
    const c = new LocalizedTextController((t) => applied.push(t));
    c.seed(msg("greet", "Hi"));
    expect(applied).toEqual([]);
    expect(c.binding).toEqual({ id: "greet", default: "Hi" });
  });

  it("set applies and clears the binding for a plain string", () => {
    const applied: string[] = [];
    const c = new LocalizedTextController((t) => applied.push(t));
    c.set(msg("greet", "Hi"));
    expect(applied).toEqual(["Hi"]);
    c.set("plain");
    expect(applied).toEqual(["Hi", "plain"]);
    expect(c.binding).toBeUndefined();
  });

  it("attach re-resolves against the plugin and re-applies on locale change", async () => {
    const applied: string[] = [];
    const c = new LocalizedTextController((t) => applied.push(t));
    c.seed(msg("greet"));
    const loc = makeLocalization({ en: { greet: "Hello" }, fr: { greet: "Bonjour" } });
    c.attach(loc);
    expect(applied).toEqual(["Hello"]);
    await loc.setLocale("fr");
    expect(applied).toEqual(["Hello", "Bonjour"]);
  });

  it("routes locale-driven refreshes through onRefresh when provided", async () => {
    const applied: string[] = [];
    const refreshed: string[] = [];
    const c = new LocalizedTextController(
      (t) => applied.push(t),
      (t) => refreshed.push(t),
    );
    c.set(msg("greet"));
    // set() uses apply, not onRefresh.
    expect(applied).toEqual(["greet"]);
    expect(refreshed).toEqual([]);

    const loc = makeLocalization({ en: { greet: "Hello" }, fr: { greet: "Bonjour" } });
    c.attach(loc); // initial re-resolve routes through onRefresh
    await loc.setLocale("fr");
    expect(refreshed).toEqual(["Hello", "Bonjour"]);
  });

  it("detach stops further refreshes", async () => {
    const applied: string[] = [];
    const c = new LocalizedTextController((t) => applied.push(t));
    c.seed(msg("greet"));
    const loc = makeLocalization({ en: { greet: "Hello" }, fr: { greet: "Bonjour" } });
    c.attach(loc);
    c.detach();
    await loc.setLocale("fr");
    expect(applied).toEqual(["Hello"]);
  });

  it("with no plugin, attach leaves the seeded static value intact", () => {
    const apply = vi.fn();
    const c = new LocalizedTextController(apply);
    c.seed(msg("greet", "Hi"));
    c.attach(undefined);
    expect(apply).not.toHaveBeenCalled();
  });

  it("clones values on assign — mutating the caller's object can't leak in", () => {
    const c = new LocalizedTextController(() => {});
    const values = { n: 1 };
    c.set(msg("coins", "{n} coins", values));
    values.n = 2; // caller mutates after assigning
    expect(c.binding?.values).toEqual({ n: 1 });
  });

  it("re-attaching a still-attached controller does not leak the prior subscription", async () => {
    const refreshed: string[] = [];
    const c = new LocalizedTextController(
      () => {},
      (t) => refreshed.push(t),
    );
    c.seed(msg("greet"));
    const loc = makeLocalization({
      en: { greet: "Hello" },
      fr: { greet: "Bonjour" },
    });
    c.attach(loc); // subscribes once
    c.attach(loc); // re-attach: prior subscription must be released first
    refreshed.length = 0;

    await loc.setLocale("fr");

    // A leaked first subscription would push "Bonjour" twice.
    expect(refreshed).toEqual(["Bonjour"]);
  });
});
