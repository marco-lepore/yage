/**
 * The examples index: a sidebar listing every example by section, and a stage
 * that runs the selected one in a frame. The URL hash names the selection
 * (`/#platformer`), so links, reloads, and Back and Forward all work.
 */
import "./styles.css";
import logoUrl from "../../../assets/logo-icon.svg";
import {
  EXAMPLES,
  PACKAGES,
  SECTIONS,
  type Example,
  type PackageId,
  type SectionId,
} from "../catalog.js";
import { byId, el } from "./dom.js";

const DOCS_URL = "https://yage.dev";
const SOURCE_URL =
  "https://github.com/marco-lepore/yage/tree/main/examples/src";

/** A filter chip: an engine package, or "any addon". */
type Filter = PackageId | "addons";

interface Entry {
  readonly example: Example;
  /** Lower-cased text that search terms are matched against. */
  readonly haystack: string;
  readonly navLink: HTMLAnchorElement;
  readonly navItem: HTMLLIElement;
  readonly overviewItem: HTMLLIElement;
}

interface SectionView {
  readonly entries: readonly Entry[];
  readonly nav: HTMLElement;
  readonly overview: HTMLElement;
  readonly counts: readonly HTMLElement[];
}

const state: {
  terms: string[];
  filters: Set<Filter>;
  current: Entry | undefined;
} = { terms: [], filters: new Set(), current: undefined };

const shell = byId("shell");
const search = byId<HTMLInputElement>("search");
const nav = byId("nav");
const backdrop = byId("backdrop");
const overview = byId("overview");
const stage = byId("stage");
const stageFrame = byId("stage-frame");
const frameHost = byId("frame-slot");
const focusHint = byId("focus-hint");
const prevButton = byId<HTMLButtonElement>("prev");
const nextButton = byId<HTMLButtonElement>("next");
const fullscreenButton = byId<HTMLButtonElement>("fullscreen");

byId<HTMLImageElement>("logo").src = logoUrl;
document.head.append(
  el("link", { rel: "icon", type: "image/svg+xml", href: logoUrl }),
);

const entries = new Map<string, Entry>();
const sectionViews = buildLists();
buildChips();
applyFilters();
wireEvents();
route();

function sectionTitle(id: SectionId): string {
  return SECTIONS.find((section) => section.id === id)?.title ?? id;
}

function pageUrl(example: Example): string {
  return `${import.meta.env.BASE_URL}${example.slug}.html`;
}

function badges(example: Example): HTMLSpanElement {
  return el(
    "span",
    { class: "badges" },
    ...(example.addons ?? []).map((addon) =>
      el(
        "span",
        { class: "badge addon", title: `@yagejs-addons/${addon}` },
        addon,
      ),
    ),
    ...example.packages.map((pkg) =>
      el("span", { class: "badge", title: `@yagejs/${pkg}` }, pkg),
    ),
  );
}

/** Build the sidebar list and the overview list, one section at a time. */
function buildLists(): SectionView[] {
  const overviewSections = byId("overview-sections");
  return SECTIONS.map((section) => {
    const navList = el("ul", { class: "nav-list" });
    const overviewList = el("ul", { class: "overview-list" });
    const sectionEntries = EXAMPLES.filter(
      (example) => example.section === section.id,
    ).map((example): Entry => {
      const href = `#${example.slug}`;
      const navLink = el("a", { class: "nav-link", href }, example.title);
      const navItem = el("li", {}, navLink);
      const overviewItem = el(
        "li",
        {},
        el(
          "a",
          { class: "overview-row", href },
          el("span", { class: "overview-title" }, example.title),
          el("span", { class: "overview-summary" }, example.summary),
          badges(example),
        ),
      );
      navList.append(navItem);
      overviewList.append(overviewItem);
      const haystack = [
        example.slug,
        example.title,
        example.summary,
        section.title,
        ...example.packages,
        ...(example.addons ?? []),
      ]
        .join(" ")
        .toLowerCase();
      const entry = { example, haystack, navLink, navItem, overviewItem };
      entries.set(example.slug, entry);
      return entry;
    });

    const navCount = el("span", { class: "count" });
    const overviewCount = el("span", { class: "count" });
    const navSection = el(
      "section",
      { class: "nav-section" },
      el("h2", {}, section.title, navCount),
      navList,
    );
    const overviewSection = el(
      "section",
      { class: "overview-section" },
      el("h2", {}, section.title, overviewCount),
      overviewList,
    );
    nav.append(navSection);
    overviewSections.append(overviewSection);
    return {
      entries: sectionEntries,
      nav: navSection,
      overview: overviewSection,
      counts: [navCount, overviewCount],
    };
  });
}

