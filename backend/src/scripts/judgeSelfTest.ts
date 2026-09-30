/**
 * Judge self-test against the real Judge0.
 *
 *   docker compose exec -T backend node dist/scripts/judgeSelfTest.js
 *
 * Judges a 20-test "sum the numbers" problem the way a match does, in each
 * language and with the usual kinds of wrong program, and prints the verdict
 * per test, which path judged it (batch, or test by test after a fallback)
 * and how long it took. Exits non-zero if any verdict is not the expected one.
 */
import { judgeService } from "../services/JudgeService";
import { TestCase } from "../types";

const tests: TestCase[] = Array.from({ length: 20 }, (_, t) => {
  const n = (t + 1) * 50;
  const nums = Array.from({ length: n }, (_, k) => ((k * 7919 + t) % 2001) - 1000);
  return {
    input: `${n}\n${nums.join(" ")}\n`,
    expectedOutput: `${nums.reduce((a, b) => a + b, 0)}\n`,
    isHidden: t >= 2,
  };
});

const CPP = `#include <bits/stdc++.h>
using namespace std;
int main() {
  int n; cin >> n; long long s = 0, x;
  for (int i = 0; i < n; i++) { cin >> x; s += x; }
  cout << s << "\\n";
}`;

const cases: { name: string; lang: number; code: string; expect: RegExp }[] = [
  { name: "C++ correct", lang: 54, code: CPP, expect: /^A{20}$/ },
  { name: "Python correct", lang: 71, code: "n = int(input())\nprint(sum(map(int, input().split())))", expect: /^A{20}$/ },
  {
    name: "JavaScript correct",
    lang: 63,
    code: "const d = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nlet s = 0; for (let i = 1; i <= d[0]; i++) s += d[i];\nconsole.log(String(s));",
    expect: /^A{20}$/,
  },
  { name: "C++ wrong on every other test", lang: 54, code: CPP.replace("cout << s", "cout << ((n / 50) % 2 ? s + 1 : s)"), expect: /^(WA){10}$/ },
  { name: "C++ infinite loop on test 3", lang: 54, code: CPP.replace("int n; cin >> n;", "int n; cin >> n; if (n == 150) for (volatile int k = 0;; k++);"), expect: /^AAT/ },
  { name: "C++ crash on test 4", lang: 54, code: CPP.replace("int n; cin >> n;", "int n; cin >> n; if (n == 200) { volatile int* p = nullptr; *p = 1; }"), expect: /^AAAR/ },
  { name: "C++ compile error", lang: 54, code: "int main( { return 0; }", expect: /^C{20}$/ },
];

function letter(status: string): string {
  if (status === "Accepted") return "A";
  if (status === "Wrong Answer") return "W";
  if (status.startsWith("Time")) return "T";
  if (status.startsWith("Runtime")) return "R";
  if (status.startsWith("Compilation")) return "C";
  if (status === "Skipped") return "s";
  return "?";
}

async function main(): Promise<void> {
  // Watch the service's own log lines to tell which path judged each case
  let fellBack = false;
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes("Falling back")) fellBack = true;
    warn(...args);
  };

  let failures = 0;
  for (const c of cases) {
    fellBack = false;
    const started = Date.now();
    const result = await judgeService.executeCode(c.code, c.lang, tests);
    const ms = Date.now() - started;
    const verdicts = (result.testResults ?? []).map((r) => letter(r.status)).join("");
    const ok = c.expect.test(verdicts);
    if (!ok) failures++;
    const note = result.status === "compile_error" ? `  compiler: ${(result.stderr || "").split("\n")[0].slice(0, 80)}` : "";
    process.stdout.write(
      `${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(32)} ${verdicts}  ${fellBack ? "per-test" : "batch   "}  ${ms} ms${note}\n`
    );
  }

  process.stdout.write(failures ? `\n${failures} case(s) failed\n` : "\nAll cases judged as expected\n");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error("Self-test crashed:", error);
  process.exit(2);
});
