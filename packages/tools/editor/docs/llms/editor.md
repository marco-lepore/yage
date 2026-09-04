# @yagejs-tools/editor

Development-only. A browser level editor for `*.yage-level.json` files: open a
level, build it up, and save it back. The game loads the same file through
`@yagejs/level`, which is the package a game depends on — never this one.

```bash
npm install -D @yagejs-tools/editor
npx yage-editor
```

`yage-editor` starts a Vite dev server on `127.0.0.1:5211` built from the
project's own Vite config, so aliases, WASM, and decorators work as they do in
the game. The editor is served at the project's Vite `base` — `/` unless the
project set one — and at the `index.html` there; every other path is the
project's.

Flags: `--port <number>`, `--no-open`, `--config <path>`, `-h`, `-v`.

## Configuration

`editor/config.ts`, read in Node:

```ts
import { defineEditorConfig } from "@yagejs-tools/editor";

export default defineEditorConfig({
  modules: {
    project: "../src/levelProject.ts", // default-exports the LevelProject a game also uses
    harness: "../lab/harness.ts", // engine + plugin factories, the lab harness shape
  },
  levels: [
    // a glob, or a glob plus the layers its levels are authored against
    {
      glob: "src/levels/forest/*.yage-level.json",
      layers: "../src/forestLayers.ts",
    },
    "src/levels/menu/*.yage-level.json",
  ],
  assets: ["public/sprites/**/*.png"], // optional: what the asset picker lists
  gamePage: "/game.html", // optional: what the Run control opens
});
```

`assets` globs are the whole filter the picker applies. The editor cannot tell
which files a given parameter would accept, so what these patterns match is
what the list offers; narrow them to narrow the list. A project without them
keeps a typed asset field and the picker says nothing matched.

The globs match a file where it sits on disk; the picker offers the path the
browser fetches, which is what a level stores. Vite serves the contents of
`publicDir` at the server root, so the glob above lists `sprites/hero.png` —
one segment shorter than the glob that matched it.

A `levels` entry's `layers` is the path of a module default-exporting the
`LayerDef[]` the game's own scene spreads into its `layers` — one array,
exported once, imported by both. It is a path rather than the array because
this file is read in Node before the server starts. The editor page imports it,
so a `sort` in it stays the function the game runs.

Layers are per entry rather than per project because a scene declares its own
set, and they are out of the level document because which scene a level loads
into is a project concern. A level whose glob names no layers keeps every
placement on `"default"`.

Without a declared set the editor's preview flattens the level: nothing has
provisioned the project's layers, so every visual falls back to `"default"` in
add order while the running game has them on distinct, ordered, sometimes
sorted layers.

Module paths are relative to the config file and must resolve inside the Vite
root. The file carries paths and globs, never imported game objects: the server
reads it in Node, and a config that imported an entity class would evaluate
Pixi and WASM before the server started.

`gamePage` is a root-relative URL naming a page this server serves, written the
way the project's own source names it — the editor resolves it under whatever
Vite `base` the project set. It needs a page of its own: the editor answers
`/`, `/index.html`, `/play` and `/play.html`, so naming any of them — or a form
that resolves onto one, such as `/play` for `/play.html` — is refused at
startup. Without a `gamePage` there is no Run control; Play needs none.

The harness has the same shape the scenario lab uses, so a project with a
`lab/harness.ts` points both tools at it:

```ts
export default {
  engine: () => new Engine({ debug: true }),
  plugins: ({ container }: { container: HTMLElement }) => [
    new RendererPlugin({ width: 960, height: 600, container }),
  ],
};
```

## What the editor edits

Three bars run across the top. The **file bar** owns which level is open; the
**toolbar** owns the tool, the pivot, the grid and the edit actions; the
**control bar** under them holds the selected placement's name and its five
transform numbers. Below them the **hierarchy** is the left column, the
viewport takes the middle, the **inspector** is the right column, and two
bands sit under the viewport in its own column: the **Actors** strip, and the
**Problems** band under it. The strip starts closed and its header opens it;
open, its entries wrap into rows under their group headings, and past a few
rows it scrolls down — never sideways, which on a trackpad or touchscreen is
the browser's back gesture. The Problems band appears with the first finding
and leaves with the last, capped at a fifth of the window, and its header
collapses the list while keeping the count. Both take their height from the
viewport rather than covering it, so nothing the viewport draws ends up behind
a panel and a finding arriving never resizes the hierarchy or the inspector.
Panels are not resizable and none of these positions is configurable.

The file bar's first control is a `select` listing every level the `levels`
globs matched, as project-relative paths in alphabetical order. Choosing one
opens it. Beside it sit the unsaved badge, Save, Play, and Run.

