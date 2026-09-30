import { createHash } from "crypto";
import { TestCase, TestResult } from "../types";

/**
 * Batch judging: one Judge0 run per submission instead of one per test.
 *
 * WHY
 * ---
 * Sending every test as its own Judge0 submission recompiles the program for
 * each test. On the 1-vCPU server a 20-test C++ submission meant 20 g++ runs,
 * five at a time, and the first wave regularly ran past the 30 s request
 * timeout ("Judge0 service temporarily unavailable").
 *
 * Here the program and the test INPUTS go to Judge0 as a "multi-file program"
 * (language 89). Judge0 runs our `compile` script once, then our `run` script:
 * a small harness that runs the program on each input under its own time
 * limit and prints one line per test with the MD5 of the output, normalised
 * exactly the way Judge0's exact-match check normalises it. The expected
 * outputs never enter the sandbox; the hashes are compared on this side.
 *
 * Anything unexpected (tools missing in the sandbox, a harness that did not
 * finish its self-check, unreadable output) makes the caller fall back to the
 * per-test path, which uses Judge0's own comparison.
 */

export const MULTI_FILE_LANGUAGE_ID = 89;

interface LanguageSpec {
  sourceFile: string;
  /** Bash, run once in /box. Absent for interpreted languages. */
  compile?: string;
  /** Bash, run once per test. `$LIMIT` is that test's wall-clock limit in seconds. */
  run: string;
}

// Paths from Judge0 1.13.1's language table (db/languages/active.rb). C++ gets
// the flags competitive programmers expect, including ONLINE_JUDGE, which
// templates use to skip their local freopen("input.txt").
const LANGUAGES: Record<number, LanguageSpec> = {
  54: {
    sourceFile: "main.cpp",
    compile: "/usr/local/gcc-9.2.0/bin/g++ -O2 -std=gnu++17 -DONLINE_JUDGE -pipe main.cpp",
    run: 'LD_LIBRARY_PATH=/usr/local/gcc-9.2.0/lib64 timeout -s KILL "$LIMIT" ./a.out',
  },
  63: {
    sourceFile: "script.js",
    run: 'timeout -s KILL "$LIMIT" /usr/local/node-12.14.0/bin/node script.js',
  },
  71: {
    sourceFile: "script.py",
    run: 'timeout -s KILL "$LIMIT" /usr/local/python-3.8.1/bin/python3 script.py',
  },
};

export function batchLanguage(languageId: number): LanguageSpec | undefined {
  return LANGUAGES[languageId];
}

/**
 * Judge0's exact-match normalisation (IsolateJob#strip): strip trailing
 * whitespace from every line, then trailing empty lines. Leading whitespace is
 * significant. The harness's awk program must produce the same string.
 */
export function normalizeOutput(text: string): string {
  const lines = text.split("\n").map((line) => line.replace(/[ \t\r]+$/, ""));
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  return lines.slice(0, end).join("\n");
}

export function outputHash(text: string): string {
  return createHash("md5").update(normalizeOutput(text), "utf8").digest("hex");
}

/**
 * Fed through the harness's normaliser before any test runs. If the sandbox's
 * awk/md5sum disagree with normalizeOutput, the hashes would silently mark
 * correct programs wrong, so a mismatch aborts batch judging instead.
 */
const SELF_CHECK_INPUT = " a \t\r\n\nb  \n\n \n";

const SAMPLE_OUTPUT_BYTES = 8192;

// awk twin of normalizeOutput. LC_ALL=C keeps it byte-oriented.
const NORMALIZE_AWK =
  '{ sub(/[ \\t\\r]+$/, ""); a[NR] = $0 } END { n = NR; while (n > 0 && a[n] == "") n--; for (i = 1; i <= n; i++) printf "%s%s", a[i], (i < n ? "\\n" : "") }';

export interface HarnessOptions {
  testCount: number;
  /** 1-based numbers of the tests whose raw output the player may see. */
  sampleTests: number[];
  perTestMs: number;
  budgetMs: number;
  runLine: string;
}

/**
 * The `run` script. Output protocol, one line each:
 *   @@SELF <md5>                         normaliser self-check
 *   @@T <test> <exit> <ms> <md5> <tle>   a test that ran
 *   @@O <test> <base64>                  first 8 KB of a sample test's output
 *   @@S <test> <tle|budget>              a test that was not run
 *   @@END
 */
