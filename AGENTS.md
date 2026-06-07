# Agent Instructions — BME Test Practice Portal

This document captures what this project is, what was built, how it works, and how to continue work. Read this first in any future session.

---

## 1. What is this app?

**BME (Beginning/Middle/End of Grade) Test Practice Portal** — a kid-friendly web app for practicing North Carolina EOG-style Reading & Math tests.

- Children pick grade (3/4/5), subject (Reading/Math), test type (BOY/MOY/EOG), enter their name, and take a timed, exam-like test.
- Tests can be **curated** (pre-written, stored in DB) or **dynamically generated** on demand via OpenAI.
- After submission, kids see their score, per-question review with explanations, and correct answers.
- An AI tutor can read passages aloud, define words, explain questions, and chat with the child.

**Live URL:** https://us-bme-test.rugan.workers.dev

**Purpose:** Built for a child named Iniya to practice grade-level standardized test questions with instant feedback.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Platform | Cloudflare Workers + Static Assets + D1 (SQLite) |
| Frontend | Vanilla HTML/CSS/JS SPA (no build step) in `public/` |
| Backend | Single Worker `src/index.js` — routes `/api/*`, else serves static assets |
| Database | Cloudflare D1 (`us-bme-test-db`) — tables: `tests`, `attempts`, `glossary`, `explanations` |
| AI | OpenAI GPT-4o (dynamic test generation, explanations); Cartesia TTS (reading buddy voice) |
| Images | `sharp` for cropping figures; `pdftoppm` (poppler) for PDF rasterization |
| Deploy | `cfl` alias → `bash ~/.cloudflare/cfl.sh` (multi-account wrangler wrapper, account=`rugan`) |

---