The placeable types are whatever `defineLevelProject({ entities: [...] })`
lists, plus the level contributions of the project's direct dependencies. See
`packages/level.md` for the declarations.

The viewport draws the level as a real engine scene, with every placement
inactive — constructors, `setup()`, and `onAdd()` run, nothing else does.
A placement the preview cannot build is left out and reported, and the rest of
the level still draws.

The zoom is the developer's alone: it is canvas pixels per world unit, so the
size the level is drawn at is the same in a narrow pane and a wide one. A band
opening, a panel closing, or a window drag changes how much of the level is on
screen and never how large it is drawn or where it sits under the pointer — the
world at the viewport's top-left corner stays put. A level with no remembered
view opens at the origin, zoomed so the whole design rectangle fits the pane,
which is what `Shift`-`F` goes back to. The editor sets its
preview's fit itself, so a `fit` a harness declares governs the game page and
the play page and not the editor's viewport.

The view moves: pan, zoom around the pointer, frame the selection, reset. The
pointer shows which of the three a press would start — `grab` over empty space
and while Space is held, `grabbing` while panning, `move` over a placement. The
view is browser-local state, stored per project and level path — it never enters a
command, the draft, or the document, never marks the level dirty, and produces
no undo entry. Zoom is clamped to 0.05–20. Whether the reference guides show,
whether gestures snap, and how wide the lattice is are part of that stored
view, so all three survive a reload; a view reset leaves them alone. The step
starts at 32 and takes a number from 1 to 10000 world units; the field refuses
one outside that rather than moving it inside. `ArrowUp` and `ArrowDown`, and
dragging the label, double and halve it inside those bounds — the sizes art
comes in — and each press takes effect at once, since the lattice takes no
undo entry.

A snapped move puts the active placement's world position on the nearest
lattice point — a placement at 14 on a lattice of 10 lands on 10, rather than
moving in ten-unit steps and staying off the grid. Everything else the gesture
carries takes the same correction, so an arrangement keeps its spacing and only
the active placement lands on a line. A snapped scale puts the side the box
handle holds on the nearest lattice point, per axis the handle holds, leaving
the factor itself unrounded; a turned placement's side lands as near that point
as its own axis reaches, since a `LevelTransform` holds no shear. A side landing on the point the gesture
scales about is a scale of zero, and one landing behind it is the placement
mirrored at that size; both are values, so both are written. Under the `Each` pivot the side that lands is the covering box's, not
any one placement's edge. Creating, pasting, and duplicating land on the
lattice too. Snapping does not touch a
turn: 15° steps are `Shift`'s, held during the drag, and rounding the resulting
world angle rather than the amount turned by.

The controls:

