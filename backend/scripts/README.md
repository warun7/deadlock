# Problem data pipeline

How `problems` and `problem_test_cases` get filled, and how we decide which
problems are safe to put in front of players.

Run these from `backend/`, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
in the environment (both live in `deploy/.env` on the server).

---

## The bug this pipeline exists to fix

`problems` had 1,608 rows and `problem_test_cases` had **zero**. The judge path
did this:

```ts
// ProblemService.getTestCases() — before
if (!testCases || testCases.length === 0) {
  return this.getDefaultTestCases();   // [{ input: '', expectedOutput: '' }]
}
```

So every submission was judged against **one blank input with a blank expected
output**. `GameService` guards with `testCases.length === 0`, but that fallback
meant the list was never empty — the guard could not fire. Any program that
printed nothing was **accepted**. The game was not judging code at all.

Three fixes, all required:

1. **Import real test cases.** 30,156 rows across 1,600 problems.
2. **Delete the blank-test fallback.** `getDefaultTestCases()` now returns `[]`,
   so a problem with no tests produces `PROBLEM_NOT_FOUND` instead of a free
   pass. Refusing to judge beats judging against nothing.
3. **Judge multi-answer problems properly.** See `judge_safe` below.

---

## Where the data comes from

### open-r1/codeforces — the primary source

9,556 problems, every one of ours included. This is the dataset our `problems`
rows were originally derived from (the description format matches exactly:
`**Difficulty:** / **Time Limit:** / **Tags:** / ## Problem Statement / ...`).

What makes it the right source:

| field | what it gives us |
|---|---|
| `official_tests` | **real Codeforces judge tests** (98% of problems, mean ~22) |
| `examples` | the published samples, shown to players |
| `generated_checker` | a **Python checker** for problems with multiple valid answers |
| `rating`, `contest_start_year` | ratings and recency |
| `executable`, `input_mode` | whether the problem can be run via stdin |

Downloaded into `/tmp/or1/data/` (7 shards, 2.6 GB):

```bash
curl -sS "https://huggingface.co/api/datasets/open-r1/codeforces/parquet/default/train" -o urls.json
```

### deepmind/code_contests — reference solutions only

Still used, but no longer for tests. It is the only source of **accepted
solutions**, which is what lets us verify things. 8,097 Codeforces problems
carry them. Note it was published in 2021, so post-2021 problems have none —
that is the origin of the "no reference solution" cases below.

### codeparserot/apps — the local `train.csv`

APPS. 5,000 problems, only 477 Codeforces, and it overlaps our database by ~25
problems. `difficulty` here is a category (`introductory|interview|competition`),
not a rating. Superseded by open-r1; kept only for historical reference.

> `wc -l train.csv` reports 172,647 lines. That is misleading — quoted fields
> contain embedded newlines. The real row count is **5,000**.

---

## Scripts

Run in this order.

### `import_openr1.py`

```bash
python3 scripts/import_openr1.py --dry-run
python3 scripts/import_openr1.py
```

Replaces every problem's tests with `examples` + `official_tests`, and installs
the real checker where one exists (setting `checker_type = 'custom'`,
`checker_code`, and `judge_safe = true`).

Tests are ordered with `examples` first so `ProblemService`'s "first two are
visible" rule shows the published samples.

Result: **30,156 test rows across 1,600 problems**, 389 checkers installed.
Eight problems are skipped because `input_mode = 'file'` — they cannot be fed
through stdin, which is how the judge works — and they are left out of the pool
rather than given tests the judge cannot use.

### `import_new_problems.py`

```bash
python3 scripts/import_new_problems.py --validate   # prove the description builder
python3 scripts/import_new_problems.py --dry-run
python3 scripts/import_new_problems.py
python3 scripts/classify_problems.py --ids-from new_problem_ids.json
```

Adds problems we do not have yet — **only ones with a real checker**, which is
safe by construction: whatever shape the answer takes, the checker decides.
Everything else is left out until there is a way to prove it is single-answer.

`--validate` regenerates the description of every problem already in the
database and diffs it against what is stored. It reports **1,608/1,608
identical**, so new rows are byte-identical in shape to old ones. (Reproducing
the format exactly required replicating one quirk: problems with no statement
get the literal text `None`, because that is what the original builder emitted.
Such problems are excluded from selection — `None` is not something to show a
player.)

