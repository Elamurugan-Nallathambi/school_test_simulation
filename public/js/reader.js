// Reading library: stories with comprehension, AI feedback, and full passage tools.
import { explainSelectionText } from "./dict.js";
let storiesData = null;
let readerMarks = {};       // storyId -> [{id,pi,s,e}]
let readerMarkSeq = 0;
let readerMarkerOn = false;
let readerSelCleanups = [];
let readAudio = null;       // current Audio object

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── Voice config ──────────────────────────────────────────────────────────────
const CARTESIA_VOICES = [
  { id: "f786b574-daa5-4673-aa0c-cbe3e8534c02", name: "Katie", desc: "gentle & clear" },
  { id: "41534e16-2966-4c6d-b0e9-1919d8313385", name: "Jessica", desc: "warm & friendly" },
  { id: "694f9389-aac1-45b6-b726-9d9369183238", name: "Nicole", desc: "bright & expressive" },
];
const VOICE_KEY = "readerVoice";
function getVoicePref() {
  try { return localStorage.getItem(VOICE_KEY) || "cartesia:f786b574-daa5-4673-aa0c-cbe3e8534c02"; } catch { return "cartesia:f786b574-daa5-4673-aa0c-cbe3e8534c02"; }
}
function setVoicePref(v) { try { localStorage.setItem(VOICE_KEY, v); } catch {} }
function isBuiltIn(v) { return !v || v.startsWith("builtin:"); }
function getBuiltInLabel(v) { return v?.replace("builtin:", "") || "Default"; }

async function speak(text, voicePref, onStatus) {
  // Stop any current audio
  try { if (readAudio) { readAudio.pause(); readAudio = null; } } catch {}
  window.speechSynthesis && window.speechSynthesis.cancel();

  if (!isBuiltIn(voicePref)) {
    const voiceId = voicePref.replace("cartesia:", "");
    if (onStatus) onStatus("Loading voice…");
    try {
      const r = await fetch("/api/speak", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
      });
      if (!r.ok) throw new Error(await r.text());
      const buf = await r.arrayBuffer();
      readAudio = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })));
      readAudio.onended = () => { if (onStatus) onStatus(""); };
      readAudio.onerror = () => { if (onStatus) onStatus(""); };
      readAudio.play().catch(() => {});
      if (onStatus) onStatus("🔊 Reading…");
    } catch (e) {
      if (onStatus) onStatus("Voice failed, trying built-in…");
      speakBuiltin(text, voicePref);
    }
  } else {
    speakBuiltin(text, voicePref);
  }
}

