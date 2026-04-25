# Phase 4: Publish to npm — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish all 4 packages (`pim-core`, `email-mcp`, `cal-mcp`, `card-mcp`) to npm with automated CI publishing.

**Architecture:** Add package metadata, LICENSE, READMEs, and a tag-triggered GitHub Actions publish workflow. Independent versioning per package.

**Tech Stack:** npm, GitHub Actions, Node 20

---

### Task 1: Add LICENSE file

**Files:**
- Create: `LICENSE`

**Step 1: Create MIT LICENSE file**

```
MIT License

Copyright (c) 2026 Miguel Rios

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

### Task 2: Update package metadata for pim-core

**Files:**
- Modify: `packages/core/package.json`

**Step 1: Add metadata fields**

Add these fields to `packages/core/package.json`:

```json
{
  "description": "Shared config, validation, errors, and utilities for PIM agent MCP servers",
  "license": "MIT",
  "author": "Miguel Rios",
  "repository": {
    "type": "git",
    "url": "https://github.com/miguelarios/pim-agents.git",
    "directory": "packages/core"
  },
  "homepage": "https://github.com/miguelarios/pim-agents",
  "bugs": "https://github.com/miguelarios/pim-agents/issues",
  "keywords": ["pim", "mcp", "config", "validation"]
}
```

**Step 2: Commit**

```bash
git add packages/core/package.json
git commit -m "chore(core): add npm package metadata"
```

---

### Task 3: Update package metadata for email-mcp

**Files:**
- Modify: `packages/email-mcp/package.json`

**Step 1: Add metadata fields and pin core dependency**

Add metadata fields and change `"@miguelarios/pim-core": "*"` to `"@miguelarios/pim-core": "^0.1.0"`:

```json
{
  "description": "MCP server for email via IMAP/SMTP — read, search, send, and manage emails",
  "license": "MIT",
  "author": "Miguel Rios",
  "repository": {
    "type": "git",
    "url": "https://github.com/miguelarios/pim-agents.git",
    "directory": "packages/email-mcp"
  },
  "homepage": "https://github.com/miguelarios/pim-agents",
  "bugs": "https://github.com/miguelarios/pim-agents/issues",
  "keywords": ["mcp", "email", "imap", "smtp", "mailbox"]
}
```

**Step 2: Commit**

```bash
git add packages/email-mcp/package.json
git commit -m "chore(email-mcp): add npm package metadata"
```

---

### Task 4: Update package metadata for cal-mcp

**Files:**
- Modify: `packages/cal-mcp/package.json`

**Step 1: Add metadata fields and pin core dependency**

Add metadata fields and change `"@miguelarios/pim-core": "*"` to `"@miguelarios/pim-core": "^0.1.0"`:

```json
{
  "description": "MCP server for calendars via CalDAV — CRUD events, free/busy, multi-provider",
  "license": "MIT",
  "author": "Miguel Rios",
  "repository": {
    "type": "git",
    "url": "https://github.com/miguelarios/pim-agents.git",
    "directory": "packages/cal-mcp"
  },
  "homepage": "https://github.com/miguelarios/pim-agents",
  "bugs": "https://github.com/miguelarios/pim-agents/issues",
  "keywords": ["mcp", "calendar", "caldav", "ical"]
}
```

**Step 2: Commit**

```bash
git add packages/cal-mcp/package.json
git commit -m "chore(cal-mcp): add npm package metadata"
```

---

### Task 5: Update package metadata for card-mcp

**Files:**
- Modify: `packages/card-mcp/package.json`

**Step 1: Add metadata fields and pin core dependency**

Add metadata fields and change `"@miguelarios/pim-core": "*"` to `"@miguelarios/pim-core": "^0.1.0"`:

```json
{
  "description": "MCP server for contacts via CardDAV — CRUD contacts, search, resolve names to emails",
  "license": "MIT",
  "author": "Miguel Rios",
  "repository": {
    "type": "git",
    "url": "https://github.com/miguelarios/pim-agents.git",
    "directory": "packages/card-mcp"
  },
  "homepage": "https://github.com/miguelarios/pim-agents",
  "bugs": "https://github.com/miguelarios/pim-agents/issues",
  "keywords": ["mcp", "contacts", "carddav", "vcard"]
}
```

**Step 2: Commit**

```bash
git add packages/card-mcp/package.json
git commit -m "chore(card-mcp): add npm package metadata"
```

---

### Task 6: Write README for pim-core

**Files:**
- Create: `packages/core/README.md`

**Step 1: Write README**

```markdown
# @miguelarios/pim-core