Problems are inserted with `judge_safe = false`; the classifier turns it on only
after the checker is actually proven to behave.

### `classify_problems.py`

```bash
python3 scripts/classify_problems.py --workers 12
python3 scripts/classify_problems.py --apply
python3 scripts/classify_problems.py --apply-from report.json   # replay a report
```

Decides `judge_safe` for every problem. See below.

`--ids-from FILE` restricts the sweep to a JSON list of problem ids, so newly
added problems can be classified without re-running the whole database.

### `validate_test_cases.py`

Spot-checks the imported tests against the dataset's own accepted solutions:
*does a known-correct solution pass?* A wrong `expected_output` is worse than no
test at all, because it marks correct code wrong.

Note the `solutions.language` enum: `1=Python 2.7` (unrunnable under python3),
`2=C++`, `3=Python 3`, `4=Java`. Only `3` is used.

### `verify_live_judge.js`

Runs **inside the deployed backend container** and checks that the real judge
path accepts correct code and rejects wrong code, for both exact-match and
checker problems.

```bash
cd deploy
docker compose exec -u root -T backend mkdir -p /app/scripts
docker compose cp ../backend/scripts/verify_live_judge.js backend:/app/scripts/
docker compose exec -u root -T backend chmod 644 /app/scripts/verify_live_judge.js
docker compose exec -T \
  -e VERIFY_PROBLEM_ID=39 \
  -e VERIFY_SOLUTION_B64="$(base64 -w0 ../ref_solution.py)" \
  backend node scripts/verify_live_judge.js
```

(The image only ships `dist`, so the script has to be copied in. `chmod` is
needed because `docker cp` writes as root and the container runs as `node`.)

---

## Why `judge_safe` exists

