#!/usr/bin/env python3
"""
Classify every problem by whether `exact` judging is sound for it.

THE PROBLEM THIS SOLVES
-----------------------
Every row in `problems` has `checker_type = 'exact'`, i.e. the judge compares
the player's output to one stored string. That is only valid for problems with
exactly one correct output. Many Codeforces problems accept *several* correct
answers ("print any such string", "output the points in any order", probabilty
answers within 1e-9). For those, a perfectly correct solution is marked WRONG
ANSWER — the single most trust-destroying thing a judge can do.

We can detect them without writing 200 checkers, because CodeContests ships the
accepted solutions. If a known-accepted solution disagrees with the stored
expected output, then that problem has more than one valid answer and plain
string comparison cannot judge it.

VERDICTS
--------
    verified      at least one known-accepted solution passes EVERY imported
                  test -> exact match is sound, safe to serve to players
    needs_checker every known-accepted solution disagreed with the stored
                  output on some test -> multiple valid answers, exact match
                  would reject correct code
    unverified    no runnable reference solution exists in the dataset, so we
                  cannot vouch for it

`judge_safe = (verdict == 'verified')`.

USAGE
-----
    python3 classify_problems.py                     # sweep, write report
    python3 classify_problems.py --apply             # also set problems.judge_safe
    python3 classify_problems.py --limit 100         # quick partial sweep

Env:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor

CF_ID_RE = re.compile(r"^(\d+)/([A-Za-z0-9]+)$")

# CodeContests `solutions.language`: 1=PYTHON(2.7) 2=CPP 3=PYTHON3 4=JAVA
PY3, CPP = 3, 2
MAX_SOLUTIONS_PER_LANG = 2

# Runs inside a child process: executes one Python solution against every test
# in a single interpreter, so we pay interpreter startup once instead of once
# per test.
PY_HARNESS = r'''
import sys, os, json, signal, tempfile

tests_path, sol_path, timeout = sys.argv[1], sys.argv[2], float(sys.argv[3])
tests = json.load(open(tests_path))
src = open(sol_path, encoding="utf-8", errors="replace").read()

class _Timeout(Exception):
    pass

def _on_alarm(signum, frame):
    raise _Timeout()

signal.signal(signal.SIGALRM, _on_alarm)
real_stdout = sys.stdout
saved_fd1 = os.dup(1)
results = []
try:
    code = compile(src, "solution.py", "exec")
except BaseException as e:
    print(json.dumps([{"ok": False, "err": "SyntaxError: " + str(e)[:150]} for _ in tests]))
    raise SystemExit(0)

def redirect(path, flags, mode):
    fd = os.open(path, flags, mode)
    os.dup2(fd, mode)
    os.close(fd)

for t in tests:
    # Both stdin AND stdout must be REAL file descriptors. Competitive
    # solutions routinely replace them with their own IOBase wrappers via
    # `file.fileno()`, and the standard fastio template does exactly that for
    # stdout as well as stdin. Feeding either one an io.StringIO raises
    # UnsupportedOperation: fileno, which looks like a broken problem but is
    # purely an artefact of the harness.
    fin = tempfile.NamedTemporaryFile("w", suffix=".in", delete=False)
    fin.write(t)
    fin.close()
    fd_in = os.open(fin.name, os.O_RDONLY)
    os.dup2(fd_in, 0)
    os.close(fd_in)
    sys.stdin = os.fdopen(0, "r", closefd=False)

    fout = tempfile.NamedTemporaryFile("w+b", suffix=".out", delete=False)
    fout.close()
    fd_out = os.open(fout.name, os.O_RDWR | os.O_TRUNC)
    os.dup2(fd_out, 1)
    os.close(fd_out)
    sys.stdout = os.fdopen(1, "w", closefd=False)

    signal.setitimer(signal.ITIMER_REAL, timeout)
    err = None
    try:
        exec(code, {"__name__": "__main__"})
    except _Timeout:
        err = "TIMEOUT"
    except SystemExit:
        pass
    except BaseException as e:
        err = type(e).__name__ + ": " + str(e)[:150]
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        try:
            sys.stdout.flush()      # solution may have buffered its own output
        except BaseException:
            pass
        os.lseek(1, 0, os.SEEK_SET)
        chunks = []
        while True:
            b = os.read(1, 1 << 20)
            if not b:
                break
            chunks.append(b)
        captured = b"".join(chunks).decode("utf-8", "replace")
        os.dup2(saved_fd1, 1)       # restore the real stdout for the report
        sys.stdout = real_stdout
        for p in (fin.name, fout.name):
            try:
                os.unlink(p)
            except OSError:
                pass

    if err:
        results.append({"ok": False, "err": err})
    else:
        results.append({"ok": True, "out": captured})

print(json.dumps(results))
'''

_CC_SOLUTIONS = {}   # cfkey -> {"py": [...], "cpp": [...]}
_CACHE_DIR = None    # persistent per-worker dir (compiled binaries must outlive
                     # the per-problem scratch dir, or the cache points at deleted files)


def cache_dir() -> str:
    global _CACHE_DIR
    if _CACHE_DIR is None:
        _CACHE_DIR = tempfile.mkdtemp(prefix="judge-classify-")
    return _CACHE_DIR


def log_normalise(text: str) -> str:
    """Match the judge: ignore trailing whitespace on each line."""
    lines = [ln.rstrip() for ln in (text or "").replace("\r\n", "\n").split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def cf_key(problem_id) -> str | None:
    m = CF_ID_RE.match(str(problem_id or "").strip())
    return f"{int(m.group(1))}/{m.group(2).upper()}" if m else None


def fetch_all(base, key, path, page_size=1000):
    rows, page = [], 0
    while True:
        req = urllib.request.Request(
            base + path,
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Range": f"{page * page_size}-{page * page_size + page_size - 1}",
            },
        )
        with urllib.request.urlopen(req, timeout=180) as r:
            batch = json.load(r)
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return rows


def load_solutions(shards_dir):
    """One pass over the shards -> {cfkey: {'py': [...], 'cpp': [...]}}"""
    import pyarrow.parquet as pq

    out = {}
    for path in sorted(glob.glob(os.path.join(shards_dir, "*.parquet"))):
        t = pq.read_table(
            path, columns=["source", "cf_contest_id", "cf_index", "solutions"]
        )
        srcs, cids, idxs = t["source"], t["cf_contest_id"], t["cf_index"]
        sols_col = t["solutions"]
        for i in range(t.num_rows):
            if srcs[i].as_py() != 2:  # CODEFORCES
                continue
            cid, idx = cids[i].as_py(), idxs[i].as_py()
            if not cid or not idx:
                continue
            k = f"{int(cid)}/{str(idx).upper()}"
            bucket = out.setdefault(k, {"py": [], "cpp": []})
            s = sols_col[i].as_py() or {}
            for lang, sol in zip(s.get("language") or [], s.get("solution") or []):
                if not sol or not sol.strip():
                    continue
                if lang == PY3 and len(bucket["py"]) < MAX_SOLUTIONS_PER_LANG:
                    bucket["py"].append(sol)
                elif lang == CPP and len(bucket["cpp"]) < MAX_SOLUTIONS_PER_LANG:
                    bucket["cpp"].append(sol)
    return out


def run_python(sol: str, inputs, workdir, timeout):
    """All tests for one Python solution, in a single interpreter."""
    with open(os.path.join(workdir, "tests.json"), "w") as f:
        json.dump(inputs, f)
    sp = os.path.join(workdir, "sol.py")
    with open(sp, "w", encoding="utf-8") as f:
        f.write(sol)
    hp = os.path.join(workdir, "harness.py")
    with open(hp, "w") as f:
        f.write(PY_HARNESS)
    try:
        p = subprocess.run(
            [sys.executable, hp, os.path.join(workdir, "tests.json"), sp, str(timeout)],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout * len(inputs) + 30,
        )
        return json.loads(p.stdout.decode(errors="replace") or "[]")
    except Exception:
        return []


_GXX_CACHE = {}

# Ship a <bits/stdc++.h> shim so GCC-flavoured solutions compile under Apple
# clang (whose `g++` is libc++). Harmless on Linux, where the real header wins.
SHIM_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shim")


def run_cpp(sol: str, inputs, workdir, timeout):
    """Compile once per distinct solution, then one process per test."""
    import hashlib

    h = hashlib.sha1(sol.encode()).hexdigest()[:16]
    exe = _GXX_CACHE.get(h)
    if not exe or not os.path.exists(exe):
        # Compiled binaries live in the persistent per-worker cache dir, NOT in
        # workdir, which is torn down when the problem finishes.
        cdir = cache_dir()
        cpp = os.path.join(cdir, f"{h}.cpp")
        exe = os.path.join(cdir, f"{h}.bin")
        with open(cpp, "w", encoding="utf-8") as f:
            f.write(sol)
        cmd = ["g++", "-O2", "-std=gnu++17"]
        if os.path.isdir(SHIM_DIR):
            cmd.append(f"-I{SHIM_DIR}")
        cmd += ["-o", exe, cpp]
        try:
            c = subprocess.run(
                cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=90
            )
        except Exception:
            return []
        if c.returncode != 0:
            return []
        _GXX_CACHE[h] = exe

    results = []
    for t in inputs:
        try:
            p = subprocess.run(
                [exe], input=t.encode(), stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, timeout=timeout,
            )
            results.append({"ok": p.returncode == 0, "out": p.stdout.decode(errors="replace")})
        except subprocess.TimeoutExpired:
            results.append({"ok": False, "err": "TIMEOUT"})
        except Exception as e:
            results.append({"ok": False, "err": str(e)[:100]})
    return results


def run_checker(checker_src, test_input, expected, submission_out, workdir, timeout=8.0):
    """Run an open-r1 checker exactly the way the judge does.

    Contract (verified against the dataset): the checker is invoked as

        python checker.py <input_file> <expected_file> <submission_file>

    and prints a SCORE on its last line: `0` for wrong answer, and a positive
    value for accepted. Checkers in the wild use both `1` and `100` -- the
    Codeforces convention is a score out of 100 -- so anything non-zero is
    accepted. Returns True/False, or None if the checker could not be run or
    produced nothing intelligible.
    """
    ck = os.path.join(workdir, "checker.py")
    with open(ck, "w", encoding="utf-8") as f:
        f.write(checker_src)
    for name, content in (
        ("in.txt", test_input),
        ("exp.txt", expected),
        ("sub.txt", submission_out),
    ):
        with open(os.path.join(workdir, name), "w", encoding="utf-8") as f:
            f.write(content)
    try:
        p = subprocess.run(
            [sys.executable, ck, "in.txt", "exp.txt", "sub.txt"],
            cwd=workdir, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=timeout,
        )
    except Exception:
        return None
    lines = [ln.strip() for ln in p.stdout.decode(errors="replace").splitlines() if ln.strip()]
    if not lines:
        return None
    try:
        return int(lines[-1]) > 0
    except ValueError:
        # Some checkers print a word instead of a score.
        word = lines[-1].upper()
        if word in ("AC", "ACCEPTED", "YES", "TRUE"):
            return True
        if word in ("WA", "WRONG", "NO", "FALSE"):
            return False
        return None


def classify_one(job):
    """Worker: decide one problem's verdict. Returns a report dict."""
    pid, key, cases, checker_src = job

    expected = [log_normalise(c["expected_output"] or "") for c in cases]
    raw_expected = [c["expected_output"] or "" for c in cases]
    inputs = [c["input"] or "" for c in cases]

    refs = _CC_SOLUTIONS.get(key) if key else None

    if not refs:
        # No accepted solution available to test with (this is the case for
        # problems published after CodeContests, which ship no solutions).
        #
        # A checker can still be validated without one: the stored expected
        # output IS the official Codeforces answer, so a correct checker must
        # accept it. A checker that rejects the official answer is broken and
        # must not be trusted with real submissions.
        if not checker_src:
            return {"id": pid, "key": key, "verdict": "unverified",
                    "why": "no reference solution", "passed": 0, "total": len(cases)}
        ckdir = tempfile.mkdtemp(prefix="ck-")
        try:
            for i in range(len(cases)):
                got = run_checker(checker_src, inputs[i], raw_expected[i],
                                  raw_expected[i], ckdir)
                if got is None:
                    return {"id": pid, "key": key, "verdict": "unverified",
                            "why": f"checker produced no verdict on test #{i}",
                            "passed": i, "total": len(cases)}
                if not got:
                    return {"id": pid, "key": key, "verdict": "unverified",
                            "why": f"checker rejects the official answer on test #{i}",
                            "passed": i, "total": len(cases)}
            # Also confirm it is not a rubber stamp.
            disc = run_checker(checker_src, inputs[0], raw_expected[0], "", ckdir)
            if disc is not False:
                return {"id": pid, "key": key, "verdict": "unverified",
                        "why": "checker accepted an empty submission",
                        "passed": 0, "total": len(cases)}
        finally:
            import shutil

            shutil.rmtree(ckdir, ignore_errors=True)
        return {"id": pid, "key": key, "verdict": "verified",
                "why": "checker accepts all official answers (no reference solution)",
                "passed": len(cases), "total": len(cases)}

    # With a real checker, "correct" no longer means "matches the stored string":
    # it means the checker accepts it. That is what rescues problems with several
    # valid answers, where exact comparison rejected correct code.
    ckdir = tempfile.mkdtemp(prefix="ck-") if checker_src else None

    def verdict_for(lang, si, res):
        """-> (passed, why) for one solution's outputs."""
        passed, why = 0, None
        for i, r in enumerate(res):
            if not r.get("ok"):
                why = f"{lang}#{si} {r.get('err','?')} on test #{i}"
                break
            if checker_src:
                got = run_checker(checker_src, inputs[i], raw_expected[i],
                                  r.get("out", ""), ckdir)
                if got is None:
                    why = f"{lang}#{si} checker produced no verdict on test #{i}"
                    break
                ok = got
            else:
                ok = log_normalise(r.get("out", "")) == expected[i]
            if ok:
                passed += 1
            else:
                why = f"{lang}#{si} {'checker rejected' if checker_src else 'output mismatch'} on test #{i}"
                break
        return (len(cases) if why is None else passed), why

    best = None
    ran_any = False
    try:
        with tempfile.TemporaryDirectory() as wd:
            for lang, runner in (("py", run_python), ("cpp", run_cpp)):
                for si, sol in enumerate(refs[lang]):
                    res = runner(sol, inputs, wd, 6.0)
                    if len(res) != len(cases):
                        continue  # harness/compile failure -> try the next solution
                    ran_any = True
                    passed, why = verdict_for(lang, si, res)
                    if best is None or passed > best[0]:
                        best = (passed, why)
                    if passed == len(cases):
                        # A checker that accepts EVERYTHING is worthless, so
                        # confirm it rejects an empty submission before trusting it.
                        if checker_src:
                            disc = run_checker(checker_src, inputs[0], raw_expected[0], "", ckdir)
                            if disc is not False:
                                return {"id": pid, "key": key, "verdict": "unverified",
                                        "why": "checker accepted an empty submission",
                                        "passed": passed, "total": len(cases)}
                        return {"id": pid, "key": key, "verdict": "verified",
                                "why": f"{lang}#{si} passed all via "
                                       + ("checker" if checker_src else "exact match"),
                                "passed": passed, "total": len(cases)}
    finally:
        if ckdir:
            import shutil

            shutil.rmtree(ckdir, ignore_errors=True)

    if not ran_any:
        # Nothing executed: can't blame the problem, we simply have no evidence.
        # Treating this as "needs_checker" would silently shrink the live pool.
        return {"id": pid, "key": key, "verdict": "unverified",
                "why": "no reference solution compiled/ran", "passed": 0,
                "total": len(cases)}

    if not checker_src:
        return {"id": pid, "key": key, "verdict": "needs_checker",
                "why": (best[1] if best else "no solution ran"), "passed": best[0] if best else 0,
                "total": len(cases)}

    # A checker exists but no accepted solution passed it: either the checker is
    # broken or the reference solutions are wrong. Either way we cannot vouch.
    return {"id": pid, "key": key, "verdict": "unverified",
            "why": (best[1] if best else "checker rejected every solution"),
            "passed": best[0] if best else 0, "total": len(cases)}