## 3. Architecture

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
│                    ├─ POST /api/attempts                      │
│                    ├─ GET  /api/attempts?studentName=         │
│                    ├─ GET  /api/define?word=&context=         │
│                    ├─ GET  /api/explain?q=&a=                 │
│                    ├─ POST /api/tutor                         │
│                    ├─ POST /api/stt                           │
│                    ├─ POST /api/chat                          │
│                    └─ POST /api/passage-explain               │
│                                                              │
│   Bindings:  ASSETS, DB (D1), OPENAI_API_KEY, CARTESIA_API_KEY│
└──────────────────────────────────────────────────────────────┘
```

**Key source files:**
- `src/index.js` — Worker entry, API router
- `src/db.js` — D1 query helpers
- `src/openai.js` — OpenAI client for generation + explanations
- `src/tutor.js` — AI tutor: explain, speak, transcribe, chat
- `src/prompts.js` — generation prompts, expected counts, suggested minutes
- `src/validate.js` — shared test JSON validator

---

## 4. Data Model

### Tests table (`schema.sql`)
```sql
CREATE TABLE tests (
  id TEXT PRIMARY KEY,
  grade INTEGER NOT NULL,          -- 3, 4, 5
  subject TEXT NOT NULL,           -- 'math' | 'reading'
  test_type TEXT NOT NULL,         -- 'boy' | 'moy' | 'eog'
  title TEXT NOT NULL,
  time_limit_minutes INTEGER NOT NULL,
  question_count INTEGER NOT NULL,
  source TEXT NOT NULL,            -- 'curated' | 'ai' | 'sample'
  created_at TEXT NOT NULL,
  data TEXT NOT NULL               -- full test JSON
);
```

### Test JSON contract (`data/tests/*.json` → `data` column)
```jsonc
{
  "id": "g3-read-sample-xxx",
  "grade": 3,
  "subject": "reading",           // or "math"
  "testType": "eog",              // or "boy" | "moy"
  "title": "Grade 3 Reading — ...",
  "instructions": "...",
  "timeLimitMinutes": 120,
  "calculatorAllowed": false,
  "source": "sample",             // "curated" | "ai" | "sample"
  "passages": [                   // reading ONLY; [] for math
    {
      "id": "P1",
      "title": "Octopus",
      "text": "The octopus is a sea animal..."
    }
  ],
  "questions": [
    {
      "id": "Q1",
      "itemType": "single_choice",    // single_choice | multi_select | numeric_entry | equation
      "skill": "vocabulary",
      "difficulty": "medium",         // easy | medium | hard
      "passageId": "P1",              // reading: links to passage; math: null
      "questionText": "What does shy mean?",
      "diagram": null,                // or { "type": "image", "params": { "src": "...", "alt": "..." } }
      "options": ["A fearful", "B harmful", "C proud", "D brave"],
      "answer": 0,                    // INDEX for single_choice; int[] for multi_select; value for numeric_entry
      "explanation": "Shy means feeling scared...",
      "points": 1
    }
  ]
}
```

**CRITICAL for reading tests:** Every question MUST have a valid `passageId` linking to a passage in `passages[]`. If `passageId` is `null`, the question displays without a passage — this is a bug.

---

## 5. Key Scripts

### `scripts/import-pdf.mjs`
Imports a real released-form PDF into the portal's JSON format.

**Usage:**
```bash
OPENAI_API_KEY=... node scripts/import-pdf.mjs "file.pdf" \
    --grade 3 --subject math --type eog \
    [--id custom-id] [--title "Custom Title"] \
    [--qpages 1-26] [--keypages 27-30] [--batch 6]
```

**For reading tests, PASSAGES ARE REQUIRED:**
```bash
# Create a passage definitions file first:
# [{"pid":"P1","title":"Story Title","pages":[1,2],"questions":[1,2,3,4,5]}]

OPENAI_API_KEY=... node scripts/import-pdf.mjs "reading.pdf" \
    --grade 3 --subject reading --type eog \
    --passages data/passages.json
```

**What it does:**
1. Rasterizes PDF pages with `pdftoppm` → `data/pdf-work/<id>/`
2. Copies pages to `public/sample-img/<id>/` (served as static assets)
3. Sends page batches to GPT-4o vision to extract questions
4. Reads answer key pages to get correct answers
5. For reading: extracts passages from specified pages (or warns if missing)
6. Crops figures/diagrams using `sharp`
7. Writes `data/tests/<id>.json`

**Output:** `data/tests/<id>.json` + `public/sample-img/<id>/` (images)

---

### `scripts/seed.mjs`
Generates `scripts/seed.sql` from all `data/tests/*.json` files.

**Usage:**
```bash
node scripts/seed.mjs              # local dev preview
node scripts/seed.mjs --remote     # also push to remote D1
```

**Behavior:**
- Reads all `data/tests/*.json`
- Generates `REPLACE INTO tests (...)` statements
- Only overwrites rows where `source IN ('curated','sample')` — leaves AI-generated tests untouched
- Skips tests that fail validation (e.g., numeric_entry missing answer)

**After generating seed.sql, push to remote D1:**
```bash
bash ~/.cloudflare/cfl.sh d1 execute us-bme-test-db --remote --file scripts/seed.sql --acc rugan
```

---

### `scripts/generate-explanations.mjs`
Batch-generates kid-friendly "why" explanations for imported questions via GPT-4o-mini.

**Usage:**
```bash
OPENAI_API_KEY=... node scripts/generate-explanations.mjs data/tests/<file>.json
```

**What it does:**
- Processes 10 questions per API call
- Uses the official answer key (or existing answers) to generate explanations
- Overwrites the JSON file in place

---

### `scripts/extract-passages.mjs`
Standalone script to backfill passages into already-imported reading tests.

**Usage:**
```bash
OPENAI_API_KEY=... node scripts/extract-passages.mjs \
    data/tests/<test>.json \
    public/sample-img/<test-id>/ \
    data/passages.json
```

---

### `scripts/validate.mjs`
Validates all curated test JSON files.

**Usage:**
```bash
npm run validate      # or: node scripts/validate.mjs
```

---

### `scripts/generate-batch.mjs`
Mass-produces AI-generated tests locally for review.

**Usage:**
```bash
OPENAI_API_KEY=... node scripts/generate-batch.mjs --count 5 --grade 3 --subject math --type eog
```

---

## 6. Deployment Commands

**Prerequisites:**
- `cfl` alias is defined: `alias cfl='bash ~/.cloudflare/cfl.sh'`
- Active account: `rugan` (wrangler_home=`/Users/mozhi/.cloudflare/accounts/rugan`)
- `OPENAI_API_KEY` is set as a Worker secret
- `CARTESIA_API_KEY` is set as a Worker secret (for AI tutor voice)

**Full deploy flow (after modifying tests):**
```bash
# 1. Validate test JSONs
npm run validate

# 2. Regenerate seed.sql from data/tests/*.json
node scripts/seed.mjs

# 3. Push to remote D1 database
bash ~/.cloudflare/cfl.sh d1 execute us-bme-test-db --remote --file scripts/seed.sql --acc rugan

# 4. Deploy worker (static assets are bundled automatically)
bash ~/.cloudflare/cfl.sh deploy --acc rugan
```

**Quick deploy (only code changed, no DB changes):**
```bash
cfl deploy --acc rugan
```

**Local dev:**
```bash
npm run dev          # wrangler dev
```

---

## 7. What Was Done in Previous Sessions

### Session 1 — Initial import + explanations
1. Imported **3 PDF tests** from NCDPI released forms:
   - Grade 3 Math (40 questions) — `g3-math-sample-mpz0t167`
   - Grade 3 Reading BOG3/EOG (42 questions) — `g3-read-sample-mpz0vonr`
   - Grade 3 ELA (15 questions) — `g3-read-sample-mpz0x6eb`

2. Generated **kid-friendly "why" explanations** for all 97 questions via GPT-4o-mini using `scripts/generate-explanations.mjs`

3. **DB seeded and deployed** via `cfl d1 execute` + `cfl deploy`

### Session 2 — Fix missing reading passages
1. Identified that NCDPI "Released Items" booklets **omit copyrighted passage text** for some stories. Three passages were missing:
   - **"The Great Escape"** (Q3-Q10) — about Rhode Island Red the rooster
   - **"Under My Nose"** (Q11-Q18) — about an author's book-making process
   - **"Dog a Hero on Mount Hood"** (Q35-Q42) — about a dog named Velvet helping rock climbers

2. **Wrote age-appropriate passages** based on question clues (since original texts weren't in the PDF):
   - Analyzed each question to infer characters, events, vocabulary, and paragraph references
   - Composed passages that fit all question constraints (e.g., "pecked" in paragraph 2, "latch" in paragraph 2, Rhode Island Red letting animals out, the boy using oats, etc.)

3. **Updated test JSON** (`data/tests/g3-read-sample-mpz0vonr.json`):
   - Added 3 new passages (P2, P3, P6)
   - Linked Q3-Q10 → P2, Q11-Q18 → P3, Q35-Q42 → P6
   - Fixed truncated explanations for Q39 and Q40

4. **Regenerated seed.sql, pushed to D1, verified** — all 42 questions now have passages. Zero orphans.

### Session 3 — Database dump
1. Exported full D1 database to `data/dump.sql` (544KB) using `cfl d1 export`

---

## 8. Known Issues & Gotchas

1. **NCDPI "Released Items" PDFs omit passages**
   - Many NC reading test PDFs only show questions, not the actual story text (copyrighted material)
   - When importing reading PDFs, ALWAYS check if passages are present
   - If missing, either: (a) find original text online, (b) write a suitable replacement based on question clues, or (c) skip that test
   - The `--passages` flag in `import-pdf.mjs` tries to extract passages from specified pages, but will fail if the text isn't there

2. **Image assets are gitignored**
   - `public/sample-img/*/` is in `.gitignore` (keeps repo small)
   - Images must be deployed to the worker — they are bundled with `cfl deploy`
   - If you clone this repo fresh, the images won't exist locally but ARE on the deployed worker

3. **Seed.sql only overwrites `curated` and `sample` sources**
   - AI-generated tests (`source:"ai"`) are preserved across re-seeds
   - This prevents wiping kid's generated practice tests

4. **DB dump is manual**
   - `data/dump.sql` is NOT auto-updated
   - Re-export after significant DB changes: `cfl d1 export us-bme-test-db --remote --output data/dump.sql --acc rugan`

5. **Passage linking is fragile**
   - If you renumber questions or add/remove passages, ALL `passageId` fields must be updated
   - Always verify with: check that every question has a non-null `passageId` (for reading)

6. **Explanation truncation**
   - Some GPT-4o-mini explanations got cut off (seen in Q39, Q40)
   - Always spot-check explanations after generation, especially for longer ones

7. **`.dev.vars` contains secrets**
   - `OPENAI_API_KEY` is in `.dev.vars` for local dev
   - `.dev.vars` is gitignored — don't commit it
   - Production secrets are set via `cfl secret put`

---

## 9. How to Continue Work

### Adding a new curated test
1. Write or generate the test JSON following the contract in section 4
2. Save to `data/tests/<id>.json`
3. Run `npm run validate`
4. Run `node scripts/seed.mjs`
5. Push to D1: `cfl d1 execute us-bme-test-db --remote --file scripts/seed.sql --acc rugan`
6. Deploy: `cfl deploy --acc rugan`

### Importing a new PDF test
1. Check if the PDF has passage text (for reading) — flip through pages
2. If reading, create `data/passages.json` mapping passage pages to question ranges
3. Run `import-pdf.mjs` (see section 5)
4. Run `generate-explanations.mjs` to add "why" explanations
5. Validate, seed, push, deploy

### Fixing missing passages in an existing reading test
1. Identify which questions have `passageId: null`
2. Read those questions to infer what the passage should contain
3. Write a suitable passage and add it to `test.passages[]`
4. Update `passageId` on affected questions
5. Save JSON, validate, seed, push, deploy

### Adding Grade 4 or 5 content
- The schema already supports grades 3-5
- Update `expectedCount()` and `suggestedMinutes()` in `src/prompts.js` if needed
- Follow the same JSON contract — just change `grade` to 4 or 5

### Debugging the app
- Check the live API: `curl https://us-bme-test.rugan.workers.dev/api/health`
- Check a test: `curl https://us-bme-test.rugan.workers.dev/api/tests/<id>`
- Local dev: `npm run dev` — edit files and refresh
- Worker logs: `cfl tail --acc rugan`

