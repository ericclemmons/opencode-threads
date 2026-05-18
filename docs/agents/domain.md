# Domain Docs

This repo uses a single-context domain documentation layout.

## Layout

- `CONTEXT.md` at the repo root contains project vocabulary and domain concepts when they exist.
- `docs/adr/` contains architectural decisions when they exist.
- There is no `CONTEXT-MAP.md`; this is not currently a multi-context repo.

## Consumer Rules

Before using engineering skills like `/improve-codebase-architecture`, `/diagnose`, or `/tdd`, read:

- `CONTEXT.md` if present.
- Relevant ADRs in `docs/adr/` if present.

If those files do not exist, proceed silently. Do not create them upfront. Create or update them only when a skill conversation resolves a durable domain term or architectural decision.

## Slash Commands

Use `/setup-matt-pocock-skills` to regenerate this setup if the issue tracker, triage labels, or domain-doc layout changes.
