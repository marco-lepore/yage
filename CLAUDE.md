# CLAUDE.md

Read `AGENTS.md` first for project conventions, architecture rules, and coding style.

## Claude Code Notes

- Prefer dedicated tools (`Read`, `Edit`, `Grep`, `Glob`) over Bash for file operations.
- Run `npx turbo run typecheck` after code changes to catch type errors early.
- Don't commit unless explicitly asked.
- For deep architecture questions, read `docs/v2/AGENT_GUIDE.md`.
