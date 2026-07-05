---
"@yagejs-addons/dialogue": patch
---

Fix a layout-listener leak in the dialogue presenters. `BoxLayout.onChange` and `BubbleLayout.onChange` now return an unsubscribe function, and `DialogueChrome`, `InBoxAvatarPresenter`, and `BubbleAvatarPresenter` call it in `dispose()`. Before, the listener was never removed: a presenter disposed and re-created against a layout that outlived it stacked a second `onChange` callback that kept firing `applyGeometry`/`place`/`follow` over the destroyed entities. The built-in factories rebuild the layout together with the presenters, so no shipped setup hit this — the fix covers the public `@yagejs-addons/dialogue/presenters` exports, whose constructors take a layout the caller can retain.
