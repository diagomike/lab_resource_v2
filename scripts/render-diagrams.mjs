#!/usr/bin/env node
/**
 * Renders the Help appendix's ```mermaid flows to public/help/img/diagrams/appendix-N.svg,
 * in the guide's colours. Run it after changing a flow in docs/user-guide/appendix.md, then
 * `npm run help:build`.
 *
 *   node scripts/render-diagrams.mjs          every flow
 *   node scripts/render-diagrams.mjs 2 5      only the 2nd and 5th
 *
 * Mermaid runs in the installed Chrome (the sister app's playwright-core drives it, as for
 * e2e/guide-shots.mjs) and is loaded from the jsDelivr CDN, so this needs a connection.
 * The output is serialised as XML and given its pixel size: an SVG shown through <img>
 * must be valid XML with a width and height (scripts/build-help.mjs refuses otherwise).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve("../sc_feedback_v2/node_modules/playwright-core"));

const md = fs.readFileSync("docs/user-guide/appendix.md", "utf8");
const blocks = [...md.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
const which = process.argv.slice(2).map(Number).filter(Boolean);
const todo = which.length ? which : blocks.map((_, i) => i + 1);

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" });
await page.evaluate(() =>
  window.mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    fontFamily: "IBM Plex Sans,system-ui,sans-serif",
    themeVariables: { primaryColor: "#e1eefa", primaryBorderColor: "#0b69b0", lineColor: "#57697a", primaryTextColor: "#0d1922", fontSize: "15px", fontFamily: "IBM Plex Sans,system-ui,sans-serif" },
  }),
);
for (const n of todo) {
  if (!blocks[n - 1]) throw new Error(`appendix.md has no flow ${n} (it has ${blocks.length})`);
  let svg = await page.evaluate(async (src) => {
    const raw = (await window.mermaid.render("d0", src)).svg;
    const host = document.createElement("div");
    host.innerHTML = raw;
    return new XMLSerializer().serializeToString(host.querySelector("svg"));
  }, blocks[n - 1]);
  const box = svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/);
  if (!box) throw new Error(`flow ${n}: no viewBox in Mermaid's output`);
  const head = svg.slice(0, svg.indexOf(">") + 1);
  const sized = head
    .replace(/\swidth="[^"]*"/, "")
    .replace(/\sheight="[^"]*"/, "")
    .replace(/\sstyle="[^"]*"/, "")
    .replace(/^<svg/, `<svg width="${Math.ceil(Number(box[1]))}" height="${Math.ceil(Number(box[2]))}"`);
  svg = sized + svg.slice(head.length);
  fs.writeFileSync(`public/help/img/diagrams/appendix-${n}.svg`, svg);
  console.log(`appendix-${n}.svg  ${Math.ceil(Number(box[1]))}×${Math.ceil(Number(box[2]))}`);
}
await browser.close();
