-- us-bme-test — D1 schema
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
  data                TEXT    NOT NULL
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
  answers          TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_test ON attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_attempts_name ON attempts(student_name);

-- Cached kid-friendly word definitions (double-click lookup), so repeats are free.
CREATE TABLE IF NOT EXISTS glossary (
  word            TEXT PRIMARY KEY,   -- lowercased
  part_of_speech  TEXT,
  meaning         TEXT NOT NULL,
  example         TEXT,
  phonetic        TEXT,
  created_at      TEXT NOT NULL
);
