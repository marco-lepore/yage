---
"create-yage": patch
---

Both scaffold templates now ship an *Agent-driven debugging — throwaway Inspector specs* section in `AGENTS.md`, pointing scaffolded-project agents at the Playwright + Inspector + frozen-clock workflow for LLM-assisted gameplay validation. The recommended template gets a complete spec template (debug already wired); the minimal template gets the same pattern with a note that `@yagejs/debug` needs to be added first.
