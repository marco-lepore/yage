---
"@yagejs/ui-react": patch
---

Keyboard and gamepad focus reaches JSX. Every component prop type derives from its imperative counterpart, so `focusable`, `focusId`, `focusNeighbors`, `onFocusChange`, `onAdjust` and `focusStyle` arrive on the elements, and `focus` on `<Panel>` makes that panel a focus scope over the tree below it. The `focus` option's keys arrive the same way, `pointerFocus` and `modal` among them.

Focus draws nothing until a game asks for it: `onFocusChange` is where most React trees show the focused row, from component state. `focusStyle` asks for the package's own outline, drawn just inside the component's box, and sets its colour, thickness, corner radius and inset on one component over whatever `UIPlugin` was given for the whole UI; `focusStyle={null}` drops a UI-wide outline for that component alone. `<Button>` and a `focusable` `<Panel>` both take `focusBg`, the JSX alias for a filled focused row; omitted, a focused component keeps its resting background.

Pressing a component focuses it and passing the pointer over one does not, so the mouse cannot take the row the keyboard is on; `focus={{ pointerFocus: "hover" }}` restores the console-style lit row and `"none"` keeps the pointer out of focus entirely. While a `<Panel focus>` holds the keys it owns the pointer, so a confirm dialog cannot be clicked through; `focus={{ modal: false }}` turns that off.

`UIRootOptions` takes `focus`, which makes the whole React tree one scope — the form for a tree whose outermost element is not a single `<Panel>`. `root.focusScope` reads the scope back, or `null` when the root carries no option.

Re-rendering with a fresh `focus` object refreshes the scope's options in place rather than rebuilding the scope, so focus survives every render. Removing the prop disposes the scope, and input passes to the next shown scope.
