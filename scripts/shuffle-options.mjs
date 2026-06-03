// Distribute correct-answer positions: permute each choice question's options
// (deterministically per question) and remap the answer index/indices.
// Correctness is preserved exactly; only the order of options changes.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateTest } from "../src/validate.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const dir = join(__dir, "..", "data", "tests");

function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function permute(n, rng) {
  const p = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p; // newOptions[k] = oldOptions[p[k]]
}

// Optional CLI args limit shuffling to specific files (basenames), so we don't
// re-permute already-balanced papers. No args = all files.
const only = process.argv.slice(2).map((a) => a.replace(/.*\//, ""));
let files = 0, shuffled = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  if (only.length && !only.includes(f)) continue;
  const path = join(dir, f);
  const test = JSON.parse(readFileSync(path, "utf8"));
  let changed = 0;
  for (const q of test.questions) {
    if (q.itemType !== "single_choice" && q.itemType !== "multi_select") continue;
    const opts = q.options || [];
    if (opts.length < 2) continue;
    const rng = mulberry32(hash(test.id + ":" + q.id));
    let perm = permute(opts.length, rng);
    // avoid the identity permutation so something actually moves
    if (perm.every((v, i) => v === i)) perm = perm.slice().reverse();
    const newOpts = perm.map((i) => opts[i]);
    const remap = (old) => perm.indexOf(old);
    if (q.itemType === "single_choice") q.answer = remap(q.answer);
    else q.answer = q.answer.map(remap).sort((a, b) => a - b);
    q.options = newOpts;
    changed++;
  }
  const v = validateTest(test);
  if (!v.ok) { console.error(`SKIP ${f}: ${v.errors[0]}`); continue; }
  writeFileSync(path, JSON.stringify(test) + "\n");
  files++; shuffled += changed;
  console.log(`✓ ${f.padEnd(24)} ${changed} choice questions shuffled`);
}
console.log(`\n${files} files, ${shuffled} choice questions re-distributed.`);
