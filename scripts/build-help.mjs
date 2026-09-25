#!/usr/bin/env node
/**
 * Builds the in-app Help (app/(workspace)/help) from the user guide in docs/user-guide/.
 *
 *   npm run help:build
 *
 * Writes:
 *   public/help/content.json   every chapter as HTML, plus its sections as plain text for search
 *   lib/help/content-url.ts    content.json's versioned URL, which the Help page fetches
 *   public/help/img/**         the guide's screenshots (public/help/img/diagrams is kept: the
 *                              appendix's flow diagrams, rendered once from its ```mermaid blocks)
 *
 * The chapters are our own Markdown, so their HTML is trusted. Run this after editing the
 * guide, and commit the result — the app build doesn't run it.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { marked } from "marked";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const SRC = path.join(ROOT, "docs", "user-guide");
const OUT = path.join(ROOT, "public", "help");

/** [id, file, title, group, one-line hint]. Who sees which chapter: lib/help/audience.ts. */
const CHAPTERS = [
  ["welcome", "README.md", "Welcome", "general", "What LRMS is, and where to begin"],
  ["getting-started", "00-getting-started.md", "Getting started", "general", "Sign in, find your way, your profile, emails"],
  ["concepts", "01-concepts.md", "How LRMS thinks", "general", "The few ideas behind every screen"],
  ["custodian", "02-custodian.md", "Lab custodian", "role", "Keep labs true, update, plan, accept, book"],
  ["head", "03-department-head.md", "Department head", "role", "Approve, compile purchases, your people"],
  ["staff", "04-staff.md", "Staff / lecturer", "role", "Look up, book, raise a need"],
  ["student", "05-student.md", "Student", "role", "What you see, and how to get a booking"],
  ["dean-avp", "06-dean-avp.md", "Dean, AVP and CMD", "role", "Purchase approvals; outside requests"],
  ["procurement", "07-procurement.md", "Procurement officer", "role", "Final approval and the order pipeline"],
  ["store-keeper", "08-store-keeper.md", "Store keeper", "role", "Receive deliveries, hand over to labs"],
  ["ict-maintenance", "12-ict-maintenance.md", "ICT maintenance", "role", "Every department's devices, read-only"],
  ["system-admin", "09-system-admin.md", "System administrator", "role", "Org chart, people, categories, views"],
  ["property-admin", "10-property-admin.md", "Property administrator", "role", "Categories and access views"],
  ["portal", "11-external-portal.md", "Outside organisations", "role", "Request, get a quote, pay, track"],
  ["appendix", "appendix.md", "Appendix", "general", "Who approves what, flows, statuses, messages"],
];
const idOfFile = Object.fromEntries(CHAPTERS.map(([id, file]) => [file, id]));

// GitHub-style heading slugs, so the chapters' own "#3-people--roles" links resolve.
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, "")
    .replace(/[^\p{L}\p{N}\- ]/gu, "")
    .trim()
    .replace(/ /g, "-");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plain = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
/** Short content hash — the ?v= that lets next.config.ts cache the guide's files for good. */
const hashOf = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 10);

/** Pixel size of a JPEG (its SOF marker) or an SVG (width/height), so the page reserves
 *  each screenshot's space before the lazy image arrives and nothing jumps. */
