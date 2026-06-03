// Minimal OpenAI Chat Completions client (JSON mode) for the Worker.
import { systemPrompt, userPrompt } from "./prompts.js";

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
