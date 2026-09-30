import React from "react";

const Wordmark: React.FC<{ className?: string }> = ({ className = "" }) => (
  <span className={`font-sans font-bold uppercase tracking-[-0.04em] ${className}`}>
    Dead<span className="text-accent">lock</span>
  </span>
);

export default Wordmark;
