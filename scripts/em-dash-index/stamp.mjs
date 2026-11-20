// Writes the current totals into the static text that can't read data.json: the link-preview
// descriptions, the blurb on the landing page, and the source of the preview card image.

import fs from "node:fs";
import path from "node:path";

const COLORS = { Anthropic: "#e8622c", OpenAI: "#3987e5", Google: "#199e70", Mistral: "#c98500",
  Moonshot: "#9085e9", DeepSeek: "#d55181", Meta: "#008300", xAI: "#e66767" };

function edit(file, edits) {
  if (!fs.existsSync(file)) return;
  let s = fs.readFileSync(file, "utf8");
  for (const [re, to] of edits) {
    if (!re.test(s)) { console.log(`! stamp: nothing matched ${re} in ${path.basename(file)}`); continue; }
    s = s.replace(re, to);
  }
  fs.writeFileSync(file, s);
}

// Lone dashes standing for empty table cells count too; keep in step with COUNT_BLANK_CELLS in the page.
const COUNT_BLANK_CELLS = true;

export function stamp(root, data) {
  const posts = data.posts.map(p => ({ ...p, n: p.n + (COUNT_BLANK_CELLS ? p.blank || 0 : 0) })), total = posts.reduce((s, p) => s + p.n, 0);
  const labs = Object.entries(posts.reduce((m, p) => (m[p.lab] = (m[p.lab] || 0) + p.n, m), {})).sort((a, b) => b[1] - a[1]);
  if (!total) return;
  const pct = n => Math.round(n / total * 100);
  const anthropic = (labs.find(l => l[0] === "Anthropic") || [0, 0])[1];
  const since = data.since.slice(0, 4);

  const desc = `Every em dash in ${posts.length} AI model launch posts from ${labs.length} labs since ${since}, counted, ranked and updated daily. ${labs[0][0]} wrote ${pct(labs[0][1])}% of them.`;
  const alt = `The Em Dash Index: em dashes per lab across ${posts.length} AI launch posts. ${labs.slice(0, 4).map(([l, n]) => `${l} ${n}`).join(", ")}.`;
  const content = (attr, text) => [new RegExp(`(<meta ${attr} content=")[^"]*(">)`), `$1${text}$2`];

  edit(path.join(root, "em-dash-index/index.html"), [
    content('name="description"', desc), content('property="og:description"', desc),
    content('name="twitter:description"', desc), content('property="og:image:alt"', alt),
  ]);

  edit(path.join(root, "index.html"), [[
    /(<span class="d">Josh&rsquo;s em dash benchmark: )[\s\S]*?(<\/span>\s*<\/a>)/,
    `$1${posts.length} AI launch posts, ${labs.length} labs, ${total} em dashes, recounted daily. Anthropic wrote ${pct(anthropic)}% of them <span class="em">&mdash;</span> the same lab whose model wrote this page.$2`,
  ]]);

  edit(path.join(root, "og/em-dash-index.html"), [
    [/(<p class="dek">)[\s\S]*?(<\/p>)/, `$1Every em dash in ${posts.length} AI launch posts since ${since}, counted. <b>${labs[0][0]} wrote ${pct(labs[0][1])}% of them.</b>$2`],
    [/(const LABS = )\[.*\];/, `$1${JSON.stringify(labs.slice(0, 4).map(([l, n]) => [l, n, COLORS[l]]))};`],
  ]);
}
