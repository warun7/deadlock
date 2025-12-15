import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';

interface CodeEditorProps {
  language: string;
  code: string;
  onChange: (value: string) => void;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ language, code, onChange }) => {
  
  // Memoize extensions to prevent unnecessary re-renders
  const extensions = useMemo(() => {
    switch (language) {
      case 'python':
        return [python()];
      case 'javascript':
        return [javascript()];
      case 'cpp':
        return [cpp()];
      default:
        return [python()];
    }
  }, [language]);

  return (
    <div className="relative w-full h-full font-mono text-sm overflow-hidden bg-[#1e1e1e]">
       <CodeMirror
          value={code}
          height="100%"
          theme={vscodeDark}
          extensions={extensions}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            dropCursor: false,
            allowMultipleSelections: false,
            indentOnInput: false,
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