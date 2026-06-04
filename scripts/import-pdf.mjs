// Import a real test PDF (e.g. an NCDPI released math form) into the portal's JSON
// format, marked source:"sample". Rasterizes pages, extracts questions with OpenAI
// vision (gpt-4o) in batches, reads the official answer-key table, merges the keys,
// crops figures, and writes data/tests/<id>.json.
//
// Usage:
//   OPENAI_API_KEY=... node scripts/import-pdf.mjs "<file.pdf>" \
//       --grade 3 --subject math --type eog [--id ...] [--title "..."]
//       [--qpages 1-26] [--keypages 27-30] [--batch 6]
//       [--passages data/passages.json]   <-- REQUIRED for reading/ELA tests
//
// Requires: pdftoppm (poppler), sharp.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { validateTest } from "../src/validate.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");
const argv = process.argv.slice(2);
const pdf = argv.find((a) => !a.startsWith("--"));
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
if (!pdf) { console.error("Usage: node scripts/import-pdf.mjs <file.pdf> --grade 3 --subject math --type eog"); process.exit(1); }
const grade = Number(opt("grade", 3));
const subject = opt("subject", "math");
const testType = opt("type", "eog");
const id = opt("id", `g${grade}-${subject === "math" ? "math" : "read"}-sample-${Date.now().toString(36)}`);
const title = opt("title", `Grade ${grade} ${subject === "math" ? "Math" : "Reading"} — Released Form (Sample)`);
const batch = Number(opt("batch", 6));
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

const range = (s, total) => { if (!s) return null; const [a, b] = s.split("-").map(Number); return { a, b: b || a }; };

// ── rasterize ──────────────────────────────────────────────────────────────────
const work = join(root, "data", "pdf-work", id);
rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
console.log("Rasterizing…");
execFileSync("pdftoppm", ["-png", "-r", "150", pdf, join(work, "page")]);
const pageFiles = readdirSync(work).filter((f) => f.endsWith(".png"))
  .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
const total = pageFiles.length;
console.log(`${total} pages.`);
const imgDir = join(root, "public", "sample-img", id);
mkdirSync(imgDir, { recursive: true });
pageFiles.forEach((p, i) => copyFileSync(join(work, p), join(imgDir, `p${i + 1}.png`)));

const qRange = range(opt("qpages"), total) || { a: 1, b: total };
const keyRange = range(opt("keypages"), total);
const b64 = (n) => readFileSync(join(work, pageFiles[n - 1])).toString("base64");

