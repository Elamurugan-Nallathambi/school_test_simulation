// Shared grading logic — used by the live runner AND the saved-results summary
// so a score is always computed the exact same way.

export function isCorrect(q, resp) {
  if (resp == null) return false;
  if (q.itemType === "single_choice") return resp === q.answer;
  if (q.itemType === "multi_select") {
    if (!Array.isArray(resp)) return false;
    const a = [...resp].sort((x, y) => x - y).join(",");
    const b = [...(q.answer || [])].sort((x, y) => x - y).join(",");
    return a === b && a !== "";
  }
  if (q.itemType === "numeric_entry" || q.itemType === "equation") {
    const norm = (v) => String(v).trim().toLowerCase().replace(/\s+/g, "").replace(/^\$/, "");
    const given = norm(resp);
    if (given === "") return false;
    const accepted = [q.answer, ...(q.acceptedAnswers || [])].map(norm);
    if (accepted.includes(given)) return true;
    const gn = Number(given.replace(/[^0-9.\-]/g, ""));
    return accepted.some((a) => {
      const an = Number(String(a).replace(/[^0-9.\-]/g, ""));
      return !Number.isNaN(gn) && !Number.isNaN(an) && Math.abs(gn - an) < 1e-9 && a !== "";
    });
  }
  return false;
}

// Grade a whole test: returns { correct, total, detail:[{q,resp,ok}] }.
export function gradeTest(questions, responses) {
  let correct = 0;
  const detail = (questions || []).map((q) => {
    const resp = responses ? responses[q.id] : undefined;
    const ok = isCorrect(q, resp);
    if (ok) correct++;
    return { q, resp, ok };
  });
  return { correct, total: (questions || []).length, detail };
}
