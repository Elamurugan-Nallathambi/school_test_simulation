// Extract passage text from page images using GPT-4o vision and inject into a reading test.
// Usage: OPENAI_API_KEY=... node scripts/extract-passages.mjs <test.json> <img-dir> <passage-defs.json>
//
// passage-defs.json example:
// [
//   {"pid":"P1","title":"Balloons Over Broadway","pages":[1,2,3,4],"questions":[1,2,3,4,5,6,7,8,9,10]},
//   {"pid":"P2","title":"Penguins and My Father's Feet","pages":[9,10],"questions":[11,12,13,14,15,16]}
// ]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateTest } from "../src/validate.js";

const testFile = process.argv[2];
const imgDir = process.argv[3];
const defsFile = process.argv[4];
if (!testFile || !imgDir || !defsFile) {
  console.error("Usage: node scripts/extract-passages.mjs <test.json> <img-dir> <defs.json>");
  process.exit(1);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

const test = JSON.parse(readFileSync(testFile, "utf8"));
const defs = JSON.parse(readFileSync(defsFile, "utf8"));

function b64(pageNum) {
  const p = join(imgDir, `p${pageNum}.png`);
  return readFileSync(p).toString("base64");
}

async function extractPassage(title, pages) {
  const content = [
    { type: "text", text: `These are pages from a Grade 3 reading test passage titled "${title}". Extract the FULL passage text exactly as written. Preserve paragraphs. Do NOT include questions, directions, or answer choices. Return JSON {"text":"full passage text"}.` }
  ];
  for (const n of pages) content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${b64(n)}`, detail: "high" } });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content }], response_format: { type: "json_object" }, temperature: 0.1, max_tokens: 8000 }),
  });
  if (!res.ok) throw new Error(await res.text());
  return JSON.parse((await res.json()).choices[0].message.content);
}

const passages = [];
for (const def of defs) {
  console.log(`Extracting "${def.title}" from pages ${def.pages.join(", ")}…`);
  try {
    const out = await extractPassage(def.title, def.pages);
    passages.push({ id: def.pid, title: def.title, text: out.text || "" });
    console.log(`  → ${(out.text || "").length} chars`);
  } catch (err) {
    console.error(`  FAILED: ${String(err).slice(0, 120)}`);
  }
}

test.passages = passages;

// Assign passageIds to questions
for (const q of test.questions) {
  const qNum = parseInt(q.id.replace("Q", ""), 10);
  const def = defs.find((d) => d.questions.includes(qNum));
  q.passageId = def ? def.pid : null;
}

const v = validateTest(test);
writeFileSync(testFile, JSON.stringify(test) + "\n");
console.log(`\nWrote ${testFile}`);
console.log(`Passages: ${passages.length} · Valid: ${v.ok}`);
if (!v.ok) v.errors.slice(0, 10).forEach((e) => console.log("  • " + e));
