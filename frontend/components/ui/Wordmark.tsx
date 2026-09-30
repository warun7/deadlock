import React from "react";

/** Two blocks pressed against each other: neither can move. */
export const Mark: React.FC<{ className?: string }> = ({ className = "size-3.5" }) => (
  <svg viewBox="0 0 16 16" className={`shrink-0 ${className}`} aria-hidden="true">
    <rect x="0.5" y="0.5" width="9" height="9" fill="currentColor" />
    <rect x="6.5" y="6.5" width="9" height="9" fill="var(--accent)" />
  </svg>
);

const Wordmark: React.FC<{ className?: string }> = ({ className = "" }) => (
  <span className={`inline-flex items-center gap-2 font-mono text-[12px] font-medium uppercase tracking-[0.04em] ${className}`}>
    <Mark />
    Deadlock
  </span>
);

export default Wordmark;
