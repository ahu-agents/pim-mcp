export interface SearchParams {
  hasWords?: string;
  body?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  since?: string;
  before?: string;
  unread?: boolean;
  flagged?: boolean;
  hasAttachment?: boolean;
  tags?: string[];
}

interface ParsedToken {
  value: string;
  negated: boolean;
}

function parseTokens(value: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  const regex = /-?"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null = regex.exec(value);
  while (match !== null) {
    const raw = match[0];
    const isNegated = raw.startsWith("-");
    const text = match[1] || match[2];
    const cleaned = isNegated && !match[1] ? text.slice(1) : text;
    if (cleaned.length > 0) {
      tokens.push({ value: cleaned, negated: isNegated });
    }
    match = regex.exec(value);
  }
  return tokens;
}

/**
 * Build imapflow-compatible search criteria from structured params.
 * All params combine with AND logic.
 * Returns a plain object when all keys are unique, or an array of criteria
 * objects when there are duplicate keys (imapflow ANDs array elements).
 */
export function buildSearchCriteria(
  params: SearchParams,
): Record<string, unknown> | Record<string, unknown>[] {
  const criteria: Record<string, unknown>[] = [];

  // Address fields → literal substring match (no tokenization)
  const addressFields = ["from", "to", "cc", "bcc"] as const;
  for (const field of addressFields) {
    const value = params[field];
    if (value === undefined) continue;
    criteria.push({ [field]: value });
  }

  // Tokenized fields → tokenized (spaces = AND), quotes for exact phrase, - for NOT
  // subject → IMAP SUBJECT, body → IMAP BODY, hasWords → IMAP TEXT
  const tokenizedFields: Array<{ param: keyof SearchParams; imapKey: string }> = [
    { param: "subject", imapKey: "subject" },
    { param: "body", imapKey: "body" },
    { param: "hasWords", imapKey: "text" },
  ];
  for (const { param, imapKey } of tokenizedFields) {
    const value = params[param] as string | undefined;
    if (value === undefined) continue;
    const tokens = parseTokens(value);
    for (const token of tokens) {
      if (token.negated) {
        criteria.push({ not: { [imapKey]: token.value } });
      } else {
        criteria.push({ [imapKey]: token.value });
      }
    }
  }

  // Date filters
  if (params.since !== undefined) {
    criteria.push({ since: new Date(params.since) });
  }
  if (params.before !== undefined) {
    criteria.push({ before: new Date(params.before) });
  }

  // Boolean flags
  if (params.unread !== undefined) {
    criteria.push({ seen: !params.unread });
  }
  if (params.flagged !== undefined) {
    criteria.push({ flagged: params.flagged });
  }

  // Attachment filter
  if (params.hasAttachment === true) {
    criteria.push({ header: { "content-type": "multipart/mixed" } });
  }

  // Tags (IMAP keywords)
  if (params.tags !== undefined) {
    for (const tag of params.tags) {
      criteria.push({ keyword: tag });
    }
  }

  // No criteria → match all
  if (criteria.length === 0) {
    return { all: true };
  }

  // Single criterion → return directly
  if (criteria.length === 1) {
    return criteria[0];
  }

  // Multiple criteria → try to merge into a flat object (imapflow ANDs top-level keys).
  // If any key appears more than once, return the array instead — imapflow ANDs array elements.
  const seenKeys = new Set<string>();
  let hasDuplicateKey = false;
  let hasNotCriterion = false;
  for (const c of criteria) {
    for (const key of Object.keys(c)) {
      if (key === "not") {
        hasNotCriterion = true;
      }
      if (seenKeys.has(key)) {
        hasDuplicateKey = true;
        break;
      }
      seenKeys.add(key);
    }
    if (hasDuplicateKey) break;
  }
  // If there are both "not" criteria and other criteria, always return array
  // form to avoid merging semantically distinct criteria into one object.
  if (hasNotCriterion && criteria.length > 1) {
    hasDuplicateKey = true;
  }

  if (hasDuplicateKey) {
    return criteria;
  }

  const merged: Record<string, unknown> = {};
  for (const c of criteria) {
    Object.assign(merged, c);
  }
  return merged;
}
