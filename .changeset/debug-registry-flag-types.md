---
"@yagejs/debug": patch
---

Expose `toggle()` and `setFlag()` on the public `DebugRegistry` interface, so code that resolves `DebugRegistryKey` can switch debug drawing and individual contributor flags without a cast.
