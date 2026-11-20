#!/usr/bin/env node
// Finds new AI model launch posts, counts their em dashes, and rewrites em-dash-index/data.json.
//
//   node scripts/em-dash-index/update.mjs            look for new posts, recount recent ones
//   node scripts/em-dash-index/update.mjs --recount  recount every post
//   node scripts/em-dash-index/update.mjs --retry    look again at posts skipped on earlier runs
//   node scripts/em-dash-index/update.mjs --lab=xAI  one lab only
//   node scripts/em-dash-index/update.mjs --dry      print what would change, write nothing

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPage, measure, pageTitle, declaredDate } from "./lib.mjs";
import { LABS, head, isLaunch, slugName } from "./labs.mjs";
import { stamp } from "./stamp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const DATA = path.join(ROOT, "em-dash-index/data.json");
const SEEN = path.join(HERE, "seen.json");
const OVERRIDES = path.join(HERE, "overrides.json");

const SINCE = "2023-01-01";   // nothing older is tracked
const RECOUNT_DAYS = 21;      // launch posts get edited in their first weeks
const MIN_WORDS = 100;        // fewer than this and the fetch probably got a shell page
const MAX_TRIES = 5;          // then stop asking for a page that never reads properly
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const args = process.argv.slice(2);
const flag = f => args.includes(`--${f}`);
const onlyLab = (args.find(a => a.startsWith("--lab=")) || "").slice(6);

const read = (f, fallback) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback;
const key = u => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
const today = new Date().toISOString().slice(0, 10);
const daysAgo = d => (Date.parse(today) - Date.parse(d)) / 864e5;

const data = read(DATA, { posts: [] });
const seen = read(SEEN, {});
const overrides = read(OVERRIDES, { include: [], exclude: [], names: {} });
const before = JSON.stringify(data.posts);

const posts = new Map(data.posts.map(p => [key(p.url), p]));
const excluded = new Set(overrides.exclude.map(key));
const forced = new Map(overrides.include.map(o => [key(o.url), o]));
const names = new Map(Object.entries(overrides.names || {}).map(([u, n]) => [key(u), n]));
const log = [];

// A post dropped by hand stays dropped.
for (const k of excluded) if (posts.delete(k)) log.push(`- removed (excluded): ${k}`);

async function count(lab, url) {
  const page = await getPage(url);
  if (!page.ok) return { error: `HTTP ${page.status} ${page.error || ""}`.trim() };
  const m = measure(page.text, LABS[lab].root);
  return { ...m, html: page.text, via: page.via, error: m.words < MIN_WORDS ? `only ${m.words} words found` : "" };
}

function nameFor(lab, title, url, date) {
  const name = names.get(key(url)) || (LABS[lab].nameFromSlug ? slugName(url) : head(title)) || title;
  const clash = [...posts.values()].some(p => p.lab === lab && p.name === name && key(p.url) !== key(url));
  return clash ? `${name} (${MON[+date.slice(5, 7) - 1]} ${date.slice(0, 4)})` : name;
}

async function consider(lab, cand) {
  const cfg = LABS[lab], k = key(cand.url), force = forced.get(k);
  if (posts.has(k) || excluded.has(k)) return;
  if (!force) {
    if (!cfg.slug.test(cand.url)) return;
    if (seen[k] && !flag("retry") && !(seen[k].tries < MAX_TRIES)) return;
    if (cand.date && cand.date < SINCE) return;
    if (cfg.family && cand.title && !isLaunch(cand.title, cfg)) { seen[k] = { lab, title: cand.title, why: "title" }; return; }
  }
  const c = await count(lab, cand.url);
  const title = c.html ? force?.name || cand.title || pageTitle(c.html) : cand.title || "";
  if (c.html && !force && cfg.family && !isLaunch(title, cfg)) { seen[k] = { lab, title, why: "title" }; return; }
  if (c.error) {
    const tries = (seen[k]?.tries || 0) + 1;
    seen[k] = { lab, title, why: c.error, tries };
    log.push(`! ${lab}: could not read ${cand.url} (${c.error}); ${tries < MAX_TRIES ? "will retry" : "giving up, use --retry to look again"}`);
    return;
  }
  delete seen[k];
  const date = force?.date || cand.date || cfg.date?.(c.html, cand.url) || declaredDate(c.html);
  if (!date) { log.push(`! ${lab}: no publish date found for ${cand.url}; add it to overrides.json`); return; }
  if (date < SINCE) { seen[k] = { lab, title, why: "before " + SINCE }; return; }
  const post = { lab, name: force?.name || nameFor(lab, title, cand.url, date), date, n: c.n, blank: c.blank, words: c.words, url: cand.url };
  posts.set(k, post);
  log.push(`+ ${lab}: ${post.name} (${date}) ${c.n} em dashes in ${c.words} words${c.via === "wayback" ? " [via Wayback]" : ""}`);
}

async function runLab(lab) {
  let cands = [];
  try { cands = await LABS[lab].discover(); }
  catch (e) { log.push(`! ${lab}: discovery failed (${e.message})`); }
  for (const o of overrides.include.filter(o => o.lab === lab)) cands.push({ url: o.url });
  for (const c of cands) await consider(lab, c);

  // Recount recent posts (or all of them), since launch posts are edited after they go up.
  for (const p of [...posts.values()].filter(p => p.lab === lab && (flag("recount") || daysAgo(p.date) <= RECOUNT_DAYS))) {
    const c = await count(lab, p.url);
    if (c.error) { log.push(`! ${lab}: could not recount ${p.name} (${c.error})`); continue; }
    if (c.n !== p.n || c.words !== p.words || c.blank !== p.blank) {
      log.push(`~ ${lab}: ${p.name} ${p.n} -> ${c.n} em dashes, ${p.blank ?? "?"} -> ${c.blank} blank cells, ${p.words} -> ${c.words} words`);
      Object.assign(p, { n: c.n, blank: c.blank, words: c.words });
    }
  }
}

await Promise.all(Object.keys(LABS).filter(l => !onlyLab || l === onlyLab).map(runLab));

for (const [k, n] of names) if (posts.has(k)) posts.get(k).name = n;
for (const [u, d] of Object.entries(overrides.dates || {})) if (posts.has(key(u))) posts.get(key(u)).date = d;
data.posts = [...posts.values()].sort((a, b) => b.date.localeCompare(a.date) || a.lab.localeCompare(b.lab) || a.name.localeCompare(b.name));
const changed = JSON.stringify(data.posts) !== before;
if (changed || !data.updated) data.updated = today;

console.log(log.sort().join("\n") || "No changes.");
console.log(`\n${data.posts.length} posts, ${data.posts.reduce((s, p) => s + p.n, 0)} em dashes, plus ${data.posts.reduce((s, p) => s + (p.blank || 0), 0)} in blank table cells.`);

if (!flag("dry")) {
  fs.writeFileSync(DATA, JSON.stringify({ updated: data.updated, since: SINCE, posts: data.posts }, null, 0)
    .replace('"posts":[', '"posts":[\n').replace(/\},\{/g, "},\n{").replace(/\]\}$/, "\n]}\n"));
  fs.writeFileSync(SEEN, JSON.stringify(Object.fromEntries(Object.entries(seen).sort()), null, 1) + "\n");
  stamp(ROOT, data);
}
