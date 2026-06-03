// SPA controller: setup wizard -> name gate -> runner.
import * as api from "./api.js";
import { Runner } from "./runner.js";

const app = document.getElementById("app");
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const state = {
  grade: null, subject: null, testType: null,
  student: localStorage.getItem("studentName") || "",
};

const GRADES = [
  { v: 3, label: "Grade 3", emoji: "3️⃣", ready: true },
  { v: 4, label: "Grade 4", emoji: "4️⃣", ready: false },
  { v: 5, label: "Grade 5", emoji: "5️⃣", ready: false },
];
const SUBJECTS = [
  { v: "reading", label: "Reading", emoji: "📖", desc: "Stories, articles & poems" },
  { v: "math", label: "Math", emoji: "🔢", desc: "Numbers, shapes & problems" },
];
const TYPES = [
  { v: "boy", label: "Beginning of Year", short: "BOY", emoji: "🌱", desc: "Start-of-year check" },
  { v: "moy", label: "Middle of Year", short: "MOY", emoji: "☀️", desc: "Mid-year check" },
  { v: "eog", label: "End of Grade", short: "EOG", emoji: "🏆", desc: "Full practice exam" },
];

let runner = null;

function setHeaderBack(show) {
  const back = document.getElementById("home-back");
  if (back) back.style.display = show ? "" : "none";
}

function render(html) {
  app.innerHTML = html;
}

// ── Step 1: Grade ──────────────────────────────────────────────────────────────
function viewGrade() {
  state.subject = null; state.testType = null;
  setHeaderBack(false);
  render(`
    <section class="wizard">
      <div class="hero">
        <h1>Pick your grade 🎒</h1>
        <p>Choose your grade to start practicing.</p>
      </div>
      <div class="choice-grid">
        ${GRADES.map((g) => `
          <button class="choice-card ${g.ready ? "" : "soon"}" data-g="${g.v}" ${g.ready ? "" : "disabled"}>
            <span class="choice-emoji">${g.emoji}</span>
            <span class="choice-label">${g.label}</span>
            ${g.ready ? "" : `<span class="soon-tag">Coming soon</span>`}
          </button>`).join("")}
      </div>
    </section>`);
  app.querySelectorAll("[data-g]").forEach((b) => b.onclick = () => { state.grade = +b.dataset.g; viewSubject(); });
}

// ── Step 2: Subject ────────────────────────────────────────────────────────────
function viewSubject() {
  setHeaderBack(true);
  render(`
    <section class="wizard">
      ${crumbs(["Grade " + state.grade])}
      <div class="hero"><h1>Reading or Math?</h1><p>Choose what you want to practice.</p></div>
      <div class="choice-grid two">
        ${SUBJECTS.map((s) => `
          <button class="choice-card big subj-${s.v}" data-s="${s.v}">
            <span class="choice-emoji">${s.emoji}</span>
            <span class="choice-label">${s.label}</span>
            <span class="choice-desc">${s.desc}</span>
          </button>`).join("")}
      </div>
    </section>`);
  wireBack(viewGrade);
  app.querySelectorAll("[data-s]").forEach((b) => b.onclick = () => { state.subject = b.dataset.s; viewType(); });
}

// ── Step 3: Test type ──────────────────────────────────────────────────────────
function viewType() {
  setHeaderBack(true);
  render(`
    <section class="wizard">
      ${crumbs(["Grade " + state.grade, cap(state.subject)])}
      <div class="hero"><h1>Which test?</h1><p>Pick the kind of test you want.</p></div>
      <div class="choice-grid three">
        ${TYPES.map((t) => `
          <button class="choice-card" data-t="${t.v}">
            <span class="choice-emoji">${t.emoji}</span>
            <span class="choice-label">${t.short}</span>
            <span class="choice-desc">${t.label}</span>
            <span class="choice-sub">${t.desc}</span>
          </button>`).join("")}
      </div>
    </section>`);
  wireBack(viewSubject);
  app.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { state.testType = b.dataset.t; viewTests(); });
}

