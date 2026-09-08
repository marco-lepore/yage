import { FeedbackLauncher } from "./FeedbackLauncher.js";
import { CSS } from "./styles.js";
import type { FeedbackSession } from "../session/FeedbackSession.js";
import { EntityPicker } from "./EntityPicker.js";
import type {
  FeedbackCapture,
  FeedbackEntity,
  FeedbackTarget,
  Rect,
} from "../../shared/protocol.js";

/** DOM owns interaction even when no engine frames are running. */
export class FeedbackPanel {
  private readonly style = document.createElement("style");
  private readonly launcher: FeedbackLauncher;
  private dialog: HTMLDialogElement | undefined;
  private destroyed = false;
  constructor(
    private readonly session: FeedbackSession,
    shortcuts: boolean,
  ) {
    this.style.textContent = CSS;
    document.head.append(this.style);
    this.launcher = new FeedbackLauncher(
      () => this.open(),
      () => this.session.toggleFreeze(),
      shortcuts,
    );
  }
  open(): void {
    if (this.dialog || this.destroyed) return;
    let observation: { capture: FeedbackCapture; image: string };
    try {
      observation = this.session.open();
    } catch (error) {
      this.launcher.error(error);
      return;
    }
    this.launcher.reset();
    const { capture, image } = observation;
    const dialog = document.createElement("dialog");
    this.dialog = dialog;
    dialog.className = "yage-feedback";
    dialog.setAttribute("aria-label", "YAGE feedback");
    dialog.innerHTML = `<header><h2>Leave feedback</h2><button data-close>Return to view</button></header>
      <p data-frame></p><div class="layout"><figure aria-label="Captured game view"><img alt="Captured game viewport"><div class="outlines"></div></figure>
      <section><label>Target <select aria-label="Target mode"><option value="global">Whole view</option><option value="entities">Entities</option><option value="area">Area</option></select></label>
      <div class="targets"></div><label>Comment<textarea aria-label="Comment" maxlength="10000" placeholder="What would you like changed?"></textarea></label>
      <button data-save>Save comment</button><button data-cancel hidden>Cancel save</button><button data-discard hidden>Discard unsaved draft</button><p class="status" role="status"></p><strong>Comments in this session</strong><ol class="history"></ol></section></div>`;
    const query = <T extends Element>(selector: string): T => {
      const element = dialog.querySelector<T>(selector);
      if (!element) throw new Error(`Feedback UI element missing: ${selector}`);
      return element;
    };
    query("[data-frame]").textContent =
      `Frame ${capture.frame} · ${capture.width} × ${capture.height} · Select a target and add one or more comments.`;
    query<HTMLImageElement>("img").src = image;
    const figure = query<HTMLElement>("figure");
    const select = query<HTMLSelectElement>("select");
    const textarea = query<HTMLTextAreaElement>("textarea");
    const save = query<HTMLButtonElement>("[data-save]");
    const close = query<HTMLButtonElement>("[data-close]");
    const discard = query<HTMLButtonElement>("[data-discard]");
    const cancel = query<HTMLButtonElement>("[data-cancel]");
    const status = query<HTMLElement>(".status");
    const targets = query<HTMLElement>(".targets");
    const outlines = query<HTMLElement>(".outlines");
    let selected: FeedbackEntity[] = [];
    let area: Rect | undefined;
    let start: { x: number; y: number } | undefined;
    const draw = (): void => {
      outlines.replaceChildren();
      const boxes =
        select.value === "entities"
          ? selected.map((entity) => entity.bounds)
          : select.value === "area" && area
            ? [area]
            : [];
      for (const box of boxes) {
        const outline = document.createElement("div");
        outline.className = "outline";
        Object.assign(outline.style, {
          left: `${(box.x / capture.width) * 100}%`,
          top: `${(box.y / capture.height) * 100}%`,
          width: `${(box.width / capture.width) * 100}%`,
          height: `${(box.height / capture.height) * 100}%`,
        });
        outlines.append(outline);
      }
      targets.hidden = select.value !== "entities";
      picker.refresh();
    };
    const picker = new EntityPicker(
      targets,
      capture.entities,
      () => selected,
      (entities) => {
        selected = entities;
        draw();
      },
    );
    select.onchange = () => {
      area = undefined;
      selected = [];
      draw();
    };
    const point = (event: PointerEvent): { x: number; y: number } => {
      const box = figure.getBoundingClientRect();
      return {
        x: Math.max(
          0,
          Math.min(
            capture.width,
            ((event.clientX - box.left) / box.width) * capture.width,
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            capture.height,
            ((event.clientY - box.top) / box.height) * capture.height,
          ),
        ),
      };
    };
    figure.onpointerdown = (event) => {
      if (event.button !== 0 || this.session.pending) return;
      const p = point(event);
      if (select.value === "area") {
        start = p;
        area = undefined;
        figure.setPointerCapture(event.pointerId);
      }
      if (select.value === "entities") {
        const candidates = capture.entities.filter(
          ({ bounds: b }) =>
            p.x >= b.x &&
            p.x <= b.x + b.width &&
            p.y >= b.y &&
            p.y <= b.y + b.height,
        );
        const entity = candidates.at(-1);
        if (entity)
          selected = event.shiftKey
            ? selected.includes(entity)
              ? selected.filter((one) => one !== entity)
              : [...selected, entity]
            : [entity];
        else if (!event.shiftKey) selected = [];
        status.textContent =
          candidates.length > 1
            ? "Overlapping bounds: use the entity dropdown to choose the intended entity."
            : "";
      }
      draw();
    };
    figure.onpointermove = (event) => {
      if (!start) return;
      const p = point(event);
      area = {
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      };
      draw();
    };
    figure.onpointerup = () => {
      start = undefined;
    };
    figure.onpointercancel = () => {
      start = undefined;
      area = undefined;
      draw();
    };
    const history = (): void => {
      const list = query<HTMLOListElement>(".history");
      list.replaceChildren();
      for (const comment of this.session.comments) {
        const li = document.createElement("li");
        li.textContent = comment.text;
        list.append(li);
      }
    };
    const closeDialog = (): void => {
      this.close();
    };
    close.onclick = closeDialog;
    dialog.oncancel = (event) => {
      event.preventDefault();
      closeDialog();
    };
    for (const type of [
      "keydown",
      "keyup",
      "pointerdown",
      "pointerup",
      "pointermove",
      "mousedown",
      "mouseup",
      "click",
      "wheel",
    ])
      dialog.addEventListener(type, (event) => event.stopPropagation());
    const showPending = (): void => {
      const draft = this.session.draftComment;
      if (!draft) return;
      textarea.value = draft.text;
      select.value = draft.target.kind;
      const target = draft.target;
      if (target.kind === "entities")
        selected = capture.entities.filter((entity) =>
          target.entities.some(
            (one) =>
              one.sceneId === entity.sceneId &&
              one.id === entity.id &&
              one.generation === entity.generation,
          ),
        );
      if (target.kind === "area") area = { ...target.rect };
      textarea.disabled = true;
      select.disabled = true;
      picker.setDisabled(true);
      save.disabled = false;
      save.textContent = "Retry save";
      discard.hidden = false;
      cancel.hidden = true;
      draw();
    };
    cancel.onclick = () => {
      this.session.cancelSave();
      showPending();
      status.textContent =
        "Save cancelled. The draft is retained; retry or return to the view. A server commit may already have completed.";
    };
    discard.onclick = () => {
      this.session.discard();
      textarea.value = "";
      textarea.disabled = false;
      select.disabled = false;
      close.disabled = false;
      picker.setDisabled(false);
      save.textContent = "Save comment";
      discard.hidden = true;
      status.textContent =
        "Draft discarded. Any comment already saved on the server remains there.";
    };
    save.onclick = () => {
      void (async () => {
        let target: FeedbackTarget = { kind: "global" };
        if (!this.session.pending) {
          if (select.value === "entities") {
            if (!selected.length) {
              status.textContent = "Select at least one entity.";
              return;
            }
            target = { kind: "entities", entities: [...selected] };
          } else if (select.value === "area") {
            if (!area || area.width < 1 || area.height < 1) {
              status.textContent = "Draw an area on the image.";
              return;
            }
            target = { kind: "area", rect: { ...area } };
          }
          if (!textarea.value.trim()) {
            status.textContent = "Write a comment first.";
            return;
          }
        }
        save.disabled = true;
        cancel.hidden = false;
        select.disabled = true;
        textarea.disabled = true;
        picker.setDisabled(true);
        status.textContent = "Saving…";
        discard.hidden = true;
        try {
          const saved = await this.session.save(textarea.value, target);
          if (this.dialog !== dialog || !saved) return;
          textarea.value = "";
          textarea.disabled = false;
          select.disabled = false;
          close.disabled = false;
          picker.setDisabled(false);
          save.textContent = "Save comment";
          status.textContent =
            "Saved. Add another comment or return to the view.";
          history();
        } catch (error) {
          if (this.dialog !== dialog) return;
          status.textContent = `${error instanceof Error ? error.message : String(error)}\nThe draft is retained. Retry or return to the view.`;
          save.textContent = "Retry save";
          discard.hidden = false;
        }
        save.disabled = false;
        cancel.hidden = true;
      })();
    };
    showPending();
    draw();
    history();
    document.body.append(dialog);
    dialog.showModal();
  }
  private close(): void {
    this.dialog?.remove();
    this.dialog = undefined;
    this.session.close();
    this.launcher.focus();
  }
  destroy(): void {
    this.destroyed = true;
    if (this.dialog) this.close();
    this.launcher.destroy();
    this.style.remove();
  }
}
