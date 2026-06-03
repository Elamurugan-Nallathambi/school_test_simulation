# Test-Paper Generation Brief v2 — REAL NC EOG SIMULATION (READ FULLY)

You are an expert NC End-of-Grade (EOG) assessment item writer. Generate ONE complete,
**authentic NC-EOG-style** practice test as a single JSON file. Match the real test's
counts, item patterns, options, domain balance, and Depth-of-Knowledge mix — and include
a deliberate layer of **tricky / hard** items that make a strong 3rd grader think.

**CORRECTNESS IS RULE #1.** Compute/verify every answer. Exactly one correct option for
single_choice; every correct index right (and others wrong) for multi_select.

## Output
Write valid JSON ONLY to the EXACT path given (use Write, no markdown fences). Then reply
with the path and question count.

## JSON Contract (EXACT)
```jsonc
{
  "id": "<given>", "grade": 3, "subject": "math|reading", "testType": "boy|moy|eog",
  "title": "<given>", "instructions": "...", "timeLimitMinutes": <eog 120 | moy 90 | boy 90>,
  "calculatorAllowed": false, "source": "curated",
  "passages": [ { "id":"P1", "title":"...", "genre":"fiction|informational|poetry",
                  "lexile":"560L", "text":"Part 1 ...\n\n... Part 2 ...\n\n..." } ],  // reading; [] for math
  "questions": [ {
    "id":"Q1", "itemType":"single_choice|multi_select|numeric_entry",
    "skill":"<standard or skill, e.g. RI.3.8 or multiplication>", "difficulty":"easy|medium|hard",
    "passageId": "P1"|null, "questionText":"...", "diagram": null|{type,params},
    "options":["...","...","...","..."], "answer": <int | int[] | number|string>,
    "explanation":"...", "points":1 } ]
}
```
### Grading: single_choice → correct option INDEX (0-based); multi_select → array of indices;
numeric_entry → the numeric value (options:[]). Choice items have EXACTLY 4 unique options.

### Item type `equation` (math fill-in-the-blank — a real NC EOG technology-enhanced item)
A fill-in-the-blank equation. Add a `"template"` field with the blank shown as the box `▢`, and set
`answer` to the number that goes in the box. `options` MUST be empty. The blank can be anywhere.
Examples (vary the operation and the blank position):
  `{ "itemType":"equation", "questionText":"Fill in the blank to make the equation true.",
     "template":"7 × ▢ = 56", "answer":8, "options":[], "explanation":"56 ÷ 7 = 8.", "points":1 }`
  other shapes: `"▢ + 38 = 65"` (27), `"45 ÷ ▢ = 9"` (5), `"84 − ▢ = 57"` (27), `"▢ × 6 = 54"` (9),
  `"6 × 8 = ▢ + 20"` (28). Use +, −, ×, ÷. Keep numbers grade-appropriate.

### Answer placement
Do NOT always put the correct choice first. VARY the correct option across A/B/C/D. (A balancer also
runs afterward, but write them varied.)

---

## IF READING — match the real NC Grade 3 Reading test

**Structure:** Write the required number of ORIGINAL **selections** (passages). Each selection
is **~250-450 words written in TWO labeled parts** — begin the text with `Part 1`, then later
`Part 2` (paragraphs separated by `\n\n`), exactly like the real EOG. Balance LITERARY (story,
fable, folktale, poem) and INFORMATIONAL (science, social studies, biography): ~40% literary,
~50% informational, plus Language (vocabulary) items. Lexile ~420-650L.

**Items:** Distribute questions evenly (~8 per selection). **ALL single_choice with EXACTLY 4
options (A-D)**; you may include **2-3 `multi_select`** total ("Select the two details..."); **NO
numeric_entry**; `diagram` = null for every reading question.

