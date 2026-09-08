import type { FeedbackEntity } from "../../shared/protocol.js";

const PAGE_SIZE = 50;

/** Search results stay bounded even when the capture contains thousands of entities. */
export class EntityPicker {
  private readonly details = document.createElement("details");
  private readonly summary = document.createElement("summary");
  private readonly search = document.createElement("input");
  private readonly results = document.createElement("div");
  private readonly count = document.createElement("span");
  private readonly previous = document.createElement("button");
  private readonly next = document.createElement("button");
  private readonly clear = document.createElement("button");
  private readonly selection = document.createElement("div");
  private readonly fields = document.createElement("fieldset");
  private page = 0;
  private disabled = false;
  private matches: FeedbackEntity[];

  constructor(
    root: HTMLElement,
    private readonly entities: readonly FeedbackEntity[],
    private readonly selected: () => readonly FeedbackEntity[],
    private readonly change: (entities: FeedbackEntity[]) => void,
  ) {
    this.matches = [...entities];
    this.details.className = "entity-picker";
    this.search.type = "search";
    this.search.placeholder = "Filter by name, ID, or scene";
    this.search.setAttribute("aria-label", "Filter entities");
    this.results.className = "entity-results";
    this.selection.className = "entity-selection";
    this.count.setAttribute("aria-live", "polite");
    this.previous.textContent = "Previous";
    this.next.textContent = "Next";
    this.clear.textContent = "Clear selection";
    for (const button of [this.previous, this.next, this.clear])
      button.type = "button";
    const paging = document.createElement("div");
    paging.className = "entity-paging";
    paging.append(this.previous, this.next);
    this.fields.append(
      this.search,
      this.count,
      this.results,
      paging,
      this.clear,
    );
    this.details.append(this.summary, this.fields);
    root.append(this.details, this.selection);
    this.summary.onclick = (event) => {
      if (this.disabled) event.preventDefault();
    };
    this.details.ontoggle = () => {
      if (this.details.open) this.search.focus();
    };
    this.search.oninput = () => {
      const terms = this.search.value
        .toLocaleLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      this.matches = this.entities.filter((entity) => {
        const label =
          `${entity.name} ${entity.id} ${entity.sceneId}`.toLocaleLowerCase();
        return terms.every((term) => label.includes(term));
      });
      this.page = 0;
      this.renderResults();
    };
    this.search.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.details.open = false;
        this.summary.focus();
      }
    };
    this.previous.onclick = () => {
      this.page--;
      this.renderResults();
    };
    this.next.onclick = () => {
      this.page++;
      this.renderResults();
    };
    this.clear.onclick = () => this.change([]);
    this.renderResults();
  }

  refresh(): void {
    const selected = this.selected();
    this.summary.textContent = selected.length
      ? `${selected.length} entities selected`
      : "Select entities…";
    this.selection.textContent = selected.length
      ? selected
          .slice(0, 3)
          .map((entity) => `${entity.name || "Entity"} (${entity.id})`)
          .join(", ") +
        (selected.length > 3 ? ` +${selected.length - 3} more` : "")
      : "No entities selected";
    this.clear.disabled = selected.length === 0;
    const ids = new Set(
      selected.map((entity) => `${entity.sceneId}:${entity.id}`),
    );
    for (const input of this.results.querySelectorAll<HTMLInputElement>(
      "input",
    ))
      input.checked = ids.has(input.value);
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.fields.disabled = disabled;
    this.summary.setAttribute("aria-disabled", String(disabled));
    if (disabled) this.details.open = false;
  }

  private renderResults(): void {
    this.results.replaceChildren();
    const start = this.page * PAGE_SIZE;
    const page = this.matches.slice(start, start + PAGE_SIZE);
    this.count.textContent = page.length
      ? `${start + 1}–${start + page.length} of ${this.matches.length} matches`
      : "No matching entities";
    this.previous.disabled = this.page === 0;
    this.next.disabled = start + PAGE_SIZE >= this.matches.length;
    for (const entity of page) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = `${entity.sceneId}:${entity.id}`;
      input.onchange = () =>
        this.change(
          input.checked
            ? [...this.selected(), entity]
            : this.selected().filter((one) => one !== entity),
        );
      label.append(
        input,
        ` ${entity.name || "Entity"} (${entity.id}) · ${entity.sceneId}`,
      );
      this.results.append(label);
    }
    this.refresh();
  }
}
