---
"@yagejs-addons/i18n": patch
---

Declare React 19 as the supported optional peer. The React entry runs on `@yagejs/ui-react`, which requires React 19, so the advertised React 18 range never worked.
