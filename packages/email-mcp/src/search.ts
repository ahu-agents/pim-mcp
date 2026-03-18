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
 *
 * Base criteria (address fields, dates, boolean flags, tags) are folded into
 * each tokenized criterion so every IMAP SEARCH call is fully self-contained.
 * Returns a plain object when there are no tokenized criteria, an array of
 * folded objects when there are tokenized criteria, or { all: true } for empty.
 */
export function buildSearchCriteria(
  params: SearchParams,
): Record<string, unknown> | Record<string, unknown>[] {
  const baseCriteria: Record<string, unknown> = {};
  const tokenizedCriteria: Record<string, unknown>[] = [];

  // Address fields → base criteria (no tokenization)
  const addressFields = ["from", "to", "cc", "bcc"] as const;
  for (const field of addressFields) {
    const value = params[field];
    if (value === undefined) continue;
    baseCriteria[field] = value;
  }

  // Date filters → base criteria
  if (params.since !== undefined) {
    baseCriteria.since = new Date(params.since);
  }
  if (params.before !== undefined) {
    baseCriteria.before = new Date(params.before);
  }

  // Boolean flags → base criteria
  if (params.unread !== undefined) {
    baseCriteria.seen = !params.unread;
  }
  if (params.flagged !== undefined) {
    baseCriteria.flagged = params.flagged;
  }

  // Attachment filter → base criteria
  if (params.hasAttachment === true) {
    baseCriteria.header = { "content-type": "multipart/mixed" };
  }

  // Tags → base criteria for single tag, tokenized for multiple (key collision)
  if (params.tags !== undefined) {
    if (params.tags.length === 1) {
      baseCriteria.keyword = params.tags[0];
    } else {
      for (const tag of params.tags) {
        tokenizedCriteria.push({ keyword: tag });
      }
    }
  }

  // Tokenized fields → subject/body/hasWords with NOT support
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
        tokenizedCriteria.push({ not: { [imapKey]: token.value } });
      } else {
        tokenizedCriteria.push({ [imapKey]: token.value });
      }
    }
  }

  // No criteria at all → match all
  const hasBase = Object.keys(baseCriteria).length > 0;
  if (!hasBase && tokenizedCriteria.length === 0) {
    return { all: true };
  }

  // Base only, no tokenized → return merged base
  if (tokenizedCriteria.length === 0) {
    return baseCriteria;
  }

  // Tokenized only, no base → check for duplicates
  if (!hasBase) {
    if (tokenizedCriteria.length === 1) {
      return tokenizedCriteria[0];
    }
    return tokenizedCriteria;
  }

  // Both base and tokenized → fold base into each tokenized criterion
  return tokenizedCriteria.map((tc) => ({ ...baseCriteria, ...tc }));
}
