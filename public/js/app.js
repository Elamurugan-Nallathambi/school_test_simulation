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

const srcLabel = (s) => (s === "ai" ? "✨ AI" : s === "sample" ? "📄 Sample (from a real test)" : "⭐ Curated");

// Helpful outside resources, tagged by grade. type: "ideas" | "questions" | "official".
const RESOURCES = [
  { grades: [3], type: "ideas", name: "Hawk Ridge Elementary — Grade 3 Math: Fractions (CMS)",
    desc: "Standards, anchor charts, videos, and a printable fractions workbook (area & length models).",
    url: "https://sites.google.com/cms.k12.nc.us/hres3rdmath/fractions?authuser=0" },
  { grades: [3], type: "questions", name: "Tutorified — NC EOG 3rd Grade Practice Test (PDF & worksheets)",
    desc: "Free printable ELA & Math practice tests and worksheets with questions.",
    url: "https://www.tutorified.com/nc-eog-3rd-grade-practice-test-pdf/" },
  { grades: [3, 4, 5], type: "questions", name: "Lumos Learning — NC EOG Test Prep Workbooks (for Parents)",
    desc: "Parent workbooks and practice questions aligned to the NC EOG.",
    url: "https://www.lumoslearning.com/llwp/parents/eog-test-prep-workbooks.html" },
  { grades: [3, 4, 5], type: "official", name: "NCDPI — End-of-Grade (EOG) Documents",
    desc: "Official test specifications and released forms (some include released questions).",
    url: "https://www.dpi.nc.gov/document-terms/eog" },
  // Official released forms — open and practice the REAL released questions on NCDPI's site.
  { grades: [3], type: "official", name: "NCDPI — Grade 3 Math Released Form (real released test)",
    desc: "Open the official Grade 3 Mathematics released form (PDF) and practice the actual released questions on NCDPI's site.",
    url: "https://www.dpi.nc.gov/documents/accountability/testing/eog/eog-mathematics-grade-3-released-form/open" },
  { grades: [3], type: "official", name: "NCDPI — Grade 3 Reading Released Form (BOG3-EOG)",
    desc: "Official Grade 3 Reading released items (PDF) with passages and questions, on NCDPI's site.",
    url: "https://www.dpi.nc.gov/documents/accountability/testing/eog/bog3-eog-reading-grade-3-released-form/open" },
  { grades: [3, 4], type: "official", name: "NCDPI — Grade 4 Math Released Form (real released test)",
    desc: "Official Grade 4 Mathematics released form (PDF) with the actual released questions, on NCDPI's site.",
    url: "https://www.dpi.nc.gov/documents/accountability/testing/eog/eog-mathematics-grade-4-released-form/open" },
  { grades: [3, 4, 5], type: "official", name: "NCDPI — All Released Tests",
    desc: "Index of every NCDPI released EOG/EOC form (Math, Reading, Science) by grade — open and practice any of them.",
    url: "https://www.dpi.nc.gov/document-terms/released-tests" },
];
const RES_TYPE = {
  ideas: { label: "💡 Ideas & Practice", cls: "rt-ideas" },
  questions: { label: "📝 Practice Questions", cls: "rt-questions" },
  official: { label: "🏛️ Official (some with questions)", cls: "rt-official" },
};

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
  if (p[0] === "resources") return viewResources();

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