`checker_type = 'exact'` means "compare the player's output to one stored
string". That is only valid when the problem has **exactly one** correct output.
Many Codeforces problems accept several ("print any such string", "output the
points in any order"). For those, a completely correct solution is marked
**WRONG ANSWER** — the single most trust-destroying bug a judge can have.

`classify_problems.py` decides `judge_safe` three ways:

| situation | how it is decided | verdict |
|---|---|---|
| a real checker exists | a known-accepted solution is **accepted by the checker** on every test | `verified` |
| no checker, but a reference solution exists | the solution must match the stored output exactly | `verified` / `needs_checker` |
| checker, but no reference solution | **the checker must accept the official answer** on every test | `verified` |

That third rule matters: problems published after CodeContests have no accepted
solutions to test with, but the stored `official_tests` output *is* the official
Codeforces answer, so a correct checker must accept it. A checker that rejects
its own official answer is broken and is discarded.

Every path also requires the checker to **reject an empty submission**. A
checker that accepts everything is worse than no checker, because it makes the
problem unfailable.

Only `verified` problems get `judge_safe = true`, and the column defaults to
`false` — a problem reaches players only by being positively verified. That is
what keeps the 8 untested problems and the 114 unverifiable ones out of the
pool; a `true` default would put them back in front of players with nothing to
judge against, which is the original bug again.

### Checker execution

Checkers are Python programs with the contract

```
python checker.py <input_file> <expected_file> <submission_file>
```

printing a score on the last line: `0` for wrong answer, non-zero for accepted
(`1` and `100` are both common — Codeforces scores out of 100).

They run **inside Judge0**, not in the API process. `CheckerService` correctly
refuses to `eval` checker code in-process (RCE), and Judge0 already provides
cgroup/namespace isolation. The three files are handed over as a ZIP in
`additional_files` (Judge0 extracts it into `/box`) with
`command_line_arguments` supplying argv. `src/utils/zip.ts` writes that ZIP —
STORED entries plus a CRC-32, so no zip dependency is needed.

Two consequences worth remembering:

- Judge0 reports **Accepted** for the checker run itself. The verdict is in the
  checker's **stdout**, never in the status code.
- An unreadable verdict is treated as *not passed*, so a broken checker can
  never silently accept code.

### Which tests are visible

`is_sample` marks the published samples from the problem statement. This used to
be inferred from position (`index >= 2`, "the first two are the samples"), which
is only correct when a problem has at least two examples. It does not: **187
problems have exactly one example** and 5 have none, so in those cases a real
hidden Codeforces judge test was shown to players as a sample.

It is not exploitable — every test must still pass — but it publishes judge data
that Codeforces keeps private, and makes the UI show more examples than the
statement has. `is_sample` now comes from the dataset's `examples` array, which
is the authoritative definition, and defaults to `false` so an un-reimported row
is treated as hidden. Publishing a test is the mistake worth defaulting against.

### Measured effect

```
                      before      after
verified              1211        1471
needs_checker          252          15
unverified               5         114
judge_safe pool       1211        1471
```

`needs_checker` — problems detected as multi-answer that exact match would have
judged wrongly — drops from 252 to 15, because 187 of them now have a real
checker. The `unverified` rise is the honest cost: 101 problems (mostly
post-CodeContests, so with no accepted solution available) have official tests
but neither a checker nor any way to prove they are single-answer. They are
excluded rather than guessed at.

Adding the checker-backed new problems then took it further:

```
                             after migration   + new problems
problems                          1,608            1,750
test cases                       30,156           31,486
problems with a real checker        389              531
judge_safe = true                 1,471            1,618
live pool (rating <= 1200)          552              691
```

---

## Gotchas

- **PostgREST caps a response at 1,000 rows.** Page with a `Range` header
  (`0-999`, `1000-1999`), or you silently get the first 1,000 and think that is
  everything.
- **`g++` on macOS is Apple clang**, which has no `<bits/stdc++.h>`. Almost
  every C++ competitive solution opens with that include, so without
  `scripts/shim/bits/stdc++.h` (added via `-I`) the sweep cannot compile a
  single C++ reference and writes everything off as unverifiable. Harmless on
  Linux, where the real header wins.
- **Python 2 reference solutions are noise.** They raise `SyntaxError`, which
  looks like a problem defect but is not. Filter to language `3`.
- **Fast-IO solutions need real file descriptors on BOTH stdin and stdout.**
  The standard competitive template replaces each with its own `IOBase`
  wrapper via `file.fileno()`. Feeding either one an `io.StringIO` raises
  `UnsupportedOperation: fileno`, which looks like a broken problem but is
  purely a harness artefact. The harness redirects fd 0 and fd 1 to real temp
  files with `os.dup2`, captures stdout by reading fd 1 back, and restores the
  original stdout for its own report.
- **`subprocess` per test is slow.** The Python harness runs all of a problem's
  tests in one interpreter and reports every result as JSON.
- **Workers must `fork`.** `ProcessPoolExecutor` defaults to `spawn` on macOS,
  which hands each worker an empty solutions dict — silently marking the whole
  database `unverified`. The script asserts the start method.
- **Checkers print `100`, not `1`.** Parsing only `1`/`0` silently loses 12
  checkers per 400 problems. Anything non-zero is accepted.

---

## Still on the table

The dataset still holds **7,806 problems we do not have**. Only checker-backed
problems get added, and the rest are deliberately left out:

| why excluded | count |
|---|---|
| no checker (cannot prove single-answer) | 6,614 |
| rated above the 1200 matchmaking cap | 1,078 |
| rated ≤1200 but **fewer than 3 tests** | 77 |
| unrated | 24 |
| `input_mode = file` (not feedable via stdin) | 10 |
| no problem statement | 3 |

The 1,078 above the rating cap are *checker-backed and safe* — they are simply
not servable while matchmaking is capped at 1200. Raising the cap brings them in
for free (`--max-rating 0`).

The 77 with fewer than three tests are the interesting judgement call. They have
checkers and official tests, so they are safe to *judge*, but with one or two
tests a wrong solution can pass. That is leniency rather than false rejection —
still a way to decide a match wrongly, so they are held back. Lower
`--min-tests` to include them.

The real blocker is the 6,614 without a checker: there is no way to prove they
accept only one answer, and ~5% of no-checker problems we *could* measure turned
out to be multi-answer. Closing that needs a source of accepted solutions for
post-2021 problems (open-r1 ships none) or a multi-answer detector.
