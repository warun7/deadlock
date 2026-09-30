#!/usr/bin/env python3
"""
Import real test cases into `problem_test_cases`.

WHY THIS EXISTS
---------------
`problems` (1,608 rows) was populated without ever populating
`problem_test_cases` (0 rows). The judging path in GameService checks
`problem.testCases.length === 0`; because ProblemService falls back to a single
EMPTY test case, that check never fired, and every submission was judged against
one blank input/blank output pair. Anything that printed nothing "passed".

WHERE THE DATA COMES FROM
-------------------------
Two public datasets, both with real test cases, used in priority order:

  1. APPS  (`codeparserot/apps`, the local `train.csv`)
     5,000 problems, multi-judge (codeforces/codechef/leetcode/codewars/...).
     Richest test sets — mean ~23, up to 93 — but only ~477 are Codeforces and
     only ~2% overlap this database. Matched on the Codeforces problem URL.

  2. CodeContests (`deepmind/code_contests`, AlphaCode's dataset)
     ~13k problems, ~60% Codeforces. Each problem carries `public_tests`,
     `private_tests` (the real judge tests) and `generated_tests`. These are
     Arrow structs of the shape {input: list<string>, output: list<string>},
     so the I/O pairs are the *zipped* lists, not a list of records — a dozen
     or so on average, but the median Codeforces problem has ~100.
     Matched on (cf_contest_id, cf_index), which maps exactly onto this
     database's `problems.problem_id` format ("852/F" -> contest 852, index F).

APPS wins where it has a problem because it has far more tests; CodeContests
supplies the coverage.

USAGE
-----
    python3 import_test_cases.py --dry-run          # coverage report only
    python3 import_test_cases.py                    # import

Env:
    SUPABASE_URL                  e.g. https://xxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY     service role key (bypasses RLS)

Args:
    --apps PATH         path to train.csv            (default ../../train.csv)
    --shards DIR        dir of code_contests parquet (default /tmp/cc/shards)
    --max-tests N       cap per problem              (default 20)
    --max-test-bytes N  skip absurdly large tests    (default 200_000)
    --dry-run           report only, write nothing
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import re
import sys
import urllib.request
from collections import defaultdict

csv.field_size_limit(10**9)

CF_URL = re.compile(r"codeforces\.com/problemset/problem/(\d+)/([A-Za-z0-9]+)")
CF_ID = re.compile(r"^(\d+)/([A-Za-z0-9]+)$")

# CodeContests stores `source` as a ClassLabel; the label order comes from the
# dataset card. index 2 == CODEFORCES.
SOURCE_NAMES = [
    "UNKNOWN",
    "CODECHEF",
    "CODEFORCES",
    "HACKEREARTH",
    "CODEJAM",
    "ATCODER",
    "AIZU",
]
CODEFORCES = SOURCE_NAMES.index("CODEFORCES")


def cf_key_from_url(url: str | None) -> str | None:
    m = CF_URL.search(url or "")
    return f"{int(m.group(1))}/{m.group(2).upper()}" if m else None


def cf_key_from_id(problem_id: str | None) -> str | None:
    m = CF_ID.match((problem_id or "").strip())
    return f"{int(m.group(1))}/{m.group(2).upper()}" if m else None


def normalise_tests(pairs, max_bytes: int):
    """Drop junk, dedupe, and bound size. Returns [(input, output), ...]."""
    out, seen = [], set()
    for inp, exp in pairs:
        inp = inp if isinstance(inp, str) else str(inp)
        exp = exp if isinstance(exp, str) else str(exp)
        if len(inp) > max_bytes or len(exp) > max_bytes:
            continue
        # A test with no input AND no output cannot discriminate between
        # submissions — accepting it would make the judge trivially passable.
        if not inp.strip() and not exp.strip():
            continue
        # Normalise trailing whitespace, which is the usual source of
        # spurious wrong-answers in competitive judges.
        inp = inp.replace("\r\n", "\n").rstrip("\n")
        exp = exp.replace("\r\n", "\n").rstrip("\n")
        k = (inp, exp)
        if k in seen:
            continue
        seen.add(k)
        out.append(k)
    return out


def load_apps(path: str, max_bytes: int):
    """APPS rows -> {cfkey: [(input, output), ...]}"""
    by_key = defaultdict(list)
    if not os.path.exists(path):
        print(f"  APPS: {path} not found, skipping")
        return by_key
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            key = cf_key_from_url(row.get("url"))
            if not key:
                continue
            try:
                io = json.loads(row.get("input_output") or "{}")
            except Exception:
                continue
            inputs = io.get("inputs") or []
            outputs = io.get("outputs") or []
            pairs = list(zip(inputs, outputs)) if len(inputs) == len(outputs) else []
            if pairs:
                by_key[key].extend(normalise_tests(pairs, max_bytes))
    # APPS may list a problem more than once; dedupe across rows.
    return {k: list(dict.fromkeys(v)) for k, v in by_key.items()}


def extract_pairs(value) -> list[tuple]:
    """Pull (input, output) pairs out of a CodeContests test column.

    The parquet schema stores these columns as a STRUCT OF LISTS:

        struct<input: list<string>, output: list<string>>

    so `.as_py()` yields a dict of two parallel lists and the pairs must be
    zipped. Older/other mirrors store a LIST OF STRUCTS
    ({input: str, output: str}); handle both so this never silently yields
    zero tests again.
    """
    if value is None:
        return []
    if isinstance(value, dict):
        ins = value.get("input") or []
        outs = value.get("output") or []
        if isinstance(ins, str):
            ins = [ins]
        if isinstance(outs, str):
            outs = [outs]
        return list(zip(ins, outs))
    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            if isinstance(item, dict):
                out.append((item.get("input", ""), item.get("output", "")))
        return out
    return []


def load_code_contests(shards_dir: str, max_bytes: int):
    """CodeContests parquet shards -> {cfkey: [(input, output), ...]}"""
    try:
        import pyarrow.parquet as pq
    except ImportError:
        print("  CodeContests: pyarrow not installed, skipping")
        return {}

    files = sorted(glob.glob(os.path.join(shards_dir, "*.parquet")))
    if not files:
        print(f"  CodeContests: no parquet in {shards_dir}, skipping")
        return {}

    by_key = defaultdict(list)
    for path in files:
        try:
            t = pq.read_table(
                path,
                columns=[
                    "source",
                    "cf_contest_id",
                    "cf_index",
                    "public_tests",
                    "private_tests",
                    "generated_tests",
                ],
            )
        except Exception as e:
            print(f"  ! could not read {os.path.basename(path)}: {e}")
            continue

        n_cf = 0
        for i in range(t.num_rows):
            if t["source"][i].as_py() != CODEFORCES:
                continue
            cid = t["cf_contest_id"][i].as_py()
            idx = t["cf_index"][i].as_py()
            if not cid or not idx:
                continue
            key = f"{int(cid)}/{str(idx).upper()}"
            pairs = []
            for col in ("public_tests", "private_tests", "generated_tests"):
                pairs.extend(extract_pairs(t[col][i].as_py()))
            if pairs:
                by_key[key].extend(normalise_tests(pairs, max_bytes))
                n_cf += 1
        print(f"    {os.path.basename(path):52s} {n_cf:5d} CF problems")

    return {k: list(dict.fromkeys(v)) for k, v in by_key.items()}


def fetch_db_problems():
    """Read id / problem_id / url for every problem in the database."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        sys.exit("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    problems, page, size = [], 0, 1000
    while True:
        req = urllib.request.Request(
            f"{base}/rest/v1/problems?select=id,problem_id,url,difficulty&order=id.asc",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                # PostgREST caps a response at 1000 rows; page with Range.
                "Range": f"{page * size}-{page * size + size - 1}",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.load(r)
        if not batch:
            break
        problems.extend(batch)
        if len(batch) < size:
            break
        page += 1
    return base, key, problems


def insert_tests(base, key, rows, batch_size=400):
    """Bulk-insert via PostgREST in batches."""
    written = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i : i + batch_size]
        req = urllib.request.Request(
            f"{base}/rest/v1/problem_test_cases",
            data=json.dumps(chunk).encode(),
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120):
            pass
        written += len(chunk)
        print(f"    inserted {written}/{len(rows)}", end="\r")
    print()
    return written


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apps", default="../../train.csv")
    ap.add_argument("--shards", default="/tmp/cc/shards")
    ap.add_argument("--max-tests", type=int, default=20)
    ap.add_argument("--max-test-bytes", type=int, default=200_000)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("Loading sources")
    apps = load_apps(args.apps, args.max_test_bytes)
    print(f"  APPS        : {len(apps)} Codeforces problems with tests")
    cc = load_code_contests(args.shards, args.max_test_bytes)
    print(f"  CodeContests: {len(cc)} Codeforces problems with tests")

    print("\nReading database")
    base, key, problems = fetch_db_problems()
    print(f"  {len(problems)} problems")

    rows, covered, by_source = [], 0, defaultdict(int)
    for p in problems:
        pk = cf_key_from_id(p.get("problem_id")) or cf_key_from_url(p.get("url"))
        if not pk:
            continue
        # APPS first (many more tests); CodeContests to fill and to top up.
        tests = list(apps.get(pk, []))
        source = "apps" if tests else ""
        if len(tests) < args.max_tests:
            extra = [t for t in cc.get(pk, []) if t not in tests]
            if extra:
                tests.extend(extra)
                source = f"{source}+cc" if source else "cc"
        if not tests:
            continue
        tests = tests[: args.max_tests]
        covered += 1
        by_source[source] += 1
        for i, (inp, exp) in enumerate(tests):
            rows.append(
                {
                    "problem_id": p["id"],
                    "input": inp,
                    "expected_output": exp,
                    "order_index": i,
                }
            )

    total = len(problems)
    print(f"\nCoverage: {covered}/{total} problems ({100 * covered / max(total,1):.1f}%)")
    for s, n in sorted(by_source.items(), key=lambda kv: -kv[1]):
        print(f"  from {s:10s}: {n}")
    print(f"Test rows to write: {len(rows)}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    print("\nClearing existing rows and inserting")
    # Idempotent re-run: the table is empty today, but re-running the importer
    # should not duplicate. Delete-all is safe here because the table is
    # derived data that this script fully regenerates.
    req = urllib.request.Request(
        f"{base}/rest/v1/problem_test_cases?id=not.is.null",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        method="DELETE",
    )
    with urllib.request.urlopen(req, timeout=120):
        pass
    written = insert_tests(base, key, rows)
    print(f"Done: {written} test cases across {covered} problems")


if __name__ == "__main__":
    main()
