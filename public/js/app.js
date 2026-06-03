// SPA controller: State → Grade → Subject → Test type → pick/generate →
// start (name + guidance) → runner → results/history. Hash-based URL routing.
import * as api from "./api.js";
import { Runner } from "./runner.js";
import { renderResults, formatDate } from "./review.js";
import { initDict } from "./dict.js";
import { officialTiming } from "./timing.js";

const app = document.getElementById("app");
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const state = {
  region: localStorage.getItem("region") || "nc",
  grade: null, subject: null, testType: null,
  student: localStorage.getItem("studentName") || "",
};
let runner = null;
let nameReturn = "#/";

const STATES = [
  { code: "nc", label: "North Carolina", emoji: "🌲", ready: true },
  { code: "sc", label: "South Carolina", emoji: "🌴", ready: false },
  { code: "ga", label: "Georgia", emoji: "🍑", ready: false },
  { code: "va", label: "Virginia", emoji: "🏛️", ready: false },
  { code: "tx", label: "Texas", emoji: "⭐", ready: false },
  { code: "fl", label: "Florida", emoji: "🌞", ready: false },
];
const stateLabel = (c) => (STATES.find((s) => s.code === c) || {}).label || c.toUpperCase();
const isState = (c) => STATES.some((s) => s.code === c);

const GRADES = [
  { v: 3, label: "Grade 3", emoji: "3️⃣", ready: true },
  { v: 4, label: "Grade 4", emoji: "4️⃣", ready: false },
  { v: 5, label: "Grade 5", emoji: "5️⃣", ready: true },
];
const SUBJECTS = [
  { v: "reading", label: "Reading", emoji: "📖", desc: "Stories, articles & poems" },
  { v: "math", label: "Math", emoji: "🔢", desc: "Numbers, shapes & problems" },
];
const TYPES = [
  { v: "boy", label: "Beginning of Grade", short: "BOG", emoji: "🌱", desc: "Start-of-year (BOG3)" },
  { v: "moy", label: "Middle of Year", short: "MOY", emoji: "☀️", desc: "Mid-year benchmark" },
  { v: "eog", label: "End of Grade", short: "EOG", emoji: "🏆", desc: "Full practice exam" },
];

const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const render = (html) => { app.innerHTML = html; };
const parseHash = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);

function route() {
  const p = parseHash();
  updateChrome(p);
  if (p[0] === "history") return viewHistory();
  if (p[0] === "result") return viewResult(p[1]);
  if (p[0] === "start") return startScreen(p[1]);
  if (p[0] === "resume") return resumeTest(p[1]);
  if (p[0] === "name") return changeName();

  if (document.body.classList.contains("in-test")) leaveTest();

  if (isState(p[0])) {
    state.region = p[0];
    localStorage.setItem("region", p[0]);
    const rest = p.slice(1);
    state.grade = rest[0] && /^g\d+$/.test(rest[0]) ? +rest[0].slice(1) : null;
    state.subject = SUBJECTS.some((s) => s.v === rest[1]) ? rest[1] : null;
    state.testType = TYPES.some((t) => t.v === rest[2]) ? rest[2] : null;
    if (!state.grade) return viewGrade();
    if (!state.subject) return viewSubject();
    if (!state.testType) return viewType();
    return viewTests();
  }
  return viewState();
}

function updateChrome(p) {
  const back = document.getElementById("home-back");
  const chip = document.getElementById("student-chip");
  const results = document.getElementById("results-link");
  const inTest = document.body.classList.contains("in-test");
  const atRoot = !p || p.length === 0;
  back.style.display = atRoot || inTest ? "none" : "";
  back.onclick = () => history.back();
  if (state.student && !inTest) {
    chip.style.display = "";
    chip.innerHTML = `👤 ${esc(state.student)} <span class="chip-edit">✎</span>`;
    chip.onclick = () => { nameReturn = location.hash || "#/"; go("#/name"); };
    results.style.display = "";
    results.onclick = () => go("#/history");
  } else {
    chip.style.display = "none";
    results.style.display = "none";
  }
}

