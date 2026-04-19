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

export interface SocialProfile {
  type: string;
  handle?: string;
  url?: string;
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
  socialProfiles?: SocialProfile[];
  otherProperties: string[];
}

const TYPE_NOISE_TOKENS = new Set(["internet", "voice", "pref"]);

const APPLE_INTERNAL_PROPS = new Set([
  "PRODID",
  "REV",
  "PHOTO",
  "X-IMAGETYPE",
  "X-IMAGEHASH",
  "X-SHARED-PHOTO-DISPLAY-PREF",
  "X-ADDRESSING-GRAMMAR",
  "X-ABADR",
]);

/**
 * Strip Apple iOS "itemN." group prefix from a line.
 * Returns both the canonical line and the group id (or undefined).
 * "item1.ADR;type=HOME:..." -> { canonical: "ADR;type=HOME:...", group: "item1" }
 * "EMAIL:foo@bar" -> { canonical: "EMAIL:foo@bar", group: undefined }
 */
function stripItemPrefix(line: string): { canonical: string; group: string | undefined } {
  const match = /^(item\d+)\.(.+)$/i.exec(line);
  if (!match) return { canonical: line, group: undefined };
  return { canonical: match[2], group: match[1].toLowerCase() };
}

/**
 * Decode an Apple X-ABLabel value.
 * "_$!<HomePage>!$_" -> "homepage"
 * "School" -> "school"
 */
function decodeABLabel(raw: string): string {
  const wrapped = /^_\$!<(.+)>!\$_$/.exec(raw.trim());
  return (wrapped ? wrapped[1] : raw.trim()).toLowerCase();
}

/**
 * Build a map of group id (e.g. "item1") -> decoded X-ABLabel value.
 */
function buildAbLabelMap(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of lines) {
    const { canonical, group } = stripItemPrefix(rawLine);
    if (!group) continue;
    const upper = canonical.toUpperCase();
    if (!upper.startsWith("X-ABLABEL:") && !upper.startsWith("X-ABLABEL;")) continue;
    const colonIndex = canonical.indexOf(":");
    if (colonIndex === -1) continue;
    const decoded = decodeABLabel(canonical.slice(colonIndex + 1));
    if (decoded) map.set(group, decoded);
  }
  return map;
}

/**
 * Normalize a raw TYPE parameter value into a clean label.
 * - Splits on comma or semicolon
 * - Lowercases all tokens
 * - Strips surrounding double-quote characters (from TYPE="internet" RFC 6868 form)
 * - Drops noise tokens: internet, voice, pref
 * - Joins remaining tokens with "/"
 * Returns undefined when no meaningful token remains.
 */
export function normalizeType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const tokens = raw
    .split(/[,;]/)
    .map((tok) => tok.trim().replace(/^"|"$/g, "").toLowerCase())
    .filter((tok) => tok.length > 0 && !TYPE_NOISE_TOKENS.has(tok));
  if (tokens.length === 0) return undefined;
  return tokens.join("/");
}

