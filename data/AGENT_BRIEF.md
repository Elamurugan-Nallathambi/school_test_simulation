# Test-Paper Generation Brief (READ FULLY)

You are an expert NC EOG (North Carolina End-of-Grade) assessment item writer.
Generate ONE complete, exam-quality practice test as a single JSON file.

**CORRECTNESS IS THE #1 RULE.** Every answer key MUST be correct. For every math
question, compute the answer step by step in your head and DOUBLE-CHECK it before
writing the key. Make sure exactly one option is correct for single_choice and that
distractors are plausible but wrong. For multi_select, make sure every listed correct
index is truly correct and every other option is truly wrong.

## Output

Write the JSON to the EXACT file path you are told. Use `Write`. Output ONLY valid
JSON in the file (no markdown fences, no comments). After writing, reply with a 2-line
summary: the file path and the question count.

## JSON Contract (follow EXACTLY)

```jsonc
{
  "id": "<given-id>",
  "grade": 3,
  "subject": "math",            // "math" | "reading"  (as instructed)
  "testType": "eog",            // "boy" | "moy" | "eog" (as instructed)
  "title": "<given title>",
  "instructions": "Read each question carefully. Choose the best answer.",
  "timeLimitMinutes": 80,        // EOG: 80, MOY: 60, BOY: 45 (use the one instructed)
  "calculatorAllowed": false,
  "source": "curated",
  "passages": [ /* reading only; [] for math */
    { "id": "P1", "title": "...", "genre": "fiction|informational|poetry",
      "lexile": "520L", "text": "Para 1...\n\nPara 2..." }
  ],
  "questions": [
    {
      "id": "Q1",
      "itemType": "single_choice",   // single_choice | multi_select | numeric_entry
      "skill": "multiplication",     // short skill tag
      "difficulty": "easy",          // easy | medium | hard
      "passageId": null,             // reading: the passage id; math: null
      "questionText": "What is 6 × 7?",
      "diagram": null,               // or a diagram object (see below)
      "options": ["35","42","48","13"], // [] for numeric_entry
      "answer": 1,                   // grading rules below
      "explanation": "6 rows of 7 is 42.",
      "points": 1
    }
  ]
}
```

### Grading rules for `answer`
- single_choice → integer INDEX (0-based) of the correct option.
- multi_select  → array of integer indices, e.g. `[0,2]` (ALL correct ones, exact).
- numeric_entry → the numeric value as a number or string (e.g. `42`, `"3/4"`).
  Optionally add `"acceptedAnswers": ["0.75","3/4"]` for equivalent forms.

### Options rules
- single_choice & multi_select: provide EXACTLY 4 options (strings).
- multi_select questions: phrase as "Select all that apply." and make 2–3 correct.
- numeric_entry: `"options": []`.

## Diagrams (use where they help — aim for many in math)

`"diagram"` is `{ "type": ..., "params": {...} }`. Supported types & params:

- `number_line`: `{ "min":0, "max":10, "step":1, "point":3 }` or with
  `"intervals":[{"from":0,"to":2,"label":"jump"}]`, `"marks":[{"value":4,"label":"4"}]`.
- `fraction_bar`: `{ "parts":4, "shaded":3 }`  OR multiple:
  `{ "bars":[{"parts":2,"shaded":1,"label":"A"},{"parts":4,"shaded":2,"label":"B"}] }`.
- `fraction_circle`: `{ "parts":4, "shaded":3 }`.
- `array_dots`: `{ "rows":6, "cols":7 }` (multiplication/area model).
- `bar_graph`: `{ "title":"Books Read","xLabel":"Kids","yLabel":"Books","yMax":10,"yStep":2,
   "bars":[{"label":"Ann","value":6},{"label":"Ben","value":4}] }`.
- `picture_graph`: `{ "title":"Apples","symbol":"🍎","unitValue":2,
   "rows":[{"label":"Mon","count":3},{"label":"Tue","count":5}] }` (count = number of symbols).
- `clock`: `{ "hour":3, "minute":45 }`.
- `rectangle`: `{ "width":6, "height":4, "unit":"cm", "showGrid":true, "label":"Garden" }`
  (area/perimeter; showGrid draws unit squares).
- `shape`: `{ "kind":"quadrilateral|triangle|pentagon|hexagon|trapezoid|rhombus",
   "sideLabels":["4 cm","3 cm","4 cm","3 cm"] }`.
- `base_ten`: `{ "hundreds":3, "tens":4, "ones":2 }` (place value blocks).
- `data_table`: `{ "headers":["Name","Votes"], "rows":[["Ann","6"],["Ben","4"]] }`.

Only attach diagrams that match the question. Keep params consistent with the text
(e.g. if a bar_graph question asks "how many more", the bar values must support the key).

## Quality bar
- Real EOG flavor: clear stems, grade-appropriate vocabulary, no trick wording.
- Spread difficulty (~40% easy, ~40% medium, ~20% hard) and skills evenly.
- Distractors reflect COMMON student mistakes (off-by-one, wrong operation,
  place-value slips, partial fractions).
- Reading passages must be ORIGINAL, age-appropriate, and self-contained, with
  paragraphs separated by `\n\n`. Questions must be answerable from the passage.
- Explanations are short, kid-friendly, and show the reasoning.
- NEVER leave an `answer` that doesn't match `options`. NEVER duplicate option text.
