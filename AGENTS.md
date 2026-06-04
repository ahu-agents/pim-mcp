# AGENTS

This repository accepts AI-assisted contributions.

## Guardrails
- Keep changes small and reviewable.
- Be careful with send/delete/move paths in email, and with calendar/contact writes; do not change their behavior without explicit intent.
- Do not commit secrets, credentials, or personal data.
- Follow the project conventions in `CLAUDE.md` (TypeScript strict, Biome, Valibot, Vitest, TDD).

## Required Human Checks
- Review every AI-generated change before merge.
- Validate credential handling and the SMTP From allowlist.
- Ensure tests mock external services and that docs match implemented tools.

## Attribution
A concise note such as "AI-assisted" in the PR description is recommended for transparency.
