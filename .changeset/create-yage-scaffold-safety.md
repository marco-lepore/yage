---
"create-yage": patch
---

Fix create-yage scaffolding across supported environments.

- Resolve bundled templates on Windows and when the install path contains spaces.
- Preserve an existing `.git` directory during forced overwrite and report file targets accurately.
- Update generated guidance, sprite anchors, and Node.js requirements.
