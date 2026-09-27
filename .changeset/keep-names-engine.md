---
"@yagejs/renderer": minor
"@yagejs/physics": minor
"@yagejs/input": minor
"@yagejs/audio": minor
"@yagejs/particles": minor
"@yagejs/tilemap": minor
"@yagejs/pathfinding": minor
"@yagejs/ui": minor
"@yagejs/ui-react": minor
"@yagejs/debug": minor
"@yagejs/save": minor
"@yagejs/effects": minor
"@yagejs/lighting": minor
"@yagejs/level": minor
---

The package is built without `keepNames`, so a game's bundler can leave out the classes it does not use. A minified production build shows short class names unless the game sets `build.rollupOptions.output.keepNames: true` in `vite.config.ts`. `CameraEntity` (renderer) and `LoadingSceneProgressBar` (ui) declare `static defaultName`, so they keep their default names in any build.