function sizeOf(file) {
  const b = fs.readFileSync(file);
  if (file.endsWith(".svg")) {
    const head = b.toString("utf8", 0, 2000);
    const w = head.match(/<svg[^>]*\swidth="([\d.]+)"/);
    const h = head.match(/<svg[^>]*\sheight="([\d.]+)"/);
    return w && h ? { w: Math.round(Number(w[1])), h: Math.round(Number(h[1])) } : null;
  }
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
/** A public/help file's versioned URL and its size. */
function asset(src) {
  const file = path.join(ROOT, "public", src);
  if (!fs.existsSync(file)) throw new Error(`missing image ${src}`);
  return { url: `${src}?v=${hashOf(fs.readFileSync(file))}`, size: sizeOf(file) };
}
const dims = (size) => (size ? ` width="${size.w}" height="${size.h}"` : "");

/** In-app link to a chapter, and optionally a section within it. */
const helpHref = (chapter, anchor) => `/help?c=${chapter}${anchor ? `#${chapter}--${anchor}` : ""}`;

function renderChapter(id, file) {
  const md = fs.readFileSync(path.join(SRC, file), "utf8");
  let mermaidIndex = 0;
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }) {
    const inner = this.parser.parseInline(tokens);
    if (depth === 1) return ""; // the chapter title is rendered by the page
    return `<h${depth} id="${id}--${slug(inner)}">${inner}</h${depth}>\n`;
  };
  renderer.link = function ({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const m = href.match(/^([\w-]+\.md)?(?:#([\w-]+))?$/);
    if (m && (m[1] || m[2])) {
      const target = m[1] ? idOfFile[m[1]] : id;
      if (!target) throw new Error(`${file}: link to a chapter the help doesn't include: ${href}`);
      return `<a href="${helpHref(target, m[2])}">${text}</a>`;
    }
    return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""} target="_blank" rel="noopener">${text}</a>`;
  };
  renderer.image = ({ href, text }) => {
    const { url, size } = asset(`/help/${href.replace(/^\.?\/?/, "")}`);
    return `<figure class="shot"><button type="button" class="zoom" data-src="${esc(url)}" aria-label="Enlarge: ${esc(text)}"><img src="${esc(url)}" alt="${esc(text)}"${dims(size)} loading="lazy" decoding="async"></button><figcaption>${esc(text)}</figcaption></figure>`;
  };
  renderer.code = ({ text, lang }) => {
    if (lang === "mermaid") {
      mermaidIndex += 1;
      const src = `/help/img/diagrams/${path.basename(file, ".md")}-${mermaidIndex}.svg`;
      if (!fs.existsSync(path.join(ROOT, "public", src))) throw new Error(`${file}: no pre-rendered diagram ${src}`);
      const { url, size } = asset(src);
      return `<figure class="diagram"><img src="${url}" alt="Flow diagram"${dims(size)} loading="lazy"></figure>`;
    }
    return `<pre class="code"><code>${esc(text)}</code></pre>`;
  };
  renderer.table = function (token) {
    const cell = (c, tag) => `<${tag}>${this.parser.parseInline(c.tokens)}</${tag}>`;
    const head = `<tr>${token.header.map((c) => cell(c, "th")).join("")}</tr>`;
    const body = token.rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("");
    return `<div class="table"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  };
  renderer.blockquote = function ({ tokens }) {
    const inner = this.parser.parse(tokens);
    const isTip = /^<p><strong>Good to know/.test(inner.trim());
    return `<aside class="${isTip ? "tip" : "note"}">${inner.replace(/<strong>Good to know:?<\/strong>:?\s*/, '<span class="tip-label">Good to know</span> ')}</aside>`;
  };
  let html = marked.parse(md, { renderer, gfm: true });
  html = html.replace(/<p>\s*(<figure[\s\S]*?<\/figure>)\s*<\/p>/g, "$1");

  // Sections: the text before the first h2 (the chapter intro), then one per h2.
  const parts = html.split(/(?=<h2 id=")/);
  const sections = parts.map((part, i) => {
    const h = part.match(/^<h2 id="([^"]+)">([\s\S]*?)<\/h2>/);
    return { id: h ? h[1] : `${id}--top`, title: h ? plain(h[2]) : i === 0 ? "Introduction" : "", text: plain(part) };
  });
  return { html, sections };
}

// Screenshots: replace every folder except the pre-rendered diagrams.
fs.mkdirSync(path.join(OUT, "img"), { recursive: true });
for (const dir of fs.readdirSync(path.join(OUT, "img"))) if (dir !== "diagrams") fs.rmSync(path.join(OUT, "img", dir), { recursive: true, force: true });
let images = 0;
for (const dir of fs.readdirSync(path.join(SRC, "img"))) {
  fs.mkdirSync(path.join(OUT, "img", dir), { recursive: true });
  for (const f of fs.readdirSync(path.join(SRC, "img", dir))) {
    fs.copyFileSync(path.join(SRC, "img", dir, f), path.join(OUT, "img", dir, f));
    images += 1;
  }
}

const chapters = CHAPTERS.map(([id, file, title, group, hint]) => ({ id, title, group, hint, ...renderChapter(id, file) }));

// Every in-app link must land on a real chapter and heading.
const anchors = new Set(chapters.flatMap((c) => [...c.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])));
for (const c of chapters) {
  for (const [, chapter, anchor] of c.html.matchAll(/href="\/help\?c=([\w-]+)(?:#([^"]+))?"/g)) {
    if (!chapters.some((x) => x.id === chapter) || (anchor && !anchors.has(anchor))) throw new Error(`${c.id}: broken help link to ${chapter}#${anchor ?? ""}`);
  }
  for (const [, src] of c.html.matchAll(/src="(\/help\/[^"]+)"/g)) {
    if (!fs.existsSync(path.join(ROOT, "public", src.replace(/\?.*$/, "")))) throw new Error(`${c.id}: missing image ${src}`);
  }
}

const json = JSON.stringify({ builtAt: new Date().toISOString().slice(0, 10), chapters });
fs.writeFileSync(path.join(OUT, "content.json"), json);
// The Help page fetches this exact URL: a rebuilt guide is a new URL, so the old one can be cached for good.
fs.writeFileSync(path.join(ROOT, "lib", "help", "content-url.ts"), `// Written by scripts/build-help.mjs — do not edit.\nexport const HELP_CONTENT_URL = "/help/content.json?v=${hashOf(json)}";\n`);
console.log(`public/help/content.json: ${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.sections.length, 0)} sections; ${images} screenshots`);
