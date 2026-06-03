// Local batch generator — produce papers via OpenAI into data/tests/.
// Usage: OPENAI_API_KEY=... node scripts/generate-batch.mjs <grade> <subject> <testType> [id] [title]
// Example: node scripts/generate-batch.mjs 4 math eog g4-math-eog-1 "Grade 4 Math — EOG Test 1"
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { systemPrompt, userPrompt } from "../src/prompts.js";
import { validateTest } from "../src/validate.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const [grade, subject, testType, idArg, titleArg] = process.argv.slice(2);
if (!grade || !subject || !testType) {
  console.error("Usage: node scripts/generate-batch.mjs <grade> <subject> <testType> [id] [title]");
  process.exit(1);
}
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

const id = idArg || `g${grade}-${subject === "math" ? "math" : "read"}-${testType}-${Date.now().toString(36)}`;
const title = titleArg || `Grade ${grade} ${subject === "math" ? "Math" : "Reading"} — ${testType.toUpperCase()}`;
const model = process.env.OPENAI_MODEL || "gpt-4o";

console.log(`Generating ${id} (${model})…`);
const res = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt({ grade: +grade, subject, testType, id, title }) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
    max_tokens: 8000,
  }),
});
if (!res.ok) { console.error(await res.text()); process.exit(1); }
const data = await res.json();
const test = JSON.parse(data.choices[0].message.content);
test.id = id; test.grade = +grade; test.subject = subject; test.testType = testType;
test.title = test.title || title; test.source = "curated";
if (!Array.isArray(test.passages)) test.passages = [];

const v = validateTest(test);
const file = join(__dir, "..", "data", "tests", `${id}.json`);
writeFileSync(file, JSON.stringify(test, null, 2) + "\n");
console.log(`Wrote ${file} — ${test.questions.length} questions, valid=${v.ok}`);
if (!v.ok) { v.errors.slice(0, 10).forEach((e) => console.log("  • " + e)); process.exit(1); }
