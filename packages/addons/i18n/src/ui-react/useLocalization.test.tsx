// @vitest-environment happy-dom
import { EngineContext } from "@yagejs/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalization } from "../core/i18next.js";
import { LocalizationKey } from "../core/Localization.js";
import { msg } from "../core/message.js";

const engine = new EngineContext();
vi.mock("@yagejs/ui-react", () => ({
  useEngine: () => engine,
  Text: (props: { children?: string }) => <span>{props.children}</span>,
  PixiSelect: (props: { items: string[]; selected?: number }) => (
    <span data-selected={props.selected}>{props.items.join("|")}</span>
  ),
}));

import { Trans, LocalizedPixiSelect } from "./components.js";
import { useLocalization } from "./useLocalization.js";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

let unregister: (() => void) | undefined;
afterEach(() => {
  unregister?.();
  unregister = undefined;
});

async function install() {
  const localization = await createLocalization({
    locale: "en",
    fallbackLocale: "en",
    catalogs: {
      en: { title: "Title" },
      it: { title: "Titolo", hard: "Difficile" },
    },
  });
  engine.register(LocalizationKey, localization);
  unregister = () => engine.unregister(LocalizationKey);
  return localization;
}

function mount(element: React.JSX.Element): HTMLElement {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(element));
  return host;
}

describe("useLocalization / <Trans>", () => {
  it("re-renders on a locale change and exposes the locale", async () => {
    const localization = await install();
    function Probe() {
      const { t, locale } = useLocalization();
      return <span>{`${locale}:${t(msg("title", "Fallback"))}`}</span>;
    }
    const host = mount(<Probe />);
    expect(host.textContent).toBe("en:Title");
    act(() => localization.setLocale("it"));
    expect(host.textContent).toBe("it:Titolo");
  });

  it("formats fallbacks without a service, with an undetermined locale", () => {
    function Probe() {
      const { t, locale } = useLocalization();
      return (
        <span>{`${locale}:${t(msg("title", "Fallback {n}", { n: 1 }))}`}</span>
      );
    }
    const host = mount(
      <>
        <Trans message={msg("title", "Fallback {n}", { n: 1 })} />
        <Probe />
      </>,
    );
    expect(host.textContent).toBe("Fallback 1und:Fallback 1");
  });

  it("<Trans> and <LocalizedPixiSelect> follow the locale", async () => {
    const localization = await install();
    const host = mount(
      <>
        <Trans message={msg("title", "Fallback")} />
        <LocalizedPixiSelect
          closedBG={{} as never}
          openBG={{} as never}
          items={[msg("easy", "Easy"), msg("hard", "Hard")]}
          selected={1}
        />
      </>,
    );
    expect(host.textContent).toBe("TitleEasy|Hard");
    act(() => localization.setLocale("it"));
    expect(host.textContent).toBe("TitoloEasy|Difficile");
    expect(
      host.querySelector("[data-selected]")?.getAttribute("data-selected"),
    ).toBe("1");
  });
});
