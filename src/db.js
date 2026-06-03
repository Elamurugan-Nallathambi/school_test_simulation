// D1 helpers.
import { questionCount } from "./validate.js";

export async function listTests(env, { grade, subject, testType } = {}) {
  let sql = `SELECT id, grade, subject, test_type, title, time_limit_minutes,
                    question_count, source, created_at
             FROM tests WHERE 1=1`;
  const binds = [];
  if (grade) { sql += " AND grade = ?"; binds.push(Number(grade)); }
  if (subject) { sql += " AND subject = ?"; binds.push(subject); }
  if (testType) { sql += " AND test_type = ?"; binds.push(testType); }
  sql += " ORDER BY subject, test_type, title";
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results.map((r) => ({
    id: r.id, grade: r.grade, subject: r.subject, testType: r.test_type,
    title: r.title, timeLimitMinutes: r.time_limit_minutes,
    questionCount: r.question_count, source: r.source, createdAt: r.created_at,
  }));
}

export async function getTest(env, id) {
  const row = await env.DB.prepare("SELECT data FROM tests WHERE id = ?").bind(id).first();
  if (!row) return null;
  return JSON.parse(row.data);
}

export async function saveTest(env, test, source = "ai") {
  const now = new Date().toISOString();
  test.source = source;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tests
       (id, grade, subject, test_type, title, time_limit_minutes, question_count, source, created_at, data)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    test.id, test.grade, test.subject, test.testType, test.title,
    test.timeLimitMinutes, questionCount(test), source, now, JSON.stringify(test)
  ).run();
  return test;
}

export async function listAttempts(env, studentName) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.test_id, a.student_name, a.grade, a.subject, a.test_type,
            a.score, a.total, a.duration_seconds, a.created_at, t.title AS test_title
       FROM attempts a LEFT JOIN tests t ON t.id = a.test_id
      WHERE a.student_name = ? COLLATE NOCASE
      ORDER BY a.created_at DESC LIMIT 100`
  ).bind(studentName).all();
  return results.map((r) => ({
    id: r.id, testId: r.test_id, studentName: r.student_name, grade: r.grade,
    subject: r.subject, testType: r.test_type, score: r.score, total: r.total,
    durationSeconds: r.duration_seconds, createdAt: r.created_at,
    testTitle: r.test_title,
  }));
}

export async function getAttempt(env, id) {
  const row = await env.DB.prepare("SELECT * FROM attempts WHERE id = ?").bind(id).first();
  if (!row) return null;
  const test = await getTest(env, row.test_id);
  return {
    attempt: {
      id: row.id, testId: row.test_id, studentName: row.student_name, grade: row.grade,
      subject: row.subject, testType: row.test_type, score: row.score, total: row.total,
      durationSeconds: row.duration_seconds, answers: JSON.parse(row.answers || "{}"),
      createdAt: row.created_at,
    },
    test,
  };
}

export async function getGlossary(env, word) {
  const row = await env.DB.prepare("SELECT * FROM glossary WHERE word = ?").bind(word).first();
  if (!row) return null;
  return { word: row.word, partOfSpeech: row.part_of_speech, meaning: row.meaning, example: row.example, phonetic: row.phonetic };
}

export async function saveGlossary(env, e) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO glossary (word, part_of_speech, meaning, example, phonetic, created_at)
     VALUES (?,?,?,?,?,?)`
  ).bind(e.word, e.partOfSpeech || "", e.meaning, e.example || "", e.phonetic || "", new Date().toISOString()).run();
}

export async function saveAttempt(env, a) {
  const id = "att-" + crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO attempts
       (id, test_id, student_name, grade, subject, test_type, score, total, duration_seconds, answers, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, a.testId, a.studentName, a.grade, a.subject, a.testType,
    a.score, a.total, a.durationSeconds, JSON.stringify(a.answers || {}), now
  ).run();
  return id;
}
