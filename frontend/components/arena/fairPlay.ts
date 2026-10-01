import { Annotation, EditorState, EditorView, type Extension, type Transaction } from "@uiw/react-codemirror";

/*
  Fair play in the editor, for matches against people (not Practice).

  The editor keeps its own clipboard: copy, cut and paste work inside it, but
  nothing from outside comes in and match code never reaches the system
  clipboard. Outside pastes, drops and large inserts that typing cannot
  produce are refused and reported.

  It also counts how the code was entered: characters typed (keys,
  autocomplete, undo) and characters pasted from its own clipboard, per
  language, plus the rhythm of single keystrokes. Sent with each submission,
  so the server can tell code that was typed from code that appeared.
*/

/** Non-whitespace characters in one insert that typing never produces */
const BULK_INSERT_CHARS = 40;
/** Gaps longer than this are thinking, not typing rhythm */
const MAX_KEYSTROKE_GAP_MS = 1500;

export type BlockedKind = "paste" | "drop" | "bulk";

export interface SubmissionTelemetry {
  typedChars: number;
  pastedChars: number;
  baseChars: number;
  keystrokeIntervals: number;
  intervalMeanMs: number;
  intervalStdMs: number;
}

interface Saved {
  typed: Record<string, number>;
  pasted: Record<string, number>;
  iv: { n: number; mean: number; m2: number };
}

const storageKey = (matchId: string) => `deadlock:fairplay:${matchId}`;
const normalize = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");

/** One match's editor clipboard and counters. Counters survive a refresh. */
export class FairPlaySession {
  clipboard: string | null = null;
  private seenOutside = new Set<string>();
  private typed: Record<string, number> = {};
  private pasted: Record<string, number> = {};
  // Welford running mean and variance of keystroke gaps
  private iv = { n: 0, mean: 0, m2: 0 };
  private lastKeyAt = -Infinity;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly matchId: string) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(matchId)) || "null") as Saved | null;
      if (saved) {
        this.typed = saved.typed ?? {};
        this.pasted = saved.pasted ?? {};
        this.iv = saved.iv ?? this.iv;
      }
    } catch {
      /* storage blocked or corrupt: start counting from here */
    }
  }

  /** Characters entered: typed (keys, autocomplete, undo) or pasted from the editor's own clipboard */
  recordInput(lang: string, typed: number, pasted: number, keystroke: boolean) {
    if (typed) this.typed[lang] = (this.typed[lang] ?? 0) + typed;
    if (pasted) this.pasted[lang] = (this.pasted[lang] ?? 0) + pasted;
    if (keystroke) {
      const now = performance.now();
      const gap = now - this.lastKeyAt;
      this.lastKeyAt = now;
      if (gap > 0 && gap < MAX_KEYSTROKE_GAP_MS) {
        this.iv.n += 1;
        const delta = gap - this.iv.mean;
        this.iv.mean += delta / this.iv.n;
        this.iv.m2 += delta * (gap - this.iv.mean);
      }
    }
    this.scheduleSave();
  }

  /**
   * Whether a refused paste counts as an attempt to bring outside text in.
   * Without anything copied in the editor, the paste can only have meant the
   * outside text. With something copied, the editor pastes that instead, and
   * the system clipboard usually just holds something stale from before the
   * match; only text that shows up there new during the match counts.
   */
  isOutsideAttempt(text: string): boolean {
    const t = normalize(text);
    if (!t.trim()) return false;
    if (this.clipboard !== null && normalize(this.clipboard) === t) return false;
    const firstEver = this.seenOutside.size === 0;
    const isNew = !this.seenOutside.has(t);
    if (this.seenOutside.size < 50) this.seenOutside.add(t);
    if (this.clipboard === null) return true;
    return isNew && !firstEver;
  }

  telemetry(lang: string, baseChars: number): SubmissionTelemetry {
    const std = this.iv.n > 1 ? Math.sqrt(this.iv.m2 / (this.iv.n - 1)) : 0;
    return {
      typedChars: this.typed[lang] ?? 0,
      pastedChars: this.pasted[lang] ?? 0,
      baseChars,
      keystrokeIntervals: this.iv.n,
      intervalMeanMs: Math.round(this.iv.mean * 10) / 10,
      intervalStdMs: Math.round(std * 10) / 10,
    };
  }

  /** The match is over */
  clear() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.clipboard = null;
    try {
      localStorage.removeItem(storageKey(this.matchId));
    } catch {
      /* ignore */
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const saved: Saved = { typed: this.typed, pasted: this.pasted, iv: this.iv };
        localStorage.setItem(storageKey(this.matchId), JSON.stringify(saved));
      } catch {
        /* storage full or blocked: counts restart after a refresh */
      }
    }, 500);
  }
}

