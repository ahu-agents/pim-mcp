# Phase 4 Design: Publish to npm

**Date:** March 9, 2026
**Status:** Approved
**Goal:** Publish all 4 packages to npm so users can run `npx @miguelarios/email-mcp`, `npx @miguelarios/cal-mcp`, `npx @miguelarios/card-mcp`.

---

## Scope

Prepare and publish the monorepo's 4 packages to npm with automated CI publishing.

### In scope

- Package metadata (license, author, description, repository, keywords)
- MIT LICENSE file at repo root
- Shebang lines in CLI entrypoints
- Pin `@miguelarios/pim-core` dependency to `^0.1.0` (not `*`)
- Per-package README.md for npm pages
- GitHub Actions publish workflow triggered by git tags
- Independent versioning per package

### Out of scope

- Live testing against real Mailbox.org / Nextcloud accounts
- OpenClaw / MCPorter deployment
- Changelogs
- Build tooling changes (no bundler, keep tsc)

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| npm scope | `@miguelarios` | Matches GitHub username, already in package.json |
| License | MIT | Standard for npm, no-friction |
| Versioning | Independent per package | Each package evolves at its own pace |
| Publishing | Automated via GitHub Actions | Tag-triggered: `<package>/v<version>` |
| Core package | Published to npm | MCP packages depend on it at install time |
| Bundling | Not now (tsc only) | Can pivot to bundled core later if needed |

---

## Package metadata

All 4 packages get:

```json
{
  "license": "MIT",
  "author": "Miguel Rios",
  "repository": {
    "type": "git",
    "url": "https://github.com/miguelarios/pim-agents.git",
    "directory": "packages/<name>"
  },
  "homepage": "https://github.com/miguelarios/pim-agents",
  "bugs": "https://github.com/miguelarios/pim-agents/issues"
}
```

Descriptions:
- `pim-core`: "Shared config, validation, errors, and utilities for PIM agent MCP servers"
- `email-mcp`: "MCP server for email via IMAP/SMTP — read, search, send, and manage emails"
- `cal-mcp`: "MCP server for calendars via CalDAV — CRUD events, free/busy, multi-provider"
- `card-mcp`: "MCP server for contacts via CardDAV — CRUD contacts, search, resolve names to emails"

---

## CLI entrypoints

Each MCP package's `src/bin/cli.ts` needs `#!/usr/bin/env node` as the first line so `npx` can execute it.

---

## CI publish workflow

`.github/workflows/publish.yml`:
- **Trigger:** Push tag matching `*/v*` (e.g., `pim-core/v0.1.0`, `email-mcp/v0.1.0`)
- **Parse:** Extract package name and version from tag
- **Steps:** Checkout → Node 20 → npm ci → npm run build → npm test → cd packages/<name> → npm publish --access public
- **Auth:** `NPM_TOKEN` repo secret
- **Publish order:** Core first, then MCP servers (manual — user pushes core tag first)

---

## Package READMEs

Each package gets a minimal README:
- One-line description
- Installation / usage (`npx @miguelarios/<name>`)
- Required environment variables
- Available tools list

---

## First publish checklist (manual steps for user)

1. Create npm account at npmjs.com
2. Create `@miguelarios` organization on npm
3. Generate npm access token (automation type)
4. Add `NPM_TOKEN` secret to GitHub repo settings
5. Push `pim-core/v0.1.0` tag → CI publishes core
6. Push `email-mcp/v0.1.0`, `cal-mcp/v0.1.0`, `card-mcp/v0.1.0` tags → CI publishes MCP servers
