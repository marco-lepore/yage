import { Component, Engine, ErrorBoundaryKey, Scene } from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { createLocalization } from "./core/i18next.js";
import { LocalizationKey } from "./core/Localization.js";
import { msg, type Message, type MessageResolver } from "./core/message.js";
import { LocalizationPlugin } from "./LocalizationPlugin.js";

class Label extends Component {
  text = "";
  constructor(readonly message: Message) {
    super();
  }
  relocalize(resolve: MessageResolver): void {
    this.text = resolve(this.message);
  }
}

class Plain extends Component {}

class TestScene extends Scene {
  constructor(readonly name: string) {
    super();
  }
}

const catalogs = {
  en: { title: "Title", hp: "HP {hp}" },
  it: { title: "Titolo", hp: "PV {hp}" },
};

async function boot() {
  const localization = await createLocalization({
    locale: "en",
    fallbackLocale: "en",
    catalogs,
  });
  const engine = new Engine();
  const plugin = new LocalizationPlugin(localization);
  engine.use(plugin);
  await engine.start();
  return { engine, localization, plugin };
}

describe("LocalizationPlugin", () => {
  it("registers the service and relocalizes components in every scene, paused ones included", async () => {
    const { engine, localization } = await boot();
    expect(engine.context.resolve(LocalizationKey)).toBe(localization);

    const world = new TestScene("world");
    const menu = new TestScene("menu");
    await engine.scenes.push(world);
    await engine.scenes.push(menu);
    expect(world.isPaused).toBe(true);

    const title = world.spawn("title").add(new Label(msg("title", "Title")));
    world.spawn("plain").add(new Plain());
    const hp = menu.spawn("hp").add(new Label(msg("hp", "HP {hp}", { hp: 3 })));

    localization.setLocale("it");
    expect(title.text).toBe("Titolo");
    expect(hp.text).toBe("PV 3");
    engine.destroy();
  });

  it("reports a throwing relocalize through the error boundary and rethrows from setLocale", async () => {
    const { engine, localization } = await boot();
    const scene = new TestScene("world");
    await engine.scenes.push(scene);
    class Broken extends Component {
      relocalize(): void {
        throw new Error("boom");
      }
    }
    scene.spawn("broken").add(new Broken());

    expect(() => localization.setLocale("it")).toThrow("boom");
    const errors = engine.context.resolve(ErrorBoundaryKey).getCallbackErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe("Localization update pass");
    expect(localization.locale).toBe("it");
    engine.destroy();
  });

  it("unregisters and stops listening on destroy, leaving the service usable", async () => {
    const { engine, localization } = await boot();
    const scene = new TestScene("world");
    await engine.scenes.push(scene);
    const label = scene.spawn("title").add(new Label(msg("title", "Title")));
    engine.destroy();
    expect(engine.context.tryResolve(LocalizationKey)).toBeUndefined();
    localization.setLocale("it");
    expect(label.text).toBe("");
    expect(localization.resolve(msg("title", "Title"))).toBe("Titolo");
  });
});

describe("inactive entities", () => {
  it("relocalizes a component on an inactive entity, so it is current when enabled", async () => {
    const { engine, localization } = await boot();
    const scene = new TestScene("world");
    await engine.scenes.push(scene);

    const entity = scene.spawn("title");
    const label = entity.add(new Label(msg("title", "Title")));
    entity.setActive(false);
    localization.setLocale("it");
    expect(label.text).toBe("Titolo");

    engine.destroy();
  });
});