// ── In-progress (unfinished) tests saved on this device ────────────────────────
function isAnsweredVal(r) {
  if (r == null) return false;
  if (Array.isArray(r)) return r.length > 0;
  return r !== "";
}
function listInProgress(student) {
  const out = [];
  if (!student) return out;
  const suffix = ":" + student;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith("attempt:") || !k.endsWith(suffix)) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k));
      if (!s || !s.testId) continue;
      const answered = Object.entries(s.responses || {})
        .filter(([qid, v]) => !qid.startsWith("__genre__") && isAnsweredVal(v)).length;
      out.push({ key: k, ...s, answered });
    } catch {}
  }
  out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return out;
}
function discardProgress(key) { try { localStorage.removeItem(key); } catch {} }

function inProgressSection() {
  const items = listInProgress(state.student);
  if (!items.length) return "";
  return `
    <div class="resume-block">
      <div class="resume-head">⏳ Pick up where you left off</div>
      ${items.map((s) => {
        const total = s.total || 0;
        const pct = total ? Math.round((s.answered / total) * 100) : 0;
        return `
        <div class="resume-card" data-id="${esc(s.testId)}">
          <span class="resume-icon">${s.subject === "math" ? "🔢" : "📖"}</span>
          <span class="resume-main">
            <span class="resume-title">${esc(s.title || s.testId)}</span>
            <span class="resume-sub">${(s.subject || "").toUpperCase()} · ${(s.testType || "").toUpperCase()} · answered ${s.answered}/${total}</span>
            <span class="resume-bar"><span class="resume-fill" style="width:${pct}%"></span></span>
          </span>
          <span class="resume-actions">
            <button class="btn btn-primary resume-go" data-id="${esc(s.testId)}">Resume →</button>
            <button class="resume-x" data-key="${esc(s.key)}" title="Discard">✕</button>
          </span>
        </div>`;
      }).join("")}
    </div>`;
}
function wireInProgress() {
  app.querySelectorAll(".resume-go").forEach((b) => (b.onclick = () => go(`#/resume/${b.dataset.id}`)));
  app.querySelectorAll(".resume-x").forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    if (confirm("Discard this unfinished test? Your saved progress will be deleted.")) { discardProgress(b.dataset.key); route(); }
  }));
}

// ── Step 0: State ──────────────────────────────────────────────────────────────
function viewState() {
  render(`
    <section class="wizard">
      <div class="hero"><h1>Where do you go to school? 🗺️</h1><p>Pick your state to get the right practice tests.</p></div>
      ${inProgressSection()}
      <div class="choice-grid">
        ${STATES.map((s) => `
          <button class="choice-card ${s.ready ? "" : "soon"}" data-c="${s.code}" ${s.ready ? "" : "disabled"}>
            <span class="choice-emoji">${s.emoji}</span>
            <span class="choice-label">${s.label}</span>
            ${s.ready ? `<span class="choice-desc">EOG / BOG practice</span>` : `<span class="soon-tag">Coming soon</span>`}
          </button>`).join("")}
      </div>
      <p class="center-note muted">More states coming soon. Right now we have full North Carolina (NC) EOG-style tests.</p>
    </section>`);
  app.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => go(`#/${b.dataset.c}`)));
  wireInProgress();
}

