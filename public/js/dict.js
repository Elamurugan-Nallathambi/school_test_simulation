// Double-click word lookup: kid-friendly meaning + example + text-to-speech.
// TTS uses the browser Web Speech API (free, offline). Definitions come from
// /api/define (OpenAI-backed, cached in D1).

const LOOKUP_IN = ".passage-text, .passage-title, .q-text, .opt-text, .rv-q, .rv-exp, .genre-q";
let popEl = null;
let started = false;

export function initDict() {
  if (started) return;
  started = true;
  document.addEventListener("dblclick", onDblClick, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopover(); });
  window.addEventListener("resize", closePopover);
  document.addEventListener("click", (e) => {
    if (popEl && !popEl.contains(e.target)) closePopover();
  });
}

function onDblClick(e) {
  const inText = e.target.closest && e.target.closest(LOOKUP_IN);
  if (!inText) return;
  const sel = window.getSelection();
  const raw = (sel ? sel.toString() : "").trim();
  const word = raw.replace(/[^A-Za-z'\-]/g, "");
  if (!word || word.length < 2 || /\s/.test(raw)) return;
  let rect;
  try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch { return; }
  const context = (inText.textContent || "").slice(0, 280);
  openPopover(word, rect, context);
}

function openPopover(word, rect, context) {
  closePopover();
  popEl = document.createElement("div");
  popEl.className = "dict-pop";
  popEl.innerHTML = `
    <div class="dict-head">
      <span class="dict-word">${esc(word)}</span>
      <button class="dict-speak" title="Hear the word" data-say="${esc(word)}">🔊</button>
      <button class="dict-close" title="Close">✕</button>
    </div>
    <div class="dict-body"><div class="dict-loading"><span class="dict-spin"></span> Looking it up…</div></div>`;
  document.body.appendChild(popEl);
  position(popEl, rect);

  popEl.querySelector(".dict-close").onclick = closePopover;
  popEl.querySelector(".dict-speak").onclick = () => speak(word);
  // auto-speak the word on open (kid-friendly)
  speak(word);

  fetch(`/api/define?word=${encodeURIComponent(word)}&context=${encodeURIComponent(context)}`)
    .then((r) => r.json())
    .then((d) => {
      if (!popEl) return;
      const body = popEl.querySelector(".dict-body");
      if (!d || !d.meaning) {
        body.innerHTML = `<div class="dict-meaning">Hmm, I couldn't find that word. Try another one!</div>`;
        return;
      }
      body.innerHTML = `
        ${d.phonetic ? `<div class="dict-phon">${esc(d.phonetic)}${d.partOfSpeech ? ` · <i>${esc(d.partOfSpeech)}</i>` : ""}</div>` : ""}
        <div class="dict-meaning">${esc(d.meaning)}</div>
        ${d.example ? `<div class="dict-example">“${esc(d.example)}” <button class="dict-speak sm" title="Hear the sentence">🔊</button></div>` : ""}`;
      const ex = body.querySelector(".dict-example .dict-speak");
      if (ex) ex.onclick = () => speak(d.example);
    })
    .catch(() => {
      if (popEl) popEl.querySelector(".dict-body").innerHTML = `<div class="dict-meaning">Couldn't load the meaning. Check your connection.</div>`;
    });
}

function position(el, rect) {
  const pad = 8, w = 280;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
  let top = rect.bottom + 10;
  el.style.left = left + "px";
  el.style.width = w + "px";
  // flip above if near bottom
  if (rect.bottom + 180 > window.innerHeight) {
    top = Math.max(pad, rect.top - 10 - el.offsetHeight);
  }
  el.style.top = top + "px";
}

function closePopover() {
  if (popEl) { popEl.remove(); popEl = null; }
}

// ── text to speech ───────────────────────────────────────────────────────────
let voice = null;
function pickVoice() {
  if (!("speechSynthesis" in window)) return null;
  const vs = window.speechSynthesis.getVoices() || [];
  return vs.find((v) => /en[-_]US/i.test(v.lang) && /female|samantha|zira|google/i.test(v.name))
    || vs.find((v) => /^en/i.test(v.lang)) || vs[0] || null;
}
export function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    if (!voice) voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = "en-US"; u.rate = 0.9; u.pitch = 1.05;
    window.speechSynthesis.speak(u);
  } catch {}
}
if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
