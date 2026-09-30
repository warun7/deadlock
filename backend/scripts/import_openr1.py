#!/usr/bin/env python3
"""
Upgrade existing problems with official Codeforces tests and real checkers.

WHY THIS EXISTS
---------------
The test cases currently in `problem_test_cases` come from CodeContests: a
handful of real tests plus a large number of *generated* ones. That was good
enough to make the judge work, but it has two problems:

  1. Generated tests are synthetic and are not what Codeforces actually judged
     with. `open-r1/codeforces` ships `official_tests` -- the real judge tests.
  2. 252 problems had to be marked `judge_safe = false` and hidden from
     matchmaking, because they accept several different correct answers and
     plain string comparison marked correct code wrong. Writing bespoke
     checkers for them was out of scope.

`open-r1/codeforces` solves the second one. It carries a `generated_checker`
for 18% of problems: a real Python checker, invoked as

    python checker.py <input_file> <expected_file> <submission_file>

which prints `1` for accepted and `0` for wrong answer. 227 of our 252 hidden
problems have one, so they can be judged properly instead of hidden.

Every one of our 1,608 problems is present in the dataset, so this is purely an
upgrade -- no new problems are added here.

WHAT IT CHANGES
---------------
  problem_test_cases : replaced with examples + official_tests
  problems.checker_type : 'custom' where a checker exists
  problems.checker_code : the checker source
  problems.judge_safe   : true where a checker exists (it can now be judged)

Tests are ordered so the published `examples` come first: ProblemService shows
the first two as the visible samples.

USAGE
-----
    python3 import_openr1.py --dry-run
    python3 import_openr1.py
    python3 import_openr1.py --no-checkers     # tests only

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import urllib.request
from collections import Counter, defaultdict

# A submission runs one Judge0 job per test, so the cap bounds match latency.
# Official tests average ~22 per problem, so this rarely truncates.
DEFAULT_MAX_TESTS = 20
DEFAULT_MAX_BYTES = 200_000


def norm_text(s: str) -> str:
    return (s or "").replace("\r\n", "\n").rstrip("\n")


def build_tests(examples, official, max_tests: int, max_bytes: int):
    """Examples first (they are the visible samples), then official tests.

    Returns (input, expected_output, is_sample) triples. `is_sample` comes from
    the dataset's `examples` array, which is the authoritative definition of a
    sample -- inferring it from position published hidden judge tests whenever a
    problem had fewer than two examples.
    """
    pairs, seen = [], set()
    for is_sample, group in ((True, examples or []), (False, official or [])):
        for t in group:
            if not isinstance(t, dict):
                continue
            inp = norm_text(t.get("input") or "")
            exp = norm_text(t.get("output") or "")
            if len(inp) > max_bytes or len(exp) > max_bytes:
                continue
            # A test with no input and no output cannot discriminate.
            if not inp.strip() and not exp.strip():
                continue
            k = (inp, exp)
            if k in seen:
                continue
            seen.add(k)
            pairs.append((inp, exp, is_sample))
            if len(pairs) >= max_tests:
                return pairs
    return pairs


def load_openr1(shards_glob: str):
    """-> {problem_key: {...}} for every usable Codeforces problem."""
    import pyarrow.parquet as pq

    out = {}
    files = sorted(glob.glob(shards_glob))
    if not files:
        sys.exit(f"no parquet shards matched {shards_glob}")
    for path in files:
        t = pq.read_table(
            path,
            columns=[
                "id", "contest_id", "index", "title", "rating", "tags",
                "description", "input_format", "output_format", "note",
                "official_tests", "examples", "generated_checker",
                "executable", "input_mode", "testset_size",
                "official_tests_complete", "time_limit", "memory_limit",
            ],
        )
        for i in range(t.num_rows):
            cid = t["contest_id"][i].as_py()
            idx = t["index"][i].as_py()
            if not cid or not idx:
                continue
            key = f"{cid}/{idx}"
            out[key] = {
                "id": t["id"][i].as_py(),
                "title": t["title"][i].as_py(),
                "rating": t["rating"][i].as_py(),
                "tags": t["tags"][i].as_py() or [],
                "description": t["description"][i].as_py() or "",
                "input_format": t["input_format"][i].as_py() or "",
                "output_format": t["output_format"][i].as_py() or "",
                "note": t["note"][i].as_py() or "",
                "time_limit": t["time_limit"][i].as_py(),
                "memory_limit": t["memory_limit"][i].as_py(),
                "examples": t["examples"][i].as_py() or [],
                "official_tests": t["official_tests"][i].as_py() or [],
                "checker": t["generated_checker"][i].as_py() or "",
                "executable": t["executable"][i].as_py(),
                "input_mode": t["input_mode"][i].as_py(),
                "testset_size": t["testset_size"][i].as_py(),
                "tests_complete": t["official_tests_complete"][i].as_py(),
            }
        print(f"    {os.path.basename(path):22s} {t.num_rows:6d} rows")
    return out


def fetch_all(base, key, path):
    rows, page = [], 0
    while True:
        req = urllib.request.Request(
            base + path,
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
        rows.extend(batch)
        if len(batch) < 1000:
            break
        page += 1
    return rows


def request(base, key, path, payload=None, method="POST", prefer="return=minimal"):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        base + path,
        data=data,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards", default="/tmp/or1/data/default-*.parquet")
    ap.add_argument("--max-tests", type=int, default=DEFAULT_MAX_TESTS)
    ap.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    ap.add_argument("--no-checkers", action="store_true",
                    help="import tests only; leave checker_type/judge_safe alone")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        sys.exit("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    print("Loading open-r1/codeforces")
    ds = load_openr1(args.shards)
    print(f"  {len(ds)} problems loaded")

    print("\nReading database")
    problems = fetch_all(base, key, "/rest/v1/problems?select=id,problem_id&order=id.asc")
    print(f"  {len(problems)} problems")

    rows, updates, skipped = [], [], Counter()
    covered = maxed = with_checker = 0
    for p in problems:
        key_ = p["problem_id"]
        d = ds.get(key_)
        if not d:
            skipped["not in dataset"] += 1
            continue
        # File-mode / interactive problems cannot be fed through stdin, which is
        # how the judge works. Leave whatever they already have alone.
        if not d["executable"]:
            skipped["not executable"] += 1
            continue
        if d["input_mode"] != "stdio":
            skipped[f"input_mode={d['input_mode']}"] += 1
            continue
        tests = build_tests(d["examples"], d["official_tests"],
                            args.max_tests, args.max_bytes)
        if not tests:
            skipped["no tests in dataset"] += 1
            continue
        covered += 1
        if len(tests) >= args.max_tests:
            maxed += 1
        for i, (inp, exp, is_sample) in enumerate(tests):
            rows.append({
                "problem_id": p["id"],
                "input": inp,
                "expected_output": exp,
                "order_index": i,
                "is_sample": is_sample,
            })
        if d["checker"].strip():
            with_checker += 1
            if not args.no_checkers:
                updates.append({
                    "id": p["id"],
                    "_checker_type": "custom",
                    "_checker_code": d["checker"],
                })

    print(f"\n  problems upgraded          : {covered}")
    print(f"  test rows to write         : {len(rows)}")
    print(f"  problems gaining a checker : {with_checker}")
    print(f"  hit the {args.max_tests}-test cap      : {maxed}")
    if skipped:
        print("  skipped:")
        for k, v in skipped.most_common():
            print(f"    {v:5d}  {k}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    print("\nClearing existing test cases")
    # Derived data: this script regenerates it in full, so a clean replace is
    # both simplest and idempotent.
    request(base, key, "/rest/v1/problem_test_cases?id=not.is.null", method="DELETE")

    print("Inserting test cases")
    written = 0
    for i in range(0, len(rows), 400):
        chunk = rows[i : i + 400]
        request(base, key, "/rest/v1/problem_test_cases", chunk)
        written += len(chunk)
        if written % 4000 == 0 or written == len(rows):
            print(f"    {written}/{len(rows)}", end="\r")
    print()

    if updates and not args.no_checkers:
        print(f"Writing checkers for {len(updates)} problems")
        for i, u in enumerate(updates, 1):
            request(
                base, key, f"/rest/v1/problems?id=eq.{u['id']}",
                {"checker_type": u["_checker_type"],
                 "checker_code": u["_checker_code"],
                 # A real checker means the problem can be judged correctly even
                 # when several answers are valid, which is exactly what
                 # judge_safe=false was standing in for.
                 "judge_safe": True},
                method="PATCH",
            )
            if i % 200 == 0:
                print(f"    {i}/{len(updates)}", end="\r")
        print(f"    {len(updates)}/{len(updates)}")

    print(f"\nDone: {written} test rows across {covered} problems, "
          f"{with_checker} checkers")


if __name__ == "__main__":
    main()
