// Balance correct-answer positions across each test so they are evenly spread
// over A/B/C/D AND not in any pattern. Correctness is preserved exactly — options
// are permuted and the answer index is remapped to the new position.
// Usage: node scripts/shuffle-options.mjs [file.json ...]   (no args = all files)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateTest } from "../src/validate.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const dir = join(__dir, "..", "data", "tests");

function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffleInPlace(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

const only = process.argv.slice(2).map((a) => a.replace(/.*\//, ""));
let files = 0, scTotal = 0;

for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  if (only.length && !only.includes(f)) continue;
  const path = join(dir, f);
  const test = JSON.parse(readFileSync(path, "utf8"));
  const rng = mulberry32(hash(test.id));

  // single_choice: assign a balanced, shuffled target position to each (grouped by
  // option count so groups with the same #options stay evenly distributed).
  const sc = test.questions.filter((q) => q.itemType === "single_choice" && (q.options || []).length >= 2);
  const byLen = {};
  for (const q of sc) { const L = q.options.length; (byLen[L] = byLen[L] || []).push(q); }
  for (const L of Object.keys(byLen)) {
    const LL = +L, group = byLen[L];
    const targets = group.map((_, i) => i % LL);
    shuffleInPlace(targets, rng);
    group.forEach((q, k) => {
      const T = targets[k], correct = q.answer, src = q.options;
      const others = []; for (let x = 0; x < LL; x++) if (x !== correct) others.push(x);
      shuffleInPlace(others, rng);
      const order = new Array(LL); order[T] = correct;
      let oi = 0; for (let s = 0; s < LL; s++) if (s !== T) order[s] = others[oi++];
      q.options = order.map((i) => src[i]);
      q.answer = T;
    });
    scTotal += group.length;
  }

  // multi_select: randomize option order (deterministic), remap the answer set.
  for (const q of test.questions) {
    if (q.itemType !== "multi_select" || (q.options || []).length < 2) continue;
    const src = q.options;
    let perm = src.map((_, i) => i); shuffleInPlace(perm, rng);
    if (perm.every((v, i) => v === i)) perm = perm.slice().reverse();
    q.options = perm.map((i) => src[i]);
    q.answer = q.answer.map((a) => perm.indexOf(a)).sort((a, b) => a - b);
  }

  const v = validateTest(test);
  if (!v.ok) { console.error(`SKIP ${f}: ${v.errors[0]}`); continue; }
  writeFileSync(path, JSON.stringify(test) + "\n");
  files++;
  const d = [0, 0, 0, 0];
  sc.forEach((q) => { if (q.answer < 4) d[q.answer]++; });
  console.log(`✓ ${f.padEnd(24)} A/B/C/D = ${d.join("/")}`);
}
console.log(`\n${files} files balanced (${scTotal} single_choice questions).`);
