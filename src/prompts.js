// Prompt builders for dynamic test generation (shared by Worker + batch script).

const DIAGRAM_DOC = `
Diagrams: attach "diagram": { "type": ..., "params": {...} } to a question where helpful (null otherwise).
Supported types & params:
- number_line: { min, max, step, point } or with intervals:[{from,to,label}], marks:[{value,label}]
- fraction_bar: { parts, shaded } OR { bars:[{parts,shaded,label}] }
- fraction_circle: { parts, shaded }
- array_dots: { rows, cols }
- bar_graph: { title, xLabel, yLabel, yMax, yStep, bars:[{label,value}] }
- picture_graph: { title, symbol, unitValue, rows:[{label,count}] }
- clock: { hour, minute }
- rectangle: { width, height, unit, showGrid, label }
- shape: { kind, sideLabels, angleLabels }
- base_ten: { hundreds, tens, ones }
- data_table: { headers:[...], rows:[[...]] }
Diagram numbers MUST be consistent with the question and key.`;

const SCHEMA_DOC = `
Return ONE JSON object ONLY (no markdown) with this exact shape:
{
  "id": string, "grade": int, "subject": "math"|"reading", "testType": "boy"|"moy"|"eog",
  "title": string, "instructions": string, "timeLimitMinutes": int,
  "calculatorAllowed": false, "source": "ai",
  "passages": [ { "id": "P1", "title": string, "genre": "fiction"|"informational"|"poetry", "lexile": string, "text": string } ],
  "questions": [ {
      "id": "Q1", "itemType": "single_choice"|"multi_select"|"numeric_entry",
      "skill": string, "difficulty": "easy"|"medium"|"hard",
      "passageId": string|null, "questionText": string,
      "diagram": object|null, "options": [string], "answer": int | int[] | number | string,
      "explanation": string, "points": 1
  } ]
}
Grading: single_choice answer = correct option INDEX (0-based); multi_select answer = array of indices;
numeric_entry answer = the numeric value (options = []). Provide EXACTLY 4 options for choice items.
Every option within a question MUST be unique — NEVER repeat the same option text twice. Each question id must be unique.
For reading, passages is non-empty and every question has a valid passageId; for math, passages = [].`;

export function systemPrompt() {
  return `You are an expert North Carolina End-of-Grade (EOG) assessment item writer for elementary grades.
You write original, standards-aligned, exam-quality practice tests.
CORRECTNESS IS PARAMOUNT: compute and double-check every math answer; ensure exactly one correct option for
single_choice; ensure reading answers are fully supported by the passage. Distractors must reflect common student mistakes.
${SCHEMA_DOC}
${DIAGRAM_DOC}`;
}

// Canonical question count per grade + subject + test type, matching the real NC
// EOG (Reading = 40 scored items across selections; Math = 40 operational items).
// BOG/MOY are lighter beginning-of-grade / benchmark forms.
export function expectedCount({ subject, testType }) {
  if (subject === "reading") return testType === "eog" ? 40 : testType === "moy" ? 24 : 32;
  return testType === "eog" ? 40 : testType === "moy" ? 30 : 25; // math
}

// Official NC administration time (suggested minutes). EOG ~120, BOG ~90; MOY is
// a local benchmark. Maximum allowed is up to 3 hours (handled in the runner).
export function suggestedMinutes(testType) {
  return testType === "eog" ? 120 : testType === "moy" ? 90 : 90;
}

export function userPrompt({ grade, subject, testType, difficulty, questionCount, id, title }) {
  const time = suggestedMinutes(testType);
  const count = questionCount || expectedCount({ subject, testType });

  const mathScope = `Match the real NC Grade ${grade} EOG Math. Domain weights: Operations & Algebraic Thinking 32-36%
(multiplication/division 0-10, properties, two-step word problems, patterns), Number & Operations Base Ten 9-13%
(place value, rounding to 10/100, add/subtract within 1000), Number & Operations–Fractions 28-32% (fractions on a
number line, equivalence, comparison, fractions of a whole), Measurement/Data/Geometry 23-27% (area & perimeter,
time to the minute + elapsed, mass/volume, bar & picture graphs, partitioning shapes, quadrilaterals).
DOK: ~45% DOK-1 (recall/procedure), ~55% DOK-2 (apply/two-step). Item mix: ~70% single_choice (EXACTLY 4 options),
~12% multi_select ("Select all"/"Select the two..."), ~18% numeric_entry (gridded). Use MANY diagrams (≥1 in 3).
Include at least 8 deliberately TRICKY or HARD items: multi-step word problems, "which expressions equal ___",
comparisons that trap common errors, elapsed-time across the hour, area-vs-perimeter mix-ups.`;

  const nPass = testType === "eog" ? 5 : testType === "moy" ? 3 : 4;
  const readingScope = `Match the real NC Grade ${grade} EOG Reading. Write ${nPass} ORIGINAL selections, a balanced mix of
LITERARY (story, fable, folktale, poem) and INFORMATIONAL (science, social studies, biography) — roughly 40% literary,
50% informational, plus Language items. Each selection is ~250-450 words and MUST be written in TWO labeled parts:
start the text with "Part 1" then later "Part 2" (separated by \\n\\n), like the real test. Distribute ${count}
questions evenly across the selections (~8 each) with correct passageId. ALL reading questions are single_choice with
EXACTLY 4 options (A-D); you may use 2-3 multi_select ("Select the two...") total; NO numeric_entry; diagram = null.
Use the authentic NC stems and cover these standards:
- Vocabulary-in-context (L.3.4 / RL.3.4 / RI.3.4): "What is the meaning of ___ in paragraph X?"
- Key details (RL/RI.3.1): "According to the text, ...", "What did ___ do after ...?"
- Character/sequence (RL.3.3 / RI.3.3): "Which word describes ___?", "What step follows ___?"
- Main idea / theme (RL.3.2 / RI.3.2): "What is the main idea of the text?"
- Text structure / connections (RI.3.8) — these are the HARD ones: "How does the author connect the ideas in
  paragraphs X and Y?", "What is the connection between paragraphs X and Y?"
- Evidence: "Which statement from the text supports the main idea?", "Which detail from the text supports that ___?"
- Cross-part (use BOTH parts): "What is one way ___ and ___ are alike?", "Why is ___ pleased at the end?"
- Figurative language (L.3.5.a): "What is the meaning of the phrase '___' in paragraph X?"
Include at least 8 deliberately TRICKY or HARD items (the RI.3.8 connection items, evidence items, inference, and
cross-part compare questions). Distractors must reflect plausible misreadings.`;

  return `Generate ONE Grade ${grade} ${subject.toUpperCase()} ${testType.toUpperCase()} practice test.
- id: "${id}"
- title: "${title}"
- timeLimitMinutes: ${time}
- The "questions" array MUST contain EXACTLY ${count} question objects — not ${count - 1}, not ${count + 1}. Count them before returning.
- Difficulty target: ${difficulty || "mixed (~40% easy, 40% medium, 20% hard)"}.
${subject === "math" ? mathScope : readingScope}
Return the JSON object only.`;
}
