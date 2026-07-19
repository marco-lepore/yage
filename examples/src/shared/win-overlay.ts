import "./win-overlay.css";

export interface OverlayOptions {
  /** Large headline text (e.g. "You Win!", "You Died"). */
  title: string;
  /** Smaller line under the title. Can also be set per `show()` call. */
  subtitle?: string;
  /** Border + title color, any CSS color. Defaults to green. */
  accent?: string;
  /** Subtitle color, any CSS color. Defaults to a muted yellow. */
  subtitleColor?: string;
}

export interface Overlay {
  /** Reveal the overlay, optionally replacing the subtitle text. */
  show(subtitle?: string): void;
  /** Hide the overlay. */
  hide(): void;
}

/**
 * Create a centered full-screen banner used by the game examples to announce a
 * win or loss. Hidden until `show()`. Covers the green "You Win!" banner and
 * red "defeated" variants via `accent`.
 */
export function createOverlay(opts: OverlayOptions): Overlay {
  const el = document.createElement("div");
  el.className = "win-overlay";
  if (opts.accent) el.style.setProperty("--overlay-accent", opts.accent);
  if (opts.subtitleColor)
    el.style.setProperty("--overlay-sub", opts.subtitleColor);

  const sub = document.createElement("div");
  sub.className = "sub";
  if (opts.subtitle !== undefined) sub.textContent = opts.subtitle;

  el.append(document.createTextNode(opts.title), sub);
  document.body.appendChild(el);

  return {
    show(subtitle) {
      if (subtitle !== undefined) sub.textContent = subtitle;
      el.style.display = "block";
    },
    hide() {
      el.style.display = "none";
    },
  };
}