| Control                                                                | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problems header                                                        | Collapses and opens the list of findings, keeping the count on screen. Nothing remembers it across a reload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Actors header                                                          | Opens and closes the strip under the viewport. It starts closed, and nothing remembers it across a reload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Actors entry                                                           | Creates that type at the middle of the view, on the grid, and selects it. Grouped by source, the project's first. Shows the default path of the type's first `"texture"`-kind asset parameter as a thumbnail, an empty frame when there is none or the file is missing. A sheet shows one frame, from the first of: the grid the parameter declared through `param.asset(descriptor, path, frames)`, the first frame of a sibling `.json` atlas when the `assets` globs match that atlas, otherwise the whole image, fitted. Proportions are never used to guess a frame, and a declared grid that runs off the loaded image is refused                        |
| Click a placement                                                      | Selects it; drag to move it. Ctrl/Cmd-click toggles it in the selection and starts no drag                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Hierarchy row                                                          | Click selects; Ctrl/Cmd-click toggles; drag before/after a row, onto a row, or onto the root area                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Hierarchy drag of a selected row                                       | Moves the whole selection, in one command; a row outside the selection moves alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Inspector asset field                                                  | Text path; Enter or blur commits, Escape restores; **Reset** puts the declared default back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Inspector reference field                                              | A list of the level's placements of the types the parameter accepts, by `name` / `key` / `id`; picking one commits at once. **Clear** beside an optional field empties it. A held id the document cannot account for stays as the first row, `Missing: <id>` or `Wrong type: <label>`. No candidates switches the list off and says which types it wanted. **Pick** beside the list waits for the target to be pointed at                                                                                                                                                                                                                                      |
| Inspector reference field **Pick**                                     | Waits for the target to be clicked in the viewport or in the hierarchy. Everything the slot cannot accept — every placement of an unaccepted type, and everything authored under one — fades to a quarter of its own opacity and its component marks are not drawn; the gizmo is put away, since a press on a handle would do nothing. A press on a faded placement is ignored, so a near miss costs a second click. It ends by choosing a target in the viewport or a row, by `Escape`, by a second press of **Pick**, by choosing a row from the list, by selecting anything but the holder, by opening another level, or by the holder leaving the document |
| Inspector number field                                                 | Type it, `ArrowUp` / `ArrowDown`, or drag its label. `Shift` takes ten steps, `Alt` a tenth of one, and a step stops at the declared `min` or `max`. Text this field cannot take stays in the box with the reason under it, and nothing is sent                                                                                                                                                                                                                                                                                                                                                                                                                |
| Inspector whole-number field                                           | The number field with a step of one, refusing a fraction. `Alt` steps by one, since a whole number has no tenth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Inspector switch                                                       | A checkbox; a press commits at once. An optional one holding nothing draws as neither on nor off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Inspector text field                                                   | Type it; Enter or blur commits, Escape restores. A multiline parameter gets a resizable text area, where Enter types a newline and leaving the box is what commits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Inspector choice field                                                 | A list of the values the parameter declared; picking one commits at once. A held value the list no longer offers stays as the first row, `Not offered: <value>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Inspector **Clear**                                                    | Beside any optional field. Empties it: the value becomes nothing at all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Control bar **Name**                                                   | Type it; Enter or blur commits, Escape restores. Emptying it removes the field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Control bar transform field                                            | Type it, `ArrowUp` / `ArrowDown`, or drag its label. One focus session is one undo step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Inspector **Reset all parameters**                                     | Offered on a migration or parameter finding; after confirmation writes fresh defaults + type version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Delete button, Delete, or Backspace                                    | Removes the selection and everything authored under it. Asks first when a surviving placement's reference parameter points into what is going                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Ctrl/Cmd-C                                                             | Copies the selection and its subtrees. Not an edit, so it works on a read-only level                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Ctrl/Cmd-V                                                             | Pastes at the middle of the view, on the grid, and selects the copies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Ctrl/Cmd-D                                                             | Duplicates the selection in place, stepped aside onto the grid, and leaves the clipboard alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Undo / Redo, or Ctrl/Cmd-Z and Ctrl/Cmd-Shift-Z                        | Replays the level's history one entry at a time, up to 100 entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| File bar level picker                                                  | Opens the level chosen. It settles the open edits into the level being left, whose draft the server keeps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Save                                                                   | Writes the draft to disk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Drag from empty space                                                  | Pans the view                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Space-drag or middle-drag, from anywhere                               | Pans the view without changing the selection; Space is the trackpad gesture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `F` on a placement with no visual                                      | Nothing — there is no rectangle to frame, and the view stays where it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Wheel                                                                  | Zooms around the pointer; the world point under the cursor stays under it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `F` / `Shift`-`F`                                                      | Frames the selection into the pane / puts the view back where the level opened: the origin, zoomed so the design rectangle fits the pane                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Toolbar **Guides**, or `G`                                             | Switches the grid, the world axes, and the default-viewport rectangle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Toolbar **Snap**, or `S`                                               | Whether a move, and the side a box handle drags, lands on the grid. On by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Toolbar **Step**                                                       | World units between grid lines, and what a snapped gesture lands on. Arrows and label drags double and halve it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Hold `Alt` during a drag                                               | Lets that gesture off the grid for as long as it is held, `Shift`'s 15° aside. Read on every pointer move                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Toolbar **Select** / **Move** / **Rotate** / **Scale** / **Transform** | Picks the tool. Each button carries its key and reports `aria-pressed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Toolbar **Active** / **Center** / **Each**                             | What rotate and scale work about. No key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Toolbar **Local** / **World**                                          | Which axes a move follows. Disabled unless the tool is **Move**. No key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Q` / `W` / `E` / `R` / `T`                                            | The same five. Not gated on the level being writable — the gesture is what refuses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Select: drag from empty space                                          | Draws a marquee and selects what it fully covers. Ctrl/Cmd adds to the selection instead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Drag a gizmo arm                                                       | Constrains the change to that one of the placement's own axes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Drag the gizmo's centre square                                         | Both axes at once: free movement, or uniform scale. Under **Move**, `Shift` holds it to one axis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Drag the rotate ring                                                   | Turns the placement with the pointer. `Shift` lands the world angle on a multiple of 15°                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Transform: drag inside the box                                         | Moves. `Shift` holds it to one of the placement's own axes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Transform: drag a box handle                                           | Scales. A corner takes both axes, a side one. `Shift` keeps the proportions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Transform: drag outside the box                                        | Turns. `Shift` lands the world angle on a multiple of 15°                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Under the placements the viewport draws three reference guides, all on one
switch. A grid of the lattice **Step** names, with a heavier line every four or
five. Zoomed out far enough that the lattice would be unreadable the grid draws
a whole multiple of it — the smallest of one, two, or five times a power of ten
that keeps its lines at least 24 screen pixels apart — so every line drawn is
still a place a gesture can land. The world axes through `(0, 0)`, red for x and green
for y as the gizmo has them, in darker shades so a reference line never reads
as a handle. And a rectangle the size of the harness
renderer's `width` and `height`, centred on the origin: what the game shows
before anything moves its camera. Under `fit: "cover"` the player sees less
than that rectangle on one axis, by an amount their window decides.

**Select** (`Q`) is the tool for choosing what to work on. It draws no
handles, and it changes one gesture: a drag from empty space draws a marquee
rather than panning. The marquee takes what it covers entirely, not what it
clips, so it does not pick up scenery behind the thing being aimed at; a
placement that draws nothing is covered by its position. Holding Ctrl/Cmd adds
to the selection rather than replacing it, and a cancelled marquee — a palm, a
pen leaving range — leaves the selection as it was. Dragging a placement still
moves it under Select; only the empty-space drag changes meaning.

Copy, paste, and duplicate work on whole subtrees, and each is one command and
one undo step. Every copy gets a fresh id, links inside the copied set follow
the copies, and a developer `key` that the destination already holds is
renumbered, because a key becomes the entity's scene key and two entities
cannot hold one. A link out of the copied set is where the two differ: a
duplicate keeps an outside parent the destination still holds, which makes
duplicating a child produce a sibling of it, while a paste always detaches and
takes the world pose the original had. The clipboard holds the placements
themselves, so it survives deleting the originals and closing the level — copy
in one level and paste into another.

A new placement, a paste, and a duplicate all step down and to the right when
something is already sitting where they would land, up to sixteen times. The
step is measured in screen pixels, so it looks the same at any zoom.

Every selected placement is outlined and gets a crosshair on its origin — the
point a rotate or a scale turns about, and the only mark a placement that draws
nothing has. Everything authored under the selection is outlined
too, at half the line width and faded — those are the placements a drag
carries, and a child may be drawn far outside its parent's box. A descendant
that is itself selected is marked once, as selected. The gizmo is sized in the
screen pixels the pointer moves in,
so it holds one size across the zoom range and whatever size a fit draws the
canvas at. The pointer names the handle under it: `move`, one of the four CSS
resize cursors pointing the way that handle grows the placement, or a curved
arrow over anything that turns. The resize direction comes from where the
handle sits on screen, so it follows a turned placement and a box that is not
square. A press grabs the handle it is nearest to,
counting from the handle as drawn: 12 pixels outside an arm's line, 17.5
outside the dot on its end or the centre square. A press that misses every
handle by up to 24 pixels keeps the selection rather than clearing it, so a
near miss costs a retry and not the gizmo. A drag on the placement's body is an
unconstrained move whatever the mode. One gesture commits one `set-poses`
command, so one undo takes back the whole gesture.

**A selection's references are drawn.** A dashed line runs from the origin of
every placement holding a reference parameter to the origin of the placement it
names, with an arrowhead at the target, whenever either end is selected — so a
selection shows both what it points at and what points at it. Nothing selected
draws no lines, and there is no toggle for them. A slot holding `null`, a slot
holding an id no placement has, and a placement pointing at itself all draw
nothing; a stale id is reported under the field in the inspector. While a
reference field is waiting for a target, a line to a faded placement is not
drawn.

**A placement with nothing to see gets a row of marks.** A light, a particle
emitter, a UI surface — anything the renderer does not draw — leaves a
placement invisible in the viewport, so the editor draws a small square for
each of its components in a row 18 screen pixels above the origin, whatever is
selected. A placement with a rectangle of its own gets no marks: its artwork
already says that it is there and where. The row is ordered by the
component's class name, so it never reshuffles; a subclass of one of the
components below gets that component's drawing. `UISurface` and `UIRoot`,
`ParticleEmitterComponent`, `LightSource` and `LightOccluder` each get their own
drawing, and every other component gets a generic one — including a game's own.
`Transform` gets none, since the crosshair, the gizmo and the control bar are
all about it. A mark says that something is there and will appear on play, and
nothing about how big it is or where inside the placement it sits: a panel
anchored below its entity still shows its mark at the origin. Resting the
pointer on a mark names the component. Pressing one selects the placement it
belongs to, which is what makes a placement with no picture reachable — a
press is tested against the marks before the artwork drawn under them.

**One gizmo however many placements are selected.** It acts on the outermost of
them: a selected child of a selected parent already travels with its parent, and
transforming it as well would apply the change twice. One gesture over five
placements is still one command and one undo step.

Two toolbar toggles say what it works about and which way it points, and both
start where a single selection has always been.

- **Pivot.** `Active` is the last placement added to the selection — the one
  clicked, for a click, falling back to the outermost one before it when the
  click landed on a child that travels with its parent. `Center` is the middle
  of the rectangle the selection covers. `Each` gives every placement its own
  origin, so a row of signs turns to face a new direction without leaving their
  posts.
- **Axes.** `Local` is the active placement's own axes; `World` is the level's.
  It applies to **Move** and nothing else, and the toolbar disables it under
  every other tool. A turn is about the screen normal, so there is one ring and
  no axis to choose. A scale can only grow a placement along its own axes,
  because that is what `scale.x` and `scale.y` are: a factor measured on
  someone else's axis still lands on those two, and a turned placement grown
  along a foreign axis is a shear, which a level transform cannot hold. So the
  scale arms lie along the placement's own axes whatever the toggle says.
  Several placements at several rotations have no shared local axis, so a
  selection's gizmo is upright.

**Rotate and scale leave `position` alone when the pivot is the placement's own
origin** — which is `Each`, and `Active` with one placement selected, the
default. About any other point they must write it, or the placements do not
orbit the pivot at all.

A scale about a shared pivot spreads the placements from it along the gizmo's
axes and applies the same factor to each placement's own scale. The two agree
exactly whenever the scale is uniform, and whenever a placement lies along
those axes. They cannot agree for an uneven scale of a turned placement inside
a selection: that result is a shear, and a level transform holds a position, an
angle, and a scale per axis with no shear in it.

**What a scale drag writes.** A box handle over one placement scaling about its
own origin sets where the side it holds lands: the distance the pointer moved
divided by that side's own offset at a scale of one, added to the scale. It
reaches any value from any value, zero included, and a drag past the origin
crosses into a mirror. The handle you grabbed keeps following the pointer while
the box inverts round it, so on release the grip under the cursor is the
opposite compass point.

`Shift` on a box handle keeps the proportions, applying one ratio to both axes.
An axis at a scale of zero has no proportion of its own, so it counts as one
there: dragging a corner of a placement at zero out to where the artwork's own
corner sits at a scale of one gives a scale of one on both axes, in the
artwork's own aspect ratio.

An arm has no side under it — it measures against its own drawn length — so it
adds a fraction of that length times `max(|scale|, 1)`. At a scale of one or
more that is a multiplication by `1 + fraction`, and below one it is a whole
unit per arm length, so a placement at zero reaches one in a single arm length.
The uniform centre square follows the same rule.

A shared pivot is the exception: one factor multiplies every selected
placement, which is what keeps the arrangement's spacing and its members
together. An axis at exactly zero is the one value multiplication cannot leave,
so a drag that grows the selection adds there and that member comes back with
the rest. A drag that shrinks the selection leaves it at zero. Every other
scale, mirrored and below one included, multiplies.

A box handle over a selection divides by the drawn rectangle's own half, at the
48-pixel minimum the rectangle is drawn at. That is what keeps a selection a
world unit or two across draggable at the rate the pointer moves, and it gives
a divisor to a selection collapsed onto a line or a point, which is what every
member at a scale of zero produces.

**A child of a parent scaled to zero shows nothing and still takes the edit.**
Its parent draws every scale the child could hold at one point, so the viewport
cannot show the drag. The box handles measure against the artwork's own
rectangle, so half that rectangle's width of pointer travel adds one to the
child's local scale. The control bar's number is where the change is visible.

**A selection is outlined.** More than one placement draws the upright
rectangle covering all of them — without handles under `Move`, `Rotate`, and
`Scale`, and as the box gizmo itself under `Transform`. It is what `Center` is
the centre of. Under `Each` there is no single pivot to
mark, so none is drawn; the origin crosshairs are what show where each
placement turns.

**A turn or a scale holds the gizmo still; a move carries it.** Rotate and
scale orbit every placement about the point they took at the press, and the
rectangle round a turning arrangement breathes as it turns, so a pivot
recomputed each frame would wander off the one in use. A move turns and
stretches nothing, so the handles and the pivot mark travel with the
placements, however the drag was started. The arms keep the direction they had
at the press, which is the axis the move is locked to.

The **Transform** gizmo (`T`) is a rectangle with a handle on each corner and
side and a marker where the gizmo is anchored. Over one placement it is that
placement's own rectangle, so it turns with the placement and stands in for its
outline. Over a selection it is upright, measured from every selected
placement's corners, and each placement keeps its own marker under it. It
carries all three transforms:
which one a press performs comes from where it lands. Handles reach 12 screen
pixels outside the dot drawn for them; the turn band runs 40 pixels out from
the box's edge; a press up to 52 pixels out keeps the selection. A placement
drawn smaller than 48 screen pixels gets a box inflated to that, so its handles
stay apart — including one at a scale of zero, whose box comes from the artwork
rather than from what is drawn.

**A placement that draws nothing gets the same three transforms round its
origin.** It has no rectangle, so there are no sides to put handles on: under
**Transform** it gets a disc at the centre that moves it, the two axis arms and
the diagonal square that scale it, and a band outside the boundary circle that
turns it. The boundary is 64 screen pixels out and the band runs 40 further.
**Move**, **Rotate**, and **Scale** each keep their own single-transform arms.

**A handle whose side sits on the origin is not drawn.** A scale turns about
the origin, and no scale moves a side sitting on it. A sprite whose game passed
no `anchor` draws out from the origin, so its box's `w` and `n` sides run
through it and the gizmo offers `e`, `s`, and `se` alone. The origin crosshair
is what says why. Nothing is drawn for the turn band: the
cursor is its only marker, and a pointer travelling towards the box crosses the
band before it reaches a handle.

**Deleting a target something points at** opens a confirmation naming each
referring placement and the parameter that holds the id. Confirming leaves
those ids exactly as they were: a delete may leave a level with semantic errors
and never with malformed JSON, so one undo puts the whole thing back and
preparation reports `reference-missing` at each field in the meantime. The
reference field then offers the survivors, so a repair is one click.

A copy rewrites references the way it rewrites parent links: one pointing
inside the copied set follows the copies, one pointing outside it keeps the id.
A kept id the destination does not hold becomes a `reference-missing` finding
rather than a guess.

The Delete and Backspace keys are read from the viewport, so they apply while
the editing surface has focus. The rest are read from the window and do not
fire while a text field, textarea, select, or editable element owns the
keystroke. Space additionally skips a focused button, link, or summary, which
activate on it — so every button in the shell blurs itself after a pointer
click (`shell/controls.tsx`), leaving Space to pan. A button reached with the
keyboard keeps its focus, and Space presses it. A pan does not start while a
placement drag is running.

The **hierarchy** lists the authored placements as a tree: parents above
children, siblings in document order, each row showing the placement's `name`
(or its type) and its id. One row drags at a time. Dropping before or after a
row gives the placement that row's parent and position; dropping onto a row
makes the row its parent, as the last child; dropping on the area under the
tree makes it top-level. A move keeps the placement's world pose — its local
transform is recomputed for the new parent — and is one undo step. A row
cannot be dropped onto itself or anything under it.

Each of the four outcomes looks different before the release: before and after
draw a line at the target row's own indent, so the depth the placement lands at
is visible; onto outlines the whole row; the area under the tree fills in. The
edge targets are the top and bottom 30% of a row.

The **control bar** and the **inspector** both render for exactly one selected
placement, and both say so when nothing or several are. The split is by how
much room the thing needs: the bar holds **Name** and the five transform
numbers, which are always six boxes; the inspector holds one control per
declared parameter, any finding about the placement, a **Draw order** section,
and an **In your game** section holding **Key** — all of which vary with the
type.

The inspector's order is: the placement's type and id, the parameter controls,
the findings, **Draw order**, then **In your game**.

Every field in both commits on Enter or on leaving it, and only when the text
differs from what the box shows — so tabbing through them writes nothing.
Escape puts the document's value back. One field is one command and one undo
step, so a two-axis position change is two steps. A field that cannot use what
was typed keeps the text and shows the reason: beside the box on the bar, under
the field in the inspector.

**Draw order** holds two things. **Layer** is a `select` over the world-space
layers this level's set declares, plus **Default**, which is what a placement
with no authored layer already draws on. It writes the placement's `layer`
field, which moves every visual the entity type left on `"default"` and leaves
one the type put somewhere else. A level whose glob declared no layers gets no
Layer control at all. Screen-space layers are never offered: a camera skips
them when it binds automatically, so a world transform there would draw at raw
screen pixels.

**Send to back**, **Backward**, **Forward** and **Bring to front** move the
placement among the placements that share its parent — a child among its
siblings, a root among the roots — and never change a parent. Inside one layer
draw order is document order, so later is on top. On a layer that declares a
`sort` the four are switched off and say why: reordering the document there
would change the file and nothing on screen.

**Name** is a label; it need not be unique and nothing below the document reads
it, so making a rename leaves the preview standing. Undoing one rebuilds it: a
replayed history entry does not carry the impact its command reported. The box is empty when the
placement has no name and shows the type greyed out, which is what the
hierarchy row shows too. Emptying it removes the field.

The bar's five numbers are X, Y, Rotation, Scale X, Scale Y. They are
the placement's own local transform, so a parented
placement's numbers are relative to its parent, and the bar says
`relative to <parent>` when there is one. While a viewport gesture is running
they show the pose that gesture has reached, which is what letting go writes;
the document itself is untouched until then. Rotation is typed in degrees; the
document stores radians. Every number is shown to at most four decimals. A
typed number is exact and is never landed on the grid, whatever **Snap** and
**Step** say. Every one of the five takes any finite number, a
scale of zero included — that is what a placement animated in from nothing
starts at, and `active: false` cannot express it, since an inactive placement
is not in the scene to tween.

Each of the five changes three ways: type it, press `ArrowUp` or `ArrowDown`,
or drag the word beside it, which carries a `col-resize` cursor. There are no
arrow buttons. One press moves:

| Field            | Press | `Shift`                  | `Alt` |
| ---------------- | ----- | ------------------------ | ----- |
| X, Y             | 1     | one grid cell (**Step**) | 0.1   |
| Rotation         | 1°    | 15°                      | 0.1°  |
| Scale X, Scale Y | 0.1   | halved or doubled        | 0.01  |

`Shift` takes the unit the quantity is measured in rather than ten of the
ordinary step. Both modifiers are the size of the step, not a lattice to land
on — a stepped number stays exact, so `Shift`+Up from 7° gives 22° where a
rotate drag under `Shift` would land the angle on 15°.

A scale is the exception: its `Shift` multiplies instead of adding, so 1 halves
to 0.5 and doubles to 2, and a mirrored scale keeps its sign. Halving and
doubling neither reach zero nor leave it, so a scale of zero is typed or
stepped by the ordinary 0.1.

Dragging the label steps once per four screen pixels of travel and reads the
modifiers at each move, so a drag can change gear part-way through. The drag
takes pointer capture, so it survives leaving the label, and it leaves the
caret and the text selection alone.

A press paints the placement in the viewport at once but writes nothing.
Enter, leaving the box, or anything that settles the open edits — save, run,
undo, redo, a level switch — turns the whole focus session into one
`set-poses` and one undo step, composed from the document as it stands with
only the number the field changed taken from the box. Escape puts the
document's number back. Two bursts separated by a pause are one undo entry,
because the unit is the focus session. A number left part-way through makes the
level dirty, and it is dropped rather than written when the selection moves on
or another level is opened.

An asset parameter is a text field holding the project-relative path, with the
project's own files on offer under it. **▾** opens the list, typing narrows it by case-insensitive substring, and
Enter or a click on a row commits that row as one edit and one undo step.
`ArrowDown` and `ArrowUp` move through the rows; Escape closes the list and
leaves what was typed, and a second Escape puts the document's value back. The
list is read fresh each time it opens, so a file added while the editor is
running appears without a reload. Typing a whole path still commits it whether
or not the list holds it. The path is not checked in the form; the
preview checks it when it rebuilds, and leaves the placement out either way. A
malformed path (empty, absolute, backslashes, `.` or `..` segments) is a
`parameter-invalid` finding shown beside that field, and **Reset** offers the
default. A well-formed path to a missing file fails when the preview loads it
and is listed under the fields as `placement-excluded`, with no reset. The
document stays editable and saveable in both cases. A finding preparation
reports against the placement — a missing
migration, a parameter the current declaration does not have — is listed under
the fields, and **Reset all parameters** discards every authored parameter,
writing the declaration's defaults and its current version in one command. It
asks first, because undo is the only way back.

A number is typed, stepped with `ArrowUp` and `ArrowDown`, or scrubbed by
dragging the word beside it, the way the control bar's transform numbers are.
`Shift` takes ten steps and `Alt` a tenth of one, and a step stops at the `min`
or `max` the declaration gave. Text the field cannot take — a word, a fraction
where a whole number belongs, a number outside the range — stays in the box
with the reason under it and is not sent. A switch is a checkbox and commits on
the press; an optional one holding nothing draws as neither on nor off. Text
commits on Enter or blur, and a parameter declared `multiline` gets a text area
where Enter types a newline instead. A choice is a list of the values the
declaration named, and a held value the list no longer offers keeps its own
first row. Every optional field carries **Clear**, which empties it.

**Key** is the placement's developer-facing identity, and the section shows the
scene key a game looks the entity up by: `<namespace>/<key or id>`, where the
namespace is the argument the game passes `instantiateLevel`. It is last in the
panel because changing it breaks every lookup written against the old value,
and the editor cannot see the game's source. The lookup a change cannot break
is `instance.get(placementId)` on what `instantiateLevel` returned, keyed on
the immutable id the panel shows under the type. Emptying it removes the field, and
the scene key goes back to deriving from the placement id. A key another
placement already derives is refused before it is sent, naming the placement
that holds it; the reducer refuses it too, because a document where two
placements derive one scene key cannot be read back.

The control bar's and the inspector's fields are document edits. The toolbar's
**Step** is a view setting: it takes no undo entry and makes nothing dirty.

Between them they edit the name, the transform, the declared parameters, and
the key. The active flag, the parent, and extensions have no controls; the
parent moves through the hierarchy.

A new placement is written whole: `active`, an identity transform at the
viewport centre, and every parameter its declaration declares, each at the
default `defineParams` gave it. Resolving defaults once, at creation, is what
keeps a later change to a declaration's default from changing a level that
already exists.

Deleting a placement deletes its authored subtree with it. A removal that would
leave a placement naming a parent that is gone is refused and names the
placement it would have orphaned.

Undo and redo are server operations rather than edits the browser composes: the
history lives beside the draft, so reloading the page keeps it. The history is
100 entries and lives in memory, so restarting `yage-editor` empties it. Undo
does not rewind to an earlier revision — it produces a new one holding the
earlier document.

## The draft

The unsaved document lives on the server, not in the page, so a reload does not
lose it. Every edit is a command the server applies to its draft and answers
with a new revision. Save promotes one exact revision to disk and carries no
document, so what lands on disk is what the server accepted.

The server holds one draft per level path, so switching levels loses nothing:
the level left behind keeps its unsaved document and its undo history until
`yage-editor` stops. The camera, guides, snap and step are per level and come
back with it; the selection does not; the clipboard is not per level. An open
drag is committed into the level being left before the switch.

## Playing and running a level

Two controls, answering two questions.

**Play** runs the level as it stands, unsaved work included, in a page the
editor serves at `<base>play.html`. It boots the project's harness — the same
`Engine` and plugins the viewport uses — instantiates the draft with entities
active, and spawns a camera so the world origin is in the middle. **A project
writes no code for this.** It works before a `gamePage` is configured and on a
project that has never heard of the editor.

What Play cannot show is the game's own start-up: its scene, its systems, and
whatever decides when a level is entered. The harness supplies an engine and
plugins, not the scene the game pushes.

**Run** answers that one. It saves the draft, then opens `gamePage` with the
level named in a single query parameter:

```
game.html?level=levels%2Fforest.yage-level.json
```

The URL is relative, so it resolves against the editor page and lands under
the project's base. The value is the level's path inside the project, and the
game resolves it against its own page — which is what puts it under the base
too. The Run control reads **Save and Run** while the draft is dirty, because
the game reads the file.

That parameter is the whole protocol. There is no route, no token, and no
revision: a game reads a level file, and the editor writes one.

```ts
import { loadLevelDocument } from "@yagejs/level";

