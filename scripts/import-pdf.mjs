// Import a real test PDF (e.g. a school's released/sample EOG paper) into the same
// JSON format the portal uses, marked source:"sample". Rasterizes each page, sends
// the page images to OpenAI vision (gpt-4o) to extract questions/passages/answers in
// our schema, crops any figures, and writes data/tests/<id>.json.
//
// Usage:
//   OPENAI_API_KEY=... node scripts/import-pdf.mjs <file.pdf> \
//       --grade 3 --subject math --type eog [--id g3-math-sample-1] [--title "..."] [--pages 1-12]
//
// Requires: pdftoppm (poppler), sharp. After import: node scripts/validate.mjs && reseed.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { validateTest } from "../src/validate.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const pdf = argv.find((a) => !a.startsWith("--"));
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
if (!pdf) { console.error("Usage: node scripts/import-pdf.mjs <file.pdf> --grade 3 --subject math --type eog"); process.exit(1); }
const grade = Number(opt("grade", 3));
const subject = opt("subject", "math");
const testType = opt("type", "eog");
const id = opt("id", `g${grade}-${subject === "math" ? "math" : "read"}-sample-${Date.now().toString(36)}`);
const title = opt("title", `Grade ${grade} ${subject === "math" ? "Math" : "Reading"} — ${testType.toUpperCase()} (Sample)`);
const pageRange = opt("pages", "");
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

// ── 1. rasterize the PDF to page PNGs ──────────────────────────────────────────
const work = join(root, "data", "pdf-work", id);
rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
console.log("Rasterizing pages…");
execFileSync("pdftoppm", ["-png", "-r", "150", pdf, join(work, "page")]);
let pages = readdirSync(work).filter((f) => f.endsWith(".png")).sort((a, b) =>
  (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
if (pageRange) {
  const [s, e] = pageRange.split("-").map(Number);
  pages = pages.filter((_, i) => i + 1 >= s && i + 1 <= (e || s));
}
console.log(`${pages.length} pages.`);

// keep public copies so figures can reference page images
const imgDir = join(root, "public", "sample-img", id);
mkdirSync(imgDir, { recursive: true });
pages.forEach((p, i) => copyFileSync(join(work, p), join(imgDir, `p${i + 1}.png`)));
const publicSrc = (n) => `/sample-img/${id}/p${n}.png`;

// ── 2. ask OpenAI vision to extract the test in our schema ─────────────────────
const sys = `You convert a scanned/exported test PDF into a strict JSON test object. Use ONLY what is in the pages.
Schema: { "questions":[ { "id":"Q1", "itemType":"single_choice|multi_select|numeric_entry|equation",
  "skill":"...", "difficulty":"easy|medium|hard", "passageId":"P1"|null, "questionText":"...",
  "diagram": null | { "type":"image", "params":{ "page": <1-based page number the figure is on>,
     "bbox":[x0,y0,x1,y1] normalized 0..1, "alt":"short description" } },
  "options":["..."], "answer": <int index | int[] | number for numeric/equation>, "template":"a + ▢ = b" (equation only),
  "explanation":"...", "points":1 } ],
  "passages":[ { "id":"P1","title":"...","genre":"fiction|informational|poetry","text":"..." } ] }.
Rules: single_choice answer = 0-based index of the correct option; multi_select = array of indices; numeric_entry/equation
answer = the number (equation: also give template with the blank as ▢, options:[]). Reproduce question text and options
EXACTLY. If the PDF has an answer key, use it; otherwise solve it and set your best answer. If a question shows a figure
(graph, number line, shape, array, picture), set diagram to type "image" with the page it is on and a tight normalized
bbox around just that figure. Reading: put each passage in passages[] and link questions via passageId. Output JSON only.`;

const content = [{ type: "text", text: `Grade ${grade} ${subject} ${testType}. Extract ALL questions from these ${pages.length} page(s) in order.` }];
for (let i = 0; i < pages.length; i++) {
  const b64 = readFileSync(join(work, pages[i])).toString("base64");
  content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}`, detail: "high" } });
}

console.log("Extracting with OpenAI vision (gpt-4o)…");
const res = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: "gpt-4o", messages: [{ role: "system", content: sys }, { role: "user", content }],
    response_format: { type: "json_object" }, temperature: 0.1, max_tokens: 12000,
  }),
});
if (!res.ok) { console.error(await res.text()); process.exit(1); }
const data = await res.json();
const test = JSON.parse(data.choices[0].message.content);

// ── 3. finalize fields + crop figures ──────────────────────────────────────────
test.id = id; test.grade = grade; test.subject = subject; test.testType = testType;
test.title = test.title || title; test.timeLimitMinutes = testType === "eog" ? 120 : 90;
test.calculatorAllowed = false; test.source = "sample"; test.createdAt = new Date().toISOString();
if (!Array.isArray(test.passages)) test.passages = [];

for (const [i, q] of (test.questions || []).entries()) {
  if (!q.id) q.id = "Q" + (i + 1);
  q.points = q.points || 1;
  const d = q.diagram;
  if (d && d.type === "image" && d.params && d.params.page) {
    const page = Math.min(pages.length, Math.max(1, d.params.page));
    const pagePng = join(imgDir, `p${page}.png`);
    let src = publicSrc(page);
    const bb = d.params.bbox;
    if (Array.isArray(bb) && bb.length === 4) {
      try {
        const meta = await sharp(pagePng).metadata();
        const [x0, y0, x1, y1] = bb;
        const left = Math.round(Math.max(0, Math.min(x0, x1)) * meta.width);
        const top = Math.round(Math.max(0, Math.min(y0, y1)) * meta.height);
        const wdt = Math.round(Math.min(1, Math.abs(x1 - x0)) * meta.width);
        const hgt = Math.round(Math.min(1, Math.abs(y1 - y0)) * meta.height);
        if (wdt > 20 && hgt > 20) {
          const cropName = `${q.id}.png`;
          await sharp(pagePng).extract({ left, top, width: wdt, height: hgt }).toFile(join(imgDir, cropName));
          src = `/sample-img/${id}/${cropName}`;
        }
      } catch (e) { /* fall back to full page */ }
    }
    q.diagram = { type: "image", params: { src, alt: d.params.alt || "figure" } };
  }
}

// ── 4. validate + write ─────────────────────────────────────────────────────────
const v = validateTest(test);
const outFile = join(root, "data", "tests", `${id}.json`);
writeFileSync(outFile, JSON.stringify(test) + "\n");
console.log(`\nWrote ${outFile}`);
console.log(`Questions: ${(test.questions || []).length}  ·  valid: ${v.ok}  ·  figures: ${imgDir}`);
if (!v.ok) { v.errors.slice(0, 12).forEach((e) => console.log("  • " + e)); }
console.log(`\nReview the JSON, then:  node scripts/validate.mjs && node scripts/seed.mjs && ./setup.sh db:seed --remote && cfl deploy --acc rugan`);