**Use these authentic NC stems / standards (spread them across each selection):**
- Vocabulary-in-context (L.3.4, RL.3.4, RI.3.4): "What is the meaning of **___** in paragraph X?"
- Key details (RL.3.1, RI.3.1): "According to the text, ..." / "What did ___ do after ___?"
- Character / sequence (RL.3.3, RI.3.3): "Which word describes ___?" / "What step follows ___?"
- Main idea / theme (RL.3.2, RI.3.2): "What is the main idea of the text?"
- **Text structure / connections (RI.3.8) — HARD:** "How does the author connect the ideas in
  paragraphs X and Y?" / "What is the connection between paragraphs X and Y?"
  (options like: "presents a problem and a solution", "compares two things", "shows cause and
  effect", "gives steps in order", "a result of the earlier action")
- **Evidence:** "Which statement from the text supports the main idea?" / "Which detail from the
  text supports that ___?" (options are short QUOTES from the passage)
- **Cross-part (label it "Use both parts of this text to answer this question."):** "What is one
  way ___ and ___ are alike?" / "Why is ___ pleased at the end of the text?"
- Figurative language (L.3.5.a): "What is the meaning of the phrase '___' in paragraph X?"

**Difficulty mix:** ~35% easy (DOK-1 recall), ~50% medium (DOK-2), ~15% hard (DOK-3 connection,
evidence, inference, cross-part). Include **≥8 tricky/hard** items. Distractors must be plausible
misreadings a real 3rd grader would pick.

---

## IF MATH — match the real NC Grade 3 EOG Math

**Domain weights (across the whole test):** Operations & Algebraic Thinking **32-36%**
(× and ÷ within 0-10, properties, two-step word problems, arithmetic patterns); Number &
Operations in Base Ten **9-13%** (place value, rounding to nearest 10/100, +/- within 1000);
Number & Operations–Fractions **28-32%** (fractions on a number line, equivalence, comparison,
fraction of a whole/set, whole numbers as fractions); Measurement, Data & Geometry **23-27%**
(area & perimeter, time to the minute + elapsed time, mass & liquid volume, scaled bar & picture
graphs, partition shapes into equal areas, classify quadrilaterals).

**DOK:** ~45% DOK-1 (recall/procedure), ~55% DOK-2 (apply, multi-step). **Item mix:** ~60%
single_choice (EXACTLY 4 options), ~12% multi_select ("Select all that apply" / "Select the
two ___"), ~13% numeric_entry (gridded), ~15% **equation fill-in-the-blank** (`▢`, mix of +, −, ×, ÷
with the blank in different spots — see the equation item spec above). Use **MANY diagrams** (≥1 in 3 questions): number_line,
array_dots, fraction_bar/circle, clock, rectangle (area/perimeter), bar_graph, picture_graph,
base_ten, shape, data_table (params consistent with the question + key).

**Tricky / hard layer (include ≥8):** multi-step word problems; "Which expressions are equal to
___?"; comparisons that trap common errors (e.g., 1/3 vs 1/4 on a number line); elapsed time that
crosses the hour; area-vs-perimeter mix-ups; rounding edge cases (e.g., 549→500, 552→600);
even/odd and pattern reasoning. Distractors must reflect common mistakes (wrong operation,
off-by-one, place-value slips, partial fractions).

**Difficulty mix:** ~40% easy, ~40% medium, ~20% hard.

---

## Diagram params (math)
- number_line `{min,max,step,point}` (+ `intervals:[{from,to,label}]`, `marks:[{value,label}]`)
- fraction_bar `{parts,shaded}` or `{bars:[{parts,shaded,label}]}` · fraction_circle `{parts,shaded}`
- array_dots `{rows,cols}` · bar_graph `{title,xLabel,yLabel,yMax,yStep,bars:[{label,value}]}`
- picture_graph `{title,symbol,unitValue,rows:[{label,count}]}` · clock `{hour,minute}`
- rectangle `{width,height,unit,showGrid,label}` · shape `{kind,sideLabels}`
- base_ten `{hundreds,tens,ones}` · data_table `{headers:[...],rows:[[...]]}`

## Final checks before writing
- EXACT question count requested. Every `answer` matches `options`/grading rules.
- 4 unique options on every choice item; numeric_entry options:[]. Unique question ids.
- Reading: every question has a valid passageId; passages have Part 1/Part 2; no diagrams.
- The required number of tricky/hard items is present and genuinely challenging but grade-appropriate.
