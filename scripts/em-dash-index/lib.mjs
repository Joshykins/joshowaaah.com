// Fetching and counting for the Em Dash Index. No dependencies; needs Node 20+ and curl.

import { execFile } from "node:child_process";

// Says what it is. A site that turns it away is retried with curl, then read from the Wayback Machine.
const UA = "Mozilla/5.0 (compatible; launch-post-punctuation-counter/1.0)";
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const good = s => s >= 200 && s < 300;

async function viaFetch(url, timeout) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: ACCEPT, "accept-language": "en-US,en;q=0.9" },
      redirect: "follow", signal: AbortSignal.timeout(timeout),
    });
    return res.ok ? { ok: true, status: res.status, text: await res.text() } : { ok: false, status: res.status, text: "" };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: String(e.message || e) };
  }
}

// Some hosts accept one HTTP client and refuse another, so curl is the second attempt.
function viaCurl(url, timeout) {
  return new Promise(resolve => {
    const args = ["-sL", "--compressed", "-m", String(Math.ceil(timeout / 1000)), "-A", UA,
      "-H", `accept: ${ACCEPT}`, "-H", "accept-language: en-US,en;q=0.9", "-w", "\n%{http_code}", url];
    execFile("curl", args, { maxBuffer: 128 * 1024 * 1024, encoding: "utf8" }, (err, out = "") => {
      if (err) return resolve({ ok: false, status: 0, text: "", error: String(err.message || err) });
      const cut = out.lastIndexOf("\n"), status = +out.slice(cut + 1);
      resolve({ ok: good(status), status, text: good(status) ? out.slice(0, cut) : "" });
    });
  });
}

export async function get(url, { timeout = 45000, tries = 2 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await viaFetch(url, timeout);
    if (last.ok) return last;
    const c = await viaCurl(url, timeout);
    if (c.ok) return c;
    if (c.status) last = c;
    if ([401, 403, 404, 410].includes(last.status)) return last; // an answer, not a blip
    await sleep(1500 * (i + 1));
  }
  return last;
}

// Fetch a page. If the site refuses, read the Wayback Machine's stored copy instead
// (the "id_" form returns the page exactly as it was archived).
export async function getPage(url) {
  const r = await get(url);
  if (r.ok) return { ...r, via: "origin" };
  if (![401, 403, 429].includes(r.status)) return r;
  const w = await get(`https://web.archive.org/web/2id_/${url}`, { timeout: 90000 });
  if (w.ok) return { ...w, via: "wayback" };
  // Not archived yet: ask for a snapshot so a later run can read it.
  await get(`https://web.archive.org/save/${url}`, { timeout: 30000, tries: 1 });
  return { ok: false, status: r.status, text: "", error: "refused by the site and not in the Wayback Machine yet" };
}

// Text -----------------------------------------------------------------------------------------

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", middot: "\u00b7", shy: "", zwj: "", zwnj: "" };
export const decode = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => (n in ENT ? ENT[n] : m));

