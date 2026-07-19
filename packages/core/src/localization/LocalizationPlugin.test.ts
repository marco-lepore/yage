import { describe, it, expect, vi } from "vitest";
import { EngineContext } from "../EngineContext.js";
import { interpolate } from "./IdentityLocalizationAdapter.js";
import {
  LocalizationKey,
  LocalizationPlugin,
  resolveLocalized,
} from "./LocalizationPlugin.js";
import { msg } from "./types.js";
import type { JsonValue, LocalizationAdapter } from "./types.js";

/**
 * Controllable adapter: a per-locale catalog, manual `onChange` emission, and a
 * `setLocale` whose resolution and side effects the test drives.
 */
class MockAdapter implements LocalizationAdapter {
  locale = "en";
  throwOnT = false;
  fireOnChangeDuringSwitch = false;
  setLocaleImpl?: (next: string) => Promise<void>;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly catalogs: Record<string, Record<string, string>> = {},
  ) {}

  t(
    id: string,
    fallback: string | undefined,
    values?: Record<string, JsonValue>,
  ): string {
    if (this.throwOnT) throw new Error("boom");
    const hit = this.catalogs[this.locale]?.[id];
    const text = hit ?? fallback ?? id;
    return values ? interpolate(text, values) : text;
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  emit(): void {
    for (const l of this.listeners) l();
  }

  async setLocale(next: string): Promise<void> {
    if (this.setLocaleImpl) await this.setLocaleImpl(next);
    if (this.fireOnChangeDuringSwitch) this.emit();
    this.locale = next;
  }
}

function installed(
  adapter: LocalizationAdapter,
): { plugin: LocalizationPlugin; context: EngineContext } {
  const plugin = new LocalizationPlugin({ adapter });
  const context = new EngineContext();
  plugin.install(context);
  return { plugin, context };
}

describe("LocalizationPlugin.install", () => {
  it("registers itself under LocalizationKey", () => {
    const { plugin, context } = installed(new MockAdapter());
    expect(context.resolve(LocalizationKey)).toBe(plugin);
  });

  it("seeds locale from the adapter", () => {
    const adapter = new MockAdapter();
    adapter.locale = "de";
    const { plugin } = installed(adapter);
    expect(plugin.locale).toBe("de");
  });
});

describe("LocalizationPlugin.resolve — fallback ordering", () => {
  const adapter = new MockAdapter({ en: { "hud.score": "Score" } });
  const { plugin } = installed(adapter);

  it("returns the catalog hit over the default", () => {
    expect(plugin.resolve(msg("hud.score", undefined, "IGNORED"))).toBe(
      "Score",
    );
  });

  it("returns the default on a miss", () => {
    expect(plugin.resolve(msg("missing", undefined, "Default"))).toBe(
      "Default",
    );
  });

  it("returns the id on a miss with no default", () => {
    expect(plugin.resolve(msg("missing"))).toBe("missing");
  });

  it("interpolates values into the resolved text", () => {
    expect(plugin.resolve(msg("missing", { n: 2 }, "{n} left"))).toBe("2 left");
  });
});

describe("LocalizationPlugin.resolve — never throws", () => {
  it("renders the default when the adapter throws", () => {
    const adapter = new MockAdapter();
    adapter.throwOnT = true;
    const { plugin } = installed(adapter);
    expect(plugin.resolve(msg("x", undefined, "Safe"))).toBe("Safe");
  });

  it("renders the id when the adapter throws and there is no default", () => {
    const adapter = new MockAdapter();
    adapter.throwOnT = true;
    const { plugin } = installed(adapter);
    expect(plugin.resolve(msg("x"))).toBe("x");
  });

  it("interpolates the default on the catch path when the adapter throws", () => {
    const adapter = new MockAdapter();
    adapter.throwOnT = true;
    const { plugin } = installed(adapter);
    // The fallback must interpolate, matching the plugin-absent identity path.
    expect(plugin.resolve(msg("coins", { n: 3 }, "{n} coins"))).toBe("3 coins");
  });
});

