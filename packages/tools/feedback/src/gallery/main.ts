import { FeedbackClient } from "../client/FeedbackClient.js";
import type { FeedbackComment } from "../shared/protocol.js";

const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing gallery element: ${id}`);
  return element as T;
};
const api = new URL(
  document.querySelector<HTMLMetaElement>('meta[name="feedback-api"]')!.content,
  location.href,
);
const client = new FeedbackClient(api.href);
const selected = new Set<string>();
let comments: FeedbackComment[] = [];
let project = "",
  page = 0,
  generation = 0,
  detailGeneration = 0;
const pageSize = 24;
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const message = (text: string, error = false) => {
  get("message").textContent = text;
  get("message").className = error ? "error" : "";
};
function filtered() {
  const status = get<HTMLSelectElement>("status").value,
    search = get<HTMLInputElement>("search").value.toLowerCase().trim();
  return comments.filter(
    (c) =>
      (status === "all" ||
        (status === "pending"
          ? ["open", "ingested"].includes(c.status)
          : c.status === status)) &&
      (!search ||
        `${c.text} ${c.id} ${c.target.kind === "entities" ? c.target.entities.map((e) => e.name).join(" ") : c.target.kind}`
          .toLowerCase()
          .includes(search)),
  );
}
function selectionChanged() {
  get<HTMLButtonElement>("codex").disabled = get<HTMLButtonElement>(
    "claude",
  ).disabled = selected.size === 0 || !project;
  get("summary").textContent =
    `${filtered().length} comments · ${selected.size} selected. Reading and copying leave status unchanged.`;
}
function render() {
  const items = filtered();
  page = Math.min(page, Math.max(0, Math.ceil(items.length / pageSize) - 1));
  get("cards").replaceChildren();
  for (const comment of items.slice(page * pageSize, (page + 1) * pageSize)) {
    const card = node("article", undefined, "card"),
      preview = node("button", undefined, "preview"),
      img = node("img");
    preview.setAttribute(
      "aria-label",
      `View evidence: ${comment.text.slice(0, 100)}`,
    );
    img.src = new URL(`captures/${comment.captureId}/screenshot.png`, api).href;
    img.alt = "Captured game view";
    img.loading = "lazy";
    preview.append(img);
    preview.onclick = () => {
      void showDetail(comment.id);
    };
    const content = node("div", undefined, "content"),
      meta = node("div", undefined, "meta"),
      label = node("label"),
      checkbox = node("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(comment.id);
    checkbox.setAttribute("aria-label", `Select comment ${comment.id}`);
    checkbox.onchange = () => {
      if (checkbox.checked) selected.add(comment.id);
      else selected.delete(comment.id);
      selectionChanged();
    };
    label.append(
      checkbox,
      node(
        "span",
        comment.target.kind === "global"
          ? "Whole view"
          : comment.target.kind === "area"
            ? "Area"
            : `${comment.target.entities.length} entities`,
      ),
    );
    meta.append(label, node("span", comment.status, "badge"));
    const open = node("button", "View evidence");
    open.onclick = preview.onclick;
    content.append(
      meta,
      node("p", comment.text, "comment"),
      node("p", new Date(comment.created).toLocaleString(), "muted"),
      open,
    );
    card.append(preview, content);
    get("cards").append(card);
  }
  if (!items.length)
    get("cards").append(node("p", "No comments match this view.", "muted"));
  get<HTMLButtonElement>("previous").disabled = page === 0;
  get<HTMLButtonElement>("next").disabled =
    (page + 1) * pageSize >= items.length;
  get("page").textContent =
    `Page ${page + 1} of ${Math.max(1, Math.ceil(items.length / pageSize))}`;
  selectionChanged();
}
async function refresh() {
  const current = ++generation;
  get<HTMLButtonElement>("refresh").disabled = true;
  try {
    const [session, records] = await Promise.all([
      client.session(),
      client.list(),
    ]);
    if (current !== generation) return;
    project = session.project;
    comments = records.reverse();
    get("project").textContent = project;
    for (const id of selected)
      if (!comments.some((c) => c.id === id)) selected.delete(id);
    render();
    message("");
  } catch (error) {
    if (current === generation)
      message(error instanceof Error ? error.message : String(error), true);
  } finally {
    if (current === generation)
      get<HTMLButtonElement>("refresh").disabled = false;
  }
}
async function showDetail(id: string) {
  const current = ++detailGeneration;
  const dialog = get<HTMLDialogElement>("detail");
  get("evidence").replaceChildren(node("p", "Loading evidence…"));
  if (!dialog.open) dialog.showModal();
  try {
    const data = await client.show(id);
    if (current !== detailGeneration || !dialog.open) return;
    const { comment, capture } = data,
      layout = node("div", undefined, "detail-grid"),
      figure = node("div", undefined, "capture"),
      img = node("img");
    img.src = new URL(data.screenshotUrl, api).href;
    img.alt = `Original capture at frame ${capture.frame}`;
    figure.append(img);
    const boxes =
      comment.target.kind === "area"
        ? [comment.target.rect]
        : comment.target.kind === "entities"
          ? comment.target.entities.map((e) => e.bounds)
          : [];
    for (const box of boxes) {
      const outline = node("div", undefined, "outline");
      Object.assign(outline.style, {
        left: `${(box.x / capture.width) * 100}%`,
        top: `${(box.y / capture.height) * 100}%`,
        width: `${(box.width / capture.width) * 100}%`,
        height: `${(box.height / capture.height) * 100}%`,
      });
      figure.append(outline);
    }
    const info = node("section");
    info.append(
      node("span", comment.status, "badge"),
      node("p", comment.text, "comment"),
      node(
        "p",
        `Frame ${capture.frame} · ${capture.width} × ${capture.height}`,
      ),
      node("p", new Date(capture.created).toLocaleString(), "muted"),
    );
    for (const [title, value] of [
      ["Target", comment.target],
      ["Host context", capture.context],
      ["Inspector snapshot", capture.snapshot],
      ["Status history", comment.history],
    ] as const) {
      const block = node("details");
      block.append(
        node("summary", title),
        node("pre", JSON.stringify(value, null, 2)),
      );
      info.append(block);
    }
    info.append(node("p", `Comment ${comment.id}`, "muted"));
    layout.append(figure, info);
    get("evidence").replaceChildren(layout);
  } catch (error) {
    if (current === detailGeneration)
      get("evidence").replaceChildren(
        node(
          "p",
          error instanceof Error ? error.message : String(error),
          "error",
        ),
      );
  }
}
async function copy(agent: "codex" | "claude") {
  const ids = [...selected];
  if (!ids.length || !project) return;
  const instruction = `${agent === "claude" ? "/yage-feedback" : "$yage-feedback"} Address these feedback comments: ${ids.join(", ")}.\nProject: ${JSON.stringify(project)}\nFeedback server: ${api.href}\nInspect each comment's screenshot and inspector snapshot, then follow the skill's acknowledgement and verification workflow. Limit this batch to the listed IDs.`;
  try {
    await navigator.clipboard.writeText(instruction);
    message(
      `Copied ${ids.length} comments for ${agent === "claude" ? "Claude" : "Codex"}. Paste into a session opened in this project.`,
    );
  } catch {
    get<HTMLTextAreaElement>("instruction").value = instruction;
    get<HTMLDialogElement>("copy").showModal();
    get<HTMLTextAreaElement>("instruction").focus();
    get<HTMLTextAreaElement>("instruction").select();
  }
}
get<HTMLButtonElement>("refresh").onclick = () => {
  void refresh();
};
for (const id of ["status", "search"])
  get(id).addEventListener(id === "search" ? "input" : "change", () => {
    selected.clear();
    page = 0;
    render();
  });
get<HTMLButtonElement>("previous").onclick = () => {
  page--;
  render();
};
get<HTMLButtonElement>("next").onclick = () => {
  page++;
  render();
};
get("select-page").onclick = () => {
  filtered()
    .slice(page * pageSize, (page + 1) * pageSize)
    .forEach((c) => selected.add(c.id));
  render();
};
get("clear").onclick = () => {
  selected.clear();
  render();
};
get<HTMLButtonElement>("codex").onclick = () => {
  void copy("codex");
};
get<HTMLButtonElement>("claude").onclick = () => {
  void copy("claude");
};
get("close-detail").onclick = () => get<HTMLDialogElement>("detail").close();
get("close-copy").onclick = () => get<HTMLDialogElement>("copy").close();
get<HTMLDialogElement>("detail").addEventListener("close", () => {
  detailGeneration++;
});
void refresh();
