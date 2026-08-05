import { describe, it, expect, vi } from "vitest";
import { EngineContext, LoggerKey } from "../EngineContext.js";
import type { Logger } from "../Logger.js";
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
    expect(plugin.resolve(msg("hud.score", "IGNORED"))).toBe(
      "Score",
    );
  });

  it("returns the default on a miss", () => {
    expect(plugin.resolve(msg("missing", "Default"))).toBe(
      "Default",
    );
  });

  it("returns the id on a miss with no default", () => {
    expect(plugin.resolve(msg("missing"))).toBe("missing");
  });

  it("interpolates values into the resolved text", () => {
    expect(plugin.resolve(msg("missing", "{n} left", { n: 2 }))).toBe("2 left");
  });
});

describe("LocalizationPlugin.resolve — never throws", () => {
  it("renders the default when the adapter throws", () => {
    const adapter = new MockAdapter();
    adapter.throwOnT = true;
    const { plugin } = installed(adapter);
    expect(plugin.resolve(msg("x", "Safe"))).toBe("Safe");
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
    expect(plugin.resolve(msg("coins", "{n} coins", { n: 3 }))).toBe("3 coins");
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

  it("reports the adapter's locale when the adapter cannot switch", async () => {
    // An adapter with no setLocale is locale-static. The call resolves, but
    // `locale` keeps reporting what `resolve()` actually reads against —
    // announcing "es" while every string stays English is what this guards.
    const adapter: LocalizationAdapter = {
      locale: "en",
      t: (id, fallback) => fallback ?? id,
      subscribe: () => () => {},
    };
    const { plugin } = installed(adapter);

    await plugin.setLocale("es");

    expect(plugin.locale).toBe("en");
    // And publishes nothing: no resolved output changed, so waking every bound
    // sink — re-splitting each split text among them — would be pure churn.
    expect(plugin.revision()).toBe(0);
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
    expect(resolveLocalized(context, msg("greet", "x"))).toBe("Hi");
  });

  it("falls back to the identity adapter with no plugin — renders default", () => {
    const context = new EngineContext();
    expect(resolveLocalized(context, msg("x", "Default"))).toBe(
      "Default",
    );
  });

  it("interpolates the default with no plugin", () => {
    const context = new EngineContext();
    expect(resolveLocalized(context, msg("x", "{n} coins", { n: 3 }))).toBe(
      "3 coins",
    );
  });

  it("renders the id with no plugin and no default", () => {
    const context = new EngineContext();
    expect(resolveLocalized(context, msg("hud.score"))).toBe("hud.score");
  });
});

describe("LocalizationPlugin.setLocale failure", () => {
  it("publishes a catalog the adapter swapped in before rejecting", async () => {
    // The adapter loads `fr` and announces it, then fails a later check. `t()`
    // already returns French, so leaving the revision unbumped would freeze
    // every bound sink on the old text while `resolve()` disagrees.
    const adapter = new MockAdapter({ fr: { greet: "Bonjour" } });
    adapter.setLocaleImpl = async (next) => {
      adapter.locale = next;
      adapter.emit();
      throw new Error("post-load check failed");
    };
    const { plugin } = installed(adapter);

    await expect(plugin.setLocale("fr")).rejects.toThrow("post-load check");
    expect(plugin.locale).toBe("fr");
    expect(plugin.revision()).toBe(1);
    expect(plugin.resolve(msg("greet", "Hello"))).toBe("Bonjour");
  });

  it("publishes nothing when the adapter fails without changing anything", async () => {
    const adapter = new MockAdapter();
    adapter.setLocaleImpl = async () => {
      throw new Error("catalog 404");
    };
    const { plugin } = installed(adapter);

    await expect(plugin.setLocale("fr")).rejects.toThrow("catalog 404");
    expect(plugin.locale).toBe("en");
    // No bump: nothing changed, so making every sink re-resolve is waste.
    expect(plugin.revision()).toBe(0);
  });
});

describe("LocalizationPlugin.resolve failure reporting", () => {
  it("logs the first adapter throw once, then stays quiet", () => {
    const adapter = new MockAdapter();
    adapter.throwOnT = true;
    const error = vi.fn();
    const context = new EngineContext();
    context.register(LoggerKey, { error } as unknown as Logger);
    const plugin = new LocalizationPlugin({ adapter });
    plugin.install(context);

    expect(plugin.resolve(msg("a", "A"))).toBe("A");
    expect(plugin.resolve(msg("b", "B"))).toBe("B");

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[1]).toContain("adapter.t threw");
  });
});