function buildChips(): void {
  const chips = byId("chips");
  const filters: Filter[] = [...PACKAGES, "addons"];
  for (const filter of filters) {
    const chip = el(
      "button",
      { type: "button", class: "chip", "aria-pressed": "false" },
      filter,
    );
    chip.addEventListener("click", () => {
      const on = !state.filters.has(filter);
      if (on) state.filters.add(filter);
      else state.filters.delete(filter);
      chip.setAttribute("aria-pressed", String(on));
      applyFilters();
    });
    chips.append(chip);
  }
}

function matches(entry: Entry): boolean {
  const { example } = entry;
  for (const filter of state.filters) {
    const has =
      filter === "addons"
        ? (example.addons?.length ?? 0) > 0
        : example.packages.includes(filter);
    if (!has) return false;
  }
  return state.terms.every((term) => entry.haystack.includes(term));
}

function setQuery(query: string): void {
  state.terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  applyFilters();
}

function clearFilters(): void {
  search.value = "";
  state.filters.clear();
  for (const chip of byId("chips").children) {
    chip.setAttribute("aria-pressed", "false");
  }
  setQuery("");
}

/** Show the examples that match the search and chips; hide the rest. */
function applyFilters(): void {
  let shown = 0;
  for (const view of sectionViews) {
    let visible = 0;
    for (const entry of view.entries) {
      const match = matches(entry);
      entry.navItem.hidden = !match;
      entry.overviewItem.hidden = !match;
      if (match) visible++;
    }
    view.nav.hidden = visible === 0;
    view.overview.hidden = visible === 0;
    for (const count of view.counts) count.textContent = String(visible);
    shown += visible;
  }

  const filtering = state.terms.length > 0 || state.filters.size > 0;
  byId("results-text").textContent = filtering
    ? `${shown} of ${EXAMPLES.length} examples`
    : `${EXAMPLES.length} examples`;
  byId("clear-filters").hidden = !filtering;
  byId("overview-empty").hidden = shown > 0;
  const filterCount = byId("filter-count");
  filterCount.hidden = state.filters.size === 0;
  filterCount.textContent = String(state.filters.size);
  updateNeighbours();
}

/**
 * The next (`step` 1) or previous (-1) example that passes the filters, in
 * list order. From the overview, the next one is the first in the list.
 */
function neighbour(step: 1 | -1): Entry | undefined {
  const all = [...entries.values()];
  const start = state.current ? all.indexOf(state.current) : -1;
  for (let i = start + step; i >= 0 && i < all.length; i += step) {
    const entry = all[i];
    if (entry && matches(entry)) return entry;
  }
  return undefined;
}

/** The first example that passes the filters. */
function firstMatch(): Entry | undefined {
  for (const entry of entries.values()) if (matches(entry)) return entry;
  return undefined;
}

function updateNeighbours(): void {
  prevButton.disabled = neighbour(-1) === undefined;
  nextButton.disabled = neighbour(1) === undefined;
}

function go(entry: Entry | undefined): void {
  if (entry) location.hash = entry.example.slug;
}

/** Show whatever the URL hash names: an example, or the overview. */
function route(): void {
  const entry = entries.get(location.hash.slice(1));
  if (entry === state.current) return;
  if (entry) showExample(entry);
  else showOverview();
}

function showExample(entry: Entry): void {
  const { example } = entry;
  state.current?.navLink.removeAttribute("aria-current");
  state.current = entry;
  entry.navLink.setAttribute("aria-current", "page");
  reveal(entry.navLink);

  byId("stage-section").textContent = sectionTitle(example.section);
  byId("stage-title").textContent = example.title;
  byId("stage-summary").textContent = example.summary;
  byId("stage-badges").replaceChildren(...badges(example).childNodes);
  byId<HTMLAnchorElement>("guide").href = DOCS_URL + example.guide;
  byId<HTMLAnchorElement>("source").href = `${SOURCE_URL}/${example.slug}`;
  byId<HTMLAnchorElement>("standalone").href = pageUrl(example);
  document.title = `${example.title} · YAGE Examples`;

  overview.hidden = true;
  stage.hidden = false;
  mountFrame(example);
  updateNeighbours();
  closeDrawer();
}

