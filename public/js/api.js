// Thin API client for the portal.
const J = (r) => r.json();

export async function listTests({ grade, subject, testType } = {}) {
  const q = new URLSearchParams();
  if (grade) q.set("grade", grade);
  if (subject) q.set("subject", subject);
  if (testType) q.set("testType", testType);
  const r = await fetch(`/api/tests?${q}`);
  const d = await J(r);
  return d.tests || [];
}

export async function getTest(id) {
  const r = await fetch(`/api/tests/${id}`);
  if (!r.ok) throw new Error("Could not load test");
  return J(r);
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
