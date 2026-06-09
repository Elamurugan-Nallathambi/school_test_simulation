// Vocabulary practice page: large words, self-check scoring, adult-gated reset.
let vocabData = null;
let vocabGrade = "all";
let vocabIndex = 0;
let vocabScore = 0;
let vocabShown = false;
let vocabPool = [];

const VOCAB_KEY = (student) => `vocabScore:${student || "guest"}`;
const VOCAB_GRADE_KEY = (student) => `vocabGrade:${student || "guest"}`;

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function loadVocab() {
  if (vocabData) return vocabData;
  const r = await fetch("/data/vocabulary.json");
  vocabData = await r.json();
  return vocabData;
}

function getScore(student) {
  try { const s = localStorage.getItem(VOCAB_KEY(student)); return s ? parseInt(s, 10) : 0; } catch { return 0; }
}
function setScore(student, score) {
  try { localStorage.setItem(VOCAB_KEY(student), String(score)); } catch {}
}
function getSavedGrade(student) {
  try { return localStorage.getItem(VOCAB_GRADE_KEY(student)) || "all"; } catch { return "all"; }
}
function setSavedGrade(student, grade) {
  try { localStorage.setItem(VOCAB_GRADE_KEY(student), grade); } catch {}
}

function buildPool(data, grade) {
  if (grade === "all") return [...data];
  const g = parseInt(grade, 10);
  return data.filter((w) => w.grade === g);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextWord(student) {
  if (!vocabPool.length) {
    vocabPool = shuffle(buildPool(vocabData, vocabGrade));
    vocabIndex = 0;
  }
  if (!vocabPool.length) return null;
  const word = vocabPool[vocabIndex % vocabPool.length];
  vocabIndex++;
  vocabShown = false;
  return word;
}

function speakWord(word) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(word));
    u.lang = "en-US"; u.rate = 0.85; u.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices() || [];
    const v = voices.find((x) => /en[-_]US/i.test(x.lang) && /samantha|zira|google/i.test(x.name))
      || voices.find((x) => /^en/i.test(x.lang)) || voices[0];
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  } catch {}
}

export async function renderVocab(app, student, onBack) {
  app.innerHTML = `
    <section class="wizard center">
      <div class="generating"><div class="spinner"></div><h2>Loading words…</h2></div>
    </section>`;
  await loadVocab();
  vocabGrade = getSavedGrade(student);
  vocabScore = getScore(student);
  vocabPool = shuffle(buildPool(vocabData, vocabGrade));
  vocabIndex = 0;
  showVocabScreen(app, student, onBack);
}

