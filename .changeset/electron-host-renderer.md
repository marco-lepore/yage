---
"@yagejs/renderer": patch
---

Run YAGE games in Electron with a host adapter and a locked-down shell.

- `RendererPlugin` draws on a page whose content security policy forbids turning strings into code: it loads PixiJS's prebuilt shader and uniform code itself, before it creates the Pixi application. A page that allows string evaluation keeps PixiJS's generated code.
- Under such a policy on WebGPU, PixiJS writes integer uniforms as floats, so `motionBlur` from `@yagejs/effects` draws nothing there. WebGL, which the renderer asks for first, draws it.