function speakBuiltin(text, voicePref) {
  if (!("speechSynthesis" in window)) return;
  const desired = getBuiltInLabel(voicePref).toLowerCase();
  const voices = window.speechSynthesis.getVoices() || [];
  const v = voices.find((x) => x.name.toLowerCase().includes(desired) && /^en/i.test(x.lang))
    || voices.find((x) => /^en/i.test(x.lang)) || voices[0];
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US"; u.rate = 0.9; u.pitch = 1.0;
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

function getBuiltinVoices() {
  if (!("speechSynthesis" in window)) return [];
  return (window.speechSynthesis.getVoices() || []).filter((v) => /^en/i.test(v.lang));
}
const paras = (t) => esc(t).split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
const markTools = (id) => `<span class="mark-tools" contenteditable="false"><button class="mark-q" data-mid="${id}" title="Explain this part" aria-label="Explain"></button><button class="mark-x" data-mid="${id}" title="Clear highlight" aria-label="Clear"></button></span>`;

function closestPpar(node) { const el = node && (node.nodeType === 1 ? node : node.parentElement); return el && el.closest ? el.closest(".ppar") : null; }
function charOffset(container, node, off) { try { const r = document.createRange(); r.setStart(container, 0); r.setEnd(node, off); return r.toString().length; } catch { return 0; } }

function renderPara(text, ranges) {
  let out = "", pos = 0;
  for (const r of ranges) {
    const s = Math.max(0, Math.min(r.s, text.length)), e = Math.max(s, Math.min(r.e, text.length));
    if (e <= s) continue;
    if (s > pos) out += esc(text.slice(pos, s));
    out += `<span class="hl" data-mid="${esc(String(r.id))}">${esc(text.slice(s, e))}${markTools(r.id)}</span>`;
    pos = e;
  }
  if (pos < text.length) out += esc(text.slice(pos));
  return out;
}

async function loadStories() {
  if (storiesData) return storiesData;
  const r = await fetch("/data/stories.json");
  storiesData = await r.json();
  return storiesData;
}

// ── Library list ──────────────────────────────────────────────────────────────
export async function renderLibrary(app, student, onBack) {
  app.innerHTML = `
    <section class="wizard center">
      <div class="generating"><div class="spinner"></div><h2>Loading stories…</h2></div>
    </section>`;
  const stories = await loadStories();

  const byGrade = {};
  for (const s of stories) { (byGrade[s.grade] = byGrade[s.grade] || []).push(s); }

  app.innerHTML = `
    <section class="wizard">
      <div class="vocab-header">
        <button id="read-back" class="btn btn-ghost btn-sm">← Back</button>
        <div class="vocab-score-box">
          <span class="vocab-score-label">📚 Reading</span>
        </div>
        <span></span>
      </div>
      <div class="hero"><h1>Story Library</h1><p>Pick a story to read and explore.</p></div>
      <div class="read-filters">
        <button class="read-filter active" data-g="all">All</button>
        <button class="read-filter" data-g="3">Grade 3</button>
        <button class="read-filter" data-g="4">Grade 4</button>
        <button class="read-filter" data-g="5">Grade 5</button>
      </div>
      <div id="story-list" class="res-list"></div>
    </section>`;

  app.querySelector("#read-back").onclick = onBack;

  const list = app.querySelector("#story-list");
  function renderList(filter) {
    const items = filter === "all" ? stories : stories.filter((s) => String(s.grade) === filter);
    list.innerHTML = items.map((s) => `
      <div class="res-card story-card" data-id="${esc(s.id)}">
        <span class="res-type ${s.genre === 'Fable' || s.genre === 'Folktale' ? 'rt-ideas' : s.genre === 'Informational' || s.genre === 'Biography' ? 'rt-official' : 'rt-questions'}">${esc(s.genre)}</span>
        <span class="res-name">${esc(s.title)}</span>
        <span class="res-desc">Grade ${s.grade} · ${esc(s.text.split(/\s+/).length)} words</span>
        <span class="res-go">Read →</span>
      </div>
    `).join("");
    list.querySelectorAll(".story-card").forEach((card) => {
      card.onclick = () => renderReader(app, card.dataset.id, student, onBack);
    });
  }

  app.querySelectorAll(".read-filter").forEach((b) => {
    b.onclick = () => {
      app.querySelectorAll(".read-filter").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      renderList(b.dataset.g);
    };
  });
  renderList("all");
}

// ── Story reader ──────────────────────────────────────────────────────────────
async function renderReader(app, storyId, student, onBack) {
  const stories = await loadStories();
  const story = stories.find((s) => s.id === storyId);
  if (!story) { onBack(); return; }

  // Reset per-story state
  readerMarks[story.id] = readerMarks[story.id] || [];
  readerMarkSeq = 0;
  readerMarkerOn = false;
  readerSelCleanups.forEach((fn) => fn());
  readerSelCleanups = [];

  const textParas = String(story.text).split(/\n\n+/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
  const markup = textParas.map((text, pi) => {
    const rs = (readerMarks[story.id] || []).filter((m) => m.pi === pi).sort((a, b) => a.s - b.s);
    return `<p class="ppar" data-pi="${pi}">${renderPara(text, rs)}</p>`;
  }).join("");

  app.innerHTML = `
    <section class="wizard read-wiz">
      <div class="vocab-header">
        <button id="read-back" class="btn btn-ghost btn-sm">← Library</button>
        <div class="vocab-score-box" style="padding:6px 14px">
          <span class="vocab-score-label" style="font-size:11px">${esc(story.genre)}</span>
          <span class="vocab-score-num" style="font-size:18px">Grade ${story.grade}</span>
        </div>
        <span></span>
      </div>

      <div class="read-passage-wrap">
        <div class="passage-toolbar">
          <button id="read-toggle" class="mark-toggle">🖍️ Highlight</button>
          <button id="read-clear" class="mark-clear" style="display:none">Clear All</button>
          <div class="voice-picker">
            <select id="read-voice" class="voice-select" title="Choose reading voice">
              <optgroup label="Cartesia (AI voices)">
                ${CARTESIA_VOICES.map((v) => `<option value="cartesia:${esc(v.id)}" ${getVoicePref() === `cartesia:${v.id}` ? "selected" : ""}>${esc(v.name)} — ${esc(v.desc)}</option>`).join("")}
              </optgroup>
              <optgroup label="Built-in (this device)">
                <option value="builtin:default" ${getVoicePref() === "builtin:default" ? "selected" : ""}>Device Default</option>
                ${getBuiltinVoices().map((v) => `<option value="builtin:${esc(v.name)}" ${getVoicePref() === `builtin:${esc(v.name)}` ? "selected" : ""}>${esc(v.name)}</option>`).join("")}
              </optgroup>
            </select>
            <button id="read-tts" class="mark-clear">🔊 Read Aloud</button>
          </div>
          <span id="read-hint" class="mark-hint">Tap “🖍️ Highlight”, then select any words you want to mark.</span>
          <span id="read-tts-status" class="mark-hint" style="margin-left:auto;color:var(--blue-d);font-weight:700"></span>
        </div>
        <div class="passage-text" id="read-ptext">${markup}</div>
      </div>

      <div class="read-done-bar">
        <button id="read-done" class="btn btn-begin">✅ I'm Done Reading</button>
      </div>
    </section>`;

  app.querySelector("#read-back").onclick = onBack;

  // Highlight wiring
  const ptext = app.querySelector("#read-ptext");
  const toggle = app.querySelector("#read-toggle");
  const clear = app.querySelector("#read-clear");
  const hint = app.querySelector("#read-hint");

  toggle.onclick = () => {
    readerMarkerOn = !readerMarkerOn;
    ptext.classList.toggle("marker-on", readerMarkerOn);
    toggle.classList.toggle("on", readerMarkerOn);
    hint.textContent = readerMarkerOn
      ? "✋ Select any words with your finger or mouse to highlight them. Tap “?” to explain, “✕” to clear."
      : "Tap “🖍️ Highlight”, then select any words you want to mark.";
  };

  clear.onclick = () => {
    readerMarks[story.id] = [];
    ptext.innerHTML = textParas.map((text, pi) => {
      const rs = [];
      return `<p class="ppar" data-pi="${pi}">${renderPara(text, rs)}</p>`;
    }).join("");
    clear.style.display = "none";
  };

  // Click handler for mark tools
  ptext.onclick = (e) => {
    const qb = e.target.closest(".mark-q");
    if (qb) {
      e.stopPropagation();
      const m = ptext.querySelector(`.hl[data-mid="${qb.dataset.mid}"]`);
      if (m) explainSelectionText(m.textContent.trim(), m.getBoundingClientRect());
      return;
    }
    const xb = e.target.closest(".mark-x");
    if (xb) {
      e.stopPropagation();
      removeMark(story, +xb.dataset.mid);
      return;
    }
  };

  // Highlight on select — only on mouseup / touchend so the user has full
  // control: hold to select, release to confirm. No selectionchange listener
  // because it fires mid-drag and captures partial selections.
  ptext.addEventListener("mouseup", () => maybeHighlight(story, ptext, textParas));
  const onTouch = () => setTimeout(() => maybeHighlight(story, ptext, textParas), 250);
  ptext.addEventListener("touchend", onTouch);
  readerSelCleanups.push(() => {
    ptext.removeEventListener("touchend", onTouch);
  });

  // TTS Read Aloud — Cartesia by default, built-in as fallback option
  const ttsStatus = app.querySelector("#read-tts-status");
  app.querySelector("#read-tts").onclick = () => {
    const voicePref = app.querySelector("#read-voice")?.value || getVoicePref();
    speak(story.text, voicePref, (msg) => { if (ttsStatus) ttsStatus.textContent = msg; });
  };
  app.querySelector("#read-voice").onchange = (e) => {
    setVoicePref(e.target.value);
    // Refresh built-in voices if the picker is opened again
    if (isBuiltIn(e.target.value)) {
      const opts = e.target.querySelector('optgroup[label="Built-in (this device)"]');
      if (opts) {
        const existing = Array.from(opts.querySelectorAll('option:not([value="builtin:default"])')).map((o) => o.value);
        const fresh = getBuiltinVoices().filter((v) => !existing.includes(`builtin:${v.name}`));
        fresh.forEach((v) => {
          const o = document.createElement("option");
          o.value = `builtin:${esc(v.name)}`; o.textContent = esc(v.name);
          opts.appendChild(o);
        });
      }
    }
  };

  app.querySelector("#read-done").onclick = () => {
    try { if (readAudio) { readAudio.pause(); readAudio = null; } } catch {}
    window.speechSynthesis && window.speechSynthesis.cancel();
    renderComprehension(app, story, student, onBack);
  };
}

function maybeHighlight(story, ptext, textParas) {
  if (!readerMarkerOn) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.toString().trim()) return;
  const range = sel.getRangeAt(0);
  const paras = Array.from(ptext.querySelectorAll(".ppar"));
  const startP = closestPpar(range.startContainer);
  const endP = closestPpar(range.endContainer);
  if (!startP) { sel.removeAllRanges(); return; }
  const si = +startP.dataset.pi, ei = endP ? +endP.dataset.pi : si;
  let added = false;
  for (let pi = si; pi <= ei; pi++) {
    const pEl = paras[pi]; if (!pEl) continue;
    const len = pEl.textContent.length;
    const s = (pi === si) ? charOffset(pEl, range.startContainer, range.startOffset) : 0;
    const e = (pi === ei) ? charOffset(pEl, range.endContainer, range.endOffset) : len;
    if (e > s) { addRange(story.id, pi, s, e); added = true; }
  }
  sel.removeAllRanges();
  if (added) {
    ptext.innerHTML = textParas.map((text, pi) => {
      const rs = (readerMarks[story.id] || []).filter((m) => m.pi === pi).sort((a, b) => a.s - b.s);
      return `<p class="ppar" data-pi="${pi}">${renderPara(text, rs)}</p>`;
    }).join("");
    const clearBtn = ptext.closest(".read-wiz")?.querySelector("#read-clear");
    if (clearBtn) clearBtn.style.display = (readerMarks[story.id] || []).length ? "inline-flex" : "none";
  }
}

function addRange(pid, pi, s, e) {
  const list = (readerMarks[pid] || []).filter((m) => m && typeof m === "object");
  let ns = s, ne = e; const keep = [];
  for (const m of list) {
    if (m.pi !== pi || m.e < s || m.s > e) keep.push(m);
    else { ns = Math.min(ns, m.s); ne = Math.max(ne, m.e); }
  }
  keep.push({ id: ++readerMarkSeq, pi, s: ns, e: ne });
  readerMarks[pid] = keep;
}

function removeMark(story, mid) {
  readerMarks[story.id] = (readerMarks[story.id] || []).filter((m) => m.id !== mid);
  const ptext = document.querySelector("#read-ptext");
  if (!ptext) return;
  const textParas = String(story.text).split(/\n\n+/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
  ptext.innerHTML = textParas.map((text, pi) => {
    const rs = (readerMarks[story.id] || []).filter((m) => m.pi === pi).sort((a, b) => a.s - b.s);
    return `<p class="ppar" data-pi="${pi}">${renderPara(text, rs)}</p>`;
  }).join("");
  const clearBtn = ptext.closest(".read-wiz")?.querySelector("#read-clear");
  if (clearBtn) clearBtn.style.display = (readerMarks[story.id] || []).length ? "inline-flex" : "none";
}

// ── Comprehension ─────────────────────────────────────────────────────────────
function renderComprehension(app, story, student, onBack) {
  readerSelCleanups.forEach((fn) => fn());
  readerSelCleanups = [];

  const questions = story.questions || [];
  app.innerHTML = `
    <section class="wizard read-wiz">
      <div class="vocab-header">
        <button id="comp-back" class="btn btn-ghost btn-sm">← Back to Story</button>
        <div class="vocab-score-box" style="padding:6px 14px">
          <span class="vocab-score-label" style="font-size:11px">Comprehension</span>
          <span class="vocab-score-num" style="font-size:18px">${esc(story.title)}</span>
        </div>
        <span></span>
      </div>
      <div class="hero"><h1>📝 Check Your Understanding</h1><p>Answer these questions about the story.</p></div>
      <div id="comp-form" class="comp-form">
        ${questions.map((q, i) => `
          <div class="comp-q" data-qid="${esc(q.id)}">
            <div class="comp-q-num">Question ${i + 1} of ${questions.length}</div>
            <div class="comp-q-text">${esc(q.question)}</div>
            ${q.hints ? `<div class="comp-hint">💡 Hint: ${esc(q.hints[0])}</div>` : ""}
            <div class="comp-input-wrap">
              <textarea class="comp-input" data-qid="${esc(q.id)}" rows="3" placeholder="Type your answer here…"></textarea>
              <button class="comp-mic" data-qid="${esc(q.id)}" title="Speak your answer">🎤</button>
            </div>
            <div class="comp-mic-status" id="mic-${esc(q.id)}"></div>
          </div>
        `).join("")}
      </div>
      <div class="read-done-bar">
        <button id="comp-submit" class="btn btn-begin">Submit Answers →</button>
      </div>
    </section>`;

  app.querySelector("#comp-back").onclick = () => renderReader(app, story.id, student, onBack);

  // Wire up voice input
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  questions.forEach((q) => {
    const micBtn = app.querySelector(`.comp-mic[data-qid="${q.id}"]`);
    const textarea = app.querySelector(`textarea[data-qid="${q.id}"]`);
    const status = app.querySelector(`#mic-${q.id}`);
    if (!micBtn || !SpeechRecognition) {
      if (micBtn) micBtn.style.display = "none";
      return;
    }
    let rec = null;
    micBtn.onclick = () => {
      if (rec && rec.recording) { rec.stop(); return; }
      try {
        rec = new SpeechRecognition();
        rec.lang = "en-US";
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.recording = true;
        micBtn.classList.add("rec");
        if (status) status.textContent = "Listening…";
        let final = textarea.value ? textarea.value + " " : "";
        rec.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t + " ";
            else interim = t;
          }
          textarea.value = (final + interim).trim();
        };
        rec.onerror = () => { micBtn.classList.remove("rec"); rec.recording = false; if (status) status.textContent = ""; };
        rec.onend = () => { micBtn.classList.remove("rec"); rec.recording = false; if (status) status.textContent = ""; };
        rec.start();
      } catch {
        micBtn.style.display = "none";
      }
    };
  });

  app.querySelector("#comp-submit").onclick = () => {
    const answers = {};
    questions.forEach((q) => {
      const val = app.querySelector(`textarea[data-qid="${q.id}"]`)?.value?.trim() || "";
      answers[q.id] = val;
    });
    if (Object.values(answers).some((v) => !v)) {
      if (!confirm("Some questions are empty. Submit anyway?")) return;
    }
    submitComprehension(app, story, answers, student, onBack);
  };
}

