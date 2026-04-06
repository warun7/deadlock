import React from 'react';
import Marquee from './Marquee';
import { Github, Twitter, Disc } from 'lucide-react';

const Footer: React.FC = () => {
  return (
    <footer className="relative overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)', borderTop: '1px solid var(--border-primary)' }}>
        <Marquee />
        
        {/* Background Text */}
        <div className="absolute bottom-0 left-0 w-full overflow-hidden pointer-events-none opacity-[0.03] select-none leading-none">
            <h1 className="text-[20vw] font-black whitespace-nowrap translate-y-[20%]" style={{ color: 'var(--text-primary)' }}>DEADLOCK</h1>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20 relative z-10">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
                
                {/* Brand Column */}
                <div className="md:col-span-4">
                    <h2 className="text-2xl font-black mb-6 font-mono tracking-tight flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        DEAD<span className="text-red-600">LOCK</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-card-solid)', color: 'var(--text-muted)' }}>BETA</span>
                    </h2>
                    <p className="font-mono text-sm mb-8 max-w-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                        The competitive 1v1 coding platform. Prove your algorithmic skills in real-time battles.
                    </p>
                    <div className="flex gap-4">
                        {/* Social Links hidden for MVP */}
                    </div>
                </div>

                <div className="md:col-span-8 flex justify-end">
                    {/* Links temporarily removed for MVP */}
                </div>

            </div>

            <div className="mt-12 sm:mt-20 pt-6 sm:pt-8 flex flex-col md:flex-row justify-between items-center gap-4" style={{ borderTop: '1px solid var(--border-primary)' }}>
                <p className="text-xs font-mono uppercase" style={{ color: 'var(--text-ghost)' }}>
                    © 2026 Deadlock. All rights reserved.
                </p>
                <div className="flex items-center gap-6 text-[10px] font-mono uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
                    <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                        All systems operational
                    </span>
                </div>
            </div>
        </div>
    </footer>
  );
};

export default Footer;