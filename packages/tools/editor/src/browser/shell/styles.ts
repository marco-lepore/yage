/**
 * The editor's stylesheet, as a string the shell renders into one `<style>`.
 *
 * It is a string rather than a `.css` file because the package builds to plain
 * ESM with no CSS pipeline, and a stylesheet import would need one here and
 * another in every project that runs the editor.
 *
 * Every rule is scoped under `.yage-editor`, including the custom properties,
 * so mounting the editor changes nothing else on the page.
 *
 * What stays inline in a component: values that come from state and change
 * between renders — the viewport's cursor, a dragged row's opacity, a tree
 * row's indent. Everything a state cannot vary lives here, which is what lets
 * hover, focus, and drop feedback exist at all.
 */

/**
 * Contrast, measured rather than assumed.
 *
 * The token values come from the editor design system, which requires the
 * first implementation to check them. Every text pair clears WCAG AA at
 * 5.4:1 or better. `--border` is 1.55:1 on `--panel-bg` and stays that way on
 * purpose: it divides panels, and a divider is decorative. Anything that
 * outlines a control uses `--control-border`, which clears 3:1 against every
 * surface it is drawn on, including `--surface-hover` at 3.07:1.
 */
export const EDITOR_CSS = `
.yage-editor {
  --font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-code: ui-monospace, "SFMono-Regular", Consolas, monospace;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-md: 14px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --control-height: 28px;
  --toolbar-height: 36px;
  --tree-row-height: 24px;
  --radius-sm: 3px;
  --radius-md: 5px;
  --editor-bg: #101217;
  --panel-bg: #171a20;
  --surface: #1e222a;
  --surface-hover: #292e38;
  --surface-selected: #163a5a;
  --border: #353b46;
  --control-border: #707888;
  --text: #eef0f3;
  --text-muted: #aab1bc;
  --accent: #55aaff;
  --accent-soft: rgba(85, 170, 255, 0.22);
  --focus: #8cc8ff;
  --danger: #ff6b72;
  --warning: #f1bf4f;
  --success: #5ccf91;

  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--editor-bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.yage-editor *,
.yage-editor *::before,
.yage-editor *::after {
  box-sizing: border-box;
}

.yage-editor :focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

/* Bars ------------------------------------------------------------------- */

.yage-editor .ye-bar {
  flex: 0 0 auto;
  height: var(--toolbar-height);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
  /* Nothing in the bar shrinks, so a narrow window would put the last group
     past the edge with no way to reach it. */
  overflow-x: auto;
  scrollbar-width: thin;
}

/* The toolbar carries more groups than a 1440-wide window fits. Wrapping keeps
   every group reachable: sideways scrolling in a bar is the back gesture on a
   trackpad. */
.yage-editor .ye-bar--tools {
  flex-wrap: wrap;
  height: auto;
  min-height: var(--toolbar-height);
  row-gap: var(--space-1);
  padding-block: var(--space-1);
}

.yage-editor .ye-select {
  flex: 0 0 auto;
  min-width: 0;
  max-width: 26rem;
  height: var(--control-height);
  padding: 0 var(--space-2);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-family: var(--font-code);
  cursor: pointer;
}

.yage-editor .ye-select:disabled {
  opacity: 0.45;
  cursor: default;
}

.yage-editor .ye-bar__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.yage-editor .ye-group {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.yage-editor .ye-group + .ye-group {
  padding-left: var(--space-3);
  border-left: 1px solid var(--border);
}

.yage-editor .ye-badge {
  flex: 0 0 auto;
  padding: 1px var(--space-2);
  border-radius: 999px;
  background: var(--surface);
  color: var(--warning);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* Controls --------------------------------------------------------------- */

.yage-editor .ye-button {
  flex: 0 0 auto;
  height: var(--control-height);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.yage-editor .ye-button:hover:not(:disabled) {
  background: var(--surface-hover);
}

.yage-editor .ye-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.yage-editor .ye-button[aria-pressed="true"]:not(:disabled) {
  border-color: var(--accent);
  background: var(--surface-selected);
}

.yage-editor .ye-button--primary:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--editor-bg);
}

.yage-editor .ye-button--primary:hover:not(:disabled) {
  background: var(--focus);
}

/* A button carrying a picture instead of a word: square, and the picture
   inherits the text colour so it fades with the button when it is disabled. */
.yage-editor .ye-icon {
  width: var(--control-height);
  padding: 0;
  justify-content: center;
}

.yage-editor .ye-icon svg {
  width: 16px;
  height: 16px;
  display: block;
}

.yage-editor .ye-tool {
  flex: 0 0 auto;
  height: var(--control-height);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  cursor: pointer;
}

.yage-editor .ye-tool:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.yage-editor .ye-tool[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--surface-selected);
  color: var(--text);
}

.yage-editor .ye-tool kbd {
  font-family: var(--font-code);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.yage-editor .ye-tool[aria-pressed="true"] kbd {
  color: var(--focus);
}

.yage-editor .ye-step {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-muted);
}

/* The bar sizes itself to its contents, so the label must not claim the
   inspector's fixed column. */
.yage-editor .ye-step .ye-field__label {
  flex: 0 0 auto;
}

/* The bar is one line, so a refused step has no row to sit under: it goes
   beside the box it is about, without the row spacing the inspector wants. */
.yage-editor .ye-bar .ye-field__reason {
  flex: 0 0 auto;
  margin: 0;
  white-space: nowrap;
}

/* The control bar ---------------------------------------------------------
 *
 * The third bar: the name and the pose of whatever is selected. It reads as a
 * bar rather than as a panel because the six things on it never change in
 * number, which is the whole reason they are here and the declared parameters
 * are in the inspector.
 */

.yage-editor .ye-bar--controls {
  gap: var(--space-2);
}

.yage-editor .ye-bar__empty {
  color: var(--text-muted);
}

.yage-editor .ye-bar__note {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.yage-editor .ye-name,
.yage-editor .ye-num {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  color: var(--text-muted);
}

/* The bar sizes itself to its contents, so a label must not claim the
   inspector's fixed column. */
.yage-editor .ye-name .ye-field__label,
.yage-editor .ye-num .ye-field__label {
  flex: 0 0 auto;
}

.yage-editor .ye-name input,
.yage-editor .ye-num input {
  height: var(--control-height);
  padding: 0 var(--space-2);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-family: var(--font-code);
}

.yage-editor .ye-name input {
  width: 18ch;
}

.yage-editor .ye-num input {
  width: 7ch;
  text-align: right;
}

.yage-editor .ye-name input:disabled,
.yage-editor .ye-num input:disabled {
  opacity: 0.45;
}

.yage-editor .ye-step input {
  width: 5ch;
  height: var(--control-height);
  padding: 0 var(--space-1);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-family: var(--font-code);
  text-align: right;
}

/* Banner ----------------------------------------------------------------- */

.yage-editor .ye-banner {
  flex: 0 0 auto;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--warning);
}

/* Layout ----------------------------------------------------------------- */

.yage-editor .ye-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.yage-editor .ye-body__left {
  flex: 0 0 auto;
  width: 260px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}

/* The viewport, with both conditional bands under it — the Actors strip and
   the Problems band — taking height from it rather than covering it. Nothing
   the viewport draws ends up behind a panel, and a finding arriving leaves the
   hierarchy and the inspector exactly as they were. */
.yage-editor .ye-body__center {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.yage-editor .ye-body__right {
  flex: 0 0 auto;
  width: 300px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
}

/* Viewport --------------------------------------------------------------- */

.yage-editor .ye-viewport {
  position: relative;
  flex: 1 1 auto;
  /* It is the one thing that gives way: the strip under it and the panels
     beside it are sized, and the viewport is whatever is left. */
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/*
 * Inside its own edge rather than outside it. The viewport takes focus on a
 * press — Delete is read from it — so this outline is on screen most of the
 * time, and offset outwards it would sit on top of the panels beside it.
 */
.yage-editor .ye-viewport:focus-visible {
  outline-offset: -2px;
}

/*
 * The name of the mark under the pointer. It never takes the pointer: the mark
 * under it is a click target, and a label that swallowed the press would put
 * the name where the selection should have happened.
 */
.yage-editor .ye-viewport__mark-name {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  padding: 0 var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
  font-family: var(--font-code);
  font-size: var(--text-xs);
  line-height: 18px;
  white-space: nowrap;
}

/* A panel ---------------------------------------------------------------- */

.yage-editor .ye-panel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
}

.yage-editor .ye-panel + .ye-panel {
  border-top: 1px solid var(--border);
}

.yage-editor .ye-panel__header {
  flex: 0 0 auto;
  /* An h2 keeps a margin from the browser, and here it would put a band of
     panel background above and below every header. */
  margin: 0;
  height: 26px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* A collapsible panel's header is a button filling the header, so the whole
   strip is the target and Tab reaches it. */
.yage-editor .ye-panel__toggle {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 100%;
  margin: 0 calc(-1 * var(--space-3));
  padding: 0 var(--space-3);
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.yage-editor .ye-panel__toggle:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.yage-editor .ye-panel__chevron {
  font-size: 9px;
}

/*
 * The strip under the viewport. Open, it is as tall as its entries up to a few
 * rows and scrolls past that; closed it is its header alone. Both are heights
 * the viewport gets back, because the strip is above it in the same column
 * rather than over it.
 */
.yage-editor .ye-panel--strip {
  flex: 0 0 auto;
  border-top: 1px solid var(--border);
}

/*
 * Scrolls down, never sideways. A sideways scroll on a trackpad or a
 * touchscreen is the browser's own back gesture, and a strip that scrolled
 * that way lost the page to a two-finger swipe. Containing the overscroll
 * keeps a scroll that reaches the end of the list from carrying on into the
 * page.
 */
.yage-editor .ye-panel--strip .ye-panel__body {
  max-height: 168px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.yage-editor .ye-panel__count {
  margin-left: auto;
  font-family: var(--font-code);
  letter-spacing: 0;
}

.yage-editor .ye-panel__body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.yage-editor .ye-panel__body > * {
  flex: 0 0 auto;
}

.yage-editor .ye-panel__empty {
  margin: 0;
  padding: var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

/* Actors ----------------------------------------------------------------- */

/* One group under another, each a heading over entries that wrap into rows:
   the strip fills its width before it grows, so a kit of a dozen types is
   read without scrolling and a large one scrolls down like any list. */
.yage-editor .ye-actors {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}

.yage-editor .ye-actors__section {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}

.yage-editor .ye-actors__group {
  /* A whole line of its own, so it reads as the heading of the row below. */
  flex: 1 0 100%;
  margin: 0;
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  white-space: nowrap;
}

.yage-editor .ye-actors__item {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 200px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.yage-editor .ye-actors__item:hover:not(:disabled) {
  border-color: var(--control-border);
  background: var(--surface-hover);
}

.yage-editor .ye-actors__item:disabled {
  opacity: 0.45;
  cursor: default;
}

/*
 * A fixed box whatever the picture is: a list of sprites of different sizes
 * reads as a list only when every name starts at the same place. The whole
 * sprite is fitted inside it, and the pixelated rendering keeps a 16px sprite
 * a sprite rather than a smear.
 */
.yage-editor .ye-actors__thumb {
  flex: 0 0 auto;
  position: relative;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--editor-bg);
  /* Clips the rest of a sheet when the image is placed to show one frame. */
  overflow: hidden;
}

.yage-editor .ye-actors__thumb-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

/*
 * One frame of a sheet: the whole image is scaled and pushed so the frame
 * lands in the box, which clips everything else.
 */
.yage-editor .ye-actors__thumb-img--framed {
  position: absolute;
  width: auto;
  height: auto;
  object-fit: none;
}

.yage-editor .ye-actors__thumb--none {
  border: 1px dashed var(--control-border);
  background: transparent;
}

.yage-editor .ye-actors__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Hierarchy -------------------------------------------------------------- */

.yage-editor .ye-tree,
.yage-editor .ye-subtree {
  list-style: none;
  margin: 0;
  padding: 0;
}

.yage-editor .ye-tree {
  padding: var(--space-1) 0;
}

.yage-editor .ye-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--tree-row-height);
  padding-right: var(--space-3);
  padding-left: var(--row-indent, var(--space-3));
  cursor: grab;
}

.yage-editor .ye-row:hover {
  background: var(--surface-hover);
}

.yage-editor .ye-row.is-selected {
  background: var(--surface-selected);
}

.yage-editor .ye-row.is-static {
  cursor: default;
}

.yage-editor .ye-row.is-unpickable {
  cursor: not-allowed;
}

/*
 * The eye each row carries. It appears on hover, and stays on a hidden row so
 * the way back is always visible on the rows that need one. Opacity rather
 * than a display switch, so the row's layout does not shift as the pointer
 * arrives.
 */
.yage-editor .ye-row__eye {
  flex: 0 0 auto;
  padding: 0 var(--space-1);
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1;
  cursor: pointer;
  opacity: 0;
}

.yage-editor .ye-row:hover .ye-row__eye,
.yage-editor .ye-row__eye.is-on,
.yage-editor .ye-row__eye:focus-visible {
  opacity: 1;
}

/*
 * The name reads, the id truncates. An id is a uuid and never fits, so a row
 * that lets it take the space it wants leaves the name as one letter and an
 * ellipsis — which is what a placement is actually recognised by.
 */
.yage-editor .ye-row__name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yage-editor .ye-row__id {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 40%;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-family: var(--font-code);
  font-size: var(--text-xs);
}

/*
 * Three drops, three pictures. A line at the row's own indent for before and
 * after, so the depth the placement will land at is visible; an outline around
 * the whole row for into. Same colour for all three would leave the developer
 * reading which quarter of a 24-pixel row the pointer is in.
 *
 * The lines are drawn on the list item rather than on the row, because a list
 * item holds the row and everything nested under it. Dropping after a row puts
 * the placement after that row's whole subtree, and a line on the row's own
 * bottom edge would point between the row and its first child instead.
 */
.yage-editor .ye-item {
  position: relative;
}

.yage-editor .ye-item[data-drop="into"] > .ye-row {
  background: var(--accent-soft);
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.yage-editor .ye-item[data-drop="before"]::before,
.yage-editor .ye-item[data-drop="after"]::after {
  content: "";
  position: absolute;
  left: var(--row-indent, var(--space-3));
  right: 0;
  height: 2px;
  background: var(--accent);
  /*
   * Above the row. Both are positioned, the row comes later in the item, and a
   * selected row has an opaque background — so without this the before-line is
   * painted over exactly when the target row is the selected one.
   */
  z-index: 1;
}

.yage-editor .ye-item[data-drop="before"]::before {
  top: 0;
}

.yage-editor .ye-item[data-drop="after"]::after {
  bottom: 0;
}

.yage-editor .ye-drop {
  position: absolute;
  left: 0;
  right: 0;
}

.yage-editor .ye-drop--before {
  top: 0;
  height: 30%;
}

.yage-editor .ye-drop--into {
  top: 30%;
  height: 40%;
}

.yage-editor .ye-drop--after {
  bottom: 0;
  height: 30%;
}

.yage-editor .ye-drop-root {
  flex: 1 0 40px;
  margin: var(--space-2);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--control-border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-align: center;
}

.yage-editor .ye-drop-root.is-over {
  border-color: var(--accent);
  border-style: solid;
  background: var(--accent-soft);
  color: var(--text);
}

/* Inspector -------------------------------------------------------------- */

.yage-editor .ye-inspector {
  padding: var(--space-3);
}

.yage-editor .ye-inspector__title {
  margin: 0 0 var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yage-editor .ye-inspector__type {
  color: var(--text-muted);
  font-family: var(--font-code);
  font-size: var(--text-xs);
}

.yage-editor .ye-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
}

/* A refused entry keeps its text, so the reason goes under the row it belongs
   to rather than squeezing the box it is about. */
.yage-editor .ye-field__reason {
  display: block;
  margin: 0 0 var(--space-2);
  color: var(--danger);
  font-size: var(--text-xs);
}

.yage-editor .ye-field__label {
  flex: 0 0 72px;
  color: var(--text-muted);
}

/* Stands where a control would be for a value the selected placements do not
   agree on, and takes the width that control would have had. */
.yage-editor .ye-field__mixed {
  flex: 1 1 auto;
  color: var(--text-muted);
  font-style: italic;
}

/* The boxes of one fixed-arity value share the width a single box would have,
   so a pair of numbers sits on one row like every other field. */
.yage-editor .ye-tuple {
  display: flex;
  flex: 1 1 auto;
  gap: var(--space-1);
  min-width: 0;
}

/* What is inside a value with a shape, indented under the label that names it
   and ruled on the left, so where one set of members ends and the next begins
   is read from the picture rather than from the labels. */
.yage-editor .ye-members {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-left: var(--space-3);
  padding-left: var(--space-2);
  border-left: 1px solid var(--control-border);
}

/* One element of a list: what it holds, and the buttons that move or remove
   it, which sit at the end of the row whatever control the element draws. */
.yage-editor .ye-members__row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
}

.yage-editor .ye-members__row > :first-child {
  flex: 1 1 auto;
  min-width: 0;
}

.yage-editor .ye-members__actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
}

/* A select in a field row fills what the label leaves, like the text box the
   rest of the rows hold. */
.yage-editor .ye-field .ye-select {
  flex: 1 1 auto;
}

/* The only thing on screen that says a number can be dragged. There are no
   arrow buttons; the cursor and the documentation carry the affordance. */
.yage-editor .ye-field__label--scrub {
  cursor: col-resize;
  user-select: none;
}

.yage-editor .ye-field input {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-height);
  padding: 0 var(--space-2);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-family: var(--font-code);
}

.yage-editor .ye-field input:disabled,
.yage-editor .ye-field textarea:disabled {
  opacity: 0.45;
}

/* A box for text that runs to several lines. It takes the one-line box's
   frame, and the browser's own handle resizes it downwards. */
.yage-editor .ye-field textarea {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-family: var(--font-code);
  resize: vertical;
}

/* A switch and a colour swatch keep a size of their own in a field row. Both
   selectors carry the element as well as the class, so they outweigh the
   full-width rule every other box in a row takes. */
.yage-editor .ye-field input.ye-checkbox {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin: 0;
  padding: 0;
  accent-color: var(--accent);
}

/* Square, so the swatch reads as the colour rather than as another box, and
   the text beside it keeps the width every other row's box has. */
.yage-editor .ye-field input.ye-swatch {
  flex: 0 0 auto;
  width: var(--control-height);
  padding: 2px;
  cursor: pointer;
}

.yage-editor .ye-swatch-slot {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}

/* The picker element paints its own swatch and takes no pattern, so selected
   placements that disagree are marked by a hatch laid over it. The hatch takes
   no pointer events, which leaves the picker itself clickable. */
.yage-editor .ye-swatch-slot.is-mixed::after {
  content: "";
  position: absolute;
  inset: 2px;
  pointer-events: none;
  border-radius: var(--radius-sm);
  background: repeating-linear-gradient(
    45deg,
    var(--surface) 0 3px,
    var(--text-muted) 3px 6px
  );
}

/* Not scoped to .ye-field: TextField renders the shell's only input, and a
   call site that passes its own class, such as the bar's .ye-step, refuses
   text the same way and has to look refused. */
.yage-editor input[aria-invalid="true"],
.yage-editor textarea[aria-invalid="true"],
.yage-editor select[aria-invalid="true"] {
  border-color: var(--danger);
}

/* The completion list sits in normal flow under the box it belongs to, so the
   inspector's own scrolling carries it and nothing has to be positioned. */
.yage-editor .ye-complete {
  margin: 0 0 var(--space-2);
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  list-style: none;
}

.yage-editor .ye-complete__item {
  padding: 2px var(--space-2);
  color: var(--text);
  font-family: var(--font-code);
  font-size: var(--text-xs);
  cursor: pointer;
  overflow-wrap: anywhere;
}

.yage-editor .ye-complete__item:hover {
  background: var(--surface-hover);
}

.yage-editor .ye-complete__item[aria-selected="true"] {
  background: var(--surface-selected);
}

.yage-editor .ye-complete__note {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.yage-editor .ye-complete__toggle {
  flex: 0 0 auto;
  height: var(--control-height);
  padding: 0 var(--space-1);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.yage-editor .ye-complete__toggle:hover:not(:disabled) {
  background: var(--surface-hover);
}

.yage-editor .ye-complete__toggle:disabled {
  opacity: 0.45;
  cursor: default;
}

.yage-editor .ye-section {
  margin: 0 0 var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}

.yage-editor .ye-section__title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.yage-editor .ye-section__actions {
  display: flex;
  /* Four buttons are wider than the panel at its narrowest. */
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
}

.yage-editor .ye-section__note {
  display: block;
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.yage-editor .ye-section__note code {
  font-family: var(--font-code);
  color: var(--text);
  /* A scene key is one token and can be longer than the panel. */
  overflow-wrap: anywhere;
}

.yage-editor .ye-messages {
  margin: 0 0 var(--space-2);
  padding-left: var(--space-4);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.yage-editor .ye-messages--error {
  color: var(--danger);
}

.yage-editor .ye-confirm {
  margin-top: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.yage-editor .ye-confirm p {
  margin: 0 0 var(--space-2);
}

.yage-editor .ye-confirm__actions {
  display: flex;
  gap: var(--space-2);
}

/* The New and Duplicate dialog: the same band the delete question uses,
   without the warning border, because creating a level breaks nothing. */
.yage-editor .ye-confirm--ask {
  border-color: var(--border);
}

.yage-editor .ye-confirm input {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-height);
  padding: 0 var(--space-2);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

/* Diagnostics ------------------------------------------------------------ */

/*
 * The band under the Actors strip, in the viewport's column.
 *
 * A flex column, not a plain block: the cap is here and the scrolling is on
 * the panel inside, and a block parent gives that panel no height to scroll
 * against — every finding past the sixth is then clipped and unreachable. The
 * cap is in window terms, because that is what says how much of the screen a
 * list of findings may take.
 */
.yage-editor .ye-problems {
  flex: 0 0 auto;
  min-height: 0;
  max-height: 20vh;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
}

.yage-editor .ye-problems ul {
  list-style: none;
  margin: 0;
  padding: var(--space-2) var(--space-3);
}

.yage-editor .ye-problems li {
  display: flex;
  gap: var(--space-2);
  padding: 2px 0;
}

.yage-editor .ye-problems code {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-family: var(--font-code);
  font-size: var(--text-xs);
}
`;
