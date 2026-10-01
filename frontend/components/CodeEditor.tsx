import React, { useMemo, useRef } from 'react';
import CodeMirror, { EditorView, keymap, Prec } from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { fairPlayEditor, type BlockedKind, type FairPlaySession } from './arena/fairPlay';

interface CodeEditorProps {
  language: string;
  code: string;
  onChange: (value: string) => void;
  /** Mod-Enter (Ctrl/Cmd + Enter) inside the editor */
  onSubmit?: () => void;
  /** Matches against people: own clipboard, outside pastes refused, input counted */
  fairPlay?: FairPlaySession | null;
  onBlocked?: (kind: BlockedKind, chars: number) => void;
}

// Keep vscodeDark's syntax colours; surfaces follow the app's dark "screen" tokens.
const surface = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--screen)', height: '100%' },
    '.cm-scroller': { fontFamily: '"Geist Mono Variable", ui-monospace, monospace', lineHeight: '1.65' },
    '.cm-content': { padding: '12px 0' },
    '.cm-gutters': { backgroundColor: 'var(--screen)', borderRight: '1px solid var(--screen-line)', color: '#5a5a5a' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--screen-fg)' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.035)' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--screen-fail)', borderLeftWidth: '2px' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(255,91,82,0.28) !important',
    },
  },
  { dark: true }
);

const CodeEditor: React.FC<CodeEditorProps> = ({ language, code, onChange, onSubmit, fairPlay, onBlocked }) => {
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const blockedRef = useRef(onBlocked);
  blockedRef.current = onBlocked;

  const extensions = useMemo(() => {
    const lang = language === 'javascript' ? javascript() : language === 'cpp' ? cpp() : python();
    return [
      lang,
      surface,
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              submitRef.current?.();
              return true;
            },
          },
        ])
      ),
      ...(fairPlay ? [fairPlayEditor(fairPlay, language, (kind, chars) => blockedRef.current?.(kind, chars))] : []),
    ];
  }, [language, fairPlay]);

  return (
    <div className="relative h-full w-full overflow-hidden text-[13.5px]">
      <CodeMirror
        value={code}
        height="100%"
        theme={vscodeDark}
        extensions={extensions}
        onChange={onChange}
        aria-label="Code editor"
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
        }}
        className="h-full"
      />
    </div>
  );
};

export default CodeEditor;
