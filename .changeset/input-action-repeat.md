---
"@yagejs/input": patch
---

A held action produces repeat edges. `isJustPressed(action, { repeat: true })` is true on the press and again every `repeatInterval` seconds once the hold passes `repeatDelay`, so one query covers the press and the repeats a menu needs. Called with one argument, `isJustPressed` reports the press edge and nothing else.

`repeatDelay` defaults to 0.35 seconds and `repeatInterval` to 0.1 seconds, and both are arguments rather than per-action state, so two callers can repeat the same action at different rates. A query window reports at most one edge: a frame longer than the interval steps a menu one row, not five. `clock` selects the clock the repeat is counted on and leaves the press edge alone, which always resolves against the caller's frame or fixed-step window. Left out, repeats count on the raw input clock, so a menu over a paused scene keeps moving.

Gamepad stick directions repeat with no extra code. A push past the direction threshold arrives as an ordinary `GamepadLeftStickDown`-style key edge, so binding a stick direction to a movement action gives it the cadence a key has, at the same rate.

The call throws when `repeatDelay` is not a finite number of seconds at or above 0, or `repeatInterval` is not a finite number of seconds above 0, naming the value. An interval of 0 has no defined repeat count; a delay of 0 is legal and starts the cadence at the press. The check runs before any state is read, so the same bad argument throws whatever the action's group enablement.

`PressRepeatOptions`, `DEFAULT_REPEAT_DELAY` and `DEFAULT_REPEAT_INTERVAL` are exported.

Keys typed into a text field stay out of the action map. A key press the browser sent to a `<textarea>`, a text-accepting `<input>` — the element `@pixi/ui`'s text input creates and focuses — or a `contenteditable` element raises no action and `preventDefaultKeys` leaves the key to the browser, so a player naming a save file does not also walk the character and can type a space. The press belongs to the field it was sent to even when handling it takes the field off the page, so the Escape or Enter that ends an edit fires no game action bound to it. This is a behaviour change for a game that binds letter keys and shows a text field: while the player types, those actions stay quiet.

Releases are always delivered. A key held when the field took focus keeps its action down until the player lets go, so nothing is stranded down. Gamepad and pointer input are unaffected by browser focus.

A release the player made is told apart from one the engine forced. `isJustReleasedByPlayer(action)` is true, in the caller's frame or fixed-step window, only for a key-up, a gamepad button-up, a pointer-button release or an on-screen control the finger left; it is false when the window loses focus, the page hides, a pad disconnects, a pointer gesture is cancelled, `clearAll()` runs or an action source releases everything, and false while the action's group is disabled. Read it wherever the release commits something the player cannot take back, such as a charged shot. `isJustReleased`, `onActionReleased` and the release-duration helpers report every end of a hold, forced or not.
