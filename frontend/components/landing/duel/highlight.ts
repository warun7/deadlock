/**
 * Tiny syntax highlighter for the hero duel. Colours follow the in-game
 * editor theme (vscodeDark) so the preview matches the real arena.
 */
export type Lang = "python" | "cpp";

export interface Token {
  text: string;
  cls: string;
}

const KEYWORDS: Record<Lang, Set<string>> = {
  python: new Set(["import", "from", "for", "in", "if", "else", "elif", "while", "return", "def", "print", "range", "int", "input", "list", "map", "max", "min", "sum", "len", "and", "or", "not"]),
  cpp: new Set(["int", "long", "char", "string", "for", "if", "else", "while", "return", "using", "namespace", "auto", "const", "void", "bool"]),
};

const CONTROL: Record<Lang, Set<string>> = {
  python: new Set(["import", "from", "for", "in", "if", "else", "elif", "while", "return"]),
  cpp: new Set(["for", "if", "else", "while", "return"]),
};

const BUILTINS: Record<Lang, Set<string>> = {
  python: new Set(["print", "range", "int", "input", "list", "map", "max", "min", "sum", "len"]),
  cpp: new Set(["std", "cin", "cout", "max", "min", "LLONG_MIN"]),
};

const PATTERN = /(\/\/[^\n]*|#include[^\n]*|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_])/g;

export function tokenize(code: string, lang: Lang): Token[] {
  const out: Token[] = [];
  PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATTERN.exec(code))) {
    const [text, comment, str, num, ident, space] = m;
    let cls = "text-[#d4d4d4]";
    if (comment) cls = comment.startsWith("#include") ? "text-[#c586c0]" : "text-[#6a9955]";
    else if (str) cls = "text-[#ce9178]";
    else if (num) cls = "text-[#b5cea8]";
    else if (ident) {
      if (CONTROL[lang].has(ident)) cls = "text-[#c586c0]";
      else if (BUILTINS[lang].has(ident)) cls = "text-[#dcdcaa]";
      else if (KEYWORDS[lang].has(ident)) cls = "text-[#569cd6]";
      else cls = "text-[#9cdcfe]";
    } else if (space) cls = "";
    out.push({ text, cls });
  }
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML for the first `count` characters of a tokenized program, plus an optional typo tail. */
export function renderPrefix(tokens: Token[], count: number, typo = ""): string {
  let html = "";
  let left = count;
  for (const t of tokens) {
    if (left <= 0) break;
    const piece = t.text.length <= left ? t.text : t.text.slice(0, left);
    left -= piece.length;
    html += t.cls ? `<span class="${t.cls}">${escapeHtml(piece)}</span>` : escapeHtml(piece);
  }
  if (typo) html += `<span class="text-[#d4d4d4]">${escapeHtml(typo)}</span>`;
  return html;
}
