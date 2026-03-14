export function getTimezone(): string {
  const envTz = process.env.PIM_TIMEZONE;
  if (envTz?.trim()) return envTz.trim();
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatInTimezone(isoUtcString: string, timezone: string): string {
  const date = new Date(isoUtcString);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour") === "24" ? "00" : get("hour");
  const minute = get("minute");
  const second = get("second");
  const tzName = get("timeZoneName"); // e.g., "GMT-05:00" or "GMT+01:00"

  // Parse offset from tzName (format: "GMT±HH:MM" or "GMT" for UTC)
  const offsetMatch = tzName.match(/GMT([+-]\d{2}:\d{2})/);
  const offset = offsetMatch ? offsetMatch[1] : "+00:00";

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

export interface ParsedTimestamp {
  date: Date;
  isUTC: boolean;
  hasExplicitTimezone: boolean;
  offsetMinutes?: number;
}

export function parseTimestamp(timestamp: string): ParsedTimestamp {
  const date = new Date(timestamp);

  if (timestamp.endsWith("Z")) {
    return { date, isUTC: true, hasExplicitTimezone: false };
  }

  const offsetMatch = timestamp.match(/([+-])(\d{2}):(\d{2})$/);
  if (offsetMatch) {
    const sign = offsetMatch[1] === "+" ? 1 : -1;
    const hours = Number.parseInt(offsetMatch[2], 10);
    const minutes = Number.parseInt(offsetMatch[3], 10);
    return {
      date,
      isUTC: false,
      hasExplicitTimezone: true,
      offsetMinutes: sign * (hours * 60 + minutes),
    };
  }

  return { date, isUTC: false, hasExplicitTimezone: false };
}