const url =
  new URLSearchParams(location.search).get("level") ??
  "/levels/forest.yage-level.json";
const document = await loadLevelDocument(url);
```

`loadLevelDocument(url)` fetches, checks the answer is a level, and throws a
message naming the URL when it is not. It never takes a cached copy. A project
with one level can ignore the parameter and pass its own path; a project with
several needs it, because one game page cannot know which level Run meant.

A level a game imports statically — `import level from "./forest.yage-level.json"`
— is inlined by Vite at transform time, so it will not follow the editor. Fetch
the level to run it from the editor.

## What the editor cannot do

The edits are create, move, rotate, scale, delete, reparent, reorder, copy,
paste, duplicate, rename, key, the typed transform, and the asset parameter.

**Typing a value.** Every parameter kind that ships has a control: assets,
references, numbers, whole numbers, switches, text and choices. The active
flag, the parent, and extensions have no controls at all.

**What the asset picker can list.** The listing walks the Vite root, so a file
under a `publicDir` outside the root is not offered, and neither is anything
behind a symlink. Both are still typed by hand. A project whose globs match
more than 5000 files gets the first 5000 and a line saying so.

**What Run's `level` parameter names.** Run names the level by its path inside
the project, which is where the file sits on disk and not always the address
the site serves. The two agree for a level outside `publicDir`. For one under
it they do not: the dev server serves the disk path, printing Vite's warning
about the public directory, while `vite build` copies `publicDir`'s contents to
the output root and serves the same level one segment higher. Run hands over
the disk path either way, so a game page that fetches whatever the parameter
holds translates it there.

**Snapping to anything but the grid.** Nothing snaps to another placement's
edge or centre. The **Scale** tool's arms measure against their own drawn
length, which is a screen distance and not a side of the placement, so a drag
on one lands on nothing — the box handles are what the grid catches. There is
no project-wide default step either: **Step** is remembered per level, in the
browser, beside the camera.

**Levels added while the editor runs.** The list is read once, when the page
loads, so a level file created afterwards needs a reload before it can be
picked. The editor cannot create, rename, duplicate, or delete a level file.

**Anything that changes the file underneath it.** A level file edited outside
the editor is not noticed, and a second editor tab on the same level does not
see the first one's edits while both are open. Reload to pick either up.
