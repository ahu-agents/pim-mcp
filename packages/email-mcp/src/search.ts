export interface SearchParams {
  query?: string;
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

/**
 * Parse a string value into tokens, respecting quoted phrases.
 * "dinner movie" → ["dinner", "movie"]
 * '"dinner movie"' → ["dinner movie"]
 * 'hello "exact phrase" world' → ["hello", "exact phrase", "world"]
 */
function parseTokens(value: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    tokens.push(match[1] || match[2]);
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

  // Simple string fields → IMAP search keys
  const stringFields = ["from", "to", "cc", "bcc", "subject", "body"] as const;
  for (const field of stringFields) {
    const value = params[field];
    if (value === undefined) continue;
    const tokens = parseTokens(value);
    for (const token of tokens) {
      criteria.push({ [field]: token });
    }
  }

  // query → OR(subject, body) for each positive term, NOT(body) for -terms
  if (params.query !== undefined) {
    const tokens = parseTokens(params.query);
    const positive: string[] = [];
    const negative: string[] = [];
    for (const token of tokens) {
      if (token.startsWith("-") && token.length > 1) {
        negative.push(token.slice(1));
      } else {
        positive.push(token);
      }
    }
    for (const term of positive) {
      criteria.push({ or: [{ subject: term }, { body: term }] });
    }
    for (const term of negative) {
      criteria.push({ not: { body: term } });
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
  for (const c of criteria) {
    for (const key of Object.keys(c)) {
      if (seenKeys.has(key)) {
        hasDuplicateKey = true;
        break;
      }
      seenKeys.add(key);
    }
    if (hasDuplicateKey) break;
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
