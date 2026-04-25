import ICAL from "ical.js";

export function normalizeRecurrenceRule(rule: string): string | null {
  if (typeof rule !== "string") return null;
  let trimmed = rule.trim();
  if (!trimmed) return null;
  if (/^RRULE:/i.test(trimmed)) trimmed = trimmed.slice(6).trim();
  if (/[\r\n]/.test(trimmed)) return null;
  try {
    const recur = ICAL.Recur.fromString(trimmed);
    // Ensure it has a FREQ property to be valid
    if (!recur.freq) return null;
  } catch {
    return null;
  }
  return trimmed;
}