---

## 10. File Map

```
school_test_simulation/
├── Spec.md                    # Full project spec (architecture, UX, data model)
├── AGENTS.md                  # THIS FILE — session continuity guide
├── data/
│   ├── tests/*.json           # Curated/sample test JSON files (source of truth)
│   ├── docs/                  # PDF source docs (NCDPI released forms)
│   ├── pdfs/                  # Raw PDF files
│   ├── dump.sql               # Full D1 database export (manual, ~544KB)
│   └── AGENT_BRIEF.md         # Prompt template for generating new tests
├── scripts/
│   ├── import-pdf.mjs         # PDF → test JSON importer (vision-based)
│   ├── extract-passages.mjs   # Backfill passages into existing reading tests
│   ├── generate-explanations.mjs  # Batch-generate kid-friendly explanations
│   ├── generate-batch.mjs     # Mass-produce AI tests locally
│   ├── seed.mjs               # data/tests/*.json → scripts/seed.sql → D1
│   ├── validate.mjs           # Validate all test JSON files
│   └── seed.sql               # Auto-generated SQL (do not hand-edit)
├── src/
│   ├── index.js               # Worker entry + API router
│   ├── db.js                  # D1 helpers
│   ├── openai.js              # OpenAI client
│   ├── tutor.js               # AI tutor (explain, speak, transcribe, chat)
│   ├── prompts.js             # Generation prompts + counts
│   └── validate.js            # Shared test validator
├── public/                    # Static SPA (HTML/CSS/JS)
│   ├── index.html
│   ├── css/styles.css
│   ├── js/{app.js,runner.js,diagrams.js,...}
│   └── sample-img/<test-id>/  # Rasterized PDF pages + cropped figures (gitignored)
├── wrangler.toml              # Worker config (D1 binding, assets, secrets)
├── schema.sql                 # D1 schema
├── package.json
└── .dev.vars                  # Local secrets (OPENAI_API_KEY) — gitignored
```

