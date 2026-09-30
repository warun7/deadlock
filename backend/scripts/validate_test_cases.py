#!/usr/bin/env python3
"""
Validate the imported `problem_test_cases` rows.

WHY THIS EXISTS
---------------
`import_test_cases.py` pulls test cases out of public datasets. Dataset test
cases are not automatically trustworthy: a wrong `expected_output` turns every
*correct* submission into a WRONG ANSWER, which is far worse for players than
having no test at all. This script is the check that the imported data actually
agrees with real accepted solutions.

HOW IT WORKS
------------
CodeContests ships the accepted solutions alongside each problem. For a sample
of covered problems we take the dataset's own Python solutions, run each one
locally against the test inputs we imported, and compare stdout with the
`expected_output` we stored. A problem "validates" if at least one reference
solution passes *every* imported test.

    validated  -> confidence the imported tests describe the real problem
    mismatch   -> either the reference solution is wrong, or a test is wrong

A handful of mismatches across a sample is normal (reference solutions can be
partial submissions, and some problems accept multiple answers). A high
mismatch rate means the import is bad.

USAGE
-----
    python3 validate_test_cases.py --sample 40
    python3 validate_test_cases.py --sample 200 --verbose

Env:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from collections import Counter, defaultdict

CF_ID_RE = __import__("re").compile(r"^(\d+)/([A-Za-z0-9]+)$")

# CodeContests `solutions.language` enum, confirmed by inspecting code content:
#   1 = PYTHON (2.7 — `print 'x'`, unusable under python3)
#   2 = CPP   3 = PYTHON3   4 = JAVA
# Only Python 3 is executable here, so only lang 3 counts as a reference.
PYTHON3_LANG = 3
CPP, JAVA = 2, 4


def cf_key(problem_id) -> str | None:
    m = CF_ID_RE.match(str(problem_id or "").strip())
    return f"{int(m.group(1))}/{m.group(2).upper()}" if m else None


def normalise(text: str) -> str:
    """Compare the way a competitive judge does: ignore trailing whitespace."""
    lines = [ln.rstrip() for ln in (text or "").replace("\r\n", "\n").split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def fetch_covered_problems(base, key):
    """Every problem, keyed by id (PostgREST caps a page at 1000 rows)."""
    problems, page = {}, 0
    while True:
        req = urllib.request.Request(
            f"{base}/rest/v1/problems?select=id,problem_id,title&order=id.asc",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Range": f"{page * 1000}-{page * 1000 + 999}",
            },
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            batch = json.load(r)
        if not batch:
            break
        for p in batch:
            problems[p["id"]] = p
        if len(batch) < 1000:
            break
        page += 1
    return problems


def fetch_tests(base, key):
    """All imported test cases, grouped by problem id."""
    by_problem = defaultdict(list)
    page = 0
    while True:
        req = urllib.request.Request(
            f"{base}/rest/v1/problem_test_cases"
            "?select=problem_id,order_index,input,expected_output"
            "&order=problem_id.asc,order_index.asc",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Range": f"{page * 1000}-{page * 1000 + 999}",
            },
        )
        with urllib.request.urlopen(req, timeout=180) as r:
            batch = json.load(r)
        if not batch:
            break
        for t in batch:
            by_problem[t["problem_id"]].append(t)
        if len(batch) < 1000:
            break
        page += 1
    for v in by_problem.values():
        v.sort(key=lambda t: t["order_index"])
    return by_problem


def load_reference_solutions(shards_dir, wanted_keys, max_solutions=3):
    """{cfkey: [python source, ...]} for the CF problems we care about."""
    import pyarrow.parquet as pq

    out = defaultdict(list)
    for path in sorted(glob.glob(os.path.join(shards_dir, "*.parquet"))):
        t = pq.read_table(
            path, columns=["source", "cf_contest_id", "cf_index", "solutions"]
        )
        for i in range(t.num_rows):
            if t["source"][i].as_py() != 2:  # CODEFORCES
                continue
            cid, idx = t["cf_contest_id"][i].as_py(), t["cf_index"][i].as_py()
            if not cid or not idx:
                continue
            k = f"{int(cid)}/{str(idx).upper()}"
            if k not in wanted_keys or len(out[k]) >= max_solutions:
                continue
            s = t["solutions"][i].as_py() or {}
            langs = s.get("language") or []
            sols = s.get("solution") or []
            for lang, sol in zip(langs, sols):
                if lang == PYTHON3_LANG and sol and sol.strip():
                    out[k].append(sol)
                    if len(out[k]) >= max_solutions:
                        break
    return out


def run_solution(source, stdin, timeout):
    """Run one Python solution on one input. Returns (ok, stdout_or_error)."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "sol.py")
        with open(path, "w", encoding="utf-8") as f:
            f.write(source)
        try:
            p = subprocess.run(
                [sys.executable, path],
                input=stdin.encode(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return False, "TIMEOUT"
    if p.returncode != 0:
        return False, "RUNTIME ERROR: " + p.stderr.decode(errors="replace")[:150]
    return True, p.stdout.decode(errors="replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards", default="/tmp/cc/shards")
    ap.add_argument("--sample", type=int, default=40, help="problems to validate")
    ap.add_argument("--solutions", type=int, default=2, help="reference sols/problem")
    ap.add_argument("--timeout", type=float, default=10.0, help="seconds per run")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        sys.exit("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    print("Reading database")
    problems = fetch_covered_problems(base, key)
    tests = fetch_tests(base, key)
    print(f"  {len(problems)} problems, {sum(len(v) for v in tests.values())} test cases")
    print(f"  {len(tests)} problems have test cases")

    # Only CodeContests-backed problems can be validated this way (we need the
    # matching reference solution), so intersect on the CF key.
    key_of = {pid: cf_key(p.get("problem_id")) for pid, p in problems.items()}
    candidates = [pid for pid in tests if key_of.get(pid)]
    missing_sol = [pid for pid in candidates if pid not in tests]
    print(f"  {len(candidates)} of them are Codeforces-keyed and checkable")

    # Deterministic sample so results are reproducible between runs.
    candidates.sort()
    step = max(1, len(candidates) // args.sample)
    sample = candidates[::step][: args.sample]

    print(f"\nLoading reference solutions for {len(sample)} sampled problems")
    refs = load_reference_solutions(
        args.shards, {key_of[pid] for pid in sample}, args.solutions
    )
    have = [pid for pid in sample if refs.get(key_of[pid])]
    print(f"  {len(have)} of {len(sample)} have a Python reference solution")

    print("\nRunning reference solutions against imported tests")
    validated, failed = [], []
    per_test_fail = 0
    total_tests = 0
    reasons = Counter()

    for n, pid in enumerate(have, 1):
        sols = refs[key_of[pid]]
        cases = tests[pid]
        total_tests += len(cases)
        best = None  # (n_passed, why)
        for si, sol in enumerate(sols):
            passed, why = 0, None
            for tc in cases:
                ok, out = run_solution(sol, tc["input"] or "", args.timeout)
                if not ok:
                    why = out
                    break
                if normalise(out) == normalise(tc["expected_output"] or ""):
                    passed += 1
                else:
                    why = f"output mismatch on test #{tc['order_index']}"
                    break
            if why is None:
                passed = len(cases)
            if best is None or passed > best[0]:
                best = (passed, why)
            if passed == len(cases):
                break
        if best[0] == len(cases):
            validated.append(pid)
            mark = "OK "
        else:
            failed.append((pid, key_of[pid], best[0], len(cases), best[1]))
            per_test_fail += best[0]
            mark = "BAD"
            reasons[str(best[1])[:60]] += 1
        if args.verbose or best[0] != len(cases):
            title = (problems[pid].get("title") or "")[:34]
            print(
                f"  [{mark}] {n:3d}/{len(have)} {key_of[pid]:10s} "
                f"{best[0]:2d}/{len(cases):2d} tests  {title}"
                + (f"  <- {best[1]}" if best[1] else "")
            )

    n = len(have)
    print(f"\n{'=' * 62}")
    print(f"Reference-solution validation ({n} problems, {total_tests} tests)")
    print(f"  problems fully passing : {len(validated)}/{n} ({100*len(validated)/max(n,1):.1f}%)")
    print(f"  problems with a failure: {len(failed)}/{n}")
    if failed:
        print("\n  failure reasons:")
        for r, c in reasons.most_common(6):
            print(f"    {c:3d}x {r}")
        print("\n  worst offenders:")
        for pid, k, got, tot, why in sorted(failed, key=lambda x: x[2])[:8]:
            print(f"    {k:10s} {got:2d}/{tot:2d}  {why}")

    # The headline number that matters: does a known-correct solution pass?
    print(
        f"\n  VERDICT: {'PASS' if len(validated)/max(n,1) >= 0.8 else 'INVESTIGATE'}"
        f" — {100*len(validated)/max(n,1):.1f}% of sampled problems accept a known-correct solution"
    )


if __name__ == "__main__":
    main()
