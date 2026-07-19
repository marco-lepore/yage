import "./toast.css";

let toastEl: HTMLDivElement | undefined;
let toastTimer = 0;

/**
 * Show a transient message pinned to the bottom-center of the screen. The
 * `#toast` element is created on first call and reused thereafter.
 */
export function showToast(msg: string, durationMs = 1500): void {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.id = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => toastEl?.classList.remove("show"),
    durationMs,
  );
}