async function vision(text, pageNums, maxTok = 8000) {
  const content = [{ type: "text", text }];
  for (const n of pageNums) content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${b64(n)}`, detail: "high" } });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content }], response_format: { type: "json_object" }, temperature: 0.1, max_tokens: maxTok }),
  });
  if (!res.ok) throw new Error(await res.text());
  return JSON.parse((await res.json()).choices[0].message.content);
}

const Q_PROMPT = (s, e) => `These are pages ${s}-${e} of a Grade ${grade} ${subject} released test. Extract EVERY numbered test question shown (ignore directions/cover/answer-key pages). Return JSON {"questions":[{
"itemNumber": <the printed item number, integer>,
"itemType":"single_choice"|"numeric_entry",
"questionText":"exact stem text",
"options":["A text","B text","C text","D text"]  (empty [] for gridded/numeric),
"diagram": null | {"page": <absolute page number where the figure is>, "bbox":[x0,y0,x1,y1] normalized 0..1 around ONLY the figure, "alt":"short desc"},
"skill":"short topic" }]}. Reproduce stems and options EXACTLY. Set diagram only when the item shows a real figure (graph, number line, shape, array, model). Do NOT include the answer.`;

const KEY_PROMPT = `These pages contain the official Answer Key table (columns like Item Number, Type, Key, DOK, Standard). Return JSON {"keys":[{"itemNumber":<int>,"key":"<the Key cell exactly, e.g. B or 3/4 or 12>"}]}. Include every row.`;

// ── extract questions in batches ────────────────────────────────────────────────
const questions = [];
console.log("Extracting questions…");
for (let s = qRange.a; s <= qRange.b; s += batch) {
  const e = Math.min(s + batch - 1, qRange.b);
  const pages = []; for (let n = s; n <= e; n++) pages.push(n);
  try {
    const out = await vision(Q_PROMPT(s, e), pages);
    for (const q of out.questions || []) questions.push(q);
    console.log(`  pages ${s}-${e}: +${(out.questions || []).length}`);
  } catch (err) { console.error(`  pages ${s}-${e} failed: ${String(err).slice(0, 120)}`); }
}

// ── extract answer key ───────────────────────────────────────────────────────────
const keyMap = {};
const kr = keyRange || { a: Math.max(1, total - 2), b: total };
console.log(`Reading answer key (pages ${kr.a}-${kr.b})…`);
try {
  const pages = []; for (let n = kr.a; n <= kr.b; n++) pages.push(n);
  const out = await vision(KEY_PROMPT, pages);
  for (const k of out.keys || []) keyMap[k.itemNumber] = String(k.key).trim();
  console.log(`  ${Object.keys(keyMap).length} keys.`);
} catch (err) { console.error(`  key read failed: ${String(err).slice(0, 120)}`); }

// ── merge + build test ───────────────────────────────────────────────────────────
let keyed = 0;
questions.sort((a, b) => (a.itemNumber || 0) - (b.itemNumber || 0));
for (const [i, q] of questions.entries()) {
  q.id = "Q" + (q.itemNumber || i + 1);
  q.points = 1; q.passageId = null;
  if (!q.difficulty) q.difficulty = "medium";
  const key = keyMap[q.itemNumber];
  const opts = Array.isArray(q.options) ? q.options : [];
  if (key != null) {
    keyed++;
    if (/^[A-Da-d]$/.test(key) && opts.length) { q.itemType = "single_choice"; q.answer = key.toUpperCase().charCodeAt(0) - 65; }
    else if (/^[A-Da-d](\s*,\s*[A-Da-d])+$/.test(key) && opts.length) { q.itemType = "multi_select"; q.answer = key.split(/\s*,\s*/).map((x) => x.toUpperCase().charCodeAt(0) - 65).sort((a, b) => a - b); }
    else { q.itemType = "numeric_entry"; q.options = []; q.answer = /^[0-9./-]+$/.test(key) ? (key.includes("/") ? key : Number(key)) : key; }
  } else if (q.itemType === "single_choice" && opts.length) { q.answer = 0; q.needsKey = true; }
  else { q.itemType = "numeric_entry"; q.options = []; q.answer = ""; q.needsKey = true; }
  if (!q.explanation) q.explanation = "From the released form answer key.";
  delete q.itemNumber;
}

// ── optional passage extraction (reading/ela only) ──────────────────────────────
const passages = [];
const passageFile = opt("passages", "");
if (passageFile && subject !== "math") {
  try {
    const defs = JSON.parse(readFileSync(passageFile, "utf8"));
    console.log("Extracting passages…");
    for (const def of defs) {
      if (!Array.isArray(def.pages) || def.pages.length === 0) continue;
      const content = [{ type: "text", text: `These are pages from a Grade ${grade} reading test passage titled "${def.title}". Extract the FULL passage text exactly as written. Preserve paragraphs. Do NOT include questions, directions, or answer choices. Return JSON {"text":"full passage text"}.` }];
      for (const n of def.pages) content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${b64(n)}`, detail: "high" } });
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content }], response_format: { type: "json_object" }, temperature: 0.1, max_tokens: 8000 }),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = JSON.parse((await res.json()).choices[0].message.content);
      passages.push({ id: def.pid, title: def.title, text: out.text || "" });
      console.log(`  ${def.title}: ${(out.text || "").length} chars`);
    }
    // Link questions to passages by item number
    for (const q of questions) {
      const itemNum = q.itemNumber || 0;
      const def = defs.find((d) => Array.isArray(d.questions) && d.questions.includes(itemNum));
      q.passageId = def ? def.pid : null;
    }
  } catch (err) { console.error(`  passage extraction failed: ${String(err).slice(0, 120)}`); }
} else if (subject !== "math") {
  console.warn("\nWARNING: This is a reading test but no --passages file was provided.");
  console.warn("The imported test will have NO passage text. Students will see questions");
  console.warn("without the passages to read.");
  console.warn("\nTo fix, create a JSON file like:");
  console.warn(`  [{"pid":"P1","title":"Story Title","pages":[1,2],"questions":[1,2,3,4,5]}]`);
  console.warn("Then re-run with: --passages path/to/defs.json\n");
}

const test = {
  id, grade, subject, testType, title,
  instructions: "Released-form sample. Choose the best answer for each question.",
  timeLimitMinutes: testType === "eog" ? 120 : 90, calculatorAllowed: subject === "math",
  source: "sample", createdAt: new Date().toISOString(), passages, questions,
};

// ── crop figures ─────────────────────────────────────────────────────────────────
for (const q of questions) {
  const d = q.diagram;
  if (!d || !d.page) { if (d && !d.type) q.diagram = null; continue; }
  const page = Math.min(total, Math.max(1, d.page));
  const pagePng = join(imgDir, `p${page}.png`);
  let src = `/sample-img/${id}/p${page}.png`;
  const bb = d.bbox;
  if (Array.isArray(bb) && bb.length === 4) {
    try {
      const m = await sharp(pagePng).metadata();
      const left = Math.round(Math.max(0, Math.min(bb[0], bb[2])) * m.width);
      const top = Math.round(Math.max(0, Math.min(bb[1], bb[3])) * m.height);
      const wdt = Math.round(Math.min(1, Math.abs(bb[2] - bb[0])) * m.width);
      const hgt = Math.round(Math.min(1, Math.abs(bb[3] - bb[1])) * m.height);
      if (wdt > 24 && hgt > 24) { await sharp(pagePng).extract({ left, top, width: wdt, height: hgt }).toFile(join(imgDir, `${q.id}.png`)); src = `/sample-img/${id}/${q.id}.png`; }
    } catch {}
  }
  q.diagram = { type: "image", params: { src, alt: d.alt || "figure" } };
}

const v = validateTest(test);
const outFile = join(root, "data", "tests", `${id}.json`);
writeFileSync(outFile, JSON.stringify(test) + "\n");
const missing = questions.filter((q) => q.needsKey).length;
console.log(`\nWrote ${outFile}`);
console.log(`Questions: ${questions.length} · keyed from PDF: ${keyed} · unkeyed: ${missing} · valid: ${v.ok}`);
if (!v.ok) v.errors.slice(0, 15).forEach((e) => console.log("  • " + e));
console.log(`Figures: public/sample-img/${id}/`);
