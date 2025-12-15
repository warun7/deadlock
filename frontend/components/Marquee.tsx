import React from 'react';

const Marquee = () => {
  const items = [
    "USER_882 WON 25RP",
    "TOURNAMENT STARTING IN 5MIN",
    "NEW PROBLEM SET: DYNAMIC PROGRAMMING",
    "SERVER LOAD: 98%",
    "TOP RANK: VOID_RUNNER (3200 ELO)",
    "LIVE BATTLES: 4,201",
    "SYSTEM STATUS: ONLINE",
    "WEEKLY CHALLENGE: REVERSE LINKED LIST II"
  ];

  return (
    <div className="w-full bg-red-950/20 border-y border-red-900/30 overflow-hidden py-2 relative z-20">
      <div className="animate-marquee whitespace-nowrap flex gap-12 items-center">
        {[...items, ...items, ...items].map((item, i) => (
          <div key={i} className="flex items-center gap-3 text-xs font-mono font-bold text-red-500/70 tracking-widest">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Marquee;