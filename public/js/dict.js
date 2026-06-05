// Double-click word lookup: kid-friendly meaning + example + text-to-speech.
// TTS uses the browser Web Speech API (free, offline). Definitions come from
// /api/define (OpenAI-backed, cached in D1).

const LOOKUP_IN = ".passage-text, .passage-title, .q-text, .opt-text, .rv-q, .rv-exp, .genre-q";
const SELECT_IN = ".passage-text, .q-text, .opt-text"; // where "explain this part" is offered
let popEl = null;
let selBtn = null;     // floating "Explain this part" button
let explEl = null;     // explanation popover
let explAudio = null;
let started = false;

export function initDict() {
  if (started) return;
  started = true;
  document.addEventListener("dblclick", onDblClick, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePopover(); closeExplain(); hideSelBtn(); } });
  window.addEventListener("resize", () => { closePopover(); closeExplain(); hideSelBtn(); });
  document.addEventListener("click", (e) => {
    if (popEl && !popEl.contains(e.target)) closePopover();
    if (explEl && !explEl.contains(e.target) && (!selBtn || !selBtn.contains(e.target))) closeExplain();
  });
  // phrase/sentence selection → "Explain this part"
  document.addEventListener("mouseup", onSelectMaybe);
  document.addEventListener("touchend", () => setTimeout(onSelectMaybe, 10));
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

// ── "Explain this part" on a highlighted phrase ──────────────────────────────
function onSelectMaybe(e) {
  if (selBtn && selBtn.contains(e.target)) return;          // ignore clicks on our button
  const sel = window.getSelection();
  const raw = (sel ? sel.toString() : "").trim();
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 60) { hideSelBtn(); return; }
  let container;
  try { container = sel.getRangeAt(0).commonAncestorContainer; } catch { hideSelBtn(); return; }
  const el = (container.nodeType === 1 ? container : container.parentElement);
  const host = el && el.closest && el.closest(SELECT_IN);
  if (!host) { hideSelBtn(); return; }
  if (host.closest(".passage.marker-on")) { hideSelBtn(); return; } // highlighter handles selections
  let rect; try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch { hideSelBtn(); return; }
  showSelBtn(rect, raw, host);
}

function showSelBtn(rect, text, host) {
  hideSelBtn();
  selBtn = document.createElement("button");
  selBtn.className = "sel-explain-btn";
  selBtn.textContent = "💬 Explain this part";
  document.body.appendChild(selBtn);
  const w = selBtn.offsetWidth || 150;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = rect.top - selBtn.offsetHeight - 8;
  if (top < 6) top = rect.bottom + 8;
  selBtn.style.left = left + "px";
  selBtn.style.top = top + "px";
  selBtn.onclick = (ev) => { ev.stopPropagation(); openExplain(text, host, rect); };
}
function hideSelBtn() { if (selBtn) { selBtn.remove(); selBtn = null; } }

function openExplain(selection, host, rect) { explainSelectionText(selection, rect); }

// Explain an arbitrary phrase/sentence (used by drag-select and the passage highlighter).
export function explainSelectionText(selection, rect) {
  hideSelBtn();
  closeExplain();
  // Use the passage shown on the page (so option-text selections still get full context).
  const passageText = ((document.querySelector(".passage-text") || document.querySelector(".passage") || document.body).textContent || "").slice(0, 4000);
  const questionText = (document.querySelector(".q-text")?.textContent || "").slice(0, 400);
  const muted = (() => { try { return localStorage.getItem("buddyVoice") === "off"; } catch { return false; } })();
  explEl = document.createElement("div");
  explEl.className = "dict-pop expl-pop";
  explEl.innerHTML = `
    <div class="dict-head"><span class="dict-word">💬 What this means</span><button class="dict-close">✕</button></div>
    <div class="dict-body"><div class="dict-loading"><span class="dict-spin"></span> Thinking…</div></div>`;
  document.body.appendChild(explEl);
  position(explEl, rect);
  explEl.querySelector(".dict-close").onclick = closeExplain;

  fetch("/api/passage-explain", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grade: 3, passageText, questionText, selection, mute: muted }),
  }).then(async (r) => {
    if (!r.ok) throw new Error();
    let text = "", audio = null;
    if (muted) { text = (await r.json()).text || ""; }
    else { text = decodeURIComponent(r.headers.get("X-Tutor-Text") || ""); audio = await r.arrayBuffer(); }
    if (!explEl) return;
    explEl.querySelector(".dict-body").innerHTML =
      `<div class="expl-sel">“${esc(selection.length > 90 ? selection.slice(0, 90) + "…" : selection)}”</div>
       <div class="dict-meaning">${esc(text)}</div>`;
    if (audio) {
      try { if (explAudio) explAudio.pause(); } catch {}
      explAudio = new Audio(URL.createObjectURL(new Blob([audio], { type: "audio/mpeg" })));
      explAudio.play().catch(() => {});
    }
  }).catch(() => {
    if (explEl) explEl.querySelector(".dict-body").innerHTML =
      `<div class="dict-meaning">${navigator.onLine ? "Couldn't explain that right now." : "Connect to the internet to explain a phrase."}</div>`;
  });
}
function closeExplain() {
  if (explAudio) { try { explAudio.pause(); } catch {} explAudio = null; }
  if (explEl) { explEl.remove(); explEl = null; }
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