async function submitComprehension(app, story, answers, student, onBack) {
  app.innerHTML = `
    <section class="wizard center">
      <div class="generating">
        <div class="spinner"></div>
        <h2>Checking your answers… ✨</h2>
        <p>Our reading buddy is looking at what you wrote.</p>
      </div>
    </section>`;

  const qaPairs = story.questions.map((q) => ({
    question: q.question,
    answer: answers[q.id] || "(no answer)",
    hint: q.hints?.[0] || "",
  }));

  const sys = `You are a kind reading teacher for a Grade ${story.grade} child. The child just read a story and answered comprehension questions. Review their answers gently and constructively.

For each question:
1. Say whether the answer shows good understanding (✓), partial understanding (~), or needs more work (✗).
2. Praise what they got right.
3. If the answer is incomplete or incorrect, give a gentle hint to help them think deeper. Never just give the full answer.
4. Keep feedback to 2-3 sentences per question.

Story title: ${story.title}
Story text: ${story.text.slice(0, 2000)}`;

  const user = qaPairs.map((qa, i) => `Q${i + 1}: ${qa.question}\nChild's answer: ${qa.answer}`).join("\n\n");

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: sys, messages: [{ role: "user", content: user }], mute: true }),
    });
    const d = await r.json();
    const feedback = d.text || "Great effort! Keep reading and thinking.";

    app.innerHTML = `
      <section class="wizard read-wiz">
        <div class="vocab-header">
          <button id="fb-back" class="btn btn-ghost btn-sm">← Library</button>
          <div class="vocab-score-box" style="padding:6px 14px">
            <span class="vocab-score-label" style="font-size:11px">Feedback</span>
          </div>
          <span></span>
        </div>
        <div class="hero"><h1>🌟 Great Job Reading!</h1><p>Here is what your reading buddy thinks.</p></div>
        <div class="comp-feedback">
          <div class="dict-meaning" style="white-space:pre-line;font-size:16px;line-height:1.7">${esc(feedback)}</div>
        </div>
        <div class="read-done-bar">
          <button id="fb-again" class="btn btn-begin">Read Another Story →</button>
        </div>
      </section>`;
    app.querySelector("#fb-back").onclick = onBack;
    app.querySelector("#fb-again").onclick = onBack;
  } catch (e) {
    app.innerHTML = `
      <section class="wizard center">
        <div class="namecard">
          <div class="name-emoji">😕</div>
          <h1>Couldn't check answers</h1>
          <p class="name-info">${esc(e.message || "Please try again.")}</p>
          <button id="fb-retry" class="btn btn-begin">Try Again</button>
        </div>
      </section>`;
    app.querySelector("#fb-retry").onclick = () => submitComprehension(app, story, answers, student, onBack);
  }
}
