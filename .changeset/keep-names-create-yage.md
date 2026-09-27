---
"create-yage": patch
---

The `minimal` template keeps class names in production builds (`build.rollupOptions.output.keepNames`), as the `recommended` template already does, so error reports and Inspector output stay readable now that the YAGE packages no longer keep names themselves.