// ── Step 4: Pick existing or generate ──────────────────────────────────────────
async function viewTests() {
  setHeaderBack(true);
  render(`
    <section class="wizard">
      ${crumbs(["Grade " + state.grade, cap(state.subject), state.testType.toUpperCase()])}
      <div class="hero"><h1>Choose a test</h1><p>Use a ready test, or make a brand-new one.</p></div>
      <div id="test-list" class="test-list"><div class="loading">Loading tests…</div></div>
      <div class="gen-row">
        <button id="btn-generate" class="btn btn-generate">✨ Generate a New Test</button>
        <span class="gen-note">Makes a fresh test with AI (about a minute). It's saved for next time.</span>
      </div>
    </section>`);
  wireBack(viewType);
  app.querySelector("#btn-generate").onclick = () => generateNew();

  try {
    const tests = await api.listTests({ grade: state.grade, subject: state.subject, testType: state.testType });
    const list = app.querySelector("#test-list");
    if (!tests.length) {
      list.innerHTML = `<div class="empty">No saved tests yet — tap “Generate a New Test” to make one! ✨</div>`;
      return;
    }
    list.innerHTML = tests.map((t) => `
      <button class="test-row" data-id="${t.id}">
        <span class="test-row-icon">${state.subject === "math" ? "🔢" : "📖"}</span>
        <span class="test-row-main">
          <span class="test-row-title">${esc(t.title)}</span>
          <span class="test-row-sub">${t.questionCount} questions · ${t.timeLimitMinutes} min · ${t.source === "ai" ? "✨ AI" : "⭐ Curated"}</span>
        </span>
        <span class="test-row-go">Start →</span>
      </button>`).join("");
    list.querySelectorAll("[data-id]").forEach((b) => b.onclick = () => startTest(b.dataset.id));
  } catch (e) {
    app.querySelector("#test-list").innerHTML = `<div class="empty error">Couldn't load tests: ${esc(e.message)}</div>`;
  }
}

async function generateNew() {
  setHeaderBack(true);
  render(`
    <section class="wizard center">
      <div class="generating">
        <div class="spinner"></div>
        <h2>Building your test… ✨</h2>
        <p>Writing ${cap(state.subject)} questions for Grade ${state.grade} ${state.testType.toUpperCase()}.</p>
        <p class="muted">This usually takes 30–60 seconds. Please wait…</p>
      </div>
    </section>`);
  try {
    const test = await api.generateTest({ grade: state.grade, subject: state.subject, testType: state.testType });
    nameGate(test);
  } catch (e) {
    render(`
      <section class="wizard center">
        <div class="generating error">
          <h2>😕 That didn't work</h2>
          <p>${esc(e.message)}</p>
          <button id="retry" class="btn btn-primary">Back to tests</button>
        </div>
      </section>`);
    app.querySelector("#retry").onclick = () => viewTests();
  }
}

async function startTest(id) {
  setHeaderBack(true);
  render(`<section class="wizard center"><div class="generating"><div class="spinner"></div><h2>Opening test…</h2></div></section>`);
  try {
    const test = await api.getTest(id);
    nameGate(test);
  } catch (e) {
    viewTests();
  }
}

// ── Name gate ──────────────────────────────────────────────────────────────────
function nameGate(test) {
  setHeaderBack(true);
  render(`
    <section class="wizard center">
      <div class="namecard">
        <div class="name-emoji">✏️</div>
        <h1>Almost ready!</h1>
        <p class="name-test">${esc(test.title)}</p>
        <p class="name-info">${test.questions.length} questions · ${test.timeLimitMinutes} minutes</p>
        <label class="name-label" for="student">Type your first name to begin:</label>
        <input id="student" class="name-input" type="text" maxlength="24" placeholder="Your name" value="${esc(state.student)}" autocomplete="off" />
        <button id="btn-begin" class="btn btn-begin" disabled>Start Test →</button>
        <p class="name-tip">⏱ A timer will start. Find a quiet spot and do your best!</p>
      </div>
    </section>`);
  wireBack(viewTests);
  const input = app.querySelector("#student");
  const begin = app.querySelector("#btn-begin");
  const sync = () => { begin.disabled = input.value.trim().length < 1; };
  input.oninput = sync; sync(); input.focus();
  input.onkeydown = (e) => { if (e.key === "Enter" && !begin.disabled) begin.click(); };
  begin.onclick = () => {
    state.student = input.value.trim();
    localStorage.setItem("studentName", state.student);
    launch(test);
  };
}

function launch(test) {
  setHeaderBack(false);
  document.body.classList.add("in-test");
  if (runner) runner.stop();
  runner = new Runner(app, test, state.student, exitTest);
  runner.start();
}

function exitTest() {
  document.body.classList.remove("in-test");
  if (runner) { runner.stop(); runner = null; }
  viewTests();
}

// ── helpers ─────────────────────────────────────────────────────────────────────
function crumbs(items) {
  return `<div class="crumbs">${items.map((i) => `<span class="crumb">${esc(i)}</span>`).join('<span class="crumb-sep">›</span>')}</div>`;
}
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
function wireBack(fn) {
  const back = document.getElementById("home-back");
  if (back) back.onclick = fn;
}

// header home button always resets to grade view
document.getElementById("home-link").onclick = (e) => {
  e.preventDefault();
  if (document.body.classList.contains("in-test")) {
    if (!confirm("Leave the test? Your progress is saved on this device.")) return;
    document.body.classList.remove("in-test");
    if (runner) { runner.stop(); runner = null; }
  }
  viewGrade();
};

viewGrade();
