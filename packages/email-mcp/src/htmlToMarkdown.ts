import { appendFileSync } from "node:fs";
import sanitize from "sanitize-html";
import TurndownService from "turndown";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "campaign_id",
  "emc",
  "instance_id",
  "nl",
  "regi_id",
  "segment_id",
  "user_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "__s",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
]);

export function cleanUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    let removed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) {
        url.searchParams.delete(key);
        removed = true;
      }
    }
    if (!removed) return urlStr;
    return url.toString();
  } catch {
    return urlStr;
  }
}

function isHiddenElement(style: string): boolean {
  const s = style.toLowerCase();
  if (!s.includes("display:none") && !s.includes("display: none")) {
    return false;
  }
  return (
    s.includes("height:0") ||
    s.includes("height: 0") ||
    s.includes("max-height:0") ||
    s.includes("max-height: 0") ||
    s.includes("overflow:hidden") ||
    s.includes("overflow: hidden") ||
    s.includes("opacity:0") ||
    s.includes("opacity: 0")
  );
}

export async function htmlToMarkdown(html: string): Promise<string> {
  // Step 1: Sanitize
  const clean = sanitize(html, {
    allowedTags: [
      "p",
      "br",
      "b",
      "i",
      "em",
      "strong",
      "a",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "table",
      "tr",
      "td",
      "th",
      "thead",
      "tbody",
      "blockquote",
      "pre",
      "code",
      "hr",
      "span",
      "div",
      "img",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt", "width", "height", "style"],
    },
    exclusiveFilter: (frame) => {
      // Remove tracking pixels
      if (frame.tag === "img") {
        const w = Number.parseInt(frame.attribs.width || "", 10);
        const h = Number.parseInt(frame.attribs.height || "", 10);
        if ((w >= 0 && w <= 1) || (h >= 0 && h <= 1)) return true;
        const style = frame.attribs.style || "";
        if (isHiddenElement(style)) return true;
      }
      // Remove hidden elements
      const style = frame.attribs?.style || "";
      if (style && isHiddenElement(style)) return true;
      return false;
    },
  });

  // Step 2: Convert to markdown
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
  });

  // Override list item rule to use single space after bullet marker
  td.addRule("listItem", {
    filter: "li",
    replacement: (content, _node, options) => {
      const marker = `${options.bulletListMarker} `;
      const indented = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n/gm, "\n    ");
      return `${marker}${indented}${content.match(/\n+$/) ? "\n\n" : "\n"}`;
    },
  });

  let markdown = td.turndown(clean);

  // Step 3: Replace images
  // ![alt](url) → [Image: alt], ![](url) → removed
  markdown = markdown.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => {
    return alt ? `[Image: ${alt}]` : "";
  });

  // Step 4: Resolve redirect URLs
  // Use ](url) pattern to catch nested brackets like [[Image: alt]](url)
  const urlPattern = /\]\((https?:\/\/[^)]+)\)/g;
  const urlMatches = [...markdown.matchAll(urlPattern)];
  if (urlMatches.length > 0) {
    const urls = [...new Set(urlMatches.map((m) => m[1]))];
    const resolved = await resolveUrls(urls);
    for (const [original, final] of resolved) {
      if (original !== final) {
        markdown = markdown.replaceAll(original, final);
      }
    }
  }

  // Step 5: Strip tracking params from all URLs
  markdown = markdown.replace(/\(https?:\/\/[^)]+\)/g, (match) => {
    const url = match.slice(1, -1); // remove parens
    return `(${cleanUrl(url)})`;
  });

  // Step 6: Post-process — collapse excessive newlines
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

  return markdown;
}

type FetchResult =
  | { url: string; resolved: string; status: "ok" }
  | { url: string; resolved: string; status: "timeout" }
  | { url: string; resolved: string; status: "error"; error: string };

const POOL_SIZE = 10;
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT = 10000;

async function fetchOne(
  url: string,
  timeoutMs: number,
  log: (msg: string) => void,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    if (url !== res.url) {
      log(`HEAD ${url} → ${res.url} (${elapsed}ms)`);
    }
    return { url, resolved: res.url, status: "ok" };
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    if (err instanceof Error && err.name === "AbortError") {
      log(`TIMEOUT ${url} after ${timeoutMs}ms (elapsed ${elapsed}ms, kept original)`);
      return { url, resolved: url, status: "timeout" };
    }
    const reason = err instanceof Error ? err.message : String(err);
    log(`ERROR ${url} ${reason} (${elapsed}ms, kept original)`);
    return { url, resolved: url, status: "error", error: reason };
  }
}

async function pooledResolve(
  urls: string[],
  concurrency: number,
  fetchFn: (url: string) => Promise<FetchResult>,
): Promise<FetchResult[]> {
  if (urls.length === 0) return [];

  const results: FetchResult[] = [];
  const queue = [...urls];
  const inFlight = new Map<Promise<FetchResult>, number>();

  function startNext(): void {
    if (queue.length === 0) return;
    const url = queue.shift()!;
    const promise = fetchFn(url)
      .then((result) => {
        inFlight.delete(promise);
        results.push(result);
        return result;
      })
      .catch((err) => {
        // Safety net — fetchOne should never reject, but guard against it
        inFlight.delete(promise);
        const fallback: FetchResult = { url, resolved: url, status: "error", error: String(err) };
        results.push(fallback);
        return fallback;
      });
    inFlight.set(promise, 1);
  }

  // Fill initial slots
  const initialBatch = Math.min(concurrency, queue.length);
  for (let i = 0; i < initialBatch; i++) {
    startNext();
  }

  // Process remaining URLs as slots free up
  while (inFlight.size > 0) {
    await Promise.race([...inFlight.keys()]);
    // Slot freed — fill it
    while (inFlight.size < concurrency && queue.length > 0) {
      startNext();
    }
  }

  return results;
}

async function resolveUrls(urls: string[]): Promise<Map<string, string>> {
  const debug = process.env.DEBUG_URL_RESOLVE === "1";
  const timeoutMs = debug
    ? Number.parseInt(process.env.URL_RESOLVE_TIMEOUT || String(DEFAULT_TIMEOUT), 10)
    : DEFAULT_TIMEOUT;
  const logFile = process.env.URL_RESOLVE_LOG || "/tmp/url-resolve.log";
  const log = debug
    ? (msg: string) => {
        const line = `[url-resolve] ${new Date().toISOString()} ${msg}\n`;
        try {
          appendFileSync(logFile, line);
        } catch {
          process.stderr.write(line);
        }
      }
    : (_msg: string) => {};

  const resolved = new Map<string, string>();

  const results = await pooledResolve(
    urls,
    POOL_SIZE,
    (url) => fetchOne(url, timeoutMs, log),
  );

  let resolvedCount = 0;
  let timeoutCount = 0;
  let errorCount = 0;

  for (const r of results) {
    resolved.set(r.url, r.resolved);
    if (r.status === "ok") resolvedCount++;
    else if (r.status === "timeout") timeoutCount++;
    else errorCount++;
  }

  if (debug) {
    log(
      `Summary: ${resolvedCount}/${urls.length} resolved, ${timeoutCount} timeout (${timeoutMs}ms), ${errorCount} errors`,
    );
  }

  return resolved;
}