describe("LocalizationPlugin.setLocale", () => {
  it("switches locale and bumps the revision once", async () => {
    const { plugin } = installed(new MockAdapter());
    expect(plugin.revision()).toBe(0);
    const onChange = vi.fn();
    plugin.subscribe(onChange);

    await plugin.setLocale("it");

    expect(plugin.locale).toBe("it");
    expect(plugin.revision()).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("coalesces an adapter onChange fired during the switch", async () => {
    const adapter = new MockAdapter();
    adapter.fireOnChangeDuringSwitch = true;
    const { plugin } = installed(adapter);

    await plugin.setLocale("it");

    // The mid-switch onChange is folded into the single driven bump.
    expect(plugin.revision()).toBe(1);
  });

  it("bumps the revision on an adapter onChange outside a switch", () => {
    const adapter = new MockAdapter();
    const { plugin } = installed(adapter);

    adapter.emit();
    adapter.emit();

    expect(plugin.revision()).toBe(2);
  });

  it("tracks the adapter's locale on an onChange outside a switch", () => {
    // The game drove the i18n library directly; the adapter changed locale and
    // fired onChange. `locale` must reflect the adapter, not stay stale.
    const adapter = new MockAdapter();
    const { plugin } = installed(adapter);

    adapter.locale = "de";
    adapter.emit();

    expect(plugin.locale).toBe("de");
  });

  it("last concurrent caller wins; superseded call commits nothing", async () => {
    const adapter = new MockAdapter();
    const gates: Record<string, () => void> = {};
    adapter.setLocaleImpl = (next) =>
      new Promise<void>((resolve) => {
        gates[next] = resolve;
      });
    const { plugin } = installed(adapter);

    const first = plugin.setLocale("it");
    const second = plugin.setLocale("fr");

    // Resolve the superseded (older) call first, then the winner.
    gates["it"]!();
    await first;
    gates["fr"]!();
    await second;

    expect(plugin.locale).toBe("fr");
    // Only the winning switch commits a bump.
    expect(plugin.revision()).toBe(1);
  });

  it("publishes the adapter's canonical locale, not the requested tag", async () => {
    // A library-backed adapter may canonicalize the request (here `en-US` →
    // `en`). `locale` must report what `resolve()` actually uses.
    let locale = "en";
    const adapter: LocalizationAdapter = {
      get locale() {
        return locale;
      },
      t: (id, fallback) => fallback ?? id,
      subscribe: () => () => {},
      setLocale(next: string): void {
        locale = next === "en-US" ? "en" : next;
      },
    };
    const { plugin } = installed(adapter);

    await plugin.setLocale("en-US");

    expect(plugin.locale).toBe("en");
  });

  it("keeps the old locale and publishes nothing when the adapter rejects", async () => {
    const adapter = new MockAdapter();
    adapter.setLocaleImpl = () => Promise.reject(new Error("load failed"));
    const { plugin } = installed(adapter);

    await expect(plugin.setLocale("it")).rejects.toThrow("load failed");

    expect(plugin.locale).toBe("en");
    expect(plugin.revision()).toBe(0);
  });

  it("works without adapter.setLocale support", async () => {
    // Adapter exposing no setLocale — the plugin still switches + bumps.
    const adapter: LocalizationAdapter = {
      locale: "en",
      t: (id, fallback) => fallback ?? id,
      subscribe: () => () => {},
    };
    const { plugin } = installed(adapter);

    await plugin.setLocale("es");

    expect(plugin.locale).toBe("es");
    expect(plugin.revision()).toBe(1);
  });
});

describe("LocalizationPlugin.onDestroy", () => {
  it("unsubscribes from the adapter", () => {
    const adapter = new MockAdapter();
    const { plugin } = installed(adapter);

    plugin.onDestroy();
    adapter.emit();

    expect(plugin.revision()).toBe(0);
  });
});

describe("resolveLocalized", () => {
  it("uses the registered plugin when present", () => {
    const adapter = new MockAdapter({ en: { greet: "Hi" } });
    const { context } = installed(adapter);
    expect(resolveLocalized(context, msg("greet", undefined, "x"))).toBe("Hi");
  });

  it("falls back to the identity adapter with no plugin — renders default", () => {
    const context = new EngineContext();
    expect(resolveLocalized(context, msg("x", undefined, "Default"))).toBe(
      "Default",
    );
  });

  it("interpolates the default with no plugin", () => {
    const context = new EngineContext();
    expect(resolveLocalized(context, msg("x", { n: 3 }, "{n} coins"))).toBe(
      "3 coins",
    );
  });

  it("renders the id with no plugin and no default", () => {
    const context = new EngineContext();
    expect(resolveLocalized(context, msg("hud.score"))).toBe("hud.score");
  });
});
