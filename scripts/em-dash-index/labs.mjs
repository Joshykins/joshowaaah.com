// Where each lab publishes, and what counts as a model launch post there.
//
// discover()  lists candidate posts: [{ url, title?, date? }]
// slug        the URL must match this
// family      if set, the title must also read as "<model name>" or "<model name>: tagline"
//             (see isLaunch); labs whose URLs are tidy enough rely on slug alone
// date()      the publish date, when the feed doesn't carry one
// root        which element holds the article body, if not <article>
//
// Anything these rules get wrong is fixed by hand in overrides.json.

import { rssItems, sitemapUrls, pageLinks, declaredDate, printedDate, articleText, iso } from "./lib.mjs";

const clean = t => t.replace(/[\u2011\u2010]/g, "-").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

const LEAD = /^(?:introducing|announcing|meet|hello|releasing|presenting|we[\u2019']re (?:announcing|introducing|launching|releasing))\s+/i;
const STOP = /\b(?:for|in|on|with|to|at|from|by|how|why|helps?|can|gets?|lets?|says?|now|available|expands?|brings?|updates?|updated|powers?|the|of|a|an|system card|model card|addendum|bounty)\b/i;

// The model name at the front of a title: "Introducing GPT-6 Sol and Luna" -> "GPT-6 Sol and Luna",
// "Gemini 4 Carbon: our next frontier model" -> "Gemini 4 Carbon".
export function head(title) {
  return clean(title).replace(/\s*\|.*$/, "").replace(LEAD, "").replace(/^(?:the|our)\s+/i, "")
    .split(/[:,\u2014]| [\u2013-] | is (?:here|now )|\s\(/)[0].replace(/\s+(?:GA )?Release$/i, "").trim();
}

// "mistral-small-3-1" -> "Mistral Small 3.1", for labs whose titles are taglines.
export function slugName(url) {
  const slug = url.replace(/\/+$/, "").split("/").pop();
  return slug.replace(/(\d)-(?=\d)/g, "$1.").split("-")
    .map(w => /^(?:ocr|tts|oss|api)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function isLaunch(title, { family, versionless }) {
  const h = head(title);
  return new RegExp(`^(?:${family})(?![\\w-])`, "i").test(h) && (versionless || /\d/.test(h))
    && !STOP.test(h) && h.split(" ").length <= 8;
}

export const LABS = {
  Anthropic: {
    discover: () => sitemapUrls("https://www.anthropic.com/sitemap.xml"),
    slug: /^https:\/\/www\.anthropic\.com\/(?:claude-[a-z-]+-\d[\d-]*|news\/claude-(?:(?:opus|sonnet|haiku|instant|fable|mythos)-)?\d[\w-]*)$/,
    date: html => {
      const eyebrow = html.match(/class="eyebrow"[^>]*>(?:\s*<time[^>]*>)?([^<]+)/);
      return iso((html.match(/<time[^>]*dateTime="([^"]+)"/i) || [])[1]) || (eyebrow && printedDate(eyebrow[1])) || declaredDate(html)
        || printedDate((html.match(/<main[\s\S]{0,6000}/i) || [""])[0].replace(/<[^>]+>/g, " "));
    },
  },
  OpenAI: {
    discover: () => rssItems("https://openai.com/news/rss.xml"),
    slug: /^https:\/\/openai\.com\/index\//,
    family: "(?:OpenAI )?(?:GPT-?\\d[\\w.-]*|GPT-[A-Za-z]+-?\\d[\\w.-]*|o\\d[\\w-]*|Sora|(?:ChatGPT )?Images|DALL\u00b7E|4o Image Generation)",
  },
  Google: {
    discover: () => sitemapUrls("https://blog.google/sitemap.xml", u => /\/models-and-research\/(?:gemini-models|google-deepmind)\/[^/]+\/$/.test(u)),
    slug: /^https:\/\/blog\.google\/innovation-and-ai\/models-and-research\/(?:gemini-models|google-deepmind)\/[^/]+\/$/,
    family: "(?:Gemini|Gemma|Genie|Veo|Imagen|Lyria|Nano Banana|WeatherNext|EmbeddingGemma)",
  },
  xAI: {
    discover: () => sitemapUrls("https://x.ai/sitemap.xml"),
    slug: /^https:\/\/x\.ai\/news\/grok-(?:(?:code|voice|imagine|imagine-image|imagine-video|build|bot)-)?(?:(?:think-)?fast-)?\d[\d.-]*(?:v|-fast)?$/,
    root: "body",
  },
  Mistral: {
    discover: () => sitemapUrls("https://mistral.ai/sitemap.xml"),
    slug: /^https:\/\/mistral\.ai\/news\/(?:mistral-(?:large|medium|small|nemo|saba|ocr|\d)[\w-]*|mixtral-[\w-]+|pixtral-[\w-]+|ministraux|(?!mistral)[a-z]+stral(?:-[\w-]+)?)\/$/,
    nameFromSlug: true,
  },
  Meta: {
    discover: () => sitemapUrls("https://about.fb.com/sitemap.xml", u => /\/news\/20\d\d\/\d\d\/[^/]*(?:llama|muse)[^/]*\/$/.test(u)),
    slug: /^https:\/\/about\.fb\.com\/news\/20\d\d\/\d\d\/[^/]*(?:llama|muse)[^/]*\/$/,
    family: "(?:Code )?Llama|Muse [A-Z]\\w+",
    versionless: true,
    root: "main",
  },
  Moonshot: {
    discover: () => pageLinks("https://www.kimi.com/en/blog"),
    slug: /^https:\/\/www\.kimi\.com\/en\/blog\/kimi-k\d[\w-]*$/,
    // the date printed on the post, else the earliest date in the page's data
    date: html => printedDate(articleText(html, "main").text.slice(0, 3000)) || declaredDate(html)
      || (html.match(/\b20(?:2[3-9]|3\d)-[01]\d-[0-3]\d\b/g) || []).sort()[0] || "",
    root: "main",
  },
  DeepSeek: {
    discover: () => sitemapUrls("https://api-docs.deepseek.com/sitemap.xml"),
    slug: /^https:\/\/api-docs\.deepseek\.com\/news\/news\d{4,6}$/,
    family: "DeepSeek[- ]?(?:V|R)\\d[\\w.-]*",
    // news260910 -> 2026-09-10; the four-digit ones (news0725) are from 2024
    date: (html, url) => { const d = url.match(/news(\d\d)?(\d\d)(\d\d)$/); return d ? `20${d[1] || "24"}-${d[2]}-${d[3]}` : ""; },
  },
};
