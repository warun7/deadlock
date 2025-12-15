import React from 'react';
import { Swords, TrendingUp, Terminal, Zap, Code2, Trophy, Users } from 'lucide-react';
import { motion } from 'framer-motion';

// Noise texture SVG as data URI for performance
const noiseTexture = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`;

// Grid pattern for texture
const gridPattern = "linear-gradient(to right, rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.02) 1px, transparent 1px)";

interface BentoCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  className?: string;
  variant?: 'default' | 'featured' | 'accent' | 'dark';
  index: number;
}

const BentoCard: React.FC<BentoCardProps> = ({ title, description, icon, className = '', variant = 'default', index }) => {
  const variants = {
    default: {
      bg: 'bg-[#0a0a0a]',
      border: 'border-stone-800/50',
      hoverBorder: 'hover:border-stone-700',
      iconBg: 'bg-stone-900/80',
      iconColor: 'text-stone-400 group-hover:text-white',
    },
    featured: {
      bg: 'bg-gradient-to-br from-red-950/40 via-[#0a0a0a] to-[#080808]',
      border: 'border-red-900/30',
      hoverBorder: 'hover:border-red-600/60',
      iconBg: 'bg-red-900/30',
      iconColor: 'text-red-500 group-hover:text-red-400',
    },
    accent: {
      bg: 'bg-gradient-to-br from-amber-950/20 via-[#0a0a0a] to-[#080808]',
      border: 'border-amber-900/20',
      hoverBorder: 'hover:border-amber-600/40',
      iconBg: 'bg-amber-900/20',
      iconColor: 'text-amber-500 group-hover:text-amber-400',
    },
    dark: {
      bg: 'bg-[#060606]',
      border: 'border-stone-900/50',
      hoverBorder: 'hover:border-stone-700',
      iconBg: 'bg-stone-900/50',
      iconColor: 'text-stone-500 group-hover:text-stone-300',
    }
  };

  const v = variants[variant];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.25, 0.1, 0.25, 1] }}
      viewport={{ once: true, margin: "-50px" }}
      className={`group relative ${className}`}
    >
      <div className={`relative h-full p-6 md:p-8 ${v.bg} border ${v.border} ${v.hoverBorder} rounded-2xl transition-all duration-500 overflow-hidden`}>
        
        {/* Noise texture overlay */}
        <div 
          className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay"
          style={{ backgroundImage: noiseTexture }}
        />
        
        {/* Grid pattern overlay */}
        <div 
          className="absolute inset-0 opacity-50 pointer-events-none"
          style={{ backgroundImage: gridPattern, backgroundSize: '24px 24px' }}
        />
        
        {/* Gradient glow on hover */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent" />
        </div>

        {/* Corner decorations */}
        <div className="absolute top-3 left-3 w-3 h-3 border-l border-t border-stone-800 group-hover:border-red-800/50 transition-colors duration-300" />
        <div className="absolute top-3 right-3 w-3 h-3 border-r border-t border-stone-800 group-hover:border-red-800/50 transition-colors duration-300" />
        <div className="absolute bottom-3 left-3 w-3 h-3 border-l border-b border-stone-800 group-hover:border-red-800/50 transition-colors duration-300" />
        <div className="absolute bottom-3 right-3 w-3 h-3 border-r border-b border-stone-800 group-hover:border-red-800/50 transition-colors duration-300" />

        {/* Content */}
        <div className="relative z-10 h-full flex flex-col">
          {/* Icon */}
          <div className={`mb-5 p-3 w-fit ${v.iconBg} backdrop-blur-sm rounded-xl border border-stone-800/50 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
            <div className={`${v.iconColor} transition-colors duration-300`}>
              {icon}
            </div>
          </div>
          
          {/* Title */}
          <h3 className="text-lg md:text-xl font-bold text-white mb-3 font-mono uppercase tracking-tight group-hover:text-red-50 transition-colors">
            {title}
          </h3>
          
          {/* Description */}
          <p className="text-sm text-stone-500 leading-relaxed group-hover:text-stone-400 transition-colors flex-grow">
            {description}
          </p>

          {/* Animated line at bottom */}
          <div className="mt-6 h-[1px] w-full bg-stone-800/50 overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-red-500 to-transparent -translate-x-full group-hover:translate-x-[400%] transition-transform duration-1000 ease-out" />
          </div>
        </div>

        {/* Scan line effect */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-red-500/30 to-transparent animate-[scanline_2s_ease-in-out_infinite]" />
        </div>
      </div>
    </motion.div>
  );
};

