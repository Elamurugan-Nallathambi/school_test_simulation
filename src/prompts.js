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

// Canonical question count per grade + subject + test type. Generation must hit
// this EXACTLY; the curated bank is built to the same numbers.
export function expectedCount({ subject, testType }) {
  if (subject === "reading") return testType === "eog" ? 36 : testType === "moy" ? 28 : 24;
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

  const mathScope = `Cover the full NC Grade ${grade} math range: add/subtract within 1000, multiplication & division (0-10),
fractions (number line, bars, equivalence), time (to the minute + elapsed), measurement (mass/volume/length),
area & perimeter, geometry (quadrilaterals/partitioning), bar & picture graphs + data tables, place value & rounding,
and multi-step word problems. Use MANY diagrams (at least 1 in 3 questions). Mix item types
(~75% single_choice, ~12% multi_select, ~13% numeric_entry).`;

  const readingScope = `Include ${testType === "eog" ? 4 : 3} ORIGINAL passages (mix of literary fiction, informational,
and a poem/folktale), Lexile ~420-650L, paragraphs separated by \\n\\n. Distribute ~${count} questions across them with
correct passageId. Cover key ideas & details, vocabulary-in-context, inference, main idea/theme, text structure,
and author's craft. diagram = null for all reading questions.`;

  return `Generate ONE Grade ${grade} ${subject.toUpperCase()} ${testType.toUpperCase()} practice test.
- id: "${id}"
- title: "${title}"
- timeLimitMinutes: ${time}
- The "questions" array MUST contain EXACTLY ${count} question objects — not ${count - 1}, not ${count + 1}. Count them before returning.
- Difficulty target: ${difficulty || "mixed (~40% easy, 40% medium, 20% hard)"}.
${subject === "math" ? mathScope : readingScope}
Return the JSON object only.`;
}
