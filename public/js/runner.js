// Exam runner: renders the timed test, handles navigation, autosave, grading.
import { renderDiagram } from "./diagrams.js";
import { saveAttempt } from "./api.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paras = (t) => esc(t).split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export class Runner {
  constructor(root, test, student, onExit) {
    this.root = root;
    this.test = test;
    this.student = student;
    this.onExit = onExit;
    this.qs = test.questions;
    this.passById = Object.fromEntries((test.passages || []).map((p) => [p.id, p]));
    this.storeKey = `attempt:${test.id}:${student}`;
    this.idx = 0;
    this.responses = {};   // qid -> answer (int | int[] | string)
    this.flags = {};       // qid -> bool
    this.submitted = false;
    this.startTs = Date.now();
    this.remaining = test.timeLimitMinutes * 60;
    this.restore();
  }

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.storeKey) || "null");
      if (saved && saved.testId === this.test.id) {
        this.responses = saved.responses || {};
        this.flags = saved.flags || {};
        this.idx = saved.idx || 0;
        if (typeof saved.remaining === "number") this.remaining = saved.remaining;
      }
    } catch {}
  }
  persist() {
    try {
      localStorage.setItem(this.storeKey, JSON.stringify({
        testId: this.test.id, responses: this.responses, flags: this.flags,
        idx: this.idx, remaining: this.remaining,
      }));
    } catch {}
  }

  start() {
    this.renderShell();
    this.renderQuestion();
    this.tick = setInterval(() => this.onTick(), 1000);
  }
  stop() { if (this.tick) clearInterval(this.tick); }

  onTick() {
    if (this.submitted) return;
    this.remaining--;
    this.updateTimer();
    if (this.remaining % 5 === 0) this.persist();
    if (this.remaining <= 0) { this.remaining = 0; this.submit(true); }
  }

  // ── shell ──────────────────────────────────────────────────────────────────
  renderShell() {
    const t = this.test;
    this.root.innerHTML = `
      <div class="runner">
        <header class="run-head">
          <div class="run-head-left">
            <span class="badge subj-${t.subject}">${t.subject === "math" ? "🔢 Math" : "📖 Reading"}</span>
            <div class="run-title">
              <strong>${esc(t.title)}</strong>
              <span class="run-student">👋 ${esc(this.student)}</span>
            </div>
          </div>
          <div class="run-head-right">
            <div id="timer" class="timer" title="Time remaining"></div>
            <button id="btn-submit" class="btn btn-submit">Finish ✓</button>
          </div>
        </header>
        <div class="run-body">
          <main id="q-area" class="q-area"></main>
          <aside class="q-nav">
            <div class="q-nav-title">Questions</div>
            <div id="q-grid" class="q-grid"></div>
            <div class="q-nav-legend">
              <span><i class="dot answered"></i> Answered</span>
              <span><i class="dot flagged"></i> Flagged</span>
              <span><i class="dot"></i> Unseen</span>
            </div>
          </aside>
        </div>
        <footer class="run-foot">
          <button id="btn-prev" class="btn btn-ghost">← Prev</button>
          <button id="btn-flag" class="btn btn-ghost">⚑ Flag</button>
          <button id="btn-next" class="btn btn-primary">Next →</button>
        </footer>
      </div>`;
    this.root.querySelector("#btn-prev").onclick = () => this.go(this.idx - 1);
    this.root.querySelector("#btn-next").onclick = () => this.go(this.idx + 1);
    this.root.querySelector("#btn-flag").onclick = () => this.toggleFlag();
    this.root.querySelector("#btn-submit").onclick = () => this.confirmSubmit();
    this.updateTimer();
    this.renderGrid();
  }

  updateTimer() {
    const el = this.root.querySelector("#timer");
    if (!el) return;
    const m = Math.floor(this.remaining / 60), s = this.remaining % 60;
    el.textContent = `⏱ ${m}:${String(s).padStart(2, "0")}`;
    el.classList.toggle("warn", this.remaining <= 300 && this.remaining > 60);
    el.classList.toggle("danger", this.remaining <= 60);
  }

  renderGrid() {
    const grid = this.root.querySelector("#q-grid");
    grid.innerHTML = this.qs.map((q, i) => {
      const answered = this.isAnswered(q.id);
      const cls = ["q-cell"];
      if (i === this.idx) cls.push("current");
      if (answered) cls.push("answered");
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
  toggleFlag() {
    const q = this.qs[this.idx];
    this.flags[q.id] = !this.flags[q.id];
    this.persist();
    this.renderGrid();
    this.renderQuestion();
  }

  // ── question view ────────────────────────────────────────────────────────────
  renderQuestion() {
    const q = this.qs[this.idx];
    const area = this.root.querySelector("#q-area");
    const passage = q.passageId ? this.passById[q.passageId] : null;

    const passageHtml = passage ? `
      <section class="passage">
        <div class="passage-inner">
          <div class="passage-genre">${esc(passage.genre || "")}${passage.lexile ? " · " + esc(passage.lexile) : ""}</div>
          <h3 class="passage-title">${esc(passage.title || "Passage")}</h3>
          <div class="passage-text">${paras(passage.text)}</div>
        </div>
      </section>` : "";

    const diagramHtml = q.diagram
      ? `<div class="q-diagram">${renderDiagram(q.diagram)}</div>` : "";

    const qBody = `
      <section class="question ${passage ? "" : "no-passage"}">
        <div class="q-scroll">
          <div class="q-meta">
            <span class="q-num">Question ${this.idx + 1} of ${this.qs.length}</span>
            ${q.skill ? `<span class="q-skill">${esc(q.skill)}</span>` : ""}
            ${this.flags[q.id] ? `<span class="q-flagged">⚑ Flagged</span>` : ""}
          </div>
          <div class="q-text">${esc(q.questionText).replace(/\n/g, "<br>")}</div>
          ${diagramHtml}
          ${this.renderInput(q)}
        </div>
      </section>`;

    area.className = "q-area" + (passage ? " with-passage" : "");
    area.innerHTML = passageHtml + qBody;
    this.wireInputs(q);

    this.root.querySelector("#btn-prev").disabled = this.idx === 0;
    const next = this.root.querySelector("#btn-next");
    next.textContent = this.idx === this.qs.length - 1 ? "Review →" : "Next →";
    const flagBtn = this.root.querySelector("#btn-flag");
    flagBtn.classList.toggle("active", !!this.flags[q.id]);
  }

  renderInput(q) {
    const r = this.responses[q.id];
    if (q.itemType === "numeric_entry") {
      return `
        <div class="answer numeric">
          <label class="numeric-label">Type your answer:</label>
          <input id="num-input" class="numeric-input" type="text" inputmode="text"
                 autocomplete="off" value="${r != null ? esc(r) : ""}" placeholder="answer" />
        </div>`;
    }
    const multi = q.itemType === "multi_select";
    const sel = multi ? (Array.isArray(r) ? r : []) : r;
    const hint = multi ? `<div class="multi-hint">✔ Select all that apply</div>` : "";
    const opts = (q.options || []).map((opt, i) => {
      const on = multi ? sel.includes(i) : sel === i;
      return `
        <button class="opt ${on ? "selected" : ""}" data-i="${i}" type="button">
          <span class="opt-letter">${LETTERS[i]}</span>
          <span class="opt-text">${esc(opt).replace(/\n/g, "<br>")}</span>
          <span class="opt-check">${multi ? "☑" : "●"}</span>
        </button>`;
    }).join("");
    return `<div class="answer ${multi ? "multi" : "single"}">${hint}<div class="opts">${opts}</div></div>`;
  }

  wireInputs(q) {
    const area = this.root.querySelector("#q-area");
    if (q.itemType === "numeric_entry") {
      const inp = area.querySelector("#num-input");
      inp.oninput = () => { this.responses[q.id] = inp.value.trim(); this.persist(); this.renderGrid(); };
      return;
    }
    const multi = q.itemType === "multi_select";
    area.querySelectorAll(".opt").forEach((b) => {
      b.onclick = () => {
        const i = +b.dataset.i;
        if (multi) {
          const cur = Array.isArray(this.responses[q.id]) ? this.responses[q.id] : [];
          this.responses[q.id] = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, c) => a - c);
        } else {
          this.responses[q.id] = i;
        }
        this.persist();
        this.renderQuestion();
        this.renderGrid();
      };
    });
  }

  // ── grading ──────────────────────────────────────────────────────────────────
  grade() {
    let correct = 0;
    const detail = this.qs.map((q) => {
      const resp = this.responses[q.id];
      const ok = isCorrect(q, resp);
      if (ok) correct++;
      return { q, resp, ok };
    });
    return { correct, total: this.qs.length, detail };
  }

  confirmSubmit() {
    const unanswered = this.qs.filter((q) => !this.isAnswered(q.id)).length;
    const msg = unanswered > 0
      ? `You have ${unanswered} unanswered question${unanswered > 1 ? "s" : ""}. Finish anyway?`
      : `Finish and see your score?`;
    if (confirm(msg)) this.submit(false);
  }

  async submit(timeUp) {
    if (this.submitted) return;
    this.submitted = true;
    this.stop();
    const g = this.grade();
    const duration = Math.round((Date.now() - this.startTs) / 1000);
    localStorage.removeItem(this.storeKey);
    saveAttempt({
      testId: this.test.id, studentName: this.student,
      grade: this.test.grade, subject: this.test.subject, testType: this.test.testType,
      score: g.correct, total: g.total, durationSeconds: duration,
      answers: this.responses,
    });
    this.renderResults(g, duration, timeUp);
  }

  renderResults(g, duration, timeUp) {
    const pct = Math.round((g.correct / g.total) * 100);
    const m = Math.floor(duration / 60), s = duration % 60;
    const mood = pct >= 85 ? "🌟" : pct >= 70 ? "😀" : pct >= 50 ? "🙂" : "💪";
    const review = g.detail.map(({ q, resp, ok }, i) => this.reviewCard(q, resp, ok, i)).join("");
    this.root.innerHTML = `
      <div class="results">
        <div class="results-head">
          <div class="score-ring ${pct >= 70 ? "good" : pct >= 50 ? "ok" : "low"}">
            <div class="score-pct">${pct}%</div>
            <div class="score-frac">${g.correct} / ${g.total}</div>
          </div>
          <div class="results-meta">
            <h2>${mood} Great job, ${esc(this.student)}!</h2>
            <p>${timeUp ? "⏰ Time was up — here's how you did." : "You finished the test."}</p>
            <p class="muted">Time used: ${m}m ${s}s · ${esc(this.test.title)}</p>
            <div class="results-actions">
              <button id="btn-again" class="btn btn-primary">Back to Tests</button>
              <button id="btn-print" class="btn btn-ghost">🖨 Print Review</button>
            </div>
          </div>
        </div>
        <h3 class="review-title">Answer Review</h3>
        <div class="review-list">${review}</div>
      </div>`;
    this.root.querySelector("#btn-again").onclick = () => this.onExit();
    this.root.querySelector("#btn-print").onclick = () => window.print();
  }

  reviewCard(q, resp, ok, i) {
    const passage = q.passageId ? this.passById[q.passageId] : null;
    const diagramHtml = q.diagram ? `<div class="q-diagram small">${renderDiagram(q.diagram)}</div>` : "";
    let answerBlock = "";
    if (q.itemType === "numeric_entry") {
      answerBlock = `
        <div class="rv-line"><b>Your answer:</b> <span class="${ok ? "ok" : "no"}">${resp != null && resp !== "" ? esc(resp) : "— (blank)"}</span></div>
        <div class="rv-line"><b>Correct answer:</b> <span class="ok">${esc(q.answer)}</span></div>`;
    } else {
      const letters = (idxs) => (Array.isArray(idxs) ? idxs : [idxs])
        .filter((x) => x != null && x !== "").map((x) => `${LETTERS[x]}. ${esc(q.options[x])}`).join("; ");
      const correctIdx = q.itemType === "multi_select" ? q.answer : q.answer;
      answerBlock = `
        <div class="rv-line"><b>Your answer:</b> <span class="${ok ? "ok" : "no"}">${(resp == null || (Array.isArray(resp) && !resp.length)) ? "— (blank)" : letters(resp)}</span></div>
        <div class="rv-line"><b>Correct answer:</b> <span class="ok">${letters(correctIdx)}</span></div>`;
    }
    return `
      <div class="rv-card ${ok ? "rv-ok" : "rv-no"}">
        <div class="rv-head">
          <span class="rv-num">${i + 1}</span>
          <span class="rv-mark">${ok ? "✓ Correct" : "✗ Review"}</span>
          ${passage ? `<span class="rv-passage">📖 ${esc(passage.title)}</span>` : ""}
        </div>
        <div class="rv-q">${esc(q.questionText).replace(/\n/g, "<br>")}</div>
        ${diagramHtml}
        ${answerBlock}
        ${q.explanation ? `<div class="rv-exp"><b>Why:</b> ${esc(q.explanation)}</div>` : ""}
      </div>`;
  }
}

export function isCorrect(q, resp) {
  if (resp == null) return false;
  if (q.itemType === "single_choice") return resp === q.answer;
  if (q.itemType === "multi_select") {
    if (!Array.isArray(resp)) return false;
    const a = [...resp].sort((x, y) => x - y).join(",");
    const b = [...q.answer].sort((x, y) => x - y).join(",");
    return a === b && a !== "";
  }
  if (q.itemType === "numeric_entry") {
    const norm = (v) => String(v).trim().toLowerCase().replace(/\s+/g, "").replace(/^\$/, "");
    const given = norm(resp);
    if (given === "") return false;
    const accepted = [q.answer, ...(q.acceptedAnswers || [])].map(norm);
    if (accepted.includes(given)) return true;
    // numeric equivalence
    const gn = Number(given.replace(/[^0-9.\-]/g, ""));
    return accepted.some((a) => {
      const an = Number(String(a).replace(/[^0-9.\-]/g, ""));
      return !Number.isNaN(gn) && !Number.isNaN(an) && Math.abs(gn - an) < 1e-9 && a !== "";
    });
  }
  return false;
}
