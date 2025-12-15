import React from 'react';
import ThreeDTilt from './ThreeDTilt';
import GameCard from './GameCard';
import GlitchText from './GlitchText';
import { Play, Terminal, Cpu, Globe, Crosshair } from 'lucide-react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface HeroProps {
  onStart: () => void;
}

const Hero: React.FC<HeroProps> = ({ onStart }) => {
  const { scrollY } = useScroll();
  const yBg = useTransform(scrollY, [0, 500], [0, 100]);
  const rotate = useTransform(scrollY, [0, 500], [0, 10]);

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center pt-8 overflow-hidden bg-[#050505]">
      {/* Dynamic Tunnel Background */}
      <div className="absolute inset-0 overflow-hidden perspective-1000">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:60px_60px] [transform:rotateX(75deg)_translateY(-50%)_scale(3)] animate-grid origin-top"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-[#050505] via-transparent to-[#050505]"></div>
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,transparent_0%,#050505_90%)]"></div>
      </div>
      
      {/* Massive Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[40vh] bg-red-600/20 blur-[150px] rounded-full pointer-events-none animate-pulse"></div>

      <div className="relative z-20 w-full max-w-7xl mx-auto px-4 flex flex-col items-center justify-center">
        
        {/* Minimal Text Header */}
        <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-8 md:mb-12"
        >
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border border-red-900/40 bg-red-950/30 text-red-400 text-[10px] font-mono uppercase tracking-widest backdrop-blur-md">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
              System Online
            </div>
            
            <h1 className="text-7xl md:text-[10rem] font-black text-white leading-[0.8] tracking-tighter font-mono mix-blend-difference">
              <GlitchText text="DEAD" />
              <GlitchText text="LOCK" className="text-red-600" />
            </h1>
            
            <p className="mt-6 text-stone-400 font-mono tracking-[0.2em] text-sm md:text-base uppercase">
              Competitve Coding <span className="text-red-500">//</span> 1v1 Ladder
            </p>
        </motion.div>

        {/* 3D Battle Scene */}
        <motion.div 
          style={{ y: yBg, rotateX: rotate }}
          className="relative w-full max-w-5xl h-[300px] md:h-[400px] perspective-2000 flex items-center justify-center"
        >
           {/* Center Ring System */}
           <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
             <div className="w-[300px] h-[300px] md:w-[500px] md:h-[500px] border border-stone-800/60 rounded-full animate-[spin_30s_linear_infinite]"></div>
             <div className="absolute w-[250px] h-[250px] md:w-[400px] md:h-[400px] border border-dashed border-red-900/40 rounded-full animate-[spin_20s_linear_infinite_reverse]"></div>
             <div className="absolute w-[600px] h-[1px] bg-gradient-to-r from-transparent via-red-500/20 to-transparent"></div>
           </div>

           {/* VS Badge */}
           <div className="absolute z-50 w-16 h-16 md:w-24 md:h-24 bg-[#0a0a0a] rounded-full border-2 border-red-600 flex items-center justify-center shadow-[0_0_50px_rgba(220,38,38,0.5)]">
              <span className="font-black text-2xl md:text-4xl italic text-white">VS</span>
           </div>

           {/* Player 1 Card (Left) */}
           <motion.div 
              initial={{ x: -200, opacity: 0, rotateY: 30 }}
              animate={{ x: 0, opacity: 1, rotateY: 15 }}
              transition={{ duration: 1, delay: 0.2 }}
              className="absolute left-0 md:left-20 top-1/2 -translate-y-1/2 z-30 hidden md:block"
           >
             <ThreeDTilt intensity={20}>
               <div className="scale-75 md:scale-90 origin-right">
                 <GameCard 
                   title="Graph Traversal" 
                   difficulty="Nightmare" 
                   ratingChange={32} 
                   description="DFS Algorithm"
                   tags={['Graph', 'DP']}
                   codeSnippet={`fn solve() {\n  // Analyzing...\n}`}
                   players={1.2}
                 />
               </div>
             </ThreeDTilt>
           </motion.div>

           {/* Player 2 Card (Right) */}
           <motion.div 
              initial={{ x: 200, opacity: 0, rotateY: -30 }}
              animate={{ x: 0, opacity: 1, rotateY: -15 }}
              transition={{ duration: 1, delay: 0.2 }}
              className="absolute right-0 md:right-20 top-1/2 -translate-y-1/2 z-20 hidden md:block"
           >
             <ThreeDTilt intensity={20}>
               <div className="scale-75 md:scale-90 grayscale-[50%] hover:grayscale-0 transition-all origin-left">
                 <GameCard 
                   title="Binary Search" 
                   difficulty="Medium" 
                   ratingChange={-18} 
                   description="Find Element"
                   tags={['Search']}
                   codeSnippet={`class Solution:\n  def search(x):`}
                   players={4.5}
                 />
               </div>
             </ThreeDTilt>
           </motion.div>

           {/* Mobile Placeholder for Cards */}
           <div className="md:hidden relative z-30">
              <div className="scale-75">
                  <GameCard 
                       title="Graph Traversal" 
                       difficulty="Nightmare" 
                       ratingChange={32} 
                       description="DFS Algorithm"
                       tags={['Graph', 'DP']}
                       codeSnippet={`fn solve() {\n  // Analyzing...\n}`}
                       players={1.2}
                     />
              </div>
           </div>
        </motion.div>

        {/* Action Bar */}
        <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1 }}
            className="mt-8 md:mt-10 flex flex-col items-center gap-6 z-40"
        >
            <button 
              onClick={onStart}
              className="group relative w-64 h-16 bg-white flex items-center justify-between px-6 rounded-sm overflow-hidden hover:scale-105 transition-transform duration-200"
            >
                <div className="absolute inset-0 bg-red-600 translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-300 ease-out z-0"></div>
                <span className="relative z-10 font-black text-xl uppercase tracking-tighter text-black group-hover:text-white transition-colors">
                    Start Match
                </span>
                <Crosshair className="relative z-10 w-6 h-6 text-black group-hover:text-white transition-colors animate-[spin_3s_linear_infinite]" />
            </button>
            
            <p className="text-[10px] text-stone-600 font-mono uppercase tracking-widest flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                14,203 Players Online
            </p>
        </motion.div>

      </div>
    </div>
  );
};

export default Hero;