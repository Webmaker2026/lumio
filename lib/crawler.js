// Sitemap -> oldalak -> tiszta szoveg. Nincs HTML parser, regex-szel dolgozunk.

const MAX_PAGES = 40;
const PER_PAGE_MAX_CHARS = 4000;
const REQUEST_DELAY_MS = 300;
const USER_AGENT = "LumioBot/1.0";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("html") && !contentType.includes("xml")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function stripTagBlock(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "gi");
  return html.replace(re, " ");
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function htmlToText(html) {
  let cleaned = html;
  for (const tag of ["script", "style", "nav", "footer", "header"]) {
    cleaned = stripTagBlock(cleaned, tag);
  }
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, " ");
  cleaned = cleaned.replace(/<[^>]+>/g, " ");
  cleaned = decodeEntities(cleaned);
  cleaned = cleaned.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return cleaned;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match) return decodeEntities(match[1]).replace(/\s+/g, " ").trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return htmlToText(h1[1]);
  return "";
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const re = /<a\s[^>]*href=["']([^"'#]+)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      const url = new URL(match[1], baseUrl);
      if (url.origin === new URL(baseUrl).origin && (url.protocol === "http:" || url.protocol === "https:")) {
        url.hash = "";
        links.add(url.toString());
      }
    } catch {
      // ervenytelen url, kihagyjuk
    }
  }
  return Array.from(links);
}

async function getSitemapUrls(startUrl) {
  try {
    const origin = new URL(startUrl).origin;
    const xml = await fetchText(`${origin}/sitemap.xml`);
    if (!xml) return null;
    const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/gi)).map((m) => m[1].trim());
    return locs.length ? locs : null;
  } catch {
    return null;
  }
}

export async function crawlSite(startUrl, maxTotalChars) {
  const sitemapUrls = await getSitemapUrls(startUrl);
  const useSitemap = Boolean(sitemapUrls && sitemapUrls.length);
  const queue = useSitemap ? sitemapUrls.slice(0, MAX_PAGES) : [startUrl];
  const visited = new Set();
  const blocks = [];
  const pages = [];
  let totalChars = 0;
  let truncated = false;

  let idx = 0;
  while (idx < queue.length && blocks.length < MAX_PAGES) {
    const url = queue[idx];
    idx++;
    if (!url || visited.has(url)) continue;
    visited.add(url);

    const html = await fetchText(url);
    if (idx < queue.length) await sleep(REQUEST_DELAY_MS);
    if (!html) continue;

    if (!useSitemap && queue.length < MAX_PAGES * 3) {
      for (const link of extractLinks(html, url)) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    }

    const title = extractTitle(html) || url;
    let text = htmlToText(html);
    if (!text) continue;
    if (text.length > PER_PAGE_MAX_CHARS) text = text.slice(0, PER_PAGE_MAX_CHARS);

    const block = `## ${title} (${url})\n\n${text}`;
    if (totalChars + block.length + 2 > maxTotalChars) {
      truncated = true;
      break;
    }

    blocks.push(block);
    pages.push({ url, title, chars: text.length });
    totalChars += block.length + 2;
  }

  return {
    text: blocks.join("\n\n"),
    pages,
    pageCount: pages.length,
    totalChars,
    truncated,
  };
}
