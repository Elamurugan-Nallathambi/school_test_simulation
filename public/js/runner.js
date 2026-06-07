// Exam runner: timed test, navigation, autosave, guidance mode, grading.
import { renderDiagram } from "./diagrams.js";
import { saveAttempt } from "./api.js";
import { gradeTest, isCorrect } from "./grade.js";
import { renderResults, normalizeGenre, genreOptions, genreLabel } from "./review.js";
import { officialTiming } from "./timing.js";
import { Buddy } from "./buddy.js";
import { explainSelectionText } from "./dict.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paras = (t) => esc(t).split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
// Tools next to a highlight. Buttons have NO text (symbols via CSS ::before) so they
// don't change the paragraph's textContent — keeping selection offsets accurate.
const markTools = (id) => `<span class="mark-tools" contenteditable="false"><button class="mark-q" data-mid="${id}" title="Explain this part" aria-label="Explain"></button><button class="mark-x" data-mid="${id}" title="Clear highlight" aria-label="Clear"></button></span>`;
function closestPpar(node) { const el = node && (node.nodeType === 1 ? node : node.parentElement); return el && el.closest ? el.closest(".ppar") : null; }
function charOffset(container, node, off) { try { const r = document.createRange(); r.setStart(container, 0); r.setEnd(node, off); return r.toString().length; } catch { return 0; } }
function renderPara(text, ranges) {
  let out = "", pos = 0;
  for (const r of ranges) {
    const s = Math.max(0, Math.min(r.s, text.length)), e = Math.max(s, Math.min(r.e, text.length));
    if (e <= s) continue;
    if (s > pos) out += esc(text.slice(pos, s));
    out += `<mark class="hl" data-mid="${r.id}">${esc(text.slice(s, e))}</mark>` + markTools(r.id);
    pos = e;
  }
  out += esc(text.slice(pos));
  return out;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export class Runner {
  constructor(root, test, student, opts = {}) {
    this.root = root;
    this.test = test;
    this.student = student;
    this.onExit = opts.onExit;
    this.onHistory = opts.onHistory;
    this.onRetake = opts.onRetake;
    this.onPause = opts.onPause;
    this.guidance = !!opts.guidance;
    this.validateMode = !!opts.validate; // self-check: lock answer & show if right (separate from guidance)
    this.validated = {};     // qid -> bool (answer validated → locked, feedback shown)
    this.navCollapsed = (() => { try { return localStorage.getItem("navCollapsed") === "1"; } catch { return false; } })();
    this.buddy = null;       // conversational AI reading buddy for the current question
    this.markerOn = false;   // passage highlighter mode
    this.marks = {};         // passageId -> [{id,pi,s,e}] ranges the child highlighted
    this.markSeq = 0;
    this.struck = {};        // qid -> [option indices crossed out] (visual only, not scored)
    this.qs = test.questions;
    this.passById = Object.fromEntries((test.passages || []).map((p) => [p.id, p]));
    this.storeKey = `attempt:${test.id}:${student}`;
    this.idx = 0;
    this.responses = {};   // qid -> answer; also "__genre__<pid>" -> genre pick
    this.flags = {};
    this.revealed = {};    // qid -> bool (guidance: show answer)
    this.checkMsg = {};    // qid -> {text,cls} (guidance: check answer)
    this.submitted = false;
    this.startTs = Date.now();
    this.timing = officialTiming(test.testType);
    this.suggestedSec = (test.timeLimitMinutes || this.timing.suggested) * 60;
    this.maxSec = Math.max(this.timing.max * 60, this.suggestedSec);
    this.elapsed = 0;
    this.restore();
  }

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.storeKey) || "null");
      if (saved && saved.testId === this.test.id) {
        this.responses = saved.responses || {};
        this.flags = saved.flags || {};
        this.idx = saved.idx || 0;
        if (typeof saved.elapsed === "number") this.elapsed = saved.elapsed;
        if (typeof saved.guidance === "boolean") this.guidance = saved.guidance;
        if (typeof saved.validate === "boolean") this.validateMode = saved.validate;
        if (saved.validated && typeof saved.validated === "object") this.validated = saved.validated;
        if (saved.marks && typeof saved.marks === "object") {
          this.marks = saved.marks;
          for (const list of Object.values(this.marks)) for (const m of (list || [])) if (m && m.id > this.markSeq) this.markSeq = m.id;
        }
        if (saved.struck && typeof saved.struck === "object") this.struck = saved.struck;
      }
    } catch {}
  }
  persist() {
    try {
      localStorage.setItem(this.storeKey, JSON.stringify({
        testId: this.test.id, responses: this.responses, flags: this.flags,
        idx: this.idx, elapsed: this.elapsed, guidance: this.guidance, marks: this.marks, struck: this.struck,
        validate: this.validateMode, validated: this.validated,
        // display metadata so the landing can show resumable tests without an API call
        title: this.test.title, subject: this.test.subject, testType: this.test.testType,
        grade: this.test.grade, total: this.qs.length, savedAt: Date.now(),
      }));
    } catch {}
  }

  start() {
    this.renderShell();
    this.renderQuestion();
    this.tick = setInterval(() => this.onTick(), 1000);
  }
  stop() { if (this.tick) clearInterval(this.tick); }

  // Pause: save progress, freeze the timer, and go home. The test stays resumable.
  pause() {
    if (this.submitted) return;
    this.persist();
    this.stop();
    this.stopTutor();
    if (this.onPause) this.onPause();
  }

  onTick() {
    if (this.submitted) return;
    this.elapsed++;
    this.updateTimer();
    if (this.elapsed % 5 === 0) this.persist();
    if (this.elapsed >= this.maxSec) this.submit(true);
  }

  // ── shell ──────────────────────────────────────────────────────────────────
  renderShell() {
    const t = this.test;
    this.root.innerHTML = `
      <div class="runner ${this.navCollapsed ? "nav-collapsed" : ""}">
        <header class="run-head">
          <div class="run-head-left">
            <span class="badge subj-${t.subject}">${t.subject === "math" ? "🔢 Math" : "📖 Reading"}</span>
            <div class="run-title">
              <strong>${esc(t.title)}</strong>
              <span class="run-student">👋 ${esc(this.student)}${this.guidance ? ' · <span class="guide-tag">🧭 Guidance on</span>' : ""}${this.validateMode ? ' · <span class="guide-tag validate-tag">✅ Validate on</span>' : ""}</span>
            </div>
          </div>
          <div class="run-head-right">
            <div id="timer" class="timer" title="Time"></div>
            <button id="btn-pause" class="btn btn-pause" title="Pause and go home — your progress is saved so you can resume later">⏸ Pause</button>
            <button id="btn-submit" class="btn btn-submit">Finish ✓</button>
          </div>
        </header>
        <div class="run-body">
          <main id="q-area" class="q-area"></main>
          <aside class="q-nav">
            <div class="q-nav-title">Questions <button id="nav-fold" class="nav-fold" title="Hide questions panel">»</button></div>
            <div id="q-grid" class="q-grid"></div>
            <div class="q-nav-legend">
              <span><i class="dot answered"></i> Answered</span>
              <span><i class="dot flagged"></i> Flagged</span>
              <span><i class="dot"></i> Unseen</span>
            </div>
            <div class="q-nav-tip">💡 Double-click any word to hear it and see what it means.</div>
          </aside>
          <button id="nav-show" class="nav-show" title="Show questions panel">‹ Questions</button>
        </div>
        <footer class="run-foot">
          <button id="btn-prev" class="btn btn-ghost">← Prev</button>
          <button id="btn-flag" class="btn btn-ghost">⚑ Flag</button>
          <button id="btn-next" class="btn btn-primary">Next →</button>
        </footer>
      </div>`;
    this.root.querySelector("#btn-prev").onclick = () => this.go(this.idx - 1);
    this.root.querySelector("#btn-next").onclick = () => this.next();
    this.root.querySelector("#btn-flag").onclick = () => this.toggleFlag();
    this.root.querySelector("#btn-submit").onclick = () => this.confirmSubmit();
    this.root.querySelector("#btn-pause").onclick = () => this.pause();
    const fold = this.root.querySelector("#nav-fold");
    const show = this.root.querySelector("#nav-show");
    if (fold) fold.onclick = () => this.setNav(true);
    if (show) show.onclick = () => this.setNav(false);
    this.updateTimer();
    this.renderGrid();
  }

  setNav(collapsed) {
    this.navCollapsed = collapsed;
    try { localStorage.setItem("navCollapsed", collapsed ? "1" : "0"); } catch {}
    const r = this.root.querySelector(".runner");
    if (r) r.classList.toggle("nav-collapsed", collapsed);
  }

  updateTimer() {
    const el = this.root.querySelector("#timer");
    if (!el) return;
    const over = this.elapsed > this.suggestedSec;
    el.classList.toggle("warn", !over && this.suggestedSec - this.elapsed <= 300 && this.suggestedSec - this.elapsed > 60);
    el.classList.toggle("danger", !over && this.suggestedSec - this.elapsed <= 60);
    el.classList.toggle("overtime", over);
    if (!over) {
      const rem = this.suggestedSec - this.elapsed;
      el.textContent = `⏱ ${fmt(rem)}`;
      el.title = `Suggested time left (up to ${Math.round(this.maxSec / 60)} min allowed)`;
    } else {
      const overBy = this.elapsed - this.suggestedSec;
      el.textContent = `＋${fmt(overBy)} ⏱`;
      el.title = `Over the suggested time — you can keep going (max ${Math.round(this.maxSec / 60)} min)`;
    }
  }

  renderGrid() {
    const grid = this.root.querySelector("#q-grid");
    grid.innerHTML = this.qs.map((q, i) => {
      const cls = ["q-cell"];
      if (i === this.idx) cls.push("current");
      if (this.isAnswered(q.id)) cls.push("answered");
      if (this.flags[q.id]) cls.push("flagged");
      return `<button class="${cls.join(" ")}" data-i="${i}">${i + 1}</button>`;
    }).join("");
    grid.querySelectorAll("button").forEach((b) => (b.onclick = () => this.go(+b.dataset.i)));
  }

  isAnswered(qid) {
    const r = this.responses[qid];
    if (r == null) return false;
    if (Array.isArray(r)) return r.length > 0;
    return r !== "";
  }

  go(i) {
    if (i < 0 || i >= this.qs.length) return;
    this.idx = i;
    this.persist();
    this.renderQuestion();
    this.renderGrid();
  }
  // On the last question this finishes the test (and shows the review); otherwise advances.
  next() {
    if (this.idx >= this.qs.length - 1) this.confirmSubmit();
    else this.go(this.idx + 1);
  }
  toggleFlag() {
    const q = this.qs[this.idx];
    this.flags[q.id] = !this.flags[q.id];
    this.persist();
    this.renderGrid();
    this.renderQuestion();
  }

  // ── question view ────────────────────────────────────────────────────────────
  renderQuestion() {
    this.stopTutor();
    const q = this.qs[this.idx];
    const area = this.root.querySelector("#q-area");
    const passage = q.passageId ? this.passById[q.passageId] : null;

    const hasMarks = passage && (this.marks[passage.id] || []).length > 0;
    const passageHtml = passage ? `
      <section class="passage ${this.markerOn ? "marker-on" : ""}">
        <div class="passage-inner">
          <div class="passage-toolbar">
            <button id="mark-toggle" class="mark-toggle ${this.markerOn ? "on" : ""}" type="button">🖍️ Highlight</button>
            <button id="mark-clear" class="mark-clear" type="button" style="display:${hasMarks ? "inline-flex" : "none"}">✕ Clear all</button>
            <span id="mark-hint" class="mark-hint">${this.markHintText()}</span>
          </div>
          <h3 class="passage-title">${esc(passage.title || "Passage")}</h3>
          <div class="passage-text">${this.markupPassage(passage)}</div>
          ${this.genreCheckHtml(passage)}
        </div>
      </section>` : "";

    const diagramHtml = q.diagram ? `<div class="q-diagram">${renderDiagram(q.diagram)}</div>` : "";

    const qBody = `
      <section class="question ${passage ? "" : "no-passage"}">
        <div class="q-scroll">
          <div class="q-meta">
            <span class="q-num">Question ${this.idx + 1} of ${this.qs.length}</span>
            ${q.skill ? `<span class="q-skill">${esc(q.skill)}</span>` : ""}
            ${this.flags[q.id] ? `<span class="q-flagged">⚑ Flagged</span>` : ""}
          </div>
          <div class="q-text">${esc(q.questionText).replace(/\n/g, "<br>")}</div>
          ${this.tutorBarHtml()}
          ${diagramHtml}
          ${this.renderInput(q)}
          ${this.validateBarHtml(q)}
          ${this.guidanceBarHtml(q)}
        </div>
      </section>`;

    area.className = "q-area" + (passage ? " with-passage" : "");
    area.innerHTML = passageHtml + qBody;
    this.wireInputs(q);
    if (passage) { this.wireGenre(passage); this.wirePassage(passage); }
    this.wireGuidance(q);
    this.wireValidate(q);
    this.wireTutor(q);

    this.root.querySelector("#btn-prev").disabled = this.idx === 0;
    this.root.querySelector("#btn-next").textContent = this.idx === this.qs.length - 1 ? "Finish & Review →" : "Next →";
    this.root.querySelector("#btn-flag").classList.toggle("active", !!this.flags[q.id]);
  }

  // ── passage highlighter ──────────────────────────────────────────────────────
  markHintText() {
    return this.markerOn
      ? "✋ Select any words with your finger or mouse to highlight them. Tap “?” to explain, “✕” to clear."
      : "Tap “🖍️ Highlight”, then select any words you want to mark.";
  }
  markupPassage(passage) {
    const ranges = (this.marks[passage.id] || []).filter((m) => m && typeof m === "object");
    const byPi = {};
    for (const m of ranges) (byPi[m.pi] = byPi[m.pi] || []).push(m);
    const paras = String(passage.text).split(/\n\n+/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
    return paras.map((text, pi) => {
      const rs = (byPi[pi] || []).slice().sort((a, b) => a.s - b.s);
      return `<p class="ppar" data-pi="${pi}">${renderPara(text, rs)}</p>`;
    }).join("");
  }
  wirePassage(passage) {
    const section = this.root.querySelector(".passage");
    if (!section) return;
    const toggle = section.querySelector("#mark-toggle");
    const clear = section.querySelector("#mark-clear");
    const hint = section.querySelector("#mark-hint");
    const ptext = section.querySelector(".passage-text");
    if (toggle) toggle.onclick = () => {
      this.markerOn = !this.markerOn;
      section.classList.toggle("marker-on", this.markerOn);
      toggle.classList.toggle("on", this.markerOn);
      if (hint) hint.textContent = this.markHintText();
    };
    if (clear) clear.onclick = () => this.clearMarks(passage);
    if (ptext) {
      ptext.onclick = (e) => {
        const qb = e.target.closest(".mark-q");
        if (qb) { e.stopPropagation(); this.explainMark(qb.dataset.mid); return; }
        const xb = e.target.closest(".mark-x");
        if (xb) { e.stopPropagation(); this.removeMark(passage, +xb.dataset.mid); return; }
      };
      ptext.addEventListener("mouseup", () => this.maybeHighlight(passage));
      ptext.addEventListener("touchend", () => setTimeout(() => this.maybeHighlight(passage), 10));
    }
  }
  maybeHighlight(passage) {
    if (!this.markerOn) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.toString().trim()) return;
    const range = sel.getRangeAt(0);
    const ptext = this.root.querySelector(".passage-text");
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
      if (e > s) { this.addRange(passage.id, pi, s, e); added = true; }
    }
    sel.removeAllRanges();
    if (added) { ptext.innerHTML = this.markupPassage(passage); this.refreshClear(passage); this.persist(); }
  }
  addRange(pid, pi, s, e) {
    const list = (this.marks[pid] || []).filter((m) => m && typeof m === "object");
    let ns = s, ne = e; const keep = [];
    for (const m of list) {
      if (m.pi !== pi || m.e < s || m.s > e) keep.push(m);     // no overlap → keep
      else { ns = Math.min(ns, m.s); ne = Math.max(ne, m.e); } // overlap → merge
    }
    keep.push({ id: ++this.markSeq, pi, s: ns, e: ne });
    this.marks[pid] = keep;
  }
  removeMark(passage, mid) {
    this.marks[passage.id] = (this.marks[passage.id] || []).filter((m) => m.id !== mid);
    const ptext = this.root.querySelector(".passage-text");
    if (ptext) ptext.innerHTML = this.markupPassage(passage);
    this.refreshClear(passage); this.persist();
  }
  clearMarks(passage) {
    this.marks[passage.id] = [];
    const ptext = this.root.querySelector(".passage-text");
    if (ptext) ptext.innerHTML = this.markupPassage(passage);
    this.refreshClear(passage); this.persist();
  }
  refreshClear(passage) {
    const clear = this.root.querySelector("#mark-clear");
    if (clear) clear.style.display = (this.marks[passage.id] || []).length ? "inline-flex" : "none";
  }
  explainMark(mid) {
    const m = this.root.querySelector(`.hl[data-mid="${mid}"]`);
    if (m) explainSelectionText(m.textContent.trim(), m.getBoundingClientRect());
  }

  // genre self-check below a passage (validated, not part of the question score)
  genreCheckHtml(passage) {
    const pick = this.responses["__genre__" + passage.id];
    const correct = normalizeGenre(passage.genre, this.test.grade);
    const opts = genreOptions(this.test.grade);
    const fine = Number(this.test.grade) >= 5;
    let fb = "";
    if (pick) {
      if (this.guidance) {
        const ok = pick === correct;
        fb = `<div class="genre-fb ${ok ? "ok" : "no"}">${ok ? "✓ Yes! " : "✗ Not quite — "}This is ${genreLabel(correct)}.</div>`;
      } else {
        fb = `<div class="genre-fb saved">Saved ✓ — we'll check it at the end.</div>`;
      }
    }
    return `
      <div class="genre-check" data-pid="${passage.id}">
        <div class="genre-q">📋 What ${fine ? "genre" : "type of text"} is this?</div>
        <div class="genre-opts">
          ${opts.map((g) => `<button class="genre-opt ${pick === g.v ? "selected" : ""}" data-g="${g.v}">${g.label}</button>`).join("")}
        </div>
        ${fb}
      </div>`;
  }

  // ── AI reading buddy (conversational) — uses the shared Buddy controller ──────
  tutorBarHtml() { return `<div class="tutor-panel" id="tutor-mount"></div>`; }
  wireTutor(q) {
    const mount = this.root.querySelector("#tutor-mount");
    if (!mount) return;
    const passage = q.passageId ? this.passById[q.passageId] : null;
    this.buddy = new Buddy({
      subject: this.test.subject, grade: this.test.grade, passage,
      questionText: q.questionText, options: q.options || [],
    });
    this.buddy.mount(mount);
  }
  stopTutor() { if (this.buddy) this.buddy.stop(); }

  guidanceBarHtml(q) {
    if (!this.guidance) return "";
    const msg = this.checkMsg[q.id];
    const revealed = this.revealed[q.id];
    let reveal = "";
    if (revealed) {
      const ans = this.correctText(q);
      reveal = `<div class="reveal-box">✅ <b>Answer:</b> ${ans}${q.explanation ? `<div class="reveal-exp">${esc(q.explanation)}</div>` : ""}</div>`;
    }
    return `
      <div class="guide-bar">
        <button id="g-check" class="btn btn-ghost sm">✓ Check my answer</button>
        <button id="g-show" class="btn btn-ghost sm">${revealed ? "🙈 Hide answer" : "👁 Show answer"}</button>
        ${msg ? `<span class="guide-msg ${msg.cls}">${esc(msg.text)}</span>` : ""}
      </div>
      ${reveal}`;
  }

  correctText(q) {
    if (q.itemType === "numeric_entry") return esc(q.answer);
    if (q.itemType === "equation") return esc(String(q.template || "").replace("▢", q.answer));
    const idxs = Array.isArray(q.answer) ? q.answer : [q.answer];
    return idxs.map((x) => `${LETTERS[x]}. ${esc((q.options || [])[x])}`).join("; ");
  }

  // An answer is locked (read-only, with the correct answer marked) once it's been
  // revealed via guidance OR validated via the self-check button.
  isLocked(q) {
    return (this.guidance && !!this.revealed[q.id]) || (this.validateMode && !!this.validated[q.id]);
  }

  renderInput(q) {
    const revealed = this.isLocked(q);
    const r = this.responses[q.id];
    if (q.itemType === "numeric_entry") {
      return `
        <div class="answer numeric">
          <label class="numeric-label">Type your answer:</label>
          <input id="num-input" class="numeric-input" type="text" inputmode="text"
                 autocomplete="off" value="${r != null ? esc(r) : ""}" placeholder="answer" ${revealed ? "disabled" : ""}/>
        </div>`;
    }
    if (q.itemType === "equation") {
      const tpl = String(q.template || "▢");
      const parts = tpl.split("▢");
      const box = `<input id="eq-input" class="eq-input" type="text" inputmode="numeric" autocomplete="off" value="${r != null ? esc(r) : ""}" placeholder="?" ${revealed ? "disabled" : ""}/>`;
      const eq = parts.map((p) => esc(p)).join(box);
      return `
        <div class="answer equation">
          <label class="numeric-label">Fill in the blank to make it true:</label>
          <div class="eq-line">${eq}</div>
        </div>`;
    }
    const multi = q.itemType === "multi_select";
    const sel = multi ? (Array.isArray(r) ? r : []) : r;
    const answerSet = new Set(Array.isArray(q.answer) ? q.answer : [q.answer]);
    const hint = multi
      ? `<div class="multi-hint">✔ Tap all the circles that apply</div>`
      : `<div class="opt-help">Tap the circle to choose · highlight any answer text and tap “💬 Explain this part”.</div>`;
    // The circle (A/B/C/D) is the selector; the text stays plain & selectable so the
    // child can highlight an answer to ask the AI to explain it.
    const struck = new Set(this.struck[q.id] || []);
    const opts = (q.options || []).map((opt, i) => {
      const on = multi ? sel.includes(i) : sel === i;
      let mark = "";
      if (revealed) {
        if (answerSet.has(i)) mark = " correct-opt";
        else if (on) mark = " wrong-opt";
      }
      const isStruck = struck.has(i);
      const face = revealed && answerSet.has(i) ? "✓" : LETTERS[i];
      return `
        <div class="opt-row ${on ? "selected" : ""}${mark}${isStruck ? " struck" : ""}">
          <button class="opt-pick ${multi ? "multi" : "single"} ${on ? "on" : ""}" data-i="${i}" type="button" ${revealed ? "disabled" : ""} aria-pressed="${on}" title="Choose ${LETTERS[i]}">${face}</button>
          <span class="opt-text">${esc(opt).replace(/\n/g, "<br>")}</span>
          <button class="opt-strike ${isStruck ? "on" : ""}" data-i="${i}" type="button" title="Cross out this option to ignore it" aria-label="Cross out option ${LETTERS[i]}">✕</button>
        </div>`;
    }).join("");
    return `<div class="answer ${multi ? "multi" : "single"}">${hint}<div class="opts">${opts}</div></div>`;
  }

  wireInputs(q) {
    const area = this.root.querySelector("#q-area");
    if (q.itemType === "numeric_entry" || q.itemType === "equation") {
      const inp = area.querySelector(q.itemType === "equation" ? "#eq-input" : "#num-input");
      if (inp) inp.oninput = () => { this.responses[q.id] = inp.value.trim(); this.persist(); this.renderGrid(); };
      return;
    }
    const multi = q.itemType === "multi_select";
    area.querySelectorAll(".opt-pick").forEach((b) => {
      b.onclick = () => {
        if (this.isLocked(q)) return;
        const i = +b.dataset.i;
        if (multi) {
          const cur = Array.isArray(this.responses[q.id]) ? this.responses[q.id] : [];
          this.responses[q.id] = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, c) => a - c);
        } else {
          this.responses[q.id] = i;
        }
        delete this.checkMsg[q.id];
        this.persist();
        this.renderQuestion();
        this.renderGrid();
      };
    });
    // cross-out (eliminate) toggles — visual only, never affects the answer/score
    area.querySelectorAll(".opt-strike").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const i = +b.dataset.i;
        const set = new Set(this.struck[q.id] || []);
        if (set.has(i)) set.delete(i); else set.add(i);
        this.struck[q.id] = [...set];
        const on = set.has(i);
        const row = b.closest(".opt-row");
        if (row) row.classList.toggle("struck", on);
        b.classList.toggle("on", on);
        this.persist();
      };
    });
  }

  wireGenre(passage) {
    const wrap = this.root.querySelector(`.genre-check[data-pid="${passage.id}"]`);
    if (!wrap) return;
    wrap.querySelectorAll(".genre-opt").forEach((b) => {
      b.onclick = () => {
        this.responses["__genre__" + passage.id] = b.dataset.g;
        this.persist();
        this.renderQuestion();
      };
    });
  }

  wireGuidance(q) {
    if (!this.guidance) return;
    const check = this.root.querySelector("#g-check");
    const show = this.root.querySelector("#g-show");
    if (check) check.onclick = () => {
      if (!this.isAnswered(q.id)) this.checkMsg[q.id] = { text: "Pick an answer first 🙂", cls: "neutral" };
      else this.checkMsg[q.id] = isCorrect(q, this.responses[q.id])
        ? { text: "✓ Correct! Nice work.", cls: "ok" }
        : { text: "✗ Not quite — try again, or tap Show answer.", cls: "no" };
      this.renderQuestion();
    };
    if (show) show.onclick = () => {
      this.revealed[q.id] = !this.revealed[q.id];
      this.renderQuestion();
    };
  }

  // ── Validate-my-answer (instant self-check) ──────────────────────────────────
  // A separate, kid-controlled mode: tap "Validate", the answer locks (no more
  // changes), and we instantly show whether it's right — and, if not, the correct
  // answer with the reason. Independent from guidance; never affects the score.
  validateBarHtml(q) {
    if (!this.validateMode) return "";
    if (this.validated[q.id]) {
      const ok = isCorrect(q, this.responses[q.id]);
      const ans = this.correctText(q);
      return `
        <div class="validate-bar done">
          <div class="validate-result ${ok ? "ok" : "no"}">${ok ? "🎉 Correct! Great job." : "❌ Not quite."}</div>
          ${ok
            ? (q.explanation ? `<div class="reveal-box">💡 ${esc(q.explanation)}</div>` : "")
            : `<div class="reveal-box">✅ <b>Correct answer:</b> ${ans}${q.explanation ? `<div class="reveal-exp">${esc(q.explanation)}</div>` : ""}</div>`}
          <div class="validate-note muted">🔒 Your answer is locked for this question.</div>
        </div>`;
    }
    const ready = this.isAnswered(q.id);
    return `
      <div class="validate-bar">
        <button id="v-check" class="btn btn-validate" ${ready ? "" : "disabled"}>✅ Validate my answer</button>
        <span class="validate-hint muted">${ready ? "Once you validate, your answer locks and I'll show you if it's right." : "Pick an answer first, then tap Validate."}</span>
      </div>`;
  }
  wireValidate(q) {
    if (!this.validateMode) return;
    const btn = this.root.querySelector("#v-check");
    if (!btn) return;
    btn.onclick = () => {
      if (!this.isAnswered(q.id)) return;
      this.validated[q.id] = true;
      this.persist();
      this.renderQuestion();
      this.renderGrid();
    };
  }

  // Pre-submit review: lists blanks (unanswered + no text-type pick) with safe
  // jump-to links that use the normal navigation (no conflict with Prev/Next).
  confirmSubmit() { this.showReview(); }
  showReview() {
    const unanswered = this.qs.map((q, i) => ({ q, i })).filter((x) => !this.isAnswered(x.q.id));
    const passages = this.test.subject === "reading" ? (this.test.passages || []) : [];
    const missingGenre = passages
      .filter((p) => !this.responses["__genre__" + p.id])
      .map((p) => ({ p, i: this.qs.findIndex((q) => q.passageId === p.id) }))
      .filter((x) => x.i >= 0);
    const answered = this.qs.length - unanswered.length;
    const allDone = !unanswered.length && !missingGenre.length;

    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `
      <div class="modal review-modal" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${allDone ? "🎉 Ready to finish?" : "Check before you finish"}</h3><button class="modal-x">✕</button></div>
        <div class="modal-body">
          <p class="rev-sum"><b>${answered} of ${this.qs.length}</b> questions answered.</p>
          ${unanswered.length ? `
            <div class="rev-block">
              <div class="rev-h">❓ Not answered yet (${unanswered.length}) — tap a number to go there:</div>
              <div class="rev-chips">${unanswered.map((x) => `<button class="rev-chip" data-go="${x.i}">${x.i + 1}</button>`).join("")}</div>
            </div>` : ""}
          ${missingGenre.length ? `
            <div class="rev-block">
              <div class="rev-h">📋 Text type not chosen (${missingGenre.length}) — tap to pick fiction / nonfiction:</div>
              <div class="rev-list">${missingGenre.map((x) => `<button class="rev-row" data-go="${x.i}">📖 ${esc(x.p.title || x.p.id)}</button>`).join("")}</div>
            </div>` : ""}
          ${allDone
            ? `<p class="rev-ok">You answered everything and chose every text type. Great job!</p>`
            : `<p class="rev-note muted">That's okay — you can still submit now even if some are left blank.</p>`}
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost rev-keep">← Keep working</button>
          <button class="btn btn-submit rev-submit">Submit now ✓</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    ov.querySelector(".modal-x").onclick = close;
    ov.querySelector(".rev-keep").onclick = close;
    ov.onclick = (e) => { if (e.target === ov) close(); };
    ov.querySelector(".rev-submit").onclick = () => { close(); this.submit(false); };
    ov.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { close(); this.go(+b.dataset.go); }));
  }

  async submit(timeUp) {
    if (this.submitted) return;
    this.submitted = true;
    this.stop();
    this.stopTutor();
    // Release the in-test layout lock so the results page scrolls normally.
    document.body.classList.remove("in-test");
    window.scrollTo(0, 0);
    const g = gradeTest(this.qs, this.responses);
    const duration = this.elapsed || Math.round((Date.now() - this.startTs) / 1000);
    localStorage.removeItem(this.storeKey);
    saveAttempt({
      testId: this.test.id, studentName: this.student,
      grade: this.test.grade, subject: this.test.subject, testType: this.test.testType,
      score: g.correct, total: g.total, durationSeconds: duration,
      answers: this.responses,
    });
    renderResults(this.root, {
      test: this.test, responses: this.responses, student: this.student,
      durationSeconds: duration, timeUp,
      primaryLabel: "Back to Tests",
      onPrimary: () => this.onExit && this.onExit(),
      onHistory: () => this.onHistory && this.onHistory(),
      onRetake: this.onRetake ? () => this.onRetake() : null,
    });
  }
}

function fmt(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
