// Validate every curated test JSON in data/tests. Usage: node scripts/validate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateTest } from "../src/validate.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const dir = join(__dir, "..", "data", "tests");

const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
let bad = 0, totalQ = 0;
console.log(`Validating ${files.length} test files in data/tests\n`);

for (const f of files) {
  let test;
  try {
    test = JSON.parse(readFileSync(join(dir, f), "utf8"));
  } catch (e) {
    console.log(`✗ ${f} — INVALID JSON: ${e.message}`);
    bad++; continue;
  }
  const v = validateTest(test);
  const qn = (test.questions || []).length;
  totalQ += qn;
  if (v.ok) {
    console.log(`✓ ${f.padEnd(26)} ${String(qn).padStart(3)} Q  [${test.subject}/${test.testType}]` +
      (v.warnings.length ? `  (${v.warnings.length} warnings)` : ""));
  } else {
    bad++;
    console.log(`✗ ${f.padEnd(26)} ${qn} Q  — ${v.errors.length} ERRORS`);
    v.errors.slice(0, 12).forEach((e) => console.log(`     • ${e}`));
  }
}
console.log(`\n${files.length - bad}/${files.length} valid · ${totalQ} total questions`);
if (bad) { console.log(`\n${bad} file(s) failed validation.`); process.exit(1); }
console.log("All curated tests are valid ✓");
