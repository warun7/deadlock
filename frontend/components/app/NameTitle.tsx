import React from "react";

/** Giant name that shrinks for long usernames so it never overflows. */
const NameTitle: React.FC<{ name: string; count?: number; className?: string }> = ({ name, count, className = "" }) => (
  <h1
    className={`min-w-0 break-words font-medium leading-[0.88] tracking-[-0.06em] text-fg ${className}`}
    style={{ fontSize: `clamp(2rem, min(14vw, ${Math.round(150 / Math.max(name.length, 1))}vw), 8.25rem)` }}
  >
    {name}
    {count !== undefined && (
      <sup className="tabular ml-[0.06em] align-top text-[max(0.2em,13px)] font-normal leading-none tracking-normal">
        ({count})
      </sup>
    )}
  </h1>
);

export default NameTitle;
