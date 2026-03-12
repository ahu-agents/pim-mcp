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
  const urlPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  const urlMatches = [...markdown.matchAll(urlPattern)];
  if (urlMatches.length > 0) {
    const urls = [...new Set(urlMatches.map((m) => m[2]))];
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

async function resolveUrls(urls: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  await Promise.allSettled(
    urls.map(async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        resolved.set(url, res.url);
      } catch {
        clearTimeout(timeout);
        resolved.set(url, url); // keep original on error
      }
    }),
  );
  return resolved;
}
