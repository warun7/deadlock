import React, { useMemo, useRef } from 'react';
import CodeMirror, { EditorView, keymap, Prec } from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';

interface CodeEditorProps {
  language: string;
  code: string;
  onChange: (value: string) => void;
  /** Mod-Enter (Ctrl/Cmd + Enter) inside the editor */
  onSubmit?: () => void;
}

// Keep vscodeDark's syntax colours, match surfaces to the app palette.
const surface = EditorView.theme(
  {
    '&': { backgroundColor: '#0e0e11', height: '100%' },
    '.cm-scroller': { fontFamily: '"Geist Mono Variable", ui-monospace, monospace', lineHeight: '1.65' },
    '.cm-content': { padding: '12px 0' },
    '.cm-gutters': { backgroundColor: '#0e0e11', borderRight: '1px solid rgba(255,255,255,0.06)', color: '#55555e' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#a6a6ae' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#ff6369' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(229,72,77,0.28) !important',
    },
  },
  { dark: true }
);

const CodeEditor: React.FC<CodeEditorProps> = ({ language, code, onChange, onSubmit }) => {
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

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
    ];
  }, [language]);

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
