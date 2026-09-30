#!/usr/bin/env python3
"""
Add Codeforces problems we do not have yet, from open-r1/codeforces.

SCOPE, AND WHY IT IS THIS NARROW
-------------------------------
The dataset holds 7,948 problems we lack -- 1,662 of them rated <= 1200 with
official tests. Adding all of those would be a mistake: only a minority carry a
checker, and a problem with several valid answers that is judged by string
comparison marks correct code WRONG. Among our own problems without a checker,
about 5% turned out to be multi-answer, so bulk-adding would put roughly 70
problems in the pool that reject correct solutions.

So this script adds only problems that are **judged by a real checker**, which
is safe by construction: whatever the answer looks like, the checker decides.
Everything else is left out until there is a way to prove it is single-answer.

    --max-rating 1200   (default) only what matchmaking can currently serve
                        pass 0 to add every checker-backed problem

Descriptions are rebuilt in exactly the format the existing rows use, so new
problems are indistinguishable from old ones. `--validate` proves that: it
regenerates the description of every problem already in the database and diffs
it against what is stored.

USAGE
-----
    python3 import_new_problems.py --validate        # prove the description builder
    python3 import_new_problems.py --dry-run
    python3 import_new_problems.py

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from collections import Counter

from import_openr1 import build_tests, fetch_all, load_openr1, request


def fmt_num(v) -> str:
    """1.0 -> '1.0', 256.0 -> '256.0'. Matches the existing rows."""
    if v is None:
        return "0.0"
    return f"{float(v):.1f}"


def build_description(d: dict) -> str:
    """Rebuild the problem statement in the exact format the existing rows use.

    Verified by `--validate` against all 1,608 problems already in the database.

    Note the `## Problem Statement` section is emitted unconditionally. Some
    dataset rows have no statement at all, and the original builder stringified
    that as the literal text `None`. Reproduced here so new rows are
    byte-identical in shape to old ones -- but such problems are excluded during
    selection, because "None" is not something to show a player.
    """
    out = [f"# {d['title']}", ""]
    out.append(f"**Difficulty:** {d['rating']}")
    out.append(f"**Time Limit:** {fmt_num(d['time_limit'])}s")
    out.append(f"**Memory Limit:** {fmt_num(d['memory_limit'])}MB")
    if d["tags"]:
        out += ["", f"**Tags:** {', '.join(d['tags'])}"]
    out += ["", "## Problem Statement", "", d["description"] or "None"]
    if d["input_format"]:
        out += ["", "## Input Format", "", d["input_format"]]
    if d["output_format"]:
        out += ["", "## Output Format", "", d["output_format"]]
    if d["examples"]:
        out += ["", "## Examples", ""]
        for i, ex in enumerate(d["examples"], 1):
            out += [
                "", f"### Example {i}", "",
                "**Input:**", "```", (ex.get("input") or "").rstrip("\n"), "```",
                "", "**Output:**", "```", (ex.get("output") or "").rstrip("\n"), "```",
            ]
    if d["note"]:
        out += ["", "## Note", "", d["note"]]
    return "\n".join(out)


def validate(base, key, ds):
    """Regenerate existing descriptions and diff them against the database."""
    print("Validating the description builder against existing rows")
    problems = fetch_all(base, key, "/rest/v1/problems?select=id,problem_id,description&order=id.asc")
    same = diff = nodata = 0
    shown = 0
    for p in problems:
        d = ds.get(p["problem_id"])
        if not d:
            nodata += 1
            continue
        built = build_description(d)
        if built == p["description"]:
            same += 1
        else:
            diff += 1
            if shown < 3:
                shown += 1
                print(f"\n  DIFF {p['problem_id']}")
                a, b = p["description"], built
                # first difference, with a little context
                i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
                print(f"    stored : ...{a[max(0,i-60):i+90]!r}")
                print(f"    rebuilt: ...{b[max(0,i-60):i+90]!r}")
                print(f"    (stored len {len(a)}, rebuilt len {len(b)})")
    total = same + diff
    print(f"\n  identical : {same}/{total} ({100*same/max(total,1):.1f}%)")
    print(f"  differing : {diff}")
    if nodata:
        print(f"  no dataset row: {nodata}")
    return diff == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards", default="/tmp/or1/data/default-*.parquet")
    ap.add_argument("--max-rating", type=int, default=1200,
                    help="0 = no rating limit")
    ap.add_argument("--max-tests", type=int, default=20)
    ap.add_argument(
        "--min-tests",
        type=int,
        default=3,
        help="skip problems with too few official tests to judge meaningfully",
    )
    ap.add_argument("--max-bytes", type=int, default=200_000)
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        sys.exit("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    print("Loading open-r1/codeforces")
    ds = load_openr1(args.shards)
    print(f"  {len(ds)} problems loaded")

    if args.validate:
        ok = validate(base, key, ds)
        # A couple of mismatches would mean the builder is subtly wrong and new
        # problems would look different from existing ones.
        sys.exit(0 if ok else 1)

    print("\nFinding problems we do not have")
    existing = {
        p["problem_id"]
        for p in fetch_all(base, key, "/rest/v1/problems?select=problem_id&order=id.asc")
    }
    print(f"  we have {len(existing)} problems")

    selected, skipped = [], Counter({"already have": 0})
    for k, d in ds.items():
        if k in existing:
            skipped["already have"] += 1
            continue
        # Only problems a checker can judge. This is the safety property.
        if not (d["checker"] or "").strip():
            skipped["no checker"] += 1
            continue
        if not d["executable"]:
            skipped["not executable"] += 1
            continue
        if d["input_mode"] != "stdio":
            skipped[f"input_mode={d['input_mode']}"] += 1
            continue
        if not (d["official_tests"] or d["examples"]):
            skipped["no tests"] += 1
            continue
        # A problem with no statement renders as "None" to the player.
        if not d["description"]:
            skipped["no problem statement"] += 1
            continue
        # Unrated problems carry no rating at all; defaulting that to 0 would
        # rank them as the easiest problems in the game.
        if not d["rating"]:
            skipped["unrated"] += 1
            continue
        if args.max_rating and d["rating"] > args.max_rating:
            skipped[f"rating > {args.max_rating}"] += 1
            continue
        tests = build_tests(d["examples"], d["official_tests"], args.max_tests, args.max_bytes)
        if not tests:
            skipped["no usable tests"] += 1
            continue
        # A problem with one or two tests is not really judged: a hardcoded
        # answer passes. Official test counts for the newest contests are
        # genuinely small, so this is a floor, not a preference.
        if len(tests) < args.min_tests:
            skipped[f"fewer than {args.min_tests} tests"] += 1
            continue
        selected.append((k, d, tests))

    print(f"\n  to add : {len(selected)}")
    print("  skipped:")
    for k, v in sorted(skipped.items(), key=lambda kv: -kv[1]):
        print(f"    {v:6d}  {k}")
    if selected:
        import statistics
        r = [d["rating"] for _, d, _ in selected if d["rating"]]
        print(f"\n  rating: min {min(r)} max {max(r)} median {statistics.median(r):.0f}")
        print(f"  tests per problem: mean {statistics.mean([len(t) for _,_,t in selected]):.1f}")

    if args.dry_run or not selected:
        print("\n(dry run — nothing written)" if selected else "\nnothing to add")
        return

    print(f"\nInserting {len(selected)} problems")
    id_by_key = {}
    batch = 50
    for i in range(0, len(selected), batch):
        chunk = selected[i : i + batch]
        payload = [
            {
                "problem_id": k,
                "title": d["title"],
                "description": build_description(d),
                "difficulty": d["rating"],
                "url": f"https://codeforces.com/problemset/problem/{k.split('/')[0]}/{k.split('/')[1]}",
                "checker_type": "custom",
                "checker_code": d["checker"],
                # Left false on purpose: classify_problems.py turns it on only
                # after the checker is actually proven to behave.
                "judge_safe": False,
            }
            for k, d, _ in chunk
        ]
        req = urllib.request.Request(
            base + "/rest/v1/problems",
            data=json.dumps(payload).encode(),
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                # Need the generated ids back to attach test cases.
                "Prefer": "return=representation",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=180) as r:
            for row in json.load(r):
                id_by_key[row["problem_id"]] = row["id"]
        print(f"    {min(i+batch, len(selected))}/{len(selected)}", end="\r")
    print(f"    {len(selected)}/{len(selected)}")

    print("Inserting test cases")
    rows = []
    for k, d, tests in selected:
        pid = id_by_key.get(k)
        if pid is None:
            continue
        for j, (inp, exp, is_sample) in enumerate(tests):
            rows.append({
                "problem_id": pid,
                "input": inp,
                "expected_output": exp,
                "order_index": j,
                "is_sample": is_sample,
            })
    for i in range(0, len(rows), 400):
        request(base, key, "/rest/v1/problem_test_cases", rows[i : i + 400])
        print(f"    {min(i+400, len(rows))}/{len(rows)}", end="\r")
    print(f"    {len(rows)}/{len(rows)}")

    with open("new_problem_ids.json", "w") as f:
        json.dump(sorted(id_by_key.values()), f)
    print(f"\nDone: {len(id_by_key)} problems, {len(rows)} test cases")
    print("Ids written to new_problem_ids.json")
    print("Next: classify them so judge_safe is only set on proven checkers:")
    print("  python3 scripts/classify_problems.py --ids-from new_problem_ids.json")


if __name__ == "__main__":
    main()
