---
"@yagejs/debug": patch
---

Expose `setFlag` and `toggle` on the public `DebugRegistry` interface so code resolving `DebugRegistryKey` can control debug drawing without a cast.
