---
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

Add a `flex` shorthand and a dev-mode overflow warning, and let `UIButton` truncate its label.

- **Keep Yoga's `flexShrink: 0` default; add a `flex` shorthand instead.** UI nodes keep their natural main-axis size and overflow a too-small row/column rather than being crushed. (A global web-style `flexShrink: 1` was tried and reverted: Yoga has no `min-width: auto` content floor, so it crushed fixed-size siblings and collapsed `ScrollView` content, which must exceed its viewport to scroll.) Shrinking/wrapping is opt-in — set `flexShrink: 1`, or use the new **`flex: <number>`** prop (shorthand for `flexGrow: <n>` + `flexShrink: 1` + `flexBasis: 0`, the CSS `flex` rule) for a child that should fill the remaining space and wrap cleanly. Prefer `flex: 1` over `flexGrow: 1` for that case, since `flexGrow: 1` alone keeps `flexBasis: auto` (content width) and overflows.
- **Dev-mode overflow warning.** When an in-flow child's computed box still spills past its container's content box (any edge), a one-time `console.warn` points at the offending node. Compiled out of production builds (`NODE_ENV=production`) and silenced for intentional overflow — `overflow: "hidden"` containers, `position: "absolute"` children, and `ScrollView` content. The warning clears once a node fits again, so a later re-overflow re-warns. New internal helpers `warnChildOverflow` / `exemptFromOverflowWarning` back this.
- **`UIButton` gains `truncate?: "clip" | "ellipsis"`**, forwarded to the auto-created label `UIText` (through construction, `setText()` promotion, and `update()`). A fixed-size button can keep a long/i18n label on one line and ellipsize it instead of spilling out of the frame.
- **`ScrollView` no longer lets its overflowing content squeeze fixed-size siblings.** A `flexGrow` viewport with no explicit main-axis size now zeroes its scroll-axis `flex-basis` (the web `flex: 1` idiom) so growth — not content — drives its size; a fixed toolbar/footer beside it keeps its height. An explicit `flexBasis` prop is respected.
