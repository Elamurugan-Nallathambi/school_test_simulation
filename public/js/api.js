// Thin API client for the portal, with offline (on-device) test caching.
const J = (r) => r.json();
const OFF = "offline:";

export function saveOffline(test) { try { if (test && test.id) localStorage.setItem(OFF + test.id, JSON.stringify(test)); } catch {} }
export function getOffline(id) { try { const s = localStorage.getItem(OFF + id); return s ? JSON.parse(s) : null; } catch { return null; } }
export function removeOffline(id) { try { localStorage.removeItem(OFF + id); } catch {} }
export function isOfflineSaved(id) { try { return localStorage.getItem(OFF + id) != null; } catch { return false; } }
export function listOffline({ grade, subject, testType } = {}) {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(OFF)) continue;
    try {
      const t = JSON.parse(localStorage.getItem(k));
      if (grade && +t.grade !== +grade) continue;
      if (subject && t.subject !== subject) continue;
      if (testType && t.testType !== testType) continue;
      out.push({ id: t.id, grade: t.grade, subject: t.subject, testType: t.testType, title: t.title,
        timeLimitMinutes: t.timeLimitMinutes, questionCount: (t.questions || []).length, source: t.source, offline: true });
    } catch {}
  }
  return out;
}

export async function listTests({ grade, subject, testType } = {}) {
  const q = new URLSearchParams();
  if (grade) q.set("grade", grade);
  if (subject) q.set("subject", subject);
  if (testType) q.set("testType", testType);
  try {
    const r = await fetch(`/api/tests?${q}`);
    const d = await J(r);
    return d.tests || [];
  } catch {
    return listOffline({ grade, subject, testType }); // offline → on-device tests
  }
}

export async function getTest(id) {
  try {
    const r = await fetch(`/api/tests/${id}`);
    if (r.ok) { const t = await J(r); if (isOfflineSaved(id)) saveOffline(t); return t; }
  } catch {}
  const off = getOffline(id);
  if (off) return off;
  throw new Error("Could not load test");
}

export async function generateTest({ grade, subject, testType }) {
  const r = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grade, subject, testType }),
  });
  const d = await J(r);
  if (!r.ok) throw new Error(d.error || "Generation failed");
  return d;
}

export async function listAttempts(studentName) {
  const r = await fetch(`/api/attempts?studentName=${encodeURIComponent(studentName)}`);
  const d = await J(r);
  return d.attempts || [];
}

export async function getAttempt(id) {
  const r = await fetch(`/api/attempts/${id}`);
  if (!r.ok) throw new Error("Could not load result");
  return J(r); // { attempt, test }
}

export async function saveAttempt(payload) {
  try {
    const r = await fetch("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return J(r);
  } catch (e) {
    return { id: null }; // non-fatal
  }
}
