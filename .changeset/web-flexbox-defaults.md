---
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

Align Yoga flex defaults with web flexbox so layouts fail gracefully, add a dev-mode overflow warning, and let `UIButton` truncate its label.

- **`flexShrink: 1` is now the default for every UI node** (Yoga's raw default is `0`, unlike web's `1`). Flex children give space back when their row/column is too small, so a `Text` sharing a row with a sibling shrinks and wraps inside the box instead of overflowing it. Set `flexShrink: 0` to opt a child out (e.g. a fixed icon); explicit `flexShrink` always wins. This is a behavior change — existing layouts that implicitly relied on Yoga's no-shrink default may now compress children on the main axis.
- **Dev-mode overflow warning.** When an in-flow child's computed box still spills past its container's content box (any edge), a one-time `console.warn` points at the offending node. Compiled out of production builds (`NODE_ENV=production`) and silenced for intentional overflow — `overflow: "hidden"` containers, `position: "absolute"` children, and `ScrollView` content. The warning clears once a node fits again, so a later re-overflow re-warns. New internal helpers `warnChildOverflow` / `exemptFromOverflowWarning` back this.
- **`UIButton` gains `truncate?: "clip" | "ellipsis"`**, forwarded to the auto-created label `UIText` (through construction, `setText()` promotion, and `update()`). A fixed-size button can keep a long/i18n label on one line and ellipsize it instead of spilling out of the frame.
- **`ScrollView` no longer lets its overflowing content squeeze fixed-size siblings.** A `flexGrow` viewport with no explicit main-axis size now zeroes its scroll-axis `flex-basis` (the web `flex: 1` idiom) so growth — not content — drives its size; a fixed toolbar/footer beside it keeps its height. An explicit `flexBasis` prop is respected.
