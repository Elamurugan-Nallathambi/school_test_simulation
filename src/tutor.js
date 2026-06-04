// AI "reading buddy": given the current passage + question, produces a warm,
// kid-friendly spoken explanation (what it's about, what the question asks, a
// comprehension tip, and a gentle hint — never the final answer). Voiced with
// Cartesia TTS (mild, slow girl voice).

export async function tutorExplain(env, body) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const grade = body.grade || 3;
  const reading = !!(body.passageText && body.passageText.trim());
  const opts = Array.isArray(body.options) ? body.options : [];
  const sys = `You are a warm, patient reading buddy — like a kind, gentle big sister — for a Grade ${grade} child.
Speak in simple, short, spoken sentences. No markdown, no lists, no bullet points, no emojis. Keep it under 110 words.
Be encouraging and calm. NEVER state which answer choice is correct and NEVER give the final answer — only help the child understand and think.`;
  const task = reading
    ? `In 4 to 6 short sentences: (1) say in simple words what the passage is mostly about, (2) explain what the question is asking, (3) point to where in the passage to look, and (4) give a gentle hint about how to think it through. Do not reveal the answer.`
    : `In 3 to 5 short sentences: explain what the question is asking, name a simple strategy, and give a gentle hint about the first step. Do not give the final answer.`;
  const user =
    (reading ? `Passage title: ${body.passageTitle || ""}\nPassage:\n${body.passageText}\n\n` : "") +
    `Question: ${body.questionText || ""}\n` +
    (opts.length ? `Choices: ${opts.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join("   ")}\n` : "") +
    `\n${task}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: env.OPENAI_DEFINE_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.5, max_tokens: 260,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI tutor error ${res.status}`);
  const json = await res.json();
  return (json.choices?.[0]?.message?.content || "").trim();
}

export async function tutorSpeak(env, text) {
  const key = env.CARTESIA_API_KEY;
  if (!key) throw new Error("CARTESIA_API_KEY is not configured");
  const voice = env.CARTESIA_VOICE_ID || "f786b574-daa5-4673-aa0c-cbe3e8534c02"; // Katie — gentle, enunciating
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: { "Cartesia-Version": "2024-11-13", "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: "sonic-2",
      transcript: text,
      voice: { mode: "id", id: voice, __experimental_controls: { speed: "slow", emotion: [] } },
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      language: "en",
    }),
  });
  if (!res.ok) throw new Error(`Cartesia ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.arrayBuffer();
}
