// Client-side "mental math" strategy generator (works offline). Given a question's
// text, if it contains a simple arithmetic expression, returns a kid-friendly tip
// for an easier way to think about it (break-apart, fact families, place value).

function findExpr(text) {
  const t = String(text || "");
  let m;
  if ((m = t.match(/(\d{1,4})\s*[×x*⋅]\s*(\d{1,4})/))) return { op: "×", a: +m[1], b: +m[2] };
  if ((m = t.match(/(\d{1,4})\s*÷\s*(\d{1,4})/))) return { op: "÷", a: +m[1], b: +m[2] };
  if ((m = t.match(/(\d{1,4})\s*\+\s*(\d{1,4})/))) return { op: "+", a: +m[1], b: +m[2] };
  if ((m = t.match(/(\d{1,4})\s*[-−–—]\s*(\d{1,4})/))) return { op: "−", a: +m[1], b: +m[2] };
  return null;
}

function decompose(f, o) {
  if (f === 10) return `10 × ${o} = ${10 * o} — just put a 0 after ${o}`;
  if (f === 9) return `9 × ${o} = (10 × ${o}) − ${o} = ${10 * o} − ${o} = ${9 * o}`;
  if (f >= 6 && f <= 8) return `${f} × ${o} = (5 × ${o}) + (${f - 5} × ${o}) = ${5 * o} + ${(f - 5) * o} = ${f * o}`;
  if (f === 11 || f === 12) return `${f} × ${o} = (10 × ${o}) + (${f - 10} × ${o}) = ${10 * o} + ${(f - 10) * o} = ${f * o}`;
  return null;
}

function multTip(a, b) {
  const rank = (f) => (f === 10 ? 5 : f === 9 ? 4 : f === 11 || f === 12 ? 3 : f >= 6 && f <= 8 ? 2 : 0);
  let f = 0, o = 0;
  if (rank(a) >= rank(b) && rank(a) > 0) { f = a; o = b; }
  else if (rank(b) > 0) { f = b; o = a; }
  if (f) { const s = decompose(f, o); if (s) return `Break a number apart into easy pieces: ${s}.`; }
  if (a <= 5 && b <= 5) {
    const big = Math.max(a, b), small = Math.min(a, b);
    const counts = Array.from({ length: small }, (_, i) => big * (i + 1)).join(", ");
    return `Think of ${small} groups of ${big}. Skip-count by ${big}: ${counts}.`;
  }
  return `Break the bigger number into tens and ones, multiply each part, then add them.`;
}

function divTip(a, b) {
  if (!b) return null;
  const q = a / b;
  if (Number.isInteger(q))
    return `Turn it into a multiplication you know: ${b} × ? = ${a}. Since ${b} × ${q} = ${a}, then ${a} ÷ ${b} = ${q}. (They're a fact family.)`;
  return `Think: how many ${b}s fit into ${a}? Use the ${b} times-table to find it.`;
}

function splitPlaceValue(n) {
  const h = Math.floor(n / 100) * 100, t = Math.floor((n % 100) / 10) * 10, o = n % 10;
  return [h, t, o].filter((x) => x > 0);
}

function addTip(a, b) {
  const parts = splitPlaceValue(b);
  if (parts.length <= 1) return `Make the next ten: start at ${a} and count on ${b} to land on a round number first.`;
  return `Add in parts. Start at ${a}, then add ${b} piece by piece: ${parts.map((p) => "+" + p).join(" ")} = ${a + b}.`;
}

function subTip(a, b) {
  const parts = splitPlaceValue(b);
  if (parts.length <= 1) return `Count up from ${b} to ${a} — the jumps you make add up to the answer.`;
  return `Subtract in parts. Start at ${a}, then take away ${b} piece by piece: ${parts.map((p) => "−" + p).join(" ")} = ${a - b}.`;
}

export function mentalMathTip(text) {
  const e = findExpr(text);
  if (!e) return null;
  const { op, a, b } = e;
  if (op === "×") return multTip(a, b);
  if (op === "÷") return divTip(a, b);
  if (op === "+") return a + b > 9999 ? null : addTip(a, b);
  if (op === "−") return a < b ? null : subTip(a, b);
  return null;
}