def apply_results(base, key, results):
    """Write `judge_safe` for every classified problem."""
    print("Applying judge_safe to the database")
    safe = [r["id"] for r in results if r["verdict"] == "verified"]
    unsafe = [r["id"] for r in results if r["verdict"] != "verified"]
    for ids, flag in ((unsafe, False), (safe, True)):
        for i in range(0, len(ids), 200):
            chunk = ids[i : i + 200]
            req = urllib.request.Request(
                f"{base}/rest/v1/problems?id=in.({','.join(str(x) for x in chunk)})",
                data=json.dumps({"judge_safe": flag}).encode(),
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                method="PATCH",
            )
            urllib.request.urlopen(req, timeout=120)
    print(f"  judge_safe=true : {len(safe)}")
    print(f"  judge_safe=false: {len(unsafe)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards", default="/tmp/cc/shards")
    ap.add_argument("--out", default="judge_classification.json")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 3))
    ap.add_argument("--limit", type=int, default=0, help="only sweep the first N (debugging)")
    ap.add_argument(
        "--ids-from",
        default="",
        help="JSON file of problem ids; classify only those (used for newly added problems)",
    )
    ap.add_argument("--apply", action="store_true", help="write judge_safe back to the DB")
    ap.add_argument(
        "--apply-from",
        default="",
        help="skip the sweep and apply an existing report JSON instead",
    )
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        sys.exit("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    # Fast path: replay a finished sweep instead of re-running a 20 minute one.
    # Useful because applying needs a migration to have landed first.
    if args.apply_from:
        with open(args.apply_from) as f:
            results = json.load(f)["results"]
        print(f"Loaded {len(results)} verdicts from {args.apply_from}")
        apply_results(base, key, results)
        return

    print("Reading database")
    problems = fetch_all(
        base, key,
        "/rest/v1/problems?select=id,problem_id,title,checker_type,checker_code&order=id.asc",
    )
    tests = defaultdict(list)
    for t in fetch_all(
        base, key,
        "/rest/v1/problem_test_cases?select=problem_id,order_index,input,expected_output"
        "&order=problem_id.asc,order_index.asc",
    ):
        tests[t["problem_id"]].append(t)
    for v in tests.values():
        v.sort(key=lambda t: t["order_index"])
    print(f"  {len(problems)} problems, {len(tests)} with test cases")

    print("Loading reference solutions from CodeContests shards")
    global _CC_SOLUTIONS
    _CC_SOLUTIONS = load_solutions(args.shards)
    print(f"  {len(_CC_SOLUTIONS)} Codeforces problems carry solutions")

    # Workers must INHERIT the solutions map rather than re-load 7 GB of parquet.
    # ProcessPoolExecutor defaults to spawn on macOS, which would silently hand
    # every worker an empty dict and mark the whole database "unverified".
    import multiprocessing as mp

    try:
        mp.set_start_method("fork", force=True)
    except RuntimeError:
        pass
    if mp.get_start_method() != "fork":
        sys.exit(
            f"refusing to sweep with the '{mp.get_start_method()}' start method: "
            "workers would not see the reference solutions"
        )

    only_ids = None
    if args.ids_from:
        with open(args.ids_from) as f:
            only_ids = set(json.load(f))
        print(f"Restricting to {len(only_ids)} ids from {args.ids_from}")

    jobs = []
    n_ck = 0
    for p in problems:
        if p["id"] not in tests:
            continue
        if only_ids is not None and p["id"] not in only_ids:
            continue
        ck = None
        if p.get("checker_type") == "custom" and (p.get("checker_code") or "").strip():
            ck = p["checker_code"]
            n_ck += 1
        jobs.append((p["id"], cf_key(p.get("problem_id")), tests[p["id"]], ck))
    if args.limit:
        jobs = jobs[: args.limit]
    print(f"\nClassifying {len(jobs)} problems on {args.workers} workers")
    print(f"  {n_ck} of them have a real checker (judged by the checker, not string match)")

    results = []
    done = 0
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        for r in ex.map(classify_one, jobs):
            results.append(r)
            done += 1
            if done % 100 == 0:
                c = Counter(x["verdict"] for x in results)
                print(f"  {done}/{len(jobs)}  " + "  ".join(f"{k}={v}" for k, v in c.most_common()))

    counts = Counter(r["verdict"] for r in results)
    total = sum(counts.values())
    print(f"\n{'=' * 62}\nJudge classification ({total} problems with test cases)")
    for v in ("verified", "needs_checker", "unverified"):
        n = counts.get(v, 0)
        print(f"  {v:14s} {n:5d}  ({100*n/max(total,1):5.1f}%)")
    print(f"\n  judge_safe (verified) pool: {counts.get('verified',0)} problems")

    # What the unsafe ones look like, so the cost of losing them is visible.
    lvl = Counter()
    for r in results:
        if r["verdict"] != "verified":
            lvl[r["why"].split(" on test")[0][:46]] += 1
    if lvl:
        print("\n  top reasons:")
        for w, c in lvl.most_common(6):
            print(f"    {c:4d}x {w}")

    with open(args.out, "w") as f:
        json.dump({"counts": dict(counts), "results": results}, f, indent=1)
    print(f"\n  report written to {args.out}")

    if not args.apply:
        print("  (--apply not given: database unchanged)")
        return

    apply_results(base, key, results)


if __name__ == "__main__":
    main()