/** Marks the editor's own paste, which the filter below lets through */
const fromEditorClipboard = Annotation.define<boolean>();

function insertedText(tr: Transaction): string {
  let text = "";
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    text += inserted.toString();
  });
  return text;
}

/** Copy or cut into the editor's own clipboard; the system clipboard is left alone */
function keepCopy(event: ClipboardEvent, view: EditorView, session: FairPlaySession, cut: boolean): boolean {
  const { state } = view;
  const ranges = state.selection.ranges;
  const changes: { from: number; to: number }[] = [];
  let text: string;
  if (ranges.every((r) => r.empty)) {
    // Nothing selected: the whole line, as CodeMirror does
    const lines: string[] = [];
    let lastLine = -1;
    for (const r of ranges) {
      const line = state.doc.lineAt(r.head);
      if (line.number === lastLine) continue;
      lastLine = line.number;
      lines.push(line.text);
      changes.push({ from: line.from, to: Math.min(state.doc.length, line.to + 1) });
    }
    text = lines.join(state.lineBreak) + state.lineBreak;
  } else {
    const selected = ranges.filter((r) => !r.empty);
    text = selected.map((r) => state.sliceDoc(r.from, r.to)).join(state.lineBreak);
    for (const r of selected) changes.push({ from: r.from, to: r.to });
  }
  session.clipboard = text;
  event.preventDefault();
  if (cut && !state.readOnly) view.dispatch({ changes, userEvent: "delete.cut", scrollIntoView: true });
  return true;
}

export function fairPlayEditor(
  session: FairPlaySession,
  lang: string,
  onBlocked: (kind: BlockedKind, chars: number) => void
): Extension {
  // Report outside the transaction that is being refused
  const blocked = (kind: BlockedKind, chars: number) => queueMicrotask(() => onBlocked(kind, chars));

  return [
    EditorView.domEventHandlers({
      copy: (event, view) => keepCopy(event, view, session, false),
      cut: (event, view) => keepCopy(event, view, session, true),
      paste: (event, view) => {
        event.preventDefault();
        const outside = event.clipboardData?.getData("text/plain") ?? "";
        if (session.isOutsideAttempt(outside)) blocked("paste", outside.length);
        if (session.clipboard !== null && !view.state.readOnly) {
          view.dispatch(view.state.replaceSelection(session.clipboard), {
            userEvent: "input.paste",
            annotations: fromEditorClipboard.of(true),
            scrollIntoView: true,
          });
        }
        return true;
      },
      drop: (event) => {
        event.preventDefault();
        const text = event.dataTransfer?.getData("text/plain") ?? "";
        if (text.trim()) blocked("drop", text.length);
        return true;
      },
      // Dragging code out of the editor is copying it out
      dragstart: (event) => {
        event.preventDefault();
        return true;
      },
    }),

    // Backstop for paths that skip the paste event (some mobile keyboards'
    // clipboard bars, input injected by extensions): refuse them here
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged || tr.annotation(fromEditorClipboard)) return tr;
      if (tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop")) {
        blocked(tr.isUserEvent("input.drop") ? "drop" : "paste", insertedText(tr).length);
        return [];
      }
      // Autocomplete may insert a whole snippet; anything else this big is not typing
      if (tr.isUserEvent("input") && !tr.isUserEvent("input.complete")) {
        const text = insertedText(tr);
        if (text.replace(/\s/g, "").length > BULK_INSERT_CHARS) {
          blocked("bulk", text.length);
          return [];
        }
      }
      return tr;
    }),

    EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) {
        if (!tr.docChanged) continue;
        const n = insertedText(tr).length;
        if (!n) continue;
        if (tr.annotation(fromEditorClipboard)) {
          session.recordInput(lang, 0, n, false);
        } else if (tr.isUserEvent("input") || tr.isUserEvent("undo") || tr.isUserEvent("redo")) {
          session.recordInput(lang, n, 0, tr.isUserEvent("input.type") && n === 1);
        }
      }
    }),
  ];
}
