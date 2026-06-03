// Exam runner: timed test, navigation, autosave, guidance mode, grading.
import { renderDiagram } from "./diagrams.js";
import { saveAttempt } from "./api.js";
import { gradeTest, isCorrect } from "./grade.js";
import { renderResults, normalizeGenre, genreOptions, genreLabel } from "./review.js";
import { officialTiming } from "./timing.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paras = (t) => esc(t).split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export class Runner {
  constructor(root, test, student, opts = {}) {
    this.root = root;
    this.test = test;
    this.student = student;
    this.onExit = opts.onExit;
    this.onHistory = opts.onHistory;
    this.onRetake = opts.onRetake;
    this.guidance = !!opts.guidance;
    this.navCollapsed = (() => { try { return localStorage.getItem("navCollapsed") === "1"; } catch { return false; } })();
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
      }
    } catch {}
  }
  persist() {
    try {
      localStorage.setItem(this.storeKey, JSON.stringify({
        testId: this.test.id, responses: this.responses, flags: this.flags,
        idx: this.idx, elapsed: this.elapsed, guidance: this.guidance,
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
              <span class="run-student">👋 ${esc(this.student)}${this.guidance ? ' · <span class="guide-tag">🧭 Guidance on</span>' : ""}</span>
            </div>
          </div>
          <div class="run-head-right">
            <div id="timer" class="timer" title="Time"></div>
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
    const q = this.qs[this.idx];
    const area = this.root.querySelector("#q-area");
    const passage = q.passageId ? this.passById[q.passageId] : null;

    const passageHtml = passage ? `
      <section class="passage">
        <div class="passage-inner">
          <h3 class="passage-title">${esc(passage.title || "Passage")}</h3>
          <div class="passage-text">${paras(passage.text)}</div>
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
          ${diagramHtml}
          ${this.renderInput(q)}
          ${this.guidanceBarHtml(q)}
        </div>
      </section>`;

    area.className = "q-area" + (passage ? " with-passage" : "");
    area.innerHTML = passageHtml + qBody;
    this.wireInputs(q);
    if (passage) this.wireGenre(passage);
    this.wireGuidance(q);

    this.root.querySelector("#btn-prev").disabled = this.idx === 0;
    this.root.querySelector("#btn-next").textContent = this.idx === this.qs.length - 1 ? "Finish & Review →" : "Next →";
    this.root.querySelector("#btn-flag").classList.toggle("active", !!this.flags[q.id]);
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

  renderInput(q) {
    const revealed = this.guidance && this.revealed[q.id];
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
    const hint = multi ? `<div class="multi-hint">✔ Select all that apply</div>` : "";
    const opts = (q.options || []).map((opt, i) => {
      const on = multi ? sel.includes(i) : sel === i;
      let mark = "";
      if (revealed) {
        if (answerSet.has(i)) mark = " correct-opt";
        else if (on) mark = " wrong-opt";
      }
      return `
        <button class="opt ${on ? "selected" : ""}${mark}" data-i="${i}" type="button" ${revealed ? "disabled" : ""}>
          <span class="opt-letter">${LETTERS[i]}</span>
          <span class="opt-text">${esc(opt).replace(/\n/g, "<br>")}</span>
          <span class="opt-check">${revealed && answerSet.has(i) ? "✓" : multi ? "☑" : "●"}</span>
        </button>`;
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
    area.querySelectorAll(".opt").forEach((b) => {
      b.onclick = () => {
        if (this.revealed[q.id]) return;
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
