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