Shared config, validation, errors, and utilities for PIM agent MCP servers.

This is an internal library used by [@miguelarios/email-mcp](https://www.npmjs.com/package/@miguelarios/email-mcp), [@miguelarios/cal-mcp](https://www.npmjs.com/package/@miguelarios/cal-mcp), and [@miguelarios/card-mcp](https://www.npmjs.com/package/@miguelarios/card-mcp). You probably don't need to install this directly.

## License

MIT
```

**Step 2: Commit**

```bash
git add packages/core/README.md
git commit -m "docs(core): add README"
```

---

### Task 7: Write README for email-mcp

**Files:**
- Create: `packages/email-mcp/README.md`

**Step 1: Write README**

```markdown
# @miguelarios/email-mcp

MCP server for email via IMAP/SMTP — read, search, send, and manage emails.

## Usage

```bash
npx @miguelarios/email-mcp
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IMAP_HOST` | Yes | — | IMAP server hostname |
| `IMAP_USER` | Yes | — | IMAP username |
| `IMAP_PASS` | Yes | — | IMAP password |
| `IMAP_PORT` | No | `993` | IMAP port |
| `IMAP_SECURE` | No | `true` | Use TLS |
| `SMTP_HOST` | Yes | — | SMTP server hostname |
| `SMTP_USER` | Yes | — | SMTP username |
| `SMTP_PASS` | Yes | — | SMTP password |
| `SMTP_PORT` | No | `465` | SMTP port |
| `SMTP_SECURE` | No | `true` | Use TLS |
| `SMTP_FROM_NAME` | No | — | Display name for outgoing emails |

## Tools

| Tool | Description |
|------|-------------|
| `list_emails` | Search and filter emails by folder, sender, subject, date, flags |
| `get_email` | Fetch full email by UID — headers, body, attachment metadata |
| `send_email` | Compose and send via SMTP with attachment support |
| `move_email` | Move email between folders |
| `mark_email` | Set/unset flags (read, unread, flagged) |
| `delete_email` | Move to trash or permanently delete |
| `list_folders` | List all IMAP folders |
| `create_folder` | Create an IMAP folder |
| `download_attachment` | Download attachment by email UID and filename |
| `get_email_raw` | Export email as .eml |

## License

MIT
```

**Step 2: Commit**

```bash
git add packages/email-mcp/README.md
git commit -m "docs(email-mcp): add README"
```

---

### Task 8: Write README for cal-mcp

**Files:**
- Create: `packages/cal-mcp/README.md`

**Step 1: Write README**

```markdown
# @miguelarios/cal-mcp

MCP server for calendars via CalDAV — CRUD events, free/busy, multi-provider.

## Usage

```bash
npx @miguelarios/cal-mcp
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CALDAV_ACCOUNTS` | Yes | JSON array of CalDAV accounts |

### CALDAV_ACCOUNTS format

```json
[
  {
    "id": "mailbox",
    "url": "https://dav.mailbox.org/caldav/",
    "username": "user@mailbox.org",
    "password": "app-password"
  },
  {
    "id": "nextcloud",
    "url": "https://cloud.example.com/remote.php/dav/calendars/user/",
    "username": "user",
    "password": "app-password"
  }
]
```

## Tools

| Tool | Description |
|------|-------------|
| `list_calendars` | Discover calendars across all configured providers |
| `list_events` | Query events by date range and calendar |
| `get_event` | Get event details by UID |
| `create_event` | Create event with title, start/end, location, attendees |
| `update_event` | Update existing event by UID |
| `delete_event` | Delete event by UID |
| `create_events_batch` | Create multiple events at once |
| `import_ics` | Parse .ics content and create events |
| `find_free_slots` | Find available time slots across calendars |

## License

MIT
```

**Step 2: Commit**

```bash
git add packages/cal-mcp/README.md
git commit -m "docs(cal-mcp): add README"
```

---

### Task 9: Write README for card-mcp

**Files:**
- Create: `packages/card-mcp/README.md`

**Step 1: Write README**

```markdown
# @miguelarios/card-mcp

MCP server for contacts via CardDAV — CRUD contacts, search, resolve names to emails.

## Usage

```bash
npx @miguelarios/card-mcp
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CARDDAV_URL` | Yes | CardDAV server URL |
| `CARDDAV_USER` | Yes | CardDAV username |
| `CARDDAV_PASS` | Yes | CardDAV password |

## Tools

| Tool | Description |
|------|-------------|
| `list_contacts` | List and search contacts by name, email, phone, org |
| `get_contact` | Get full contact details by UID |
| `create_contact` | Create a new contact |
| `update_contact` | Update an existing contact (merge-based) |
| `delete_contact` | Delete a contact by UID |
| `resolve_contact` | Given a name, return email address |

## License

MIT
```

**Step 2: Commit**

```bash
git add packages/card-mcp/README.md
git commit -m "docs(card-mcp): add README"
```

---

### Task 10: Create GitHub Actions publish workflow

**Files:**
- Create: `.github/workflows/publish.yml`

**Step 1: Write workflow**

```yaml
name: Publish to npm

on:
  push:
    tags:
      - "*/v*"

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://registry.npmjs.org"
          cache: npm

      - name: Parse tag
        id: tag
        run: |
          TAG="${GITHUB_REF#refs/tags/}"
          PACKAGE="${TAG%%/v*}"
          VERSION="${TAG#*/v}"
          echo "package=$PACKAGE" >> "$GITHUB_OUTPUT"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "Publishing $PACKAGE@$VERSION"

      - name: Map package to directory
        id: dir
        run: |
          case "${{ steps.tag.outputs.package }}" in
            pim-core) DIR="packages/core" ;;
            email-mcp) DIR="packages/email-mcp" ;;
            cal-mcp) DIR="packages/cal-mcp" ;;
            card-mcp) DIR="packages/card-mcp" ;;
            *) echo "Unknown package: ${{ steps.tag.outputs.package }}" && exit 1 ;;
          esac
          echo "dir=$DIR" >> "$GITHUB_OUTPUT"

      - run: npm ci
      - run: npm run build
      - run: npm test

      - name: Publish
        run: npm publish --access public
        working-directory: ${{ steps.dir.outputs.dir }}
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Step 2: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: add npm publish workflow triggered by tags"
```

---

### Task 11: Verify build and tests pass

**Step 1: Run full build**

```bash
npm run build
```

Expected: All 4 packages build successfully.

**Step 2: Run all tests**

```bash
npm test
```

Expected: 114 tests passing across all packages.

**Step 3: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: No errors.

**Step 4: Verify npm pack output for each package**

```bash
cd packages/core && npm pack --dry-run
cd ../email-mcp && npm pack --dry-run
cd ../cal-mcp && npm pack --dry-run
cd ../card-mcp && npm pack --dry-run
```

Expected: Each pack includes only `dist/`, `package.json`, `README.md`, `LICENSE`. No source files, no test files.

---

### Task 12: Final commit and tag prep

**Step 1: Update CLAUDE.md Phase 4 status**

Change the Phase 4 line in CLAUDE.md to reflect that code is ready, pending npm account setup.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update Phase 4 status in CLAUDE.md"
```

**Step 3: Provide user with npm setup instructions**

Tell the user to:
1. Create npm account at https://npmjs.com
2. Create `@miguelarios` organization
3. Generate an automation access token
4. Add `NPM_TOKEN` secret in GitHub repo Settings → Secrets → Actions
5. Then push tags to trigger publishing:
   ```bash
   git tag pim-core/v0.1.0 && git push origin pim-core/v0.1.0
   # Wait for CI to complete, then:
   git tag email-mcp/v0.1.0 && git push origin email-mcp/v0.1.0
   git tag cal-mcp/v0.1.0 && git push origin cal-mcp/v0.1.0
   git tag card-mcp/v0.1.0 && git push origin card-mcp/v0.1.0
   ```
