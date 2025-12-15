import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Play, CheckCircle, XCircle, Terminal, Maximize2, RotateCcw, Clock, ChevronDown, AlertCircle, Loader2, Trophy } from 'lucide-react';
import CodeEditor from '../components/CodeEditor';
import { gameSocket } from '../lib/socket';

const LANGUAGE_IDS = {
  python: 71,
  javascript: 63,
  cpp: 54
};

const STARTER_CODE = {
  python: `# Write your solution here
def solve():
    pass

if __name__ == '__main__':
    solve()`,
  javascript: `// Write your solution here
function solve() {
    
}

solve();`,
  cpp: `#include <iostream>
using namespace std;

int main() {
    // Write your solution here
    return 0;
}`
};

type Language = keyof typeof STARTER_CODE;

const RealGameArena: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const matchData = location.state?.matchData;

  const [language, setLanguage] = useState<Language>('python');
  const [code, setCode] = useState(STARTER_CODE.python);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<any>(null);
  const [opponentProgress, setOpponentProgress] = useState<string>('Idle');
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);

  useEffect(() => {
    if (!matchData) {
      console.error('No match data, redirecting...');
      navigate('/dashboard');
      return;
    }

    const socket = gameSocket.getSocket();
    if (!socket) {
      console.error('Socket not connected');
      navigate('/dashboard');
      return;
    }

    // Listen for submission results
    socket.on('submission_result', (result) => {
      console.log('Submission result:', result);
      setSubmissionResult(result);
      setIsSubmitting(false);
    });

    // Listen for opponent progress
    socket.on('opponent_progress', (data) => {
      console.log('Opponent progress:', data);
      setOpponentProgress(data.status);
    });

    // Listen for game over
    socket.on('game_over', (data) => {
      console.log('Game over:', data);
      setGameOver(true);
      setWinner(data.winnerId);
      
      // Navigate back after delay
      setTimeout(() => {
        navigate('/dashboard');
      }, 5000);
    });

    socket.on('error', (data) => {
      console.error('Socket error:', data);
      alert(data.message);
    });

    return () => {
      socket.off('submission_result');
      socket.off('opponent_progress');
      socket.off('game_over');
      socket.off('error');
    };
  }, [matchData, navigate]);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    setCode(STARTER_CODE[lang]);
    setIsLangMenuOpen(false);
  };

  const handleSubmit = () => {
    if (!gameSocket.isConnected()) {
      alert('Not connected to server');
      return;
    }

    setIsSubmitting(true);
    setSubmissionResult(null);
    
    gameSocket.submitCode(code, LANGUAGE_IDS[language]);
  };

  if (gameOver) {
    return (
      <div className="fixed inset-0 z-50 bg-[#050505] flex items-center justify-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center"
        >
          <Trophy className="w-24 h-24 mx-auto mb-6 text-yellow-500" />
          <h1 className="text-6xl font-black text-white mb-4">
            {winner === 'YOU' ? 'VICTORY!' : 'DEFEAT'}
          </h1>
          <p className="text-stone-400">Returning to dashboard...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-[#050505] flex flex-col font-mono overflow-hidden">
      {/* Game Header */}
      <div className="h-14 border-b border-stone-800 bg-[#0a0a0a] flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-4">
          <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-sm uppercase">Ranked Match</div>
          <div className="flex items-center gap-2 text-stone-400 text-xs">
            <Clock className="w-3 h-3" />
            <span>LIVE</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-stone-500">
            Opponent: <span className="text-white">{opponentProgress}</span>
          </div>
          <button 
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold px-4 py-1.5 rounded-sm flex items-center gap-2 transition-colors"
          >
            {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
            SUBMIT
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Panel: Problem */}
        <div className="w-1/2 border-r border-stone-800 flex flex-col bg-[#050505]">
          <div className="flex border-b border-stone-800">
            <button className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-white border-b-2 border-red-600 bg-stone-900/50">
              Description
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            <div className="flex justify-between items-start mb-6">
              <h1 className="text-2xl font-black text-white uppercase tracking-tight">
                {matchData?.problem?.title || 'Loading...'}
              </h1>
              <span className="text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded text-[10px] font-bold">
                {matchData?.problem?.difficulty || 'MEDIUM'}
              </span>
            </div>

            <div className="prose prose-invert prose-sm max-w-none text-stone-400">
              <div dangerouslySetInnerHTML={{ __html: matchData?.problem?.description || 'Loading problem...' }} />
            </div>
          </div>
        </div>

        {/* Right Panel: Editor & Results */}
        <div className="w-1/2 flex flex-col h-full bg-[#080808]">
          
          {/* Code Editor Header */}
          <div className="h-10 bg-[#0a0a0a] border-b border-stone-800 flex items-center justify-between px-4">
            <div className="relative">
              <button 
                onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                className="flex items-center gap-2 text-[10px] text-stone-400 hover:text-white font-bold uppercase transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                {language === 'cpp' ? 'C++' : language}
                <ChevronDown className="w-3 h-3" />
              </button>
              
              {isLangMenuOpen && (
                <div className="absolute top-full left-0 mt-2 w-32 bg-[#0a0a0a] border border-stone-800 rounded-sm shadow-xl z-50 py-1">
                  {Object.keys(STARTER_CODE).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => handleLanguageChange(lang as Language)}
                      className={`w-full text-left px-3 py-2 text-[10px] font-bold uppercase hover:bg-stone-900 ${language === lang ? 'text-red-500' : 'text-stone-400'}`}
                    >
                      {lang === 'cpp' ? 'C++' : lang}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button 
                onClick={() => setCode(STARTER_CODE[language])}
                className="text-stone-600 hover:text-white transition-colors" 
                title="Reset Code"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Code Editor Area */}
          <div className="flex-1 relative overflow-hidden bg-[#0c0c0c]">
            <CodeEditor language={language} code={code} onChange={setCode} />
          </div>

          {/* Results Area */}
          <div className="h-48 bg-[#050505] flex flex-col border-t border-stone-800">
            <div className="h-8 border-b border-stone-800 flex items-center px-2">
              <button className="flex items-center gap-2 px-3 h-full text-[10px] font-bold border-b text-white border-stone-600">
                <Terminal className="w-3 h-3" />
                Submission Results
              </button>
            </div>

            <div className="flex-1 p-4 overflow-auto font-mono text-xs">
              {isSubmitting ? (
                <div className="flex items-center gap-2 text-stone-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting to backend...
                </div>
              ) : submissionResult ? (
                <div className="space-y-3">
                  {submissionResult.status === 'accepted' ? (
                    <div className="flex items-center gap-2 text-emerald-500 font-bold">
                      <CheckCircle className="w-4 h-4" />
                      Accepted ({submissionResult.passed}/{submissionResult.total} tests passed)
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-red-500 font-bold">
                      <XCircle className="w-4 h-4" />
                      {submissionResult.status} ({submissionResult.passed}/{submissionResult.total} tests passed)
                    </div>
                  )}

                  {submissionResult.stderr && (
                    <div className="bg-stone-900/50 p-2 rounded-sm border border-red-900/50">
                      <span className="text-stone-500 block text-[10px] uppercase mb-1">Error</span>
                      <pre className="text-red-400 whitespace-pre-wrap">{submissionResult.stderr}</pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-stone-600 italic">
                  Submit your code to see results...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RealGameArena;
