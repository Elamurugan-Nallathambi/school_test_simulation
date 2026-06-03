// Shared test-paper validator. Used by the Worker (post-generation) and scripts.
// Returns { ok: boolean, errors: string[], warnings: string[] }.

const ITEM_TYPES = ["single_choice", "multi_select", "numeric_entry", "equation"];
const SUBJECTS = ["math", "reading"];
const TEST_TYPES = ["boy", "moy", "eog"];
const DIFFICULTIES = ["easy", "medium", "hard"];

const DIAGRAM_TYPES = new Set([
  "number_line", "fraction_bar", "fraction_circle", "array_dots",
  "bar_graph", "picture_graph", "clock", "rectangle", "shape",
  "base_ten", "data_table",
]);

export function validateTest(test) {
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  if (!test || typeof test !== "object") {
    return { ok: false, errors: ["test is not an object"], warnings };
  }

  if (!test.id || typeof test.id !== "string") E("missing/invalid id");
  if (!Number.isInteger(test.grade)) E("grade must be an integer");
  if (!SUBJECTS.includes(test.subject)) E(`subject must be one of ${SUBJECTS}`);
  if (!TEST_TYPES.includes(test.testType)) E(`testType must be one of ${TEST_TYPES}`);
  if (!test.title) E("missing title");
  if (!Number.isInteger(test.timeLimitMinutes) || test.timeLimitMinutes <= 0)
    E("timeLimitMinutes must be a positive integer");

  const passages = Array.isArray(test.passages) ? test.passages : [];
  const passageIds = new Set();
  for (const [i, p] of passages.entries()) {
    if (!p.id) E(`passage[${i}] missing id`);
    else passageIds.add(p.id);
    if (!p.text || p.text.length < 40) W(`passage[${i}] (${p.id}) text looks short`);
  }

  const questions = Array.isArray(test.questions) ? test.questions : [];
  if (questions.length === 0) E("no questions");

  const seenIds = new Set();
  for (const [i, q] of questions.entries()) {
    const tag = `Q[${i}]${q && q.id ? ` (${q.id})` : ""}`;
    if (!q || typeof q !== "object") { E(`${tag} not an object`); continue; }
    if (!q.id) E(`${tag} missing id`);
    else if (seenIds.has(q.id)) E(`${tag} duplicate id`);
    else seenIds.add(q.id);

    if (!ITEM_TYPES.includes(q.itemType)) { E(`${tag} bad itemType '${q.itemType}'`); continue; }
    if (!q.questionText) E(`${tag} missing questionText`);
    if (q.difficulty && !DIFFICULTIES.includes(q.difficulty)) W(`${tag} odd difficulty '${q.difficulty}'`);

    // passage linkage
    if (test.subject === "reading") {
      if (q.passageId == null) W(`${tag} reading question has no passageId`);
      else if (!passageIds.has(q.passageId)) E(`${tag} passageId '${q.passageId}' not found`);
    }

    const opts = Array.isArray(q.options) ? q.options : [];

    if (q.itemType === "single_choice") {
      if (opts.length < 2) E(`${tag} single_choice needs >=2 options`);
      if (new Set(opts.map(String)).size !== opts.length) E(`${tag} duplicate option text`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= opts.length)
        E(`${tag} answer index ${q.answer} out of range (0..${opts.length - 1})`);
    } else if (q.itemType === "multi_select") {
      if (opts.length < 2) E(`${tag} multi_select needs >=2 options`);
      if (!Array.isArray(q.answer) || q.answer.length < 1)
        E(`${tag} multi_select answer must be a non-empty array`);
      else {
        for (const a of q.answer)
          if (!Number.isInteger(a) || a < 0 || a >= opts.length)
            E(`${tag} multi_select answer index ${a} out of range`);
        if (new Set(q.answer).size !== q.answer.length) E(`${tag} duplicate answer indices`);
      }
    } else if (q.itemType === "numeric_entry") {
      if (opts.length > 0) W(`${tag} numeric_entry should have empty options`);
      if (q.answer === undefined || q.answer === null || q.answer === "")
        E(`${tag} numeric_entry missing answer`);
    } else if (q.itemType === "equation") {
      if (opts.length > 0) W(`${tag} equation should have empty options`);
      if (!q.template || !String(q.template).includes("▢"))
        E(`${tag} equation needs a template containing the blank box "▢"`);
      if (q.answer === undefined || q.answer === null || q.answer === "")
        E(`${tag} equation missing answer`);
    }

    if (q.diagram != null) {
      if (typeof q.diagram !== "object" || !DIAGRAM_TYPES.has(q.diagram.type))
        W(`${tag} unknown diagram type '${q.diagram && q.diagram.type}'`);
    }
    if (!q.explanation) W(`${tag} missing explanation`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function questionCount(test) {
  return Array.isArray(test.questions) ? test.questions.length : 0;
}