function showVocabScreen(app, student, onBack) {
  const word = nextWord(student);
  if (!word) {
    app.innerHTML = `
      <section class="wizard center">
        <div class="namecard">
          <div class="name-emoji">📚</div>
          <h1>No words found</h1>
          <p class="name-info">Try a different level.</p>
          <button id="vocab-back" class="btn btn-begin">← Back</button>
        </div>
      </section>`;
    app.querySelector("#vocab-back").onclick = onBack;
    return;
  }

  app.innerHTML = `
    <section class="wizard vocab-wiz">
      <div class="vocab-header">
        <button id="vocab-back" class="btn btn-ghost btn-sm">← Back</button>
        <div class="vocab-score-box">
          <span class="vocab-score-label">Score</span>
          <span id="vocab-score" class="vocab-score-num ${vocabScore < 0 ? "neg" : vocabScore > 0 ? "pos" : ""}">${vocabScore}</span>
        </div>
        <button id="vocab-reset" class="btn btn-ghost btn-sm">↺ Reset</button>
      </div>

      <div class="vocab-level-bar">
        <span class="vocab-level-label">Level:</span>
        <select id="vocab-grade" class="vocab-grade-select">
          <option value="all" ${vocabGrade === "all" ? "selected" : ""}>All Grades</option>
          <option value="1" ${vocabGrade === "1" ? "selected" : ""}>Grade 1</option>
          <option value="2" ${vocabGrade === "2" ? "selected" : ""}>Grade 2</option>
          <option value="3" ${vocabGrade === "3" ? "selected" : ""}>Grade 3</option>
          <option value="4" ${vocabGrade === "4" ? "selected" : ""}>Grade 4</option>
          <option value="5" ${vocabGrade === "5" ? "selected" : ""}>Grade 5</option>
        </select>
      </div>

      <div class="vocab-card">
        <div class="vocab-word">${esc(word.word)}</div>
        <div class="vocab-grade-tag">Grade ${word.grade}</div>

        <div class="vocab-actions">
          <button id="vocab-hear" class="btn btn-ghost">🔊 Hear Word</button>
          <button id="vocab-show" class="btn btn-primary">📖 Show Meaning</button>
        </div>

        <div id="vocab-meaning" class="vocab-meaning" style="display:none">
          <div class="vocab-meaning-text"><strong>Meaning:</strong> ${esc(word.meaning)}</div>
          <div class="vocab-example"><strong>Example:</strong> ${esc(word.example)}</div>
          <div class="vocab-selfcheck">
            <p class="vocab-check-q">Did you know this word?</p>
            <div class="vocab-check-btns">
              <button id="vocab-yes" class="btn btn-primary">✅ I Knew It!</button>
              <button id="vocab-no" class="btn btn-ghost">❌ I Didn't Know</button>
            </div>
          </div>
        </div>

        <div class="vocab-next-row">
          <button id="vocab-next" class="btn btn-begin">→ Next Word</button>
        </div>
      </div>

      <div id="vocab-gate" class="adult-gate" style="display:none"></div>
    </section>`;

  // Wire up
  app.querySelector("#vocab-back").onclick = onBack;

  const gradeSel = app.querySelector("#vocab-grade");
  gradeSel.onchange = () => {
    vocabGrade = gradeSel.value;
    setSavedGrade(student, vocabGrade);
    vocabPool = shuffle(buildPool(vocabData, vocabGrade));
    vocabIndex = 0;
    showVocabScreen(app, student, onBack);
  };

  app.querySelector("#vocab-hear").onclick = () => speakWord(word.word);

  app.querySelector("#vocab-show").onclick = () => {
    vocabShown = true;
    app.querySelector("#vocab-meaning").style.display = "";
    app.querySelector("#vocab-show").style.display = "none";
  };

  app.querySelector("#vocab-yes").onclick = () => {
    vocabScore += 1;
    setScore(student, vocabScore);
    updateScoreDisplay(app);
    showVocabScreen(app, student, onBack);
  };

  app.querySelector("#vocab-no").onclick = () => {
    vocabScore -= 1;
    setScore(student, vocabScore);
    updateScoreDisplay(app);
    showVocabScreen(app, student, onBack);
  };

  app.querySelector("#vocab-next").onclick = () => showVocabScreen(app, student, onBack);

  app.querySelector("#vocab-reset").onclick = () => showResetGate(app, student, onBack);
}

function updateScoreDisplay(app) {
  const el = app.querySelector("#vocab-score");
  if (!el) return;
  el.textContent = vocabScore;
  el.className = "vocab-score-num " + (vocabScore < 0 ? "neg" : vocabScore > 0 ? "pos" : "");
}

function showResetGate(app, student, onBack) {
  const gate = app.querySelector("#vocab-gate");
  if (!gate) return;
  const a = 12 + Math.floor(Math.random() * 18);
  const b = 13 + Math.floor(Math.random() * 16);
  const answer = a * b;
  let gateOK = false;
  gate.innerHTML = `
    <div class="gate-title">🔒 Grown-up check to reset score</div>
    <div class="gate-text">Solve: <b>${a} × ${b} = ?</b></div>
    <input id="vocab-gate-input" class="gate-input" type="text" inputmode="numeric" autocomplete="off" placeholder="answer" />
    <span id="vocab-gate-status" class="gate-status"></span>
    <div style="margin-top:8px"><button id="vocab-gate-cancel" class="btn btn-ghost btn-sm">Cancel</button></div>`;
  gate.style.display = "";

  const gi = gate.querySelector("#vocab-gate-input");
  const gs = gate.querySelector("#vocab-gate-status");
  gi.oninput = () => {
    gateOK = parseInt(gi.value, 10) === answer;
    gs.textContent = gi.value.trim() === "" ? "" : (gateOK ? "✓ Unlocked" : "");
    gs.className = "gate-status" + (gateOK ? " ok" : "");
    if (gateOK) {
      vocabScore = 0;
      setScore(student, 0);
      gate.style.display = "none";
      showVocabScreen(app, student, onBack);
    }
  };
  gi.focus();
  gate.querySelector("#vocab-gate-cancel").onclick = () => { gate.style.display = "none"; };
}
