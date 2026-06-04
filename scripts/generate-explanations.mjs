// Generate kid-friendly "why" explanations for test questions using OpenAI.
// Usage: OPENAI_API_KEY=... node scripts/generate-explanations.mjs <data/tests/xxx.json>
import { readFileSync, writeFileSync } from "node:fs";
import { validateTest } from "../src/validate.js";

const file = process.argv[2];
if (!file) { console.error("Usage: node scripts/generate-explanations.mjs <test.json>"); process.exit(1); }

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

const test = JSON.parse(readFileSync(file, "utf8"));
const questions = test.questions;

const BATCH = 10;

function fmtAnswer(q) {
  if (q.itemType === "single_choice" && Array.isArray(q.options)) {
    const idx = q.answer;
    const letter = String.fromCharCode(65 + idx);
    return `${letter}) ${q.options[idx] ?? ""}`;
  }
  if (q.itemType === "multi_select" && Array.isArray(q.options)) {
    return q.answer.map((idx) => `${String.fromCharCode(65 + idx)}) ${q.options[idx] ?? ""}`).join(", ");
  }
  return String(q.answer);
}

async function explainBatch(batch, startIdx) {
  const lines = batch.map((q, i) => {
    const num = startIdx + i + 1;
    let text = `Question ${num}:\n${q.questionText}`;
    if (Array.isArray(q.options) && q.options.length) {
      text += "\nOptions:\n" + q.options.map((o, j) => `${String.fromCharCode(65 + j)}) ${o}`).join("\n");
    }
    text += `\nCorrect answer: ${fmtAnswer(q)}\n`;
    return text;
  }).join("\n---\n");

  const prompt = `You are a friendly tutor helping a 3rd grader named Iniya understand why each answer is correct. For each question below, write a SHORT (1-3 sentences), encouraging explanation that tells Iniya *why* the correct answer is right. Use simple language a 3rd grader can understand. Do NOT just say "the answer is B" — explain the reasoning.

Return ONLY a JSON object in this exact format: {"explanations":["...","...",...]} where each string matches the question order.

${lines}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return parsed.explanations || [];
}

console.log(`Generating explanations for ${questions.length} questions in ${file}…`);
for (let i = 0; i < questions.length; i += BATCH) {
  const batch = questions.slice(i, i + BATCH);
  try {
    const explanations = await explainBatch(batch, i);
    for (let j = 0; j < batch.length; j++) {
      const exp = explanations[j];
      if (exp && typeof exp === "string" && exp.trim()) {
        batch[j].explanation = exp.trim();
      }
    }
    console.log(`  ${i + 1}-${Math.min(i + BATCH, questions.length)} done`);
  } catch (err) {
    console.error(`  ${i + 1}-${Math.min(i + BATCH, questions.length)} failed: ${String(err).slice(0, 120)}`);
  }
}

writeFileSync(file, JSON.stringify(test) + "\n");
const v = validateTest(test);
console.log(`\nWrote ${file} · valid: ${v.ok}`);
if (!v.ok) v.errors.slice(0, 5).forEach((e) => console.log("  • " + e));
