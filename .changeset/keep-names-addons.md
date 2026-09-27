---
"@yagejs-addons/abilities": patch
"@yagejs-addons/dialogue": patch
"@yagejs-addons/feel": patch
"@yagejs-addons/i18n": patch
"@yagejs-addons/interaction": patch
"@yagejs-addons/inventory": patch
"@yagejs-addons/quests": patch
"@yagejs-addons/steering": patch
"@yagejs-addons/synth": patch
"@yagejs-addons/virtual-controls": patch
---

The addon is built without `keepNames`, so a game's bundler can leave out the classes it does not use. A minified production build shows short class names unless the game sets `build.rollupOptions.output.keepNames: true` in `vite.config.ts`. The abilities addon's `Hitbox` and `Projectile` declare `static defaultName`, so they keep their default names in any build.