function showOverview(): void {
  state.current?.navLink.removeAttribute("aria-current");
  state.current = undefined;
  // Removing the frame unloads the example that was running.
  frameHost.replaceChildren();
  document.title = "YAGE Examples";
  stage.hidden = true;
  overview.hidden = false;
  updateNeighbours();
}

/**
 * Run `example` in a new frame. A new element each time, because pointing an
 * existing frame at a new page adds a history entry, and Back would then step
 * through pages inside the frame instead of between examples.
 */
function mountFrame(example: Example): void {
  const frame = el("iframe", { title: example.title, src: pageUrl(example) });
  // Hand the keyboard to the example as soon as it loads.
  frame.addEventListener("load", () => frame.contentWindow?.focus());
  frameHost.replaceChildren(frame);
  updateFocusHint();
}

function currentFrame(): HTMLIFrameElement | null {
  return frameHost.querySelector("iframe");
}

/** Keys reach the example only while its frame has focus; say so otherwise. */
function updateFocusHint(): void {
  const frame = currentFrame();
  const focused =
    frame !== null && document.activeElement === frame && document.hasFocus();
  focusHint.dataset["state"] = focused ? "active" : "idle";
}

/** Scroll the sidebar so `link` sits mid-list, unless it is already in view. */
function reveal(link: HTMLElement): void {
  const list = nav.getBoundingClientRect();
  const box = link.getBoundingClientRect();
  if (box.top >= list.top && box.bottom <= list.bottom) return;
  nav.scrollTop += box.top - list.top - (list.height - box.height) / 2;
}

function openDrawer(): void {
  shell.dataset["drawer"] = "open";
  backdrop.hidden = false;
}

function closeDrawer(): void {
  delete shell.dataset["drawer"];
  backdrop.hidden = true;
}

function visibleNavLinks(): HTMLAnchorElement[] {
  return [
    ...nav.querySelectorAll<HTMLAnchorElement>(
      "section:not([hidden]) li:not([hidden]) > a",
    ),
  ];
}

function wireEvents(): void {
  window.addEventListener("hashchange", route);
  window.addEventListener("popstate", route);

  byId("home-link").addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
      return;
    event.preventDefault();
    // Drop the hash but keep the path, so this works under any base.
    history.pushState(null, "", location.pathname + location.search);
    route();
  });

  search.addEventListener("input", () => setQuery(search.value));
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      go(firstMatch());
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (search.value) {
        search.value = "";
        setQuery("");
      } else {
        search.blur();
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      visibleNavLinks()[0]?.focus();
    }
  });

  nav.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const links = visibleNavLinks();
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index === -1) return;
    event.preventDefault();
    const target = links[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (target) target.focus();
    else if (event.key === "ArrowUp") search.focus();
  });

  byId("clear-filters").addEventListener("click", clearFilters);
  for (const button of document.querySelectorAll("[data-action=clear]")) {
    button.addEventListener("click", clearFilters);
  }
  for (const button of document.querySelectorAll("[data-action=menu]")) {
    button.addEventListener("click", openDrawer);
  }
  backdrop.addEventListener("click", closeDrawer);

  prevButton.addEventListener("click", () => go(neighbour(-1)));
  nextButton.addEventListener("click", () => go(neighbour(1)));
  byId("reload").addEventListener("click", () => {
    if (state.current) mountFrame(state.current.example);
  });

  fullscreenButton.hidden = !document.fullscreenEnabled;
  fullscreenButton.addEventListener("click", () => {
    stageFrame
      .requestFullscreen()
      .then(() => currentFrame()?.contentWindow?.focus())
      .catch((err: unknown) => {
        console.warn("[examples] full screen was refused:", err);
      });
  });

  // Focus moving into the frame blurs this window; moving back focuses it.
  window.addEventListener("blur", () => setTimeout(updateFocusHint));
  window.addEventListener("focus", updateFocusHint);
  document.addEventListener("focusin", updateFocusHint);

  // Shortcuts. They only fire while focus is outside the example's frame, so
  // they never take keys the example is using.
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
    if (event.altKey) return;
    const target = event.target;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);
    if (event.key === "Escape") closeDrawer();
    if (typing) return;
    if (event.key === "/") {
      event.preventDefault();
      search.focus();
      search.select();
    } else if (event.key === "j") {
      go(neighbour(1));
    } else if (event.key === "k") {
      go(neighbour(-1));
    }
  });
}