const strip = (html, tags) => tags.reduce((h, t) =>
  h.replace(new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?</${t}\\s*>`, "gi"), " "), html);

// Every outermost <tag>...</tag> block, matching nested tags of the same name.
function blocks(html, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  const out = [];
  let depth = 0, start = -1, m;
  while ((m = re.exec(html))) {
    if (!m[1]) { if (depth++ === 0) start = m.index; }
    else if (depth > 0 && --depth === 0) out.push(html.slice(start, m.index + m[0].length));
  }
  return out;
}

const toText = html => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const countWords = t => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019.,%$-]*/gu) || []).length;

// The article body as plain text. `root` picks the element: the <article> holding the most
// text by default, falling back to <main>, then <body>. Scripts, navigation, headers outside
// the article, footers, asides and buttons are removed.
const CHROME = ["nav", "footer", "aside", "button", "dialog"];
// An element holding nothing but an em dash is a placeholder (an empty table cell), not
// punctuation. Those are swapped for a marker and counted separately.
const BLANK = "\u0001";
const LONE_DASH = /<(td|th|span|div|p|li|dd)\b[^>]*>(?:\s|&nbsp;|<[^>]+>)*(?:—|&mdash;|&#8212;|&#x2014;)(?:\s|&nbsp;|<[^>]+>)*<\/\1>/gi;
export function articleText(html, root = "article") {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ");
  h = strip(h, ["script", "style", "noscript", "template", "svg", "iframe", "select", "form"]);
  h = h.replace(LONE_DASH, ` ${BLANK} `);
  const pick = (tag, extra = []) => blocks(h, tag).map(b => toText(strip(b, [...CHROME, ...extra])))
    .sort((a, b) => b.length - a.length)[0] || "";
  for (const tag of ["article", "main", "body"].slice(["article", "main", "body"].indexOf(root))) {
    const text = pick(tag, tag === "article" ? [] : ["header"]);
    if (text.length >= 600) return { text, root: tag };
  }
  return { text: toText(strip(h, [...CHROME, "header"])), root: "page" };
}

export function measure(html, root) {
  const a = articleText(html, root);
  return { n: (a.text.match(/\u2014/g) || []).length, blank: a.text.split(BLANK).length - 1, words: countWords(a.text), root: a.root };
}

// Page metadata --------------------------------------------------------------------------------

const meta = (html, key) => {
  for (const t of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!new RegExp(`(?:property|name|itemprop)=["']${key}["']`, "i").test(t)) continue;
    const c = t.match(/content=(?:"([^"]*)"|'([^']*)')/i);
    if (c) return decode(c[1] ?? c[2]).trim();
  }
  return "";
};

export const iso = s => { const d = new Date(s); return s && !isNaN(d) ? d.toISOString().slice(0, 10) : ""; };

// "September 22, 2026" or "22 September 2026" anywhere in a string.
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
export function printedDate(text) {
  const m = text.match(new RegExp(`\\b(${MONTHS})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (20\\d\\d)\\b`));
  if (m) return iso(`${m[1].slice(0, 3)} ${m[2]}, ${m[3]} UTC`);
  const e = text.match(new RegExp(`\\b(\\d{1,2}) (${MONTHS})\\.?,? (20\\d\\d)\\b`));
  return e ? iso(`${e[2].slice(0, 3)} ${e[1]}, ${e[3]} UTC`) : "";
}

// The publish date a page declares about itself, in its meta tags or structured data.
export function declaredDate(html) {
  for (const k of ["article:published_time", "og:article:published_time", "datePublished", "publish-date", "parsely-pub-date"]) {
    const d = iso(meta(html, k)); if (d) return d;
  }
  const ld = html.match(/\\?"datePublished\\?"\s*:\s*\\?"([^"\\]+)/);
  return ld ? iso(ld[1]) : "";
}

export function pageTitle(html) {
  const t = meta(html, "og:title") || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  return t.replace(/\s+/g, " ").trim();
}

// Feeds ----------------------------------------------------------------------------------------

const cdata = s => decode(s.replace("<![CDATA[", "").replace("]]>", "")).trim();
const inner = (s, t) => {
  const m = s.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, "i"));
  return m ? cdata(m[1]) : "";
};

export async function rssItems(url) {
  const r = await get(url);
  if (!r.ok) throw new Error(`feed ${url}: HTTP ${r.status} ${r.error || ""}`);
  return [...r.text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m => ({
    url: inner(m[1], "link"), title: inner(m[1], "title"), date: iso(inner(m[1], "pubDate")),
  }));
}

export async function sitemapUrls(url, keep = () => true, depth = 0) {
  const r = await get(url);
  if (!r.ok) throw new Error(`sitemap ${url}: HTTP ${r.status} ${r.error || ""}`);
  if (/<sitemapindex/i.test(r.text) && depth < 2) {
    const subs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decode(m[1]));
    const out = [];
    for (const s of subs) out.push(...await sitemapUrls(s, keep, depth + 1).catch(() => []));
    return out;
  }
  return [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => ({ url: decode(m[1]) })).filter(x => keep(x.url));
}

// Links on an index page, made absolute.
export async function pageLinks(url, keep = () => true) {
  const r = await get(url);
  if (!r.ok) throw new Error(`index ${url}: HTTP ${r.status} ${r.error || ""}`);
  const out = new Set();
  for (const m of r.text.matchAll(/href=["']([^"'#?]+)/gi)) {
    try { const abs = new URL(decode(m[1]), url).href; if (keep(abs)) out.add(abs); } catch {}
  }
  return [...out].map(u => ({ url: u }));
}
