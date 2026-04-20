---
"@yagejs/ui": minor
---

Add `LoadingSceneProgressBar` — default visual for `@yagejs/core`'s `LoadingScene`.

- Entity subclass. Spawn it inside a `LoadingScene` from `onEnter` (throws otherwise).
- Subscribes to `scene:loading:progress` on the engine event bus and updates a `UIProgressBar`.
- Customizable: `width`, `height`, `track`, `fill`, `anchor`, `offset`, `layer`.
- Optional `backdrop` for a full-viewport background behind the bar — recommended whenever the loading scene is used with a transition, otherwise the outgoing scene bleeds through during the fade. Implemented as a sibling entity whose lifetime is tied to the progress bar.
- For custom visuals (spinners, animated text, etc.), write a component that subscribes to the same event — same idiom this widget uses internally.
