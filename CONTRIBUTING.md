# Contributing

Thanks for contributing to PIM MCP.

## Requirements
- Node.js 20+
- npm 10+

## Development Setup
```bash
npm ci
npm run build      # build all packages via Turborepo
npm run lint       # Biome
npm run typecheck
npm test           # Vitest
```

## Branch and Commit Guidelines
- Create a feature branch from `main`.
- Use Conventional Commits, e.g.:
  - `feat: add find_free_slots calendar tool`
  - `fix: handle empty IMAP folder listing`
  - `docs: update MCP client config`

## Pull Request Checklist
- Keep changes focused and minimal.
- Follow TDD: add or update Vitest tests for behavior changes.
- Mock external dependencies (tsdav, imapflow, nodemailer, MCP SDK) in tests.
- Update docs when behavior or config changes.
- Ensure `npm run lint`, `npm run typecheck`, and `npm test` pass, and CI is green.

## Security and Secrets
- Never commit real IMAP/SMTP/CalDAV/CardDAV credentials.
- Pass credentials via environment variables only.
- For vulnerabilities, follow `SECURITY.md`.

## Review Policy
- All PRs require human review before merge.
- AI-assisted changes are welcome, but maintainers are responsible for final correctness.
