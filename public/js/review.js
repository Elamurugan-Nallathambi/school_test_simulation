// Shared results + answer-review renderer. Used by the live runner (right after
// finishing) and by the saved-results summary (from the DB) — identical scoring
// and identical review cards.
import { renderDiagram } from "./diagrams.js";
import { gradeTest } from "./grade.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const LETTERS = ["A", "B", "C", "D", "E", "F"];

// NC organizes reading into Literature (Fiction) vs Informational (Nonfiction);
// poetry is a literary type kept separate so poems aren't mislabeled.
export const GENRE_LABEL = { fiction: "Fiction", nonfiction: "Nonfiction", poetry: "Poetry" };

// Normalize any author/genre tag to one of fiction | nonfiction | poetry.
export function normalizeGenre(g) {
  const s = String(g || "").toLowerCase();
  if (/poe|poem|verse|rhyme/.test(s)) return "poetry";
  if (/inform|nonfiction|non-fiction|biograph|article|science|history|expositor/.test(s)) return "nonfiction";
  return "fiction"; // fiction, story, fable, folktale, myth, legend, narrative
}

function genreSectionHTML(test, responses) {
  const passages = test.passages || [];
  if (!passages.length) return "";
  const rows = passages.map((p) => {
    const pick = responses ? responses["__genre__" + p.id] : null;
    const correct = normalizeGenre(p.genre);
    const ok = pick === correct;
    const yourLabel = pick ? GENRE_LABEL[pick] : "— (not chosen)";
    return `<div class="genre-row ${pick ? (ok ? "rv-ok" : "rv-no") : ""}">
        <span class="genre-mark">${pick ? (ok ? "✓" : "✗") : "·"}</span>
        <span class="genre-title">📖 ${esc(p.title || p.id)}</span>
        <span class="genre-vals">You said: <b>${esc(yourLabel)}</b> · Correct answer: <b>${esc(GENRE_LABEL[correct])}</b></span>
      </div>`;
  }).join("");
  const picked = passages.filter((p) => responses && responses["__genre__" + p.id]);
  const right = picked.filter((p) => responses["__genre__" + p.id] === normalizeGenre(p.genre)).length;
  return `
    <h3 class="review-title">Text-Type Check ${picked.length ? `<span class="muted">(${right}/${picked.length} correct)</span>` : ""}</h3>
    <div class="genre-review">${rows}</div>`;
}

// opts: { test, responses, student, durationSeconds, timeUp, savedAt,
//         primaryLabel, onPrimary }
export function renderResults(root, opts) {
  const { test, responses, student } = opts;
  const passById = Object.fromEntries((test.passages || []).map((p) => [p.id, p]));
  const g = gradeTest(test.questions, responses);
  const pct = g.total ? Math.round((g.correct / g.total) * 100) : 0;
  const dur = opts.durationSeconds || 0;
  const m = Math.floor(dur / 60), s = dur % 60;
  const mood = pct >= 85 ? "🌟" : pct >= 70 ? "😀" : pct >= 50 ? "🙂" : "💪";
  const review = g.detail.map(({ q, resp, ok }, i) => reviewCard(q, resp, ok, i, passById)).join("");

  root.innerHTML = `
    <div class="results">
      <div class="results-head">
        <div class="score-ring ${pct >= 70 ? "good" : pct >= 50 ? "ok" : "low"}">
          <div class="score-pct">${pct}%</div>
          <div class="score-frac">${g.correct} / ${g.total}</div>
        </div>
        <div class="results-meta">
          <h2>${mood} ${opts.timeUp ? "Time's up" : "Great job"}, ${esc(student)}!</h2>
          <p class="muted">${esc(test.title)}</p>
          <p class="muted">Score ${g.correct} of ${g.total} · ${pct}%${dur ? ` · Time used ${m}m ${s}s` : ""}${opts.savedAt ? ` · ${esc(formatDate(opts.savedAt))}` : ""}</p>
          <div class="results-actions">
            <button id="btn-primary" class="btn btn-primary">${esc(opts.primaryLabel || "Back to Tests")}</button>
            <button id="btn-history" class="btn btn-ghost">📊 My Results</button>
            <button id="btn-print" class="btn btn-ghost">🖨 Print</button>
          </div>
        </div>
      </div>
      ${genreSectionHTML(test, responses)}
      <h3 class="review-title">Answer Review</h3>
      <div class="review-list">${review}</div>
    </div>`;

  root.querySelector("#btn-primary").onclick = () => opts.onPrimary && opts.onPrimary();
  root.querySelector("#btn-history").onclick = () => opts.onHistory && opts.onHistory();
  root.querySelector("#btn-print").onclick = () => window.print();
  return g;
}

export function reviewCard(q, resp, ok, i, passById) {
  const passage = q.passageId ? passById[q.passageId] : null;
  const diagramHtml = q.diagram ? `<div class="q-diagram small">${renderDiagram(q.diagram)}</div>` : "";
  const blank = (resp == null || resp === "" || (Array.isArray(resp) && !resp.length));
  let answerBlock = "";
  if (q.itemType === "numeric_entry") {
    answerBlock = `
      <div class="rv-line"><b>Your answer:</b> <span class="${ok ? "ok" : "no"}">${blank ? "— (blank)" : esc(resp)}</span></div>
      <div class="rv-line"><b>Correct answer:</b> <span class="ok">${esc(q.answer)}</span></div>`;
  } else {
    const letters = (idxs) => (Array.isArray(idxs) ? idxs : [idxs])
      .filter((x) => x != null && x !== "")
      .map((x) => `${LETTERS[x]}. ${esc((q.options || [])[x])}`).join("; ");
    answerBlock = `
      <div class="rv-line"><b>Your answer:</b> <span class="${ok ? "ok" : "no"}">${blank ? "— (blank)" : letters(resp)}</span></div>
      <div class="rv-line"><b>Correct answer:</b> <span class="ok">${letters(q.answer)}</span></div>`;
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

export function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}
