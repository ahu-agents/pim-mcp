# Contacts MCP Tools

`@miguelarios/card-mcp` — CardDAV contacts server with 6 tools.

## list_contacts

List or search contacts. Returns all contacts if no query provided, or filters by name/email/phone/org when query is given.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | | Search query to filter contacts by name, email, phone, or organization. |
| `addressBook` | string | | Address book URL. If omitted, uses the first available address book. |

## get_contact

Get full details of a single contact by UID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | yes | The unique identifier (UID) of the contact. |
| `addressBook` | string | | Address book URL. If omitted, uses the first available address book. |

## create_contact

Create a new contact with the specified details.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fullName` | string | yes | Full display name (e.g., "John Doe"). |
| `firstName` | string | | First/given name. |
| `lastName` | string | | Last/family name. |
| `emails` | object[] | | Email addresses. Each object: `value` (required), `type`. |
| `phones` | object[] | | Phone numbers. Each object: `value` (required), `type`. |
| `addresses` | object[] | | Postal addresses. Each object: `type`, `street`, `city`, `state`, `postalCode`, `country`. |
| `urls` | object[] | | URLs. Each object: `value` (required), `type`. |
| `organization` | string | | Company/organization name. |
| `title` | string | | Job title. |
| `role` | string | | Role/function within organization. |
| `nickname` | string | | Nickname. |
| `birthday` | string | | Birthday (YYYY-MM-DD). |
| `categories` | string[] | | Contact categories/tags. |
| `note` | string | | Free-text note. |
| `addressBook` | string | | Address book URL. If omitted, uses the first available address book. |

## update_contact

Update an existing contact. Only provided fields are changed (merge update). Omitted fields keep their current values.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | yes | The UID of the contact to update. |
| `fullName` | string | | New full display name. |
| `firstName` | string | | New first name. |
| `lastName` | string | | New last name. |
| `emails` | object[] | | New email addresses (replaces existing). Each object: `value` (required), `type`. |
| `phones` | object[] | | New phone numbers (replaces existing). Each object: `value` (required), `type`. |
| `addresses` | object[] | | New postal addresses (replaces existing). Each object: `type`, `street`, `city`, `state`, `postalCode`, `country`. |
| `urls` | object[] | | New URLs (replaces existing). Each object: `value` (required), `type`. |
| `organization` | string | | New organization. |
| `title` | string | | New job title. |
| `role` | string | | New role/function within organization. |
| `nickname` | string | | New nickname. |
| `birthday` | string | | New birthday (YYYY-MM-DD). |
| `categories` | string[] | | New contact categories/tags (replaces existing). |
| `note` | string | | New note. |
| `addressBook` | string | | Address book URL. If omitted, uses the first available address book. |

## delete_contact

Delete a contact by UID. This action cannot be undone.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | yes | The UID of the contact to delete. |
| `addressBook` | string | | Address book URL. If omitted, uses the first available address book. |

## resolve_contact

Given a person's name, find their email address. Returns the best match's full name and primary email. Use this for "send email to [name]" workflows.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Name to search for (partial matches allowed). |
| `addressBook` | string | | Address book URL. If omitted, uses the first available address book. |
