// Replaces PixiJS's generated shader and uniform code with prebuilt
// functions, so the renderer draws on a page that forbids turning strings
// into code. Importing it resolves the same copy of PixiJS the renderer
// draws with, which is what the replacement needs.
import "pixi.js/unsafe-eval";
