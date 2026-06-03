# School Test Simulation — EOG Practice Portal

A kid-friendly web portal for practicing **North Carolina EOG-style** tests
(Reading & Math). Children pick their grade, test type, and subject, enter their
name, and take a clean, **exam-like, timed** test. Tests can be **curated**
(pre-generated and stored) or **dynamically generated** on demand via OpenAI and
then **stored for reuse** so we don't regenerate the same effort repeatedly.

Built to run on **Cloudflare free services** and deployed via `cfl` (account
`rugan`) as the project **`us-bme-test`**.

---

## 1. Goals

1. Grades **3, 4, 5** (start with Grade 3, schema is grade-agnostic).
2. Test types: **BOY** (Beginning of Year), **MOY** (Middle of Year), **EOG** (End of Grade).
3. Subjects: **Reading** and **Math**.
4. **Correctness first** — every question has a verified correct answer + explanation.
5. **Exam-like presentation** — reading passages in a scrollable panel beside the
   question; math rendered with proper formatting and **diagrams** (number lines,
   arrays, fraction bars, clocks, graphs, area grids, geometry, base-ten blocks).
6. **Dynamic generation** via OpenAI; generated tests are **persisted** so kids can
   reuse existing ones or generate fresh ones.
7. **Pre-seed 10–15 full practice papers** for immediate use.
8. **Timer** that runs unobtrusively; the student's **name** is shown throughout.
9. Deploy to **Cloudflare** (Worker + Static Assets + D1), free tier only.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Cloudflare Worker  "us-bme-test"                             │
│                                                              │
│   /            → Static Assets (public/)  — the portal SPA    │
│   /api/*       → fetch handler (src/index.js)                 │
│                    ├─ GET  /api/health                        │
│                    ├─ GET  /api/tests?grade=&subject=&type=   │
│                    ├─ GET  /api/tests/:id                     │
│                    ├─ POST /api/generate                      │
│                    └─ POST /api/attempts                      │
│                                                              │
│   Bindings:  ASSETS (static),  DB (D1),  OPENAI_API_KEY (secret)│
└──────────────────────────────────────────────────────────────┘
```

- **Frontend**: vanilla HTML/CSS/JS SPA (no build step) in `public/`.
- **Backend**: single Worker `src/index.js` routing `/api/*`, else `env.ASSETS.fetch`.
- **Storage**: Cloudflare **D1** (SQLite). Tables: `tests`, `attempts`.
- **AI**: OpenAI Chat Completions (`gpt-4o`) with strict JSON output + server-side
  validation before storing.

### Free-tier services used
- Workers (static assets + functions) — free plan
- D1 — free plan
- OpenAI — paid externally (key provided as a Worker secret), used **only** for
  dynamic generation. Curated tests need no API calls.

---

## 3. Data Model

### D1 schema (`schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS tests (
  id                  TEXT PRIMARY KEY,
  grade               INTEGER NOT NULL,
  subject             TEXT    NOT NULL,   -- 'math' | 'reading'
  test_type           TEXT    NOT NULL,   -- 'boy' | 'moy' | 'eog'
  title               TEXT    NOT NULL,
  time_limit_minutes  INTEGER NOT NULL,
  question_count      INTEGER NOT NULL,
  source              TEXT    NOT NULL,   -- 'curated' | 'ai'
  created_at          TEXT    NOT NULL,
  data                TEXT    NOT NULL    -- full test JSON (see below)
);
CREATE INDEX IF NOT EXISTS idx_tests_filter ON tests(grade, subject, test_type);

CREATE TABLE IF NOT EXISTS attempts (
  id               TEXT PRIMARY KEY,
  test_id          TEXT NOT NULL,
  student_name     TEXT NOT NULL,
  grade            INTEGER NOT NULL,
  subject          TEXT NOT NULL,
  test_type        TEXT NOT NULL,
  score            INTEGER NOT NULL,
  total            INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  answers          TEXT NOT NULL,        -- JSON map questionId -> response
  created_at       TEXT NOT NULL
);
```

### Test JSON contract (the `data` column / `data/tests/*.json`)

```jsonc
{
  "id": "g3-math-eog-1",
  "grade": 3,
  "subject": "math",                // "math" | "reading"
  "testType": "eog",                // "boy" | "moy" | "eog"
  "title": "Grade 3 Math — EOG Practice Test 1",
  "instructions": "Read each question carefully. Choose the best answer.",
  "timeLimitMinutes": 80,
  "calculatorAllowed": false,
  "source": "curated",              // "curated" | "ai"
  "passages": [                      // reading only; [] for math
    {
      "id": "P1",
      "title": "The Lost Kitten",
      "genre": "fiction",            // fiction | informational | poetry
      "lexile": "520L",
      "text": "Paragraph one...\n\nParagraph two..."
    }
  ],
  "questions": [
    {
      "id": "Q1",
      "itemType": "single_choice",   // single_choice | multi_select | numeric_entry
      "skill": "multiplication",     // NC standard / skill tag
      "difficulty": "medium",        // easy | medium | hard
      "passageId": null,             // reading: "P1"; math: null
      "questionText": "What is 6 × 7?",
      "diagram": {                    // optional; null if none
        "type": "array_dots",
        "params": { "rows": 6, "cols": 7 }
      },
      "options": ["35", "42", "48", "13"],   // [] for numeric_entry
      "answer": 1,                            // see grading rules
      "explanation": "6 rows of 7 dots is 42.",
      "points": 1
    }
  ]
}
```

### Grading rules (`answer` field by item type)
- **single_choice** → `answer` is the **integer index** of the correct option.
- **multi_select**  → `answer` is an **array of integer indices** (all required, exact match).
- **numeric_entry** → `answer` is the **numeric value** (number or string). Optional
  `acceptedAnswers: [...]` array allows equivalent forms (e.g. `"1/2"`, `"0.5"`).

---

## 4. Diagram Engine (`public/js/diagrams.js`)

Frontend renders an SVG from `{ type, params }`. Supported types:

| type            | params |
|-----------------|--------|
| `number_line`   | `{ min, max, step, point?, ticks?, intervals?:[{from,to,label}], marks?:[{value,label}] }` |
| `fraction_bar`  | `{ parts, shaded }` or `{ bars:[{parts,shaded,label}] }` |
| `fraction_circle`| `{ parts, shaded }` |
| `array_dots`    | `{ rows, cols }` |
| `bar_graph`     | `{ title?, xLabel?, yLabel?, yMax?, yStep?, bars:[{label,value}] }` |
| `picture_graph` | `{ title?, symbol, unitValue, rows:[{label,count}] }` |
| `clock`         | `{ hour, minute }` |
| `rectangle`     | `{ width, height, unit?, showGrid?, label? }` (area/perimeter) |
| `shape`         | `{ kind, sideLabels?, angleLabels?, points? }` (geometry) |
| `base_ten`      | `{ hundreds, tens, ones }` (place value) |
| `data_table`    | `{ headers:[...], rows:[[...]] }` |

All renderers are pure (params → `<svg>` string), responsive, and print-clean.

---

## 5. API

| Method | Path | Body / Query | Returns |
|--------|------|--------------|---------|
| GET | `/api/health` | — | `{ ok, time }` |
| GET | `/api/tests` | `?grade&subject&testType` (all optional) | `[{ id, grade, subject, testType, title, timeLimitMinutes, questionCount, source, createdAt }]` |
| GET | `/api/tests/:id` | — | full test JSON |
| POST | `/api/generate` | `{ grade, subject, testType, difficulty?, questionCount? }` | full test JSON (also stored, `source:"ai"`) |
| POST | `/api/attempts` | `{ testId, studentName, score, total, durationSeconds, answers, grade, subject, testType }` | `{ id }` |

`/api/generate` calls OpenAI with a strict system prompt + JSON schema, validates
the result server-side (structure + answer sanity), assigns an id, stores in D1,
and returns it. Generation is slow (20–60s); the UI shows a friendly progress state.

---

## 6. Portal UX

**Flow:** Landing → Grade → Subject → Test Type → Pick existing **or** Generate new → Name → Test runner → Results.

- **Landing/Setup**: big friendly buttons. Grade (3/4/5), Subject (Reading/Math),
  Test type (BOY/MOY/EOG). Then a list of existing tests for that combo + a
  **"✨ Generate New Test"** button.
- **Name gate**: enter first name; required to start. Name shown in the runner header.
- **Runner**:
  - Sticky header: student name, test title, **timer** (counts down, turns amber/red
    near the end; never blocks or pops up).
  - Reading: passage in a scrollable left/top panel, question on the right/below.
  - Math: question with rendered diagram, big tappable answer choices, numeric keypad
    for numeric entry.
  - One question per screen with **Prev / Next**, a question **navigator grid**
    (answered/flagged), and **Flag for review**.
  - Auto-saves answers to `localStorage` (resume if reloaded). Submit → confirm.
- **Results**: score, % , time taken, per-question review with the student's answer,
  correct answer, and explanation. Math diagrams shown in review too. Saved via
  `/api/attempts`.
- **Kid-friendly**: large fonts, rounded cards, high contrast, calm colors, emoji
  accents, no scary modals. Mobile + tablet friendly.

---

## 7. Content — Curated Test Bank

Pre-generate **10–15 full papers** (Grade 3 first), stored in `data/tests/*.json`
and seeded into D1.

**Math (NC Grade 3 standards):** add/subtract within 1000, multiplication & division
(0–10), fractions (number line, bars, equivalence), time (nearest minute, elapsed),
measurement (mass/volume, length), area & perimeter, geometry (quadrilaterals,
partitioning), graphs/data (bar & picture graphs, tables), place value & rounding,
multi-step word problems. Mix easy/medium/hard with **distractors that reflect
common mistakes**. Item types: single_choice, multi_select, numeric_entry. Include
**diagrams** wherever they help (arrays, number lines, fraction models, clocks,
rectangles, graphs, base-ten blocks).

**Reading (NC Grade 3):** literary + informational passages (and a poem), each with
key-ideas, vocabulary-in-context, inference, main-idea, text-structure, and
author's-craft questions. Grade-appropriate Lexile (~420–650L).

**Planned bank (≥12 papers):**
1. Grade 3 Math — EOG Test 1 (~40 Q)
2. Grade 3 Math — EOG Test 2 (~40 Q)
3. Grade 3 Math — EOG Test 3 (~40 Q)
4. Grade 3 Math — BOY Test 1 (~25 Q)
5. Grade 3 Math — MOY Test 1 (~30 Q)
6. Grade 3 Math — MOY Test 2 (~30 Q)
7. Grade 3 Reading — EOG Test 1 (4 passages, ~36 Q)
8. Grade 3 Reading — EOG Test 2 (4 passages, ~36 Q)
9. Grade 3 Reading — BOY Test 1 (3 passages, ~24 Q)
10. Grade 3 Reading — MOY Test 1 (3 passages, ~28 Q)
11. Grade 3 Reading — MOY Test 2 (3 passages, ~28 Q)
12. Grade 3 Math — EOG Test 4 (~40 Q)
(+ Grade 4/5 added later using the same schema.)

Each paper is generated by a dedicated agent with explicit **self-verification** of
every math answer and answer-key sanity, then validated by `scripts/validate.mjs`.

---

## 8. Dynamic Generation Pipeline

- **On-demand** (`POST /api/generate`): Worker → OpenAI `gpt-4o`, strict JSON schema,
  server validation, store in D1 (`source:"ai"`), return to the kid. Subsequent kids
  see it in the existing-tests list.
- **Batch pre-generation** (`scripts/generate-batch.mjs`): node script using the same
  prompt/schema to mass-produce papers locally for review, then seeded into D1. Used
  for the curated bank and to grow it over time.
- **Prompts** live in `src/prompts.js` (shared shape with the batch script).

---

## 9. Project Layout

```
school_test_simulation/
├── Spec.md
├── setup.sh                 # setup/start/stop/restart/status/logs/deploy:qa/...
├── package.json
├── wrangler.toml            # Worker + assets + D1 binding
├── schema.sql
├── src/
│   ├── index.js             # Worker entry + /api router
│   ├── db.js                # D1 helpers
│   ├── openai.js            # OpenAI client
│   ├── prompts.js           # generation prompts/schema
│   └── validate.js          # shared test validator
├── public/                  # static SPA
│   ├── index.html
│   ├── css/styles.css
│   └── js/{app.js,api.js,runner.js,diagrams.js,setup.js,results.js}
├── data/tests/*.json        # curated bank
└── scripts/
    ├── seed.mjs             # load data/tests/*.json into D1
    ├── validate.mjs         # validate all curated JSON
    └── generate-batch.mjs   # local OpenAI batch generator
```

---

## 10. Deployment (Cloudflare via `cfl`, account `rugan`)

```bash
# 1. Create D1
cfl d1 create us-bme-test-db --acc rugan      # → copy database_id into wrangler.toml

# 2. Apply schema
cfl d1 execute us-bme-test-db --remote --file schema.sql --acc rugan

# 3. Set OpenAI secret
cfl secret put OPENAI_API_KEY --acc rugan      # paste key

# 4. Seed curated bank
node scripts/seed.mjs --remote                 # inserts data/tests/*.json

# 5. Deploy
cfl deploy --acc rugan                          # wrangler deploy → us-bme-test.<subdomain>.workers.dev
```

`setup.sh` wraps local dev (`wrangler dev`) and the deploy steps.

---

## 11. Roadmap
- Grades 4 & 5 curated banks (schema already supports them).
- Teacher/parent dashboard over `attempts` (progress, weak skills).
- Read-aloud (TTS) accessibility for younger readers.
- Per-skill remediation suggestions after a test.