// ── Step 1: Grade ──────────────────────────────────────────────────────────────
function viewGrade() {
  render(`
    <section class="wizard">
      ${crumbs([stateLabel(state.region)])}
      <div class="hero"><h1>Pick your grade 🎒</h1><p>Choose your grade to start practicing.</p></div>
      ${inProgressSection()}
      <div class="choice-grid">
        ${GRADES.map((g) => `
          <button class="choice-card ${g.ready ? "" : "soon"}" data-g="${g.v}" ${g.ready ? "" : "disabled"}>
            <span class="choice-emoji">${g.emoji}</span>
            <span class="choice-label">${g.label}</span>
            ${g.ready ? "" : `<span class="soon-tag">Coming soon</span>`}
          </button>`).join("")}
      </div>
      ${state.student ? `<p class="center-link"><button class="linkish" id="go-history">📊 See ${esc(state.student)}'s results</button></p>` : ""}
    </section>`);
  app.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => go(`#/${state.region}/g${b.dataset.g}`)));
  const gh = app.querySelector("#go-history"); if (gh) gh.onclick = () => go("#/history");
  wireInProgress();
}

// Resume an unfinished test directly (skips the start screen; the runner restores progress).
async function resumeTest(id) {
  render(`<section class="wizard center"><div class="generating"><div class="spinner"></div><h2>Resuming your test…</h2></div></section>`);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(`attempt:${id}:${state.student}`) || "null"); } catch {}
  let test;
  try { test = await api.getTest(id); }
  catch (e) {
    if (saved) discardProgress(`attempt:${id}:${state.student}`); // test no longer exists
    go("#/"); return;
  }
  state.grade = test.grade; state.subject = test.subject; state.testType = test.testType;
  if (!state.student) { go(`#/start/${id}`); return; }
  launch(test, !!(saved && saved.guidance));
}

// ── Step 2: Subject ────────────────────────────────────────────────────────────
function viewSubject() {
  render(`
    <section class="wizard">
      ${crumbs([stateLabel(state.region), "Grade " + state.grade])}
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
  app.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => go(`#/${state.region}/g${state.grade}/${b.dataset.s}`)));
}

// ── Step 3: Test type ──────────────────────────────────────────────────────────
function viewType() {
  render(`
    <section class="wizard">
      ${crumbs([stateLabel(state.region), "Grade " + state.grade, cap(state.subject)])}
      <div class="hero"><h1>Which test?</h1><p>Pick the kind of test you want.</p></div>
      <div class="choice-grid three">
        ${TYPES.map((t) => {
          const tm = officialTiming(t.v);
          return `
          <button class="choice-card" data-t="${t.v}">
            <span class="choice-emoji">${t.emoji}</span>
            <span class="choice-label">${t.short}</span>
            <span class="choice-desc">${t.label}</span>
            <span class="choice-sub">${t.desc} · ~${tm.suggested} min</span>
          </button>`;
        }).join("")}
      </div>
    </section>`);
  app.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => go(`#/${state.region}/g${state.grade}/${state.subject}/${b.dataset.t}`)));
}

// ── Step 4: Pick existing or generate ──────────────────────────────────────────
async function viewTests() {
  render(`
    <section class="wizard">
      ${crumbs([stateLabel(state.region), "Grade " + state.grade, cap(state.subject), state.testType.toUpperCase()])}
      <div class="hero"><h1>Choose a test</h1><p>Use a ready test, or make a brand-new one.</p></div>
      <div id="test-list" class="test-list"><div class="loading">Loading tests…</div></div>
      <div class="gen-row">
        <button id="btn-generate" class="btn btn-generate">✨ Generate a New Test</button>
        <span class="gen-note">Makes a fresh test with AI (about a minute). It's saved for next time.</span>
      </div>
    </section>`);
  app.querySelector("#btn-generate").onclick = () => generateNew();

  try {
    const tests = await api.listTests({ grade: state.grade, subject: state.subject, testType: state.testType });
    const list = app.querySelector("#test-list");
    if (!list) return;
    if (!tests.length) {
      list.innerHTML = `<div class="empty">No saved tests yet — tap “Generate a New Test” to make one! ✨</div>`;
      return;
    }
    list.innerHTML = tests.map((t) => `
      <button class="test-row" data-id="${t.id}">
        <span class="test-row-icon">${state.subject === "math" ? "🔢" : "📖"}</span>
        <span class="test-row-main">
          <span class="test-row-title">${esc(t.title)}</span>
          <span class="test-row-sub">${t.questionCount} questions · ~${t.timeLimitMinutes} min · ${t.source === "ai" ? "✨ AI" : "⭐ Curated"}</span>
        </span>
        <span class="test-row-go">Start →</span>
      </button>`).join("");
    list.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => go(`#/start/${b.dataset.id}`)));
  } catch (e) {
    const list = app.querySelector("#test-list");
    if (list) list.innerHTML = `<div class="empty error">Couldn't load tests: ${esc(e.message)}</div>`;
  }
}