export function buildHarness(o: HarnessOptions): string {
  return `#!/bin/bash
export LC_ALL=C
AWK=$(command -v mawk || command -v gawk || command -v awk)
for tool in timeout md5sum base64 head; do
  command -v "$tool" >/dev/null || { echo "@@FATAL missing $tool"; exit 3; }
done
[ -n "$AWK" ] || { echo "@@FATAL missing awk"; exit 3; }

N=${o.testCount}
PER_TEST_MS=${o.perTestMs}
BUDGET_MS=${o.budgetMs}
SAMPLES=" ${o.sampleTests.join(" ")} "

now_ms() {
  local t=\${EPOCHREALTIME//[!0-9]/}
  if [ -n "$t" ]; then NOW=$((10#$t / 1000)); else NOW=$(( $(date +%s%N) / 1000000 )); fi
}
normalize() { "$AWK" '${NORMALIZE_AWK}'; }

self=$(printf '${SELF_CHECK_INPUT.replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n")}' | normalize | md5sum)
echo "@@SELF \${self:0:32}"

now_ms; START=$NOW
stop=""
for ((i = 1; i <= N; i++)); do
  if [ -n "$stop" ]; then echo "@@S $i $stop"; continue; fi
  now_ms; left=$((BUDGET_MS - (NOW - START)))
  if [ "$left" -le 100 ]; then stop=budget; echo "@@S $i $stop"; continue; fi
  lim=$PER_TEST_MS; [ "$left" -lt "$lim" ] && lim=$left
  LIMIT="$((lim / 1000)).$(printf '%03d' $((lim % 1000)))"
  now_ms; t0=$NOW
  ${o.runLine} < "in/$i" > out.txt 2> /dev/null
  code=$?
  now_ms; ms=$((NOW - t0))
  tle=0
  # timeout exits 137 when it had to KILL (124 on some versions). A program
  # killed for memory also exits 137, but well before its time limit.
  if { [ "$code" -eq 137 ] || [ "$code" -eq 124 ]; } && [ "$ms" -ge $((lim - 50)) ]; then tle=1; fi
  hash=$(normalize < out.txt | md5sum)
  echo "@@T $i $code $ms \${hash:0:32} $tle"
  case "$SAMPLES" in *" $i "*) echo "@@O $i $(head -c ${SAMPLE_OUTPUT_BYTES} out.txt | base64 -w0)" ;; esac
  # Cut short by the overall budget rather than its own limit: the rest are
  # time-limit failures too. Otherwise they are skipped.
  if [ "$tle" -eq 1 ]; then
    if [ "$lim" -lt "$PER_TEST_MS" ]; then stop=budget; else stop=tle; fi
  fi
done
echo "@@END"
`;
}

const SIGNALS: Record<number, string> = {
  4: "SIGILL",
  6: "SIGABRT",
  7: "SIGBUS",
  8: "SIGFPE",
  9: "SIGKILL",
  11: "SIGSEGV",
  25: "SIGXFSZ",
};

function runtimeErrorStatus(exitCode: number): string {
  if (exitCode > 128 && SIGNALS[exitCode - 128]) {
    return `Runtime Error (${SIGNALS[exitCode - 128]})`;
  }
  return "Runtime Error (NZEC)";
}

/**
 * Turn the harness's stdout into per-test results. Returns null when the
 * output cannot be trusted (no self-check, a failed self-check, or no test
 * lines at all), so the caller falls back to per-test judging.
 *
 * `harnessTimedOut` is true when Judge0 stopped the whole run (total CPU or
 * wall limit); tests with no line are then time-limit failures rather than
 * crashes.
 */
export function parseHarnessOutput(
  stdout: string | null,
  testCases: TestCase[],
  harnessTimedOut: boolean
): TestResult[] | null {
  const lines = (stdout || "").split("\n");
  const self = lines.find((l) => l.startsWith("@@SELF "));
  if (!self || self.split(" ")[1] !== outputHash(SELF_CHECK_INPUT)) {
    return null;
  }

  const ran = new Map<number, { exit: number; ms: number; hash: string; tle: boolean }>();
  const skipped = new Map<number, string>();
  const samples = new Map<number, string>();

  for (const line of lines) {
    const parts = line.split(" ");
    const test = Number(parts[1]);
    if (!Number.isInteger(test) || test < 1 || test > testCases.length) continue;
    // First line per test wins. The program cannot forge a passing line
    // without the expected output, which never enters the sandbox.
    if (parts[0] === "@@T" && !ran.has(test) && parts.length >= 6) {
      ran.set(test, {
        exit: Number(parts[2]),
        ms: Number(parts[3]),
        hash: parts[4],
        tle: parts[5] === "1",
      });
    } else if (parts[0] === "@@S" && !skipped.has(test)) {
      skipped.set(test, parts[2] || "");
    } else if (parts[0] === "@@O" && !samples.has(test)) {
      samples.set(test, Buffer.from(parts[2] || "", "base64").toString("utf8"));
    }
  }

  if (ran.size === 0 && skipped.size === 0 && testCases.length > 0) {
    return null;
  }

  return testCases.map((testCase, index): TestResult => {
    const test = index + 1;
    const hidden = testCase.isHidden !== false;
    const base = { testIndex: index, hidden, expected: testCase.expectedOutput };
    const r = ran.get(test);

    if (!r) {
      const reason = skipped.get(test);
      return {
        ...base,
        passed: false,
        // Not run because an earlier test hit the time limit
        status:
          reason === "tle"
            ? "Skipped"
            : reason === "budget" || harnessTimedOut
            ? "Time Limit Exceeded"
            : "Runtime Error",
      };
    }

    let status: string;
    let passed = false;
    if (r.tle) {
      status = "Time Limit Exceeded";
    } else if (r.exit !== 0) {
      status = runtimeErrorStatus(r.exit);
    } else if (r.hash === outputHash(testCase.expectedOutput)) {
      status = "Accepted";
      passed = true;
    } else {
      status = "Wrong Answer";
    }

    return {
      ...base,
      passed,
      status,
      stdout: samples.get(test),
      time: Number.isFinite(r.ms) ? (r.ms / 1000).toFixed(3) : undefined,
    };
  });
}
