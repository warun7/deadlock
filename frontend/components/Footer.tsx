import React from 'react';
import Marquee from './Marquee';
import { Github, Twitter, Disc } from 'lucide-react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-[#020202] relative overflow-hidden border-t border-stone-900">
        <Marquee />
        
        {/* Massive Background Text */}
        <div className="absolute bottom-0 left-0 w-full overflow-hidden pointer-events-none opacity-5 select-none leading-none">
            <h1 className="text-[20vw] font-black text-white whitespace-nowrap translate-y-[20%]">DEADLOCK</h1>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
                
                {/* Brand Column */}
                <div className="md:col-span-4">
                    <h2 className="text-2xl font-black text-white mb-6 font-mono tracking-tight flex items-center gap-2">
                        DEAD<span className="text-red-600">LOCK</span>
                        <span className="text-[10px] px-2 py-0.5 bg-stone-800 text-stone-400 rounded-full">BETA</span>
                    </h2>
                    <p className="text-stone-500 font-mono text-sm mb-8 max-w-xs leading-relaxed">
                        The world's most advanced 1v1 competitive coding platform. Prove your logic or get garbage collected.
                    </p>
                    <div className="flex gap-4">
                        {[Github, Twitter, Disc].map((Icon, i) => (
                            <a key={i} href="#" className="w-10 h-10 flex items-center justify-center border border-stone-800 bg-stone-900/50 text-stone-400 hover:text-white hover:border-red-600 hover:bg-red-600/10 transition-all duration-300 group">
                                <Icon className="w-4 h-4 group-hover:scale-110 transition-transform" />
                            </a>
                        ))}
                    </div>
                </div>

                {/* Links Grid */}
                <div className="md:col-span-8 grid grid-cols-2 md:grid-cols-3 gap-8">
                    {[
                        { title: "Battle", links: ["Ranked Match", "Custom Game", "Tournaments", "Leaderboard"] },
                        { title: "Resources", links: ["Documentation", "API Status", "Algorithm Wiki", "Community"] },
                        { title: "Legal", links: ["Privacy Policy", "Terms of Service", "Code of Conduct", "DMCA"] }
                    ].map((col, i) => (
                        <div key={i}>
                            <h3 className="text-stone-300 font-bold font-mono uppercase tracking-widest text-xs mb-6 border-l-2 border-red-600 pl-2">
                                {col.title}
                            </h3>
                            <ul className="space-y-3">
                                {col.links.map((link, j) => (
                                    <li key={j}>
                                        <a href="#" className="text-stone-500 hover:text-white hover:translate-x-2 transition-all duration-300 text-sm font-mono flex items-center gap-2 group">
                                            <span className="w-0 group-hover:w-2 h-[1px] bg-red-600 transition-all duration-300"></span>
                                            {link}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

            </div>

            <div className="mt-20 pt-8 border-t border-stone-900 flex flex-col md:flex-row justify-between items-center gap-4">
                <p className="text-stone-700 text-xs font-mono uppercase">
                    © 2024 Deadlock Inc. All systems normal.
                </p>
                <div className="flex items-center gap-6 text-[10px] font-mono text-stone-600 uppercase tracking-widest">
                    <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                        Server: US-EAST-1
                    </span>
                    <span>Latency: 24ms</span>
                </div>
            </div>
        </div>
    </footer>
  );
};

export default Footer;