const FeatureGrid: React.FC = () => {
  return (
    <section className="py-24 md:py-32 relative z-10 bg-[#050505]">
      {/* Background texture */}
      <div className="absolute inset-0 pointer-events-none">
        <div 
          className="absolute inset-0 opacity-[0.015]"
          style={{ backgroundImage: noiseTexture }}
        />
        {/* Radial gradient accent */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-600/5 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="mb-16 md:mb-20"
        >
          <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
            <div>
              <span className="inline-block px-3 py-1 mb-4 text-xs font-mono uppercase tracking-wider text-red-500 bg-red-500/10 border border-red-500/20 rounded-full">
                ▸ Feature Set
              </span>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-black text-white font-mono uppercase tracking-tighter">
                Built for<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">Competition</span>
              </h2>
            </div>
            <div className="flex items-center gap-3 text-stone-600">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <div className="w-2 h-2 rounded-full bg-stone-700" />
                <div className="w-2 h-2 rounded-full bg-stone-700" />
              </div>
              <span className="font-mono text-xs uppercase">v2.4.0 Stable</span>
            </div>
          </div>
        </motion.div>

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
          
          {/* Row 1 */}
          <BentoCard
            index={0}
            title="1v1 Battles"
            description="Race against your opponent in real-time. First to pass all test cases wins. Pure skill, no luck involved."
            icon={<Swords className="w-6 h-6" />}
            variant="featured"
            className="lg:col-span-2 lg:row-span-2"
          />
          
          <BentoCard
            index={1}
            title="ELO Rating"
            description="Competitive matchmaking ensures balanced fights every time."
            icon={<TrendingUp className="w-6 h-6" />}
            variant="default"
            className="lg:col-span-1"
          />
          
          <BentoCard
            index={2}
            title="Polyglot"
            description="Python, C++, Java, Rust, Go, or JavaScript. Pick your weapon."
            icon={<Terminal className="w-6 h-6" />}
            variant="default"
            className="lg:col-span-1"
          />
          
          {/* Row 2 */}
          <BentoCard
            index={3}
            title="Instant Results"
            description="Submit and see results in milliseconds."
            icon={<Zap className="w-6 h-6" />}
            variant="dark"
            className="lg:col-span-1"
          />
          
          <BentoCard
            index={4}
            title="Match History"
            description="Track your wins, losses, and improvement."
            icon={<Trophy className="w-6 h-6" />}
            variant="accent"
            className="lg:col-span-1"
          />
          
          {/* Row 3 - Full width */}
          <div className="lg:col-span-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              viewport={{ once: true }}
              className="relative p-6 md:p-8 bg-gradient-to-r from-[#0a0a0a] via-red-950/10 to-[#0a0a0a] border border-stone-800/50 rounded-2xl overflow-hidden group"
            >
              {/* Textures */}
              <div 
                className="absolute inset-0 opacity-[0.03] pointer-events-none"
                style={{ backgroundImage: noiseTexture }}
              />
              <div 
                className="absolute inset-0 opacity-30 pointer-events-none"
                style={{ backgroundImage: gridPattern, backgroundSize: '32px 32px' }}
              />
              
              {/* Animated background bars */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {[...Array(5)].map((_, i) => (
                  <div 
                    key={i}
                    className="absolute h-full w-[1px] bg-gradient-to-b from-transparent via-red-500/10 to-transparent"
                    style={{ 
                      left: `${20 + i * 15}%`,
                      animation: `pulse ${2 + i * 0.5}s ease-in-out infinite`,
                      animationDelay: `${i * 0.3}s`
                    }}
                  />
                ))}
              </div>
              
              <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-6">
                  <div className="p-4 bg-red-900/20 rounded-xl border border-red-800/30">
                    <Code2 className="w-8 h-8 text-red-500" />
                  </div>
                  <div>
                    <h3 className="text-xl md:text-2xl font-bold text-white font-mono uppercase tracking-tight mb-1">
                      Real-Time Code Sync
                    </h3>
                    <p className="text-stone-500 text-sm md:text-base">
                      Watch your opponent's progress live. See when they submit. Feel the pressure mount.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-green-400 text-xs font-mono uppercase">WebSocket Live</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Custom keyframes for scan line animation */}
      <style>{`
        @keyframes scanline {
          0%, 100% { transform: translateY(0); opacity: 0; }
          50% { opacity: 1; }
          100% { transform: translateY(100vh); }
        }
      `}</style>
    </section>
  );
};

export default FeatureGrid;