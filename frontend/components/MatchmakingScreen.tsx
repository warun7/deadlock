import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, Server, Shield, Globe } from 'lucide-react';
import GlitchText from './GlitchText';

interface MatchmakingScreenProps {
  onMatchFound: () => void;
}

const MatchmakingScreen: React.FC<MatchmakingScreenProps> = ({ onMatchFound }) => {
  const [status, setStatus] = useState<'searching' | 'found'>('searching');
  const [timer, setTimer] = useState(0);
  const [logIndex, setLogIndex] = useState(0);

  const logs = [
    "Handshake initiated...",
    "Verifying integrity...",
    "Scanning US-EAST nodes...",
    "Ping check: 24ms",
    "Allocating isolated container...",
    "Opponent found.",
    "Synchronizing..."
  ];

  useEffect(() => {
    // Timer
    const timerInterval = setInterval(() => {
        setTimer(t => t + 1);
    }, 1000);

    // Log rotator
    const logInterval = setInterval(() => {
        setLogIndex(i => (i + 1) % logs.length);
    }, 800);

    // Mock match found after 4 seconds
    const matchTimeout = setTimeout(() => {
        setStatus('found');
        clearInterval(timerInterval);
        clearInterval(logInterval);
        
        // Transition to game after animation
        setTimeout(() => {
            onMatchFound();
        }, 3000);
    }, 4500);

    return () => {
        clearInterval(timerInterval);
        clearInterval(logInterval);
        clearTimeout(matchTimeout);
    };
  }, [onMatchFound]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center font-mono">
       
       <AnimatePresence>
         {status === 'searching' ? (
            <motion.div 
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex flex-col items-center relative"
            >
                {/* Radar Ring */}
                <div className="relative w-64 h-64 md:w-96 md:h-96 border border-stone-800 rounded-full flex items-center justify-center mb-12">
                    <div className="absolute inset-0 border-2 border-red-900/30 rounded-full animate-[ping_2s_linear_infinite]"></div>
                    <div className="absolute inset-0 border-t-2 border-red-600 rounded-full animate-[radar-spin_3s_linear_infinite]"></div>
                    <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(220,38,38,0.1)_0%,transparent_70%)]"></div>
                    
                    <div className="text-center z-10">
                        <div className="text-4xl font-black text-white mb-2 font-mono tracking-widest">{formatTime(timer)}</div>
                        <div className="text-xs text-red-500 uppercase tracking-widest animate-pulse">Searching</div>
                    </div>
                </div>

                {/* Status Logs */}
                <div className="w-80 h-32 overflow-hidden border-l-2 border-red-900 pl-4 relative">
                    <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-[#050505] via-transparent to-[#050505] z-10"></div>
                    <div className="space-y-2">
                        {logs.map((log, i) => (
                            <div key={i} className={`text-xs ${i === logIndex ? 'text-red-400' : 'text-stone-700'}`}>
                                {'> '}{log}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-8 flex gap-8 text-stone-600 text-xs uppercase tracking-widest">
                    <div className="flex items-center gap-2">
                        <Server className="w-4 h-4" />
                        US-EAST-1
                    </div>
                    <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        GLOBAL
                    </div>
                </div>
            </motion.div>
         ) : (
            <motion.div 
                initial={{ opacity: 0, scale: 1.5 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative flex flex-col items-center justify-center w-full h-full"
            >
                {/* Impact Flash */}
                <motion.div 
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    className="absolute inset-0 bg-red-600 z-0"
                />

                <div className="relative z-10 text-center">
                    <h1 className="text-6xl md:text-9xl font-black text-white italic tracking-tighter mb-4 mix-blend-difference">
                        <GlitchText text="MATCH" /> <br/>
                        <span className="text-red-600">FOUND</span>
                    </h1>
                    
                    <div className="flex items-center justify-center gap-12 mt-12">
                        <div className="text-center">
                            <div className="w-24 h-24 bg-stone-900 rounded-full border-2 border-white flex items-center justify-center mb-4">
                                <span className="text-2xl font-bold">YOU</span>
                            </div>
                            <div className="text-sm font-bold text-white">1402 ELO</div>
                        </div>

                        <div className="text-4xl font-black text-red-600 italic">VS</div>

                        <div className="text-center">
                            <div className="w-24 h-24 bg-stone-900 rounded-full border-2 border-red-600 flex items-center justify-center mb-4 relative overflow-hidden">
                                <div className="absolute inset-0 bg-red-900/20 animate-pulse"></div>
                                <span className="text-2xl font-bold text-red-500">?</span>
                            </div>
                            <div className="text-sm font-bold text-stone-400">HIDDEN</div>
                        </div>
                    </div>

                    <p className="mt-12 text-stone-500 font-mono text-sm uppercase tracking-[0.3em] animate-pulse">
                        Allocating Server Resources...
                    </p>
                </div>
            </motion.div>
         )}
       </AnimatePresence>
    </div>
  );
};

export default MatchmakingScreen;