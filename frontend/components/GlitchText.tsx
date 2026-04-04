import React from 'react';

interface GlitchTextProps {
  text: string;
  className?: string;
}

const GlitchText: React.FC<GlitchTextProps> = ({ text, className = "" }) => {
  return (
    <div className={`relative inline-block group ${className}`}>
      <span className="relative z-10">{text}</span>
      <span className="absolute top-0 left-0 -z-10 w-full h-full text-red-500/60 opacity-0 group-hover:opacity-100 group-hover:translate-x-[1px] transition-all duration-100 select-none">
        {text}
      </span>
      <span className="absolute top-0 left-0 -z-10 w-full h-full opacity-0 group-hover:opacity-40 group-hover:-translate-x-[1px] transition-all duration-100 select-none" style={{ color: 'var(--text-ghost)' }}>
        {text}
      </span>
    </div>
  );
};

export default GlitchText;