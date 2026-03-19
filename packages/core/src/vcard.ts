export interface TypedValue {
  type?: string;
  value: string;
}

export interface PostalAddress {
  type?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Contact {
  uid: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  emails: TypedValue[];
  phones: TypedValue[];
  addresses: PostalAddress[];
  urls: TypedValue[];
  organization?: string;
  title?: string;
  role?: string;
  nickname?: string;
  birthday?: string;
  categories?: string[];
  note?: string;
  otherProperties: string[];
}

export function parseVCard(data: string): Contact {
  const lines = unfoldLines(data);

  const uid = extractFirst(lines, "UID") ?? "";
  const fullName = extractFirst(lines, "FN") ?? "";
  const n = extractFirst(lines, "N");
  const emails = extractTypedAll(lines, "EMAIL");
  const phones = extractTypedAll(lines, "TEL");
  const urls = extractTypedAll(lines, "URL");
  const organization = extractFirst(lines, "ORG");
  const title = extractFirst(lines, "TITLE");
  const note = extractFirst(lines, "NOTE");

  let firstName: string | undefined;
  let lastName: string | undefined;
  if (n) {
    const parts = n.split(";");
    lastName = parts[0] || undefined;
    firstName = parts[1] || undefined;
  }

  return {
    uid,
    fullName,
    firstName,
    lastName,
    emails,
    phones,
    addresses: [],
    urls,
    organization,
    title,
    note,
    otherProperties: [],
  };
}

export function buildVCard(contact: Contact): string {
  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `UID:${contact.uid}`,
    `FN:${contact.fullName}`,
  ];

  if (contact.lastName || contact.firstName) {
    lines.push(`N:${contact.lastName ?? ""};${contact.firstName ?? ""};;;`);
  }

  for (const email of contact.emails) {
    lines.push(email.type ? `EMAIL;TYPE=${email.type}:${email.value}` : `EMAIL:${email.value}`);
  }
  for (const phone of contact.phones) {
    lines.push(phone.type ? `TEL;TYPE=${phone.type}:${phone.value}` : `TEL:${phone.value}`);
  }
  for (const url of contact.urls) {
    lines.push(url.type ? `URL;TYPE=${url.type}:${url.value}` : `URL:${url.value}`);
  }
  for (const addr of contact.addresses) {
    const parts = [
      "",
      "",
      addr.street ?? "",
      addr.city ?? "",
      addr.state ?? "",
      addr.postalCode ?? "",
      addr.country ?? "",
    ];
    const line = addr.type ? `ADR;TYPE=${addr.type}:${parts.join(";")}` : `ADR:${parts.join(";")}`;
    lines.push(line);
  }
  if (contact.organization) {
    lines.push(`ORG:${contact.organization}`);
  }
  if (contact.title) {
    lines.push(`TITLE:${contact.title}`);
  }
  if (contact.note) {
    lines.push(`NOTE:${contact.note}`);
  }
  for (const raw of contact.otherProperties) {
    lines.push(raw);
  }

  lines.push("END:VCARD");
  return lines.join("\r\n");
}

/** Unfold continuation lines per RFC 6350 */
function unfoldLines(data: string): string[] {
  return data
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

/** Extract first matching property value (ignoring parameters like ;TYPE=HOME) */
function extractFirst(lines: string[], property: string): string | undefined {
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith(`${property}:`) || upper.startsWith(`${property};`)) {
      const colonIndex = line.indexOf(":");
      if (colonIndex !== -1) {
        return line.slice(colonIndex + 1).trim();
      }
    }
  }
  return undefined;
}

/** Extract all values for a property with optional TYPE parameter */
function extractTypedAll(lines: string[], property: string): TypedValue[] {
  const results: TypedValue[] = [];
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith(`${property}:`) || upper.startsWith(`${property};`)) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;
      const value = line.slice(colonIndex + 1).trim();
      const paramSection = line.slice(property.length, colonIndex);
      const types: string[] = [];
      for (const match of paramSection.matchAll(/TYPE=([^;,\s]+)/gi)) {
        types.push(match[1].toLowerCase().trim());
      }
      const type = types.length > 0 ? types.join(",") : undefined;
      results.push(type ? { type, value } : { value });
    }
  }
  return results;
}

/** Extract all values for a property (e.g., multiple EMAIL lines) */
function extractAll(lines: string[], property: string): string[] {
  const results: string[] = [];
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith(`${property}:`) || upper.startsWith(`${property};`)) {
      const colonIndex = line.indexOf(":");
      if (colonIndex !== -1) {
        results.push(line.slice(colonIndex + 1).trim());
      }
    }
  }
  return results;
}