async function generateNew() {
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
    go(`#/start/${test.id}`);
  } catch (e) {
    render(`
      <section class="wizard center">
        <div class="generating error">
          <h2>😕 That didn't work</h2>
          <p>${esc(e.message)}</p>
          <button id="retry" class="btn btn-primary">Back to tests</button>
        </div>
      </section>`);
    app.querySelector("#retry").onclick = () => go(`#/${state.region}/g${state.grade}/${state.subject}/${state.testType}`);
  }
}

// ── Start screen: name (remembered) + guidance toggle ──────────────────────────
async function startScreen(id) {
  if (runner && runner.test && runner.test.id === id && document.body.classList.contains("in-test")) return;
  render(`<section class="wizard center"><div class="generating"><div class="spinner"></div><h2>Opening test…</h2></div></section>`);
  let test;
  try { test = await api.getTest(id); }
  catch (e) { go("#/"); return; }
  state.grade = test.grade; state.subject = test.subject; state.testType = test.testType;
  const tm = officialTiming(test.testType);
  const known = !!state.student;
  const guidePref = localStorage.getItem("needGuidance") === "1";

  render(`
    <section class="wizard center">
      <div class="namecard">
        <div class="name-emoji">${known ? "🎒" : "✏️"}</div>
        <h1>${known ? `Ready, ${esc(state.student)}?` : "Almost ready!"}</h1>
        <p class="name-test">${esc(test.title)}</p>
        <p class="name-info">${test.questions.length} questions · ~${tm.suggested} min (up to ${tm.max} min)</p>
        ${known ? "" : `
          <label class="name-label" for="student">Type your first name to begin:</label>
          <input id="student" class="name-input" type="text" maxlength="24" placeholder="Your name" value="${esc(state.student)}" autocomplete="off" />`}
        <label class="guide-toggle">
          <input type="checkbox" id="need-guidance" ${guidePref ? "checked" : ""}/>
          <span>🧭 <b>Need guidance</b> — let me <i>check</i> &amp; <i>show</i> answers as I go (practice mode)</span>
        </label>
        <button id="btn-begin" class="btn btn-begin">Start Test →</button>
        ${known ? `<p class="name-tip">Not ${esc(state.student)}? <button class="linkish" id="change-name">change name</button></p>`
                : `<p class="name-tip">⏱ A timer will start. We'll remember your name next time.</p>`}
      </div>
    </section>`);

  const input = app.querySelector("#student");
  const begin = app.querySelector("#btn-begin");
  const guide = app.querySelector("#need-guidance");
  const sync = () => { begin.disabled = !state.student && (!input || input.value.trim().length < 1); };
  if (input) { input.oninput = sync; input.focus(); input.onkeydown = (e) => { if (e.key === "Enter" && !begin.disabled) begin.click(); }; }
  sync();
  const cn = app.querySelector("#change-name");
  if (cn) cn.onclick = () => { nameReturn = location.hash; go("#/name"); };
  begin.onclick = () => {
    if (input && input.value.trim()) setStudent(input.value.trim());
    if (!state.student) return;
    const guidance = !!(guide && guide.checked);
    localStorage.setItem("needGuidance", guidance ? "1" : "0");
    launch(test, guidance);
  };
}

function launch(test, guidance) {
  document.body.classList.add("in-test");
  updateChrome(parseHash());
  if (runner) runner.stop();
  runner = new Runner(app, test, state.student, {
    guidance, onExit: exitTest, onHistory: () => go("#/history"),
  });
  runner.start();
}

function exitTest() {
  leaveTest();
  go(`#/${state.region}/g${state.grade}/${state.subject}/${state.testType}`);
}
function leaveTest() {
  document.body.classList.remove("in-test");
  if (runner) { runner.stop(); runner = null; }
}

// ── Change / set name ──────────────────────────────────────────────────────────
function changeName() {
  render(`
    <section class="wizard center">
      <div class="namecard">
        <div class="name-emoji">👤</div>
        <h1>Who's practicing?</h1>
        <p class="name-info">We'll save results under this name.</p>
        <label class="name-label" for="student">First name:</label>
        <input id="student" class="name-input" type="text" maxlength="24" placeholder="Your name" value="${esc(state.student)}" autocomplete="off" />
        <button id="btn-save" class="btn btn-begin" disabled>Save</button>
      </div>
    </section>`);
  const input = app.querySelector("#student");
  const save = app.querySelector("#btn-save");
  const sync = () => (save.disabled = input.value.trim().length < 1);
  input.oninput = sync; sync(); input.focus();
  input.onkeydown = (e) => { if (e.key === "Enter" && !save.disabled) save.click(); };
  save.onclick = () => { setStudent(input.value.trim()); go(nameReturn && !nameReturn.includes("/name") ? nameReturn : "#/"); };
}

function setStudent(name) {
  state.student = name;
  localStorage.setItem("studentName", name);
}

// ── History (per student) ──────────────────────────────────────────────────────
async function viewHistory() {
  if (!state.student) { nameReturn = "#/history"; return go("#/name"); }
  render(`
    <section class="wizard">
      ${crumbs(["📊 " + state.student + "'s Results"])}
      <div class="hero"><h1>My Results</h1><p>Every test ${esc(state.student)} has finished.</p></div>
      <div id="hist" class="test-list"><div class="loading">Loading results…</div></div>
      <p class="center-link"><button class="linkish" id="back-grade">← Back to tests</button></p>
    </section>`);
  app.querySelector("#back-grade").onclick = () => go(`#/${state.region}`);
  try {
    const attempts = await api.listAttempts(state.student);
    const hist = app.querySelector("#hist");
    if (!hist) return;
    if (!attempts.length) {
      hist.innerHTML = `<div class="empty">No results yet. Finish a test and it shows up here! ✨</div>`;
      return;
    }
    hist.innerHTML = attempts.map((a) => {
      const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
      const cls = pct >= 70 ? "good" : pct >= 50 ? "ok" : "low";
      const mins = Math.round((a.durationSeconds || 0) / 60);
      return `
        <button class="test-row hist-row" data-id="${a.id}">
          <span class="hist-score ${cls}">${pct}%</span>
          <span class="test-row-main">
            <span class="test-row-title">${esc(a.testTitle || a.testId)}</span>
            <span class="test-row-sub">${esc((a.subject || "").toUpperCase())} · ${esc((a.testType || "").toUpperCase())} · ${a.score}/${a.total} correct · ${mins} min · ${esc(formatDate(a.createdAt))}</span>
          </span>
          <span class="test-row-go">View →</span>
        </button>`;
    }).join("");
    hist.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => go(`#/result/${b.dataset.id}`)));
  } catch (e) {
    const hist = app.querySelector("#hist");
    if (hist) hist.innerHTML = `<div class="empty error">Couldn't load results: ${esc(e.message)}</div>`;
  }
}

// ── Saved attempt summary (re-scored identically) ──────────────────────────────
async function viewResult(id) {
  render(`<section class="wizard center"><div class="generating"><div class="spinner"></div><h2>Loading result…</h2></div></section>`);
  try {
    const { attempt, test } = await api.getAttempt(id);
    if (!test) { go("#/history"); return; }
    renderResults(app, {
      test, responses: attempt.answers, student: attempt.studentName,
      durationSeconds: attempt.durationSeconds, savedAt: attempt.createdAt,
      primaryLabel: "← My Results",
      onPrimary: () => go("#/history"),
      onHistory: () => go("#/history"),
    });
  } catch (e) { go("#/history"); }
}

// ── helpers ─────────────────────────────────────────────────────────────────────
function crumbs(items) {
  return `<div class="crumbs">${items.map((i) => `<span class="crumb">${esc(i)}</span>`).join('<span class="crumb-sep">›</span>')}</div>`;
}

document.getElementById("home-link").onclick = (e) => {
  e.preventDefault();
  if (document.body.classList.contains("in-test")) {
    if (!confirm("Leave the test? Your progress is saved on this device.")) return;
    leaveTest();
  }
  go("#/");
};

initDict();
window.addEventListener("hashchange", route);
route();
