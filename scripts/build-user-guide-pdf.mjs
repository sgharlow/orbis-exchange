// Renders docs/user-guide.md to docs/user-guide.pdf (dark theme, Letter).
// The markdown is the single source — never edit the PDF or the temp HTML.
// Run: pnpm guide:pdf

import { chromium } from "playwright";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { marked } from "marked";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(path.join(root, "docs", "user-guide.md"), "utf8");
const body = marked.parse(md);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Orbis Exchange — Player's Guide</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=IBM+Plex+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root { --bg:#05070d; --ink:#c9d4e8; --dim:#7f8fb0; --line:rgba(120,160,220,0.16); --gold:#f5c450; --cyan:#38e0f5; }
  * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @page { size: Letter; margin: 11mm 13mm; }
  body { background:var(--bg); color:var(--ink); font:12px/1.55 'IBM Plex Mono',monospace; margin:0; padding:6mm 2mm; }
  h1 { font-family:Fraunces,Georgia,serif; font-style:italic; font-size:34px; color:#eef3ff; margin:0 0 4px; }
  h2 { font-size:12px; letter-spacing:0.3em; text-transform:uppercase; color:#6f86b3; border-top:1px solid var(--line); padding-top:12px; margin:20px 0 10px; break-after:avoid; }
  em { color:var(--dim); }
  strong { color:#e7eefc; font-weight:500; }
  img { max-height:700px; width:auto; max-width:100%; object-fit:contain; object-position:top left; display:block; border:1px solid var(--line); border-radius:8px; margin:6px 0 2px; break-inside:avoid; }
  p, li { color:var(--ink); }
  blockquote { margin:0; padding-left:10px; border-left:2px solid var(--line); color:var(--dim); }
  table { border-collapse:collapse; width:100%; font-size:11px; break-inside:avoid; }
  th, td { border:1px solid var(--line); padding:5px 8px; text-align:left; vertical-align:top; }
  th { color:#9fe9f6; font-weight:500; }
  code { color:var(--cyan); }
  hr { border:0; border-top:1px solid var(--line); margin:14px 0; }
  ol, ul { padding-left: 20px; }
</style></head><body>${body}</body></html>`;

const tmp = path.join(root, "docs", "user-guide.tmp.html");
writeFileSync(tmp, html);
try {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
  await page.pdf({
    path: path.join(root, "docs", "user-guide.pdf"),
    format: "Letter",
    printBackground: true,
    margin: { top: "11mm", bottom: "11mm", left: "13mm", right: "13mm" },
  });
  await browser.close();
  console.log("wrote docs/user-guide.pdf");
} finally {
  unlinkSync(tmp);
}
