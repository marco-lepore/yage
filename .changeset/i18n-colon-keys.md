---
"@yagejs-addons/i18n": patch
---

A catalog key containing `:` is looked up as written. The i18next backend used to read `line:abc` as key `abc` in a namespace `line`, so the entry was never found and the fallback showed; Yarn Spinner line ids take that form. `.` is still the only separator, reaching into nested catalog objects.
