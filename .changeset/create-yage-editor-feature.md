---
"create-yage": patch
---

Add an `editor` entry to `--features`. `npx create-yage my-game --features editor` puts `@yagejs/level` in the project's dependencies and `@yagejs-tools/editor` in its devDependencies, adds an `"editor": "yage-editor"` script, and prints `npx yage-editor init` among the next steps — that command writes the editor's config, harness and project files itself.

A feature can now carry `scripts` and `nextSteps` alongside its dependencies. Feature scripts are appended after the template's own, which keep their order.
