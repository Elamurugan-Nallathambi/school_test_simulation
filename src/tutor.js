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

// Transcribe the child's spoken question (OpenAI Whisper).
export async function transcribe(env, audioBuf, mime) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const m = String(mime || "audio/webm");
  const ext = /mp4|m4a|aac/.test(m) ? "mp4" : /ogg/.test(m) ? "ogg" : /wav/.test(m) ? "wav" : /mpeg|mp3/.test(m) ? "mp3" : "webm";
  const fd = new FormData();
  fd.append("file", new File([audioBuf], `audio.${ext}`, { type: m }));
  fd.append("model", "whisper-1");
  fd.append("language", "en");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: fd,
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.text || "").trim();
}

// Number the passage paragraphs so the AI can navigate quickly and cite accurately.
function indexPassage(text) {
  return String(text || "").split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
    .map((p, i) => `[paragraph ${i + 1}] ${p}`).join("\n");
}

// Conversational reply: answer the child's question grounded ONLY in the passage.
export async function tutorChat(env, body) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const grade = body.grade || 3;
  const reading = !!(body.passageText && body.passageText.trim());
  const opts = Array.isArray(body.options) ? body.options : [];
  const sys = `You are a warm, patient reading buddy — like a kind big sister — talking out loud with a Grade ${grade} child.
Have a natural back-and-forth conversation. Answer ONLY using facts from the passage and question below; NEVER invent details
that are not there. When it helps, tell the child exactly where to look (say "look at paragraph 2"). If she is confused, re-explain
more simply. NEVER say which answer choice is correct and NEVER give the final answer — guide her to think it out herself.
Reply in short, friendly, spoken sentences, under 80 words. No markdown, no lists, no emojis. If she asks something off-topic,
gently steer back to the passage.`;
  const ctx =
    (reading ? `Passage title: ${body.passageTitle || ""}\nPassage (paragraphs are labeled):\n${indexPassage(body.passageText)}\n\n` : "") +
    `The question she is working on: ${body.questionText || ""}\n` +
    (opts.length ? `The answer choices: ${opts.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join("   ")}\n` : "");
  const messages = [{ role: "system", content: `${sys}\n\n${ctx}` }];
  for (const m of (body.history || []).slice(-10)) {
    if (m && (m.role === "user" || m.role === "assistant") && m.content) messages.push({ role: m.role, content: String(m.content).slice(0, 500) });
  }
  messages.push({ role: "user", content: String(body.message || "Can you help me understand this?").slice(0, 500) });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: env.OPENAI_DEFINE_MODEL || "gpt-4o-mini", messages, temperature: 0.4, max_tokens: 220 }),
  });
  if (!res.ok) throw new Error(`OpenAI chat error ${res.status}`);
  const json = await res.json();
  return (json.choices?.[0]?.message?.content || "").trim();
}

// Explain a highlighted phrase/sentence in the context of the whole passage.
export async function explainPart(env, body) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const grade = body.grade || 3;
  const sys = `You are a kind, simple reading helper for a Grade ${grade} child. The child highlighted a part of a passage and wants to understand it.
In 3 to 5 short, spoken sentences (under 80 words): say what the highlighted part means in simple words, and how it fits into the whole passage (and the question, if one is given). Be warm and clear. No markdown, no lists, no emojis. Do not give away any test answer.`;
  const user =
    `Whole passage:\n${String(body.passageText || "").slice(0, 4000)}\n\n` +
    (body.questionText ? `The question the child is on: ${String(body.questionText).slice(0, 400)}\n\n` : "") +
    `The child highlighted this part: "${String(body.selection || "").slice(0, 400)}"\n\nExplain that highlighted part.`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: env.OPENAI_DEFINE_MODEL || "gpt-4o-mini", messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0.4, max_tokens: 220 }),
  });
  if (!res.ok) throw new Error(`OpenAI explainPart error ${res.status}`);
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
