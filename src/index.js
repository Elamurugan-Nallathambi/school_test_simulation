// Worker entry — routes /api/*, otherwise serves static assets.
import { listTests, getTest, saveTest, saveAttempt, listAttempts, getAttempt, getGlossary, saveGlossary, getExplanation, saveExplanation } from "./db.js";
import { generateTest, defineWord, explainMath } from "./openai.js";
import { tutorExplain, tutorSpeak, transcribe, tutorChat, explainPart } from "./tutor.js";
import { validateTest } from "./validate.js";
import { expectedCount, suggestedMinutes } from "./prompts.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

const GRADES = [3, 4, 5];
const SUBJECTS = ["math", "reading"];
const TYPES = ["boy", "moy", "eog"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (path.startsWith("/api/")) {
      try {
        return await handleApi(path, request, env);
      } catch (err) {
        return json({ error: String(err.message || err) }, 500);
      }
    }

    // static assets (SPA)
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(path, request, env) {
  // GET /api/health
  if (path === "/api/health") {
    return json({ ok: true, time: new Date().toISOString() });
  }

  // GET /api/tests?grade=&subject=&testType=
  if (path === "/api/tests" && request.method === "GET") {
    const u = new URL(request.url);
    const tests = await listTests(env, {
      grade: u.searchParams.get("grade"),
      subject: u.searchParams.get("subject"),
      testType: u.searchParams.get("testType"),
    });
    return json({ tests });
  }

  // GET /api/tests/:id
  const m = path.match(/^\/api\/tests\/([\w-]+)$/);
  if (m && request.method === "GET") {
    const test = await getTest(env, m[1]);
    if (!test) return json({ error: "not found" }, 404);
    return json(test);
  }

  // POST /api/generate
  if (path === "/api/generate" && request.method === "POST") {
    const b = await request.json();
    const grade = Number(b.grade);
    const subject = String(b.subject || "");
    const testType = String(b.testType || "");
    if (!GRADES.includes(grade)) return json({ error: "invalid grade" }, 400);
    if (!SUBJECTS.includes(subject)) return json({ error: "invalid subject" }, 400);
    if (!TYPES.includes(testType)) return json({ error: "invalid testType" }, 400);

    const stamp = Date.now().toString(36);
    const id = `g${grade}-${subject === "math" ? "math" : "read"}-${testType}-ai-${stamp}`;
    const title = `Grade ${grade} ${subject === "math" ? "Math" : "Reading"} — ${testType.toUpperCase()} (Generated)`;
    const wantCount = expectedCount({ grade, subject, testType });

    // Generate with retries — enforce the EXACT question count for the grade/type
    // and re-roll on validation slips (e.g. duplicate options).
    let test = null, lastErrors = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const t = await generateTest(env, {
        grade, subject, testType,
        difficulty: b.difficulty, questionCount: wantCount,
        id, title, attempt,
      });
      t.id = id; t.grade = grade; t.subject = subject; t.testType = testType;
      if (!t.title) t.title = title;
      t.timeLimitMinutes = suggestedMinutes(testType);
      t.source = "ai";
      if (!Array.isArray(t.passages)) t.passages = [];
      repair(t);
      // If the model produced extra questions, trim to the exact count.
      if (Array.isArray(t.questions) && t.questions.length > wantCount) {
        t.questions = t.questions.slice(0, wantCount);
      }
      const v = validateTest(t);
      const countOk = Array.isArray(t.questions) && t.questions.length === wantCount;
      if (v.ok && countOk) { test = t; break; }
      lastErrors = countOk ? v.errors : [`expected ${wantCount} questions, got ${t.questions?.length}`, ...(v.errors || [])];
    }
    if (!test) return json({ error: "generation failed validation", details: lastErrors }, 502);

    await saveTest(env, test, "ai");
    return json(test);
  }

  // GET /api/define?word=&context=  (cached kid-friendly dictionary)
  if (path === "/api/define" && request.method === "GET") {
    const u = new URL(request.url);
    const raw = (u.searchParams.get("word") || "").toLowerCase().trim();
    const word = raw.replace(/[^a-z'\-]/g, "");
    if (!word || word.length > 40) return json({ error: "invalid word" }, 400);
    const cached = await getGlossary(env, word);
    if (cached) return json({ ...cached, cached: true });
    const context = (u.searchParams.get("context") || "").slice(0, 300);
    const entry = await defineWord(env, word, context);
    if (entry.meaning) { try { await saveGlossary(env, entry); } catch {} }
    return json({ ...entry, cached: false });
  }

  const audioReply = (audio, text) => new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg", "Cache-Control": "no-store",
      "X-Tutor-Text": encodeURIComponent(text),
      "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-Tutor-Text",
    },
  });

  // POST /api/tutor  → spoken kid-friendly explanation of the current passage/question
  if (path === "/api/tutor" && request.method === "POST") {
    const b = await request.json();
    const text = await tutorExplain(env, b);
    if (b.mute) return json({ text });
    return audioReply(await tutorSpeak(env, text), text);
  }

  // POST /api/stt  → transcribe the child's spoken question (audio body) → { text }
  if (path === "/api/stt" && request.method === "POST") {
    const mime = request.headers.get("Content-Type") || "audio/webm";
    const buf = await request.arrayBuffer();
    if (!buf || buf.byteLength < 200) return json({ text: "" });
    const text = await transcribe(env, buf, mime);
    return json({ text });
  }

  // POST /api/speak → text-to-speech (Cartesia) → audio/mp3
  if (path === "/api/speak" && request.method === "POST") {
    const b = await request.json();
    const text = String(b.text || "").slice(0, 4000);
    if (!text) return new Response("No text", { status: 400 });
    try {
      const audio = await tutorSpeak(env, text, b.voiceId || null);
      return new Response(audio, {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" },
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  }

  // POST /api/chat  → conversational reply (grounded in the passage) → spoken audio
  if (path === "/api/chat" && request.method === "POST") {
    const b = await request.json();
    const text = await tutorChat(env, b);
    if (b.mute) return json({ text });
    return audioReply(await tutorSpeak(env, text), text);
  }

  // POST /api/passage-explain → explain a highlighted phrase in passage context
  if (path === "/api/passage-explain" && request.method === "POST") {
    const b = await request.json();
    const text = await explainPart(env, b);
    if (b.mute) return json({ text });
    return audioReply(await tutorSpeak(env, text), text);
  }

  // GET /api/explain?q=&a=  (cached mental-math "easier way" for a math question)
  if (path === "/api/explain" && request.method === "GET") {
    const u = new URL(request.url);
    const q = (u.searchParams.get("q") || "").slice(0, 400);
    const a = (u.searchParams.get("a") || "").slice(0, 120);
    if (!q) return json({ error: "missing question" }, 400);
    const qkey = "x" + fnv1a(q + "||" + a).toString(36);
    const cached = await getExplanation(env, qkey);
    if (cached) return json({ strategy: cached, cached: true });
    const strategy = await explainMath(env, q, a);
    if (strategy) { try { await saveExplanation(env, qkey, strategy); } catch {} }
    return json({ strategy, cached: false });
  }

  // GET /api/attempts?studentName=
  if (path === "/api/attempts" && request.method === "GET") {
    const name = new URL(request.url).searchParams.get("studentName");
    if (!name) return json({ attempts: [] });
    const attempts = await listAttempts(env, name);
    return json({ attempts });
  }

  // GET /api/attempts/:id
  const am = path.match(/^\/api\/attempts\/([\w-]+)$/);
  if (am && request.method === "GET") {
    const data = await getAttempt(env, am[1]);
    if (!data) return json({ error: "not found" }, 404);
    return json(data);
  }

  // POST /api/attempts
  if (path === "/api/attempts" && request.method === "POST") {
    const b = await request.json();
    if (!b.testId || !b.studentName) return json({ error: "missing fields" }, 400);
    const id = await saveAttempt(env, b);
    return json({ id });
  }

  return json({ error: "not found" }, 404);
}

function fnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Safe, lossless normalizations to raise first-pass validity.
function repair(test) {
  for (const q of test.questions || []) {
    if (Array.isArray(q.options)) q.options = q.options.map((o) => (typeof o === "string" ? o.trim() : o));
    if (q.itemType === "numeric_entry") {
      q.options = [];
    } else if (q.itemType === "single_choice") {
      // string answer that matches an option -> its index
      if (typeof q.answer === "string" && Array.isArray(q.options)) {
        const i = q.options.indexOf(q.answer.trim());
        if (i >= 0) q.answer = i;
      }
      if (typeof q.answer === "string" && /^\d+$/.test(q.answer)) q.answer = Number(q.answer);
    } else if (q.itemType === "multi_select") {
      if (Array.isArray(q.answer)) {
        q.answer = q.answer.map((a) => {
          if (typeof a === "number") return a;
          if (typeof a === "string") {
            const i = q.options.indexOf(a.trim());
            if (i >= 0) return i;
            if (/^\d+$/.test(a)) return Number(a);
          }
          return a;
        }).filter((a) => Number.isInteger(a));
      }
    }
    if (q.diagram && typeof q.diagram !== "object") q.diagram = null;
    if (q.points == null) q.points = 1;
  }
}