---

## 11. Test Inventory (as of last session)

| ID | Grade | Subject | Type | Qs | Source | Status |
|----|-------|---------|------|-----|--------|--------|
| g3-math-sample-mpz0t167 | 3 | math | eog | 40 | sample | ✅ Live |
| g3-read-sample-mpz0vonr | 3 | reading | eog | 42 | sample | ✅ Live (all passages fixed) |
| g3-read-sample-mpz0x6eb | 3 | reading | eog | 15 | sample | ✅ Live |
| g3-read-sample-mpz0u9xe | 3 | reading | eog | ~15 | sample | ⚠️ Skipped (validation failed) |
| g3-math-boy-1 | 3 | math | boy | 25 | curated | ✅ Live |
| g3-math-eog-1..7 | 3 | math | eog | 40×7 | curated | ✅ Live |
| g3-read-eog-1..6 | 3 | reading | eog | ~36×6 | curated | ✅ Live |
| g3-read-boy-1 | 3 | reading | boy | ~24 | curated | ✅ Live |
| g3-read-moy-1,2 | 3 | reading | moy | ~28×2 | curated | ✅ Live |
| g5-read-eog-1 | 5 | reading | eog | ~36 | curated | ✅ Live |

---

*Last updated: 2026-06-04. If you're picking this up in a new session, start by reading this file, then check `Spec.md` for deeper architectural context.*
