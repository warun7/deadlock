/**
 * End-to-end check that the DEPLOYED judge actually judges.
 *
 * WHY THIS EXISTS
 * ---------------
 * The database can look correct while the running service still grades every
 * submission against nothing. This script exercises the real path inside a
 * running backend container, using the same services the Socket.IO handler
 * uses:
 *
 *   ProblemService.getRandomProblem()  -> is the matchmaking pool non-empty and
 *                                         does a served problem carry tests?
 *   ProblemService.getProblemById()    -> are the test cases real (not the old
 *                                         blank-input fallback)?
 *   JudgeService.executeCode()         -> does a correct solution get ACCEPTED
 *                                         and a wrong one get WRONG ANSWER?
 *
 * The last part is the one that matters: a judge that accepts everything is
 * exactly the failure this pipeline was built to fix, so a correct AND a wrong
 * submission are both required before this can pass.
 *
 * USAGE (inside the backend container)
 * ------------------------------------
 *   docker compose exec -T \
 *     -e VERIFY_SOLUTION_B64="$(base64 -i ref_solution.py)" \
 *     backend node scripts/verify_live_judge.js
 *
 * Env:
 *   VERIFY_PROBLEM_ID      problem row id to judge against (default 39)
 *   VERIFY_SOLUTION_B64    base64 of a known-correct Python 3 solution
 *   VERIFY_SOLUTIONS       how many random pool problems to sample (default 5)
 */

const { problemService } = require("../dist/services/ProblemService");
const { judgeService } = require("../dist/services/JudgeService");

// Judge0 CE: 71 = Python 3
const PYTHON3 = 71;

let failures = 0;

function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
}

async function main() {
  const problemId = process.env.VERIFY_PROBLEM_ID || "39";
  const samples = parseInt(process.env.VERIFY_SOLUTIONS || "5", 10);
  const b64 = process.env.VERIFY_SOLUTION_B64 || "";
  const reference = b64 ? Buffer.from(b64, "base64").toString("utf8") : "";

  console.log("\n1. Matchmaking pool");
  let withTests = 0;
  for (let i = 0; i < samples; i++) {
    const p = await problemService.getRandomProblem();
    if (!p) continue;
    if (p.testCases.length > 0 && p.testCases[0].input.trim() !== "") {
      withTests++;
    } else {
      console.log(`     ! ${p.title} served with ${p.testCases.length} usable tests`);
    }
  }
  check(
    `${withTests}/${samples} random pool problems carry real test cases`,
    withTests === samples,
    withTests === samples ? undefined : "pool may still contain unjudgeable problems"
  );

  console.log(`\n2. Test cases for problem ${problemId}`);
  const problem = await problemService.getProblemById(problemId);
  if (!check("problem exists", !!problem)) return finish();
  check("has test cases", problem.testCases.length > 0, `${problem.testCases.length} tests`);

  // The original bug was a single test with blank input and blank expected
  // output, which every submission trivially passed.
  const blank = problem.testCases.filter(
    (t) => !t.input.trim() && !t.expectedOutput.trim()
  ).length;
  check("no blank input/blank output test cases", blank === 0, `${blank} blank tests`);
  const distinct = new Set(problem.testCases.map((t) => t.input)).size;
  check("test inputs are not all identical", distinct > 1, `${distinct} distinct inputs`);
  check(
    "visible samples are the first two",
    problem.testCases.filter((t) => !t.isHidden).length >= 2,
    `${problem.testCases.length - problem.testCases.filter((t) => !t.isHidden).length} hidden`
  );

  if (!reference) {
    console.log("\n  (VERIFY_SOLUTION_B64 not set: skipping execution checks)");
    return finish();
  }

  console.log("\n3. Judging a KNOWN-CORRECT solution (expect accepted)");
  const good = await judgeService.executeCode(reference, PYTHON3, problem.testCases, "exact");
  check(
    `correct solution accepted (${good.passed}/${good.total})`,
    good.status === "accepted",
    `status=${good.status}`
  );

  console.log("\n4. Judging a WRONG solution (expect wrong_answer)");
  // A judge that accepts everything is the original bug, so this must fail.
  const wrong = await judgeService.executeCode("print(0)\n", PYTHON3, problem.testCases, "exact");
  check(
    `wrong solution rejected (${wrong.passed}/${wrong.total})`,
    wrong.status === "wrong_answer",
    `status=${wrong.status}`
  );

  // ---- Checker problems -------------------------------------------------
  // Problems with several valid answers are judged by their own Python checker
  // running inside Judge0, not by string comparison. This is the newest and
  // least-proven path, so it gets its own test.
  console.log("\n5. Judging a CHECKER problem (expect accepted, then rejected)");
  const ckProblem = await findCheckerProblem();
  if (!ckProblem) {
    check("found a problem with a custom checker", false, "none in the pool");
    return finish();
  }
  console.log(
    `     using ${ckProblem.title} (${ckProblem.testCases.length} tests, checker ${ckProblem.checkerCode.length} bytes)`
  );

  // A program that reproduces the problem's own accepted output must pass: the
  // checker is defined to accept those answers.
  const table = ckProblem.testCases.map((t) => [t.input, t.expectedOutput]);
  const echo = [
    "import sys",
    "data = sys.stdin.read()",
    `table = ${JSON.stringify(table)}`,
    "for k, v in table:",
    "    if data.strip() == k.strip():",
    "        sys.stdout.write(v)",
    "        break",
  ].join("\n");

  const ckGood = await judgeService.executeCode(
    echo, PYTHON3, ckProblem.testCases, "custom", ckProblem.checkerCode
  );
  check(
    `checker accepts correct answers (${ckGood.passed}/${ckGood.total})`,
    ckGood.status === "accepted",
    `status=${ckGood.status}`
  );

  // An empty program is not a valid answer to any of these problems.
  const ckBad = await judgeService.executeCode(
    "pass\n", PYTHON3, ckProblem.testCases, "custom", ckProblem.checkerCode
  );
  check(
    `checker rejects an empty submission (${ckBad.passed}/${ckBad.total})`,
    ckBad.status === "wrong_answer",
    `status=${ckBad.status}`
  );

  return finish();
}

/** Find a judge-safe problem that carries a real checker. */
async function findCheckerProblem() {
  for (let i = 0; i < 40; i++) {
    const p = await problemService.getRandomProblem();
    if (p && p.checkerType === "custom" && p.checkerCode && p.testCases.length > 0) {
      return p;
    }
  }
  return null;
}

function finish() {
  console.log(
    `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verification crashed:", e);
  process.exit(1);
});
