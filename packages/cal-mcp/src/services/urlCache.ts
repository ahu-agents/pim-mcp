import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CachedObject {
  url: string;
  etag?: string;
}

type CacheShape = Record<string, Record<string, CachedObject>>;

// Persistent UID→URL cache keyed by calendar_id. Used by findCalendarObject
// so get/update/delete can target a single event instead of scanning the
// entire calendar. Primary driver: Mailbox.org's CalDAV ignores UID prop-
// filters on calendar-query REPORTs and returns every object (observed:
// 1127 objects / 107s on a real calendar).
//
// Cache is shared across MCP processes via a JSON file at
// $XDG_CACHE_HOME/cal-mcp/urls.json (falls back to ~/.cache/cal-mcp/urls.json).
// No TTL — entries are refreshed on every successful touch and invalidated
// on delete. Small footprint per entry (~120 bytes).

function cachePath(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "cal-mcp", "urls.json");
}

function readCache(): CacheShape {
  try {
    const raw = readFileSync(cachePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as CacheShape;
    return {};
  } catch {
    return {};
  }
}

function writeCache(cache: CacheShape): void {
  const path = cachePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache), { mode: 0o600 });
  } catch {
    // Ignore cache write failures — cache is an optimization, not a source
    // of truth. Don't let disk errors break the tool call.
  }
}

export function getCachedObject(calendarId: string, uid: string): CachedObject | null {
  const cache = readCache();
  return cache[calendarId]?.[uid] ?? null;
}

export function setCachedObject(calendarId: string, uid: string, obj: CachedObject): void {
  const cache = readCache();
  if (!cache[calendarId]) cache[calendarId] = {};
  cache[calendarId][uid] = obj;
  writeCache(cache);
}

export function deleteCachedObject(calendarId: string, uid: string): void {
  const cache = readCache();
  if (cache[calendarId]?.[uid]) {
    delete cache[calendarId][uid];
    writeCache(cache);
  }
}
