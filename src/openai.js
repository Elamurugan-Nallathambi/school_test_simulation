// Minimal OpenAI Chat Completions client (JSON mode) for the Worker.
import { systemPrompt, userPrompt } from "./prompts.js";

// Kid-friendly single-word definition for the double-click dictionary.
export async function defineWord(env, word, context) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const sys = `You are a friendly dictionary for a third-grade child (about 8 years old).
Return ONLY JSON: {"word","partOfSpeech","phonetic","meaning","example"}.
- meaning: ONE simple sentence a 3rd grader understands, max 14 words, no hard words.
- example: ONE short, friendly sentence that uses the word naturally.
- phonetic: an easy sound-it-out spelling, e.g. "to-MAY-toe".
- partOfSpeech: noun, verb, adjective, adverb, etc.`;
  const usr = `Define the word "${word}".` + (context ? ` It is used in this sentence: "${context}".` : "");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: env.OPENAI_DEFINE_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 200,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI define error ${res.status}`);
  const json = await res.json();
  const parsed = JSON.parse(json.choices?.[0]?.message?.content || "{}");
  return {
    word, partOfSpeech: parsed.partOfSpeech || "", phonetic: parsed.phonetic || "",
    meaning: parsed.meaning || "", example: parsed.example || "",
  };
}

export async function generateTest(env, params) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const model = env.OPENAI_MODEL || "gpt-4o";

  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(params) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
    max_tokens: 8000,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error("OpenAI returned invalid JSON");
  }
  return parsed;
}