// ── Resources for the selected grade ───────────────────────────────────────────
function viewResources() {
  const grade = state.grade || 3;
  const items = RESOURCES.filter((r) => r.grades.includes(grade));
  render(`
    <section class="wizard">
      ${crumbs([stateLabel(state.region), "Grade " + grade, "Resources"])}
      <div class="hero"><h1>📚 Helpful Resources</h1><p>Extra practice and official material for Grade ${grade}.</p></div>
      <div class="res-list">
        ${items.map((r) => {
          const t = RES_TYPE[r.type] || RES_TYPE.ideas;
          return `
          <a class="res-card" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">
            <span class="res-type ${t.cls}">${t.label}</span>
            <span class="res-name">${esc(r.name)}</span>
            <span class="res-desc">${esc(r.desc)}</span>
            <span class="res-go">Open ↗</span>
          </a>`;
        }).join("")}
      </div>
      <p class="center-note muted">Links open on the providers' sites. Some are study material (ideas); some include real practice questions.</p>
      <p class="center-link"><button class="linkish" id="res-back">← Back</button></p>
    </section>`);
  app.querySelector("#res-back").onclick = () => go(`#/${state.region}/g${grade}`);
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
  launch(test, !!(saved && saved.guidance), saved && typeof saved.validate === "boolean" ? saved.validate : true);
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
      <p class="center-link"><button class="linkish" id="go-res">📚 Helpful resources for Grade ${state.grade}</button></p>
    </section>`);
  app.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => go(`#/${state.region}/g${state.grade}/${b.dataset.s}`)));
  app.querySelector("#go-res").onclick = () => go("#/resources");
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
  const offline = !navigator.onLine;
  render(`
    <section class="wizard">
      ${crumbs([stateLabel(state.region), "Grade " + state.grade, cap(state.subject), state.testType.toUpperCase()])}
      <div class="hero"><h1>Choose a test</h1><p>Use a ready test, or make a brand-new one.</p></div>
      ${offline ? `<div class="offline-banner">📴 You're offline — showing tests you saved on this device. Tap a test to take it.</div>` : ""}
      <div id="test-list" class="test-list"><div class="loading">Loading tests…</div></div>
      ${offline ? "" : `<div class="gen-row">
        <button id="btn-generate" class="btn btn-generate">✨ Generate a New Test</button>
        <span class="gen-note">Makes a fresh test with AI (about a minute). It's saved for next time.</span>
      </div>`}
    </section>`);
  const genBtn = app.querySelector("#btn-generate");
  if (genBtn) genBtn.onclick = () => generateNew();

  let tests = [];
  try { tests = await api.listTests({ grade: state.grade, subject: state.subject, testType: state.testType }); }
  catch (e) {}
  const list = app.querySelector("#test-list");
  if (!list) return;
  if (!tests.length) {
    list.innerHTML = offline
      ? `<div class="empty">No tests saved on this device for this choice yet. Connect to the internet and tap “⬇ Save offline” on a test.</div>`
      : `<div class="empty">No saved tests yet — tap “Generate a New Test” to make one! ✨</div>`;
    return;
  }
  list.innerHTML = tests.map((t) => {
    const saved = api.isOfflineSaved(t.id);
    return `
      <div class="test-row" data-id="${t.id}" role="button" tabindex="0">
        <span class="test-row-icon">${state.subject === "math" ? "🔢" : "📖"}</span>
        <span class="test-row-main">
          <span class="test-row-title">${esc(t.title)}${t.source === "sample" ? ` <span class="sample-badge">Sample</span>` : ""}${saved ? ` <span class="off-badge">📥 Offline</span>` : ""}</span>
          <span class="test-row-sub">${t.questionCount} questions · ~${t.timeLimitMinutes} min · ${srcLabel(t.source)}</span>
        </span>
        <span class="test-row-actions">
          ${offline ? "" : `<button class="dl-btn ${saved ? "saved" : ""}" data-id="${t.id}">${saved ? "✓ Saved" : "⬇ Save offline"}</button>`}
          <span class="test-row-go">Start →</span>
        </span>
      </div>`;
  }).join("");
  list.querySelectorAll(".test-row").forEach((row) => {
    row.onclick = () => go(`#/start/${row.dataset.id}`);
    row.onkeydown = (e) => { if (e.key === "Enter") go(`#/start/${row.dataset.id}`); };
  });
  list.querySelectorAll(".dl-btn").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const id = b.dataset.id;
      if (api.isOfflineSaved(id)) { api.removeOffline(id); viewTests(); return; }
      b.textContent = "Saving…"; b.disabled = true;
      try { const full = await api.getTest(id); api.saveOffline(full); }
      catch { b.textContent = "⬇ Save offline"; b.disabled = false; return; }
      viewTests();
    };
  });
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
  const validatePref = localStorage.getItem("enableValidate") !== "0"; // default ON

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
        <label class="guide-toggle validate-toggle">
          <input type="checkbox" id="enable-validate" ${validatePref ? "checked" : ""}/>
          <span>✅ <b>Let me validate my answers</b> — after I pick, I can tap <i>Validate</i> to lock it in and instantly see if it's right (and the correct answer if not)</span>
        </label>
        <label class="guide-toggle">
          <input type="checkbox" id="need-guidance" ${guidePref ? "checked" : ""}/>
          <span>🧭 <b>Need guidance</b> — let me <i>check</i> &amp; <i>show</i> answers as I go (practice mode)</span>
        </label>
        <div id="adult-gate" class="adult-gate" style="display:none"></div>
        <button id="btn-begin" class="btn btn-begin">Start Test →</button>
        ${known ? `<p class="name-tip">Not ${esc(state.student)}? <button class="linkish" id="change-name">change name</button></p>`
                : `<p class="name-tip">⏱ A timer will start. We'll remember your name next time.</p>`}
      </div>
    </section>`);

  const input = app.querySelector("#student");
  const begin = app.querySelector("#btn-begin");
  const guide = app.querySelector("#need-guidance");
  const gateBox = app.querySelector("#adult-gate");
  let gateAnswer = null, gateOK = false;

  const nameOK = () => !!state.student || (input && input.value.trim().length >= 1);
  const sync = () => { begin.disabled = !nameOK() || (guide.checked && !gateOK); };

  // Adult-only check: a 2-digit × 2-digit problem a grown-up solves to unlock
  // guidance (which can reveal answers). Required every time the test is started.
  function showGate() {
    const a = 12 + Math.floor(Math.random() * 18);   // 12–29
    const b = 13 + Math.floor(Math.random() * 16);   // 13–28
    gateAnswer = a * b; gateOK = false;
    gateBox.innerHTML = `
      <div class="gate-title">🔒 Grown-up check</div>
      <div class="gate-text">Guidance can show answers, so a grown-up unlocks it. Solve: <b>${a} × ${b} = ?</b></div>
      <input id="gate-input" class="gate-input" type="text" inputmode="numeric" autocomplete="off" placeholder="answer" />
      <span id="gate-status" class="gate-status"></span>`;
    gateBox.style.display = "";
    const gi = gateBox.querySelector("#gate-input");
    const gs = gateBox.querySelector("#gate-status");
    gi.oninput = () => {
      gateOK = parseInt(gi.value, 10) === gateAnswer;
      gs.textContent = gi.value.trim() === "" ? "" : (gateOK ? "✓ Unlocked" : "");
      gs.className = "gate-status" + (gateOK ? " ok" : "");
      sync();
    };
    gi.onkeydown = (e) => { if (e.key === "Enter" && !begin.disabled) begin.click(); };
    gi.focus();
  }
  function hideGate() { gateBox.style.display = "none"; gateBox.innerHTML = ""; gateOK = false; gateAnswer = null; }

  if (input) { input.oninput = sync; input.focus(); input.onkeydown = (e) => { if (e.key === "Enter" && !begin.disabled) begin.click(); }; }
  if (guide.checked) showGate();             // remembered preference → still re-confirm
  guide.onchange = () => { if (guide.checked) showGate(); else hideGate(); sync(); };
  sync();

  const cn = app.querySelector("#change-name");
  if (cn) cn.onclick = () => { nameReturn = location.hash; go("#/name"); };
  const validate = app.querySelector("#enable-validate");
  begin.onclick = () => {
    if (input && input.value.trim()) setStudent(input.value.trim());
    if (!state.student) return;
    const guidance = !!(guide.checked && gateOK);
    localStorage.setItem("needGuidance", guide.checked ? "1" : "0");
    localStorage.setItem("enableValidate", validate.checked ? "1" : "0");
    launch(test, guidance, validate.checked);
  };
}

function launch(test, guidance, validate = true) {
  api.saveOffline(test); // cache so this test (and resume/review) works offline
  document.body.classList.add("in-test");
  updateChrome(parseHash());
  if (runner) runner.stop();
  runner = new Runner(app, test, state.student, {
    guidance, validate, onExit: exitTest, onHistory: () => go("#/history"),
    onRetake: () => go(`#/start/${test.id}`),
    onPause: () => { leaveTest(); go(`#/${state.region}`); },
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
      onRetake: () => go(`#/start/${test.id}`),
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

// PWA install prompt → show an "Install" button in the header when available.
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  const b = document.getElementById("install-btn");
  if (!b) return;
  b.style.display = "";
  b.onclick = async () => {
    b.style.display = "none";
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch {}
    deferredInstall = null;
  };
});
window.addEventListener("appinstalled", () => {
  const b = document.getElementById("install-btn");
  if (b) b.style.display = "none";
});

initDict();
window.addEventListener("hashchange", route);
window.addEventListener("online", () => { if (!document.body.classList.contains("in-test")) route(); });
window.addEventListener("offline", () => { if (!document.body.classList.contains("in-test")) route(); });
route();
