import React from 'react';
import { CardProps } from '../types';
import { Trophy, Hash, Activity, Timer, Code2, Terminal } from 'lucide-react';

const difficultyConfig = {
  Easy: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/20' },
  Medium: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', glow: 'shadow-yellow-500/20' },
  Hard: { color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/30', glow: 'shadow-orange-500/20' },
  Nightmare: { color: 'text-red-500', bg: 'bg-red-600/10', border: 'border-red-600/30', glow: 'shadow-[0_0_30px_rgba(220,38,38,0.3)]' }
};

const GameCard: React.FC<CardProps> = ({ title, difficulty, ratingChange, description, tags, codeSnippet, players }) => {
  const config = difficultyConfig[difficulty];

  return (
    <div className={`relative w-72 h-[420px] rounded-sm border ${config.border} bg-[#0a0a0a] flex flex-col overflow-hidden group transition-all duration-500 hover:shadow-2xl ${config.glow}`}>
      
      {/* Scanline Effect */}
      <div className="absolute inset-0 z-20 pointer-events-none opacity-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-50 background-size-[100%_2px,3px_100%]"></div>
      <div className="absolute inset-0 z-20 pointer-events-none bg-gradient-to-b from-white/5 to-transparent h-2 animate-[scanline_3s_linear_infinite] opacity-20"></div>

      {/* Header */}
      <div className="w-full p-3 border-b border-white/5 bg-black/40 flex justify-between items-center backdrop-blur-sm z-10">
        <div className={`flex items-center gap-2 px-2 py-1 rounded-sm border ${config.border} ${config.bg}`}>
          <Terminal className={`w-3 h-3 ${config.color}`} />
          <span className={`text-[10px] font-bold uppercase tracking-widest ${config.color}`}>
            {difficulty}
          </span>
        </div>
        <div className="flex items-center gap-1 text-yellow-500 font-mono text-xs font-bold">
          <Trophy className="w-3 h-3" />
          <span>+{ratingChange} RP</span>
        </div>
      </div>

      {/* Code/Visual Area */}
      <div className="w-full flex-grow relative bg-[#050505] p-4 overflow-hidden group-hover:bg-black transition-colors duration-300">
         {/* Grid Background */}
         <div className="absolute inset-0 bg-[linear-gradient(to_right,#222_1px,transparent_1px),linear-gradient(to_bottom,#222_1px,transparent_1px)] bg-[size:20px_20px] opacity-20"></div>
         
         {/* Code Content */}
         <div className="relative z-10 font-mono text-[10px] leading-loose text-stone-400">
            <div className="flex justify-between mb-4 opacity-50 text-[8px] uppercase tracking-widest">
               <span>main.rs</span>
               <span>Ln 42, Col 12</span>
            </div>
            <pre className={`${config.color} opacity-80 transition-all duration-300 group-hover:scale-105 group-hover:opacity-100 group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]`}>
              {codeSnippet || `class Solution:\n  def solve(self, nums):\n    # Write your code\n    # O(n log n)\n    pass`}
            </pre>
         </div>
         
         {/* Dynamic Element */}
         <div className="absolute bottom-4 right-4 animate-pulse">
            <Activity className={`w-16 h-16 ${config.color} opacity-10 transform -rotate-12`} />
         </div>
      </div>

      {/* Content */}
      <div className="w-full bg-[#080808] p-5 z-10 border-t border-white/5 relative">
        <div className="absolute -top-3 right-4 bg-stone-900 border border-stone-700 px-2 py-0.5 text-[9px] text-stone-400 uppercase tracking-widest">
           Live Match
        </div>

        <h3 className="text-lg font-bold text-white mb-2 truncate font-mono tracking-tight">{title}</h3>
        <p className="text-xs text-stone-500 font-medium leading-relaxed mb-4 line-clamp-2">{description}</p>
        
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.map(tag => (
            <span key={tag} className="text-[9px] text-stone-400 bg-stone-900/80 px-2 py-1 rounded-sm border border-stone-800 hover:border-stone-600 transition-colors cursor-default">
              {tag}
            </span>
          ))}
        </div>

        <div className="flex justify-between items-center text-[10px] text-stone-600 font-mono border-t border-stone-900/50 pt-3 uppercase tracking-wider">
           <div className="flex items-center gap-1.5">
             <Hash className="w-3 h-3" />
             <span>ID: 8X92</span>
           </div>
           <div className="flex items-center gap-1.5 text-red-400/70">
             <Timer className="w-3 h-3" />
             <span>{players ? `${players}k` : '1.2k'} Online</span>
           </div>
        </div>
      </div>
      
      {/* Corner Accents */}
      <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-white/20"></div>
      <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-white/20"></div>
      <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-white/20"></div>
      <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-white/20"></div>
    </div>
  );
};

export default GameCard;