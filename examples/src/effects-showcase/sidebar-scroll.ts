import type { UIPanel } from "@yagejs/ui";
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT, SIDEBAR_WIDTH } from "./constants.js";

// Module-level state for the sidebar scroller. `bindSidebar` assigns the
// panels built for this example so the wheel handler can reach them.
let activeScroller: UIPanel | null = null;
let activeSidebar: UIPanel | null = null;
let sidebarScrollY = 0;

/** Register the sidebar's scroller + root panel for wheel scrolling; resets
 * scroll to the top (called on each sidebar rebuild). */
export function bindSidebar(scroller: UIPanel, sidebar: UIPanel): void {
  activeScroller = scroller;
  activeSidebar = sidebar;
  sidebarScrollY = 0;
}

/** Install the wheel-scroll handler on the game container. */
export function installSidebarWheel(container: HTMLElement): void {
  // Wheel-scroll the sidebar when the pointer is over it. Yoga's
  // `margin.top: -scrollY` on `scroller` slides overflowing content up under
  // the sidebar's `overflow: "hidden"` mask — no per-frame layout hook
  // required; Yoga incorporates the offset on the next layout pass.
  container.addEventListener(
    "wheel",
    (e) => {
      const scroller = activeScroller;
      const sidebar = activeSidebar;
      if (!scroller || !sidebar) return;
      const canvas = container.querySelector("canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = ((e.clientX - rect.left) * VIRTUAL_WIDTH) / rect.width;
      const cy = ((e.clientY - rect.top) * VIRTUAL_HEIGHT) / rect.height;
      const left = VIRTUAL_WIDTH - SIDEBAR_WIDTH - 8;
      if (
        cx < left ||
        cx > VIRTUAL_WIDTH - 8 ||
        cy < 8 ||
        cy > VIRTUAL_HEIGHT - 8
      ) {
        return;
      }
      const visibleH = sidebar.yogaNode.getComputedHeight();
      const contentH = scroller.yogaNode.getComputedHeight();
      // Subtract sidebar's top + bottom padding (10px each) to get the
      // scrollable viewport height. The title scrolls with the rest now.
      const chromeH = 20;
      const maxScroll = Math.max(0, contentH - (visibleH - chromeH));
      const next = Math.max(0, Math.min(maxScroll, sidebarScrollY + e.deltaY));
      if (next !== sidebarScrollY) {
        sidebarScrollY = next;
        scroller.update({ margin: { top: -sidebarScrollY } });
      }
      e.preventDefault();
    },
    { passive: false },
  );
}
