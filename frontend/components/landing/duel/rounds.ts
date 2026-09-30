import type { Lang } from "./highlight";

/*
  Scripted rounds for the hero duel. Sample data for illustration: the
  opponent's code carries a real bug so the failure the viewer sees is honest.
*/
export interface DuelPlayer {
  name: string;
  lang: Lang;
  langLabel: string;
  code: string;
  /** Characters per second while typing */
  cps: number;
  /** Per-test outcome when this player submits (true = pass) */
  results: boolean[];
  verdict: string;
}

export interface DuelRound {
  problem: string;
  rating: number;
  /** Match clock shown at the end of the round, in seconds */
  finishClock: number;
  you: DuelPlayer;
  them: DuelPlayer;
}

const pass = (n: number) => Array.from({ length: n }, () => true);

export const ROUNDS: DuelRound[] = [
  {
    problem: "Balanced Brackets",
    rating: 1100,
    finishClock: 4 * 60 + 12,
    you: {
      name: "you",
      lang: "python",
      langLabel: "Python",
      cps: 62,
      code: `import sys

s = sys.stdin.readline().strip()
bal = need = 0
for c in s:
    bal += 1 if c == "(" else -1
    if bal < 0:
        need += 1
        bal = 0
print(need + bal)`,
      results: pass(10),
      verdict: "Accepted",
    },
    them: {
      name: "kestrel_dp",
      lang: "cpp",
      langLabel: "C++",
      cps: 78,
      code: `#include <bits/stdc++.h>
using namespace std;

int main() {
  string s; cin >> s;
  int bal = 0, need = 0;
  for (char c : s) {
    bal += c == '(' ? 1 : -1;
    if (bal < 0) need++, bal = 0;
  }
  cout << need << "\\n";
}`,
      // forgets the unmatched "(" left in bal
      results: [true, true, true, true, true, true, true, false, true, false],
      verdict: "Wrong answer on test 8",
    },
  },
  {
    problem: "Best Streak Sum",
    rating: 1200,
    finishClock: 5 * 60 + 37,
    you: {
      name: "you",
      lang: "cpp",
      langLabel: "C++",
      cps: 66,
      code: `#include <bits/stdc++.h>
using namespace std;

int main() {
  int n; cin >> n;
  long long best = LLONG_MIN, cur = 0;
  for (int i = 0; i < n; i++) {
    long long x; cin >> x;
    cur = max(x, cur + x);
    best = max(best, cur);
  }
  cout << best;
}`,
      results: pass(10),
      verdict: "Accepted",
    },
    them: {
      name: "vexmire",
      lang: "python",
      langLabel: "Python",
      cps: 70,
      code: `n = int(input())
a = list(map(int, input().split()))
best = a[0]
for i in range(n):
    for j in range(i, n):
        best = max(best, sum(a[i:j+1]))
print(best)`,
      // O(n^3) passes the small tests, times out on the big ones
      results: [true, true, true, true, true, true, false, false, false, false],
      verdict: "Time limit exceeded on test 7",
    },
  },
];