export function parseVCard(data: string): Contact {
  const lines = unfoldLines(data);
  const abLabels = buildAbLabelMap(lines);

  const uid = extractFirst(lines, "UID") ?? "";
  const fullName = extractFirst(lines, "FN") ?? "";
  const n = extractFirst(lines, "N");
  const emails = extractTypedAll(lines, "EMAIL", abLabels);
  const phones = extractTypedAll(lines, "TEL", abLabels);
  const urls = extractTypedAll(lines, "URL", abLabels);
  const orgRaw = extractFirst(lines, "ORG");
  const organization = orgRaw ? orgRaw.split(";")[0].trim() || undefined : undefined;
  const title = extractFirst(lines, "TITLE");
  const note = extractFirst(lines, "NOTE");
  const role = extractFirst(lines, "ROLE");
  const nickname = extractFirst(lines, "NICKNAME");
  const birthday = extractFirst(lines, "BDAY");
  const categoriesRaw = extractFirst(lines, "CATEGORIES");
  const categories = categoriesRaw ? categoriesRaw.split(",").map((c) => c.trim()) : undefined;
  const socialProfiles = extractSocialProfiles(lines);

  const KNOWN = new Set([
    "BEGIN",
    "END",
    "VERSION",
    "UID",
    "FN",
    "N",
    "EMAIL",
    "TEL",
    "ORG",
    "TITLE",
    "NOTE",
    "ADR",
    "URL",
    "BDAY",
    "NICKNAME",
    "CATEGORIES",
    "ROLE",
    "X-ABLABEL",
    "X-SOCIALPROFILE",
  ]);
  const otherProperties: string[] = [];
  for (const rawLine of lines) {
    const { canonical: line } = stripItemPrefix(rawLine);
    const propName = line.split(/[:;]/)[0].toUpperCase();
    if (KNOWN.has(propName) || APPLE_INTERNAL_PROPS.has(propName)) continue;
    if (rawLine.trim()) {
      otherProperties.push(rawLine);
    }
  }

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
    addresses: extractAddresses(lines, abLabels),
    urls,
    organization,
    title,
    role,
    nickname,
    birthday,
    categories,
    note,
    socialProfiles: socialProfiles.length > 0 ? socialProfiles : undefined,
    otherProperties,
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
  if (contact.role) {
    lines.push(`ROLE:${contact.role}`);
  }
  if (contact.nickname) {
    lines.push(`NICKNAME:${contact.nickname}`);
  }
  if (contact.birthday) {
    lines.push(`BDAY:${contact.birthday}`);
  }
  if (contact.categories && contact.categories.length > 0) {
    lines.push(`CATEGORIES:${contact.categories.join(",")}`);
  }
  if (contact.note) {
    lines.push(`NOTE:${contact.note}`);
  }
  if (contact.socialProfiles) {
    for (const sp of contact.socialProfiles) {
      const parts: string[] = [`type=${sp.type}`];
      if (sp.handle) parts.push(`x-user=${sp.handle}`);
      const params = parts.join(";");
      const value = sp.url ?? (sp.handle ? `x-apple:${sp.handle}` : "");
      lines.push(`X-SOCIALPROFILE;${params}:${value}`);
    }
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
  for (const rawLine of lines) {
    const { canonical: line } = stripItemPrefix(rawLine);
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
function extractTypedAll(
  lines: string[],
  property: string,
  abLabels: Map<string, string>,
): TypedValue[] {
  const results: TypedValue[] = [];
  for (const rawLine of lines) {
    const { canonical: line, group } = stripItemPrefix(rawLine);
    const upper = line.toUpperCase();
    if (upper.startsWith(`${property}:`) || upper.startsWith(`${property};`)) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;
      const value = line.slice(colonIndex + 1).trim();
      const paramSection = line.slice(property.length, colonIndex);
      const typeMatches: string[] = [];
      for (const match of paramSection.matchAll(/TYPE=([^;:]+)/gi)) {
        typeMatches.push(match[1]);
      }
      const labelOverride = group ? abLabels.get(group) : undefined;
      const type = labelOverride ?? normalizeType(typeMatches.join(","));
      results.push(type ? { type, value } : { value });
    }
  }
  return results;
}

/** Extract ADR lines into PostalAddress objects */
function extractAddresses(lines: string[], abLabels: Map<string, string>): PostalAddress[] {
  const results: PostalAddress[] = [];
  for (const rawLine of lines) {
    const { canonical: line, group } = stripItemPrefix(rawLine);
    const upper = line.toUpperCase();
    if (!upper.startsWith("ADR:") && !upper.startsWith("ADR;")) continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const paramSection = line.slice(3, colonIndex);
    const typeMatches: string[] = [];
    for (const match of paramSection.matchAll(/TYPE=([^;:]+)/gi)) {
      typeMatches.push(match[1]);
    }
    const labelOverride = group ? abLabels.get(group) : undefined;
    const type = labelOverride ?? normalizeType(typeMatches.join(","));

    const parts = line.slice(colonIndex + 1).split(";");
    const streetParts = [parts[0], parts[1], parts[2]].filter(Boolean);
    const street = streetParts.join(", ") || undefined;
    const city = parts[3] || undefined;
    const state = parts[4] || undefined;
    const postalCode = parts[5] || undefined;
    const country = parts[6] || undefined;

    const addr: PostalAddress = {};
    if (type) addr.type = type;
    if (street) addr.street = street;
    if (city) addr.city = city;
    if (state) addr.state = state;
    if (postalCode) addr.postalCode = postalCode;
    if (country) addr.country = country;
    results.push(addr);
  }
  return results;
}

/** Extract X-SOCIALPROFILE lines into SocialProfile objects */
function extractSocialProfiles(lines: string[]): SocialProfile[] {
  const results: SocialProfile[] = [];
  for (const rawLine of lines) {
    const { canonical: line } = stripItemPrefix(rawLine);
    const upper = line.toUpperCase();
    if (!upper.startsWith("X-SOCIALPROFILE;") && !upper.startsWith("X-SOCIALPROFILE:")) continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const paramSection = line.slice("X-SOCIALPROFILE".length, colonIndex);
    const value = line.slice(colonIndex + 1).trim();

    const typeMatch = /type=([^;:]+)/i.exec(paramSection);
    const userMatch = /x-user=([^;:]+)/i.exec(paramSection);
    const type = typeMatch ? typeMatch[1].trim().toLowerCase() : "";
    if (!type) continue;

    const profile: SocialProfile = { type };
    if (userMatch) profile.handle = userMatch[1].trim();
    if (value && !/^x-apple:/i.test(value)) profile.url = value;
    results.push(profile);
  }
  return results;
}
