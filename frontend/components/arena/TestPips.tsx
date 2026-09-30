import React from "react";

interface TestPipsProps {
  passed: number;
  total: number;
  /** Colour of filled cells. "pass" when the run was accepted. */
  tone?: "you" | "opponent" | "pass";
  className?: string;
  /** Cell size in px */
  size?: number;
}

const toneClass = {
  you: "bg-fg",
  opponent: "bg-accent",
  pass: "bg-pass",
};

/** Tests-passed meter: one square per test. */
const TestPips: React.FC<TestPipsProps> = ({ passed, total, tone = "you", className = "", size = 8 }) => {
  const count = Math.max(total, 1);
  return (
    <div
      className={`flex items-center gap-[2px] ${className}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={passed}
      aria-label={`${passed} of ${total} tests passed`}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`block shrink-0 transition-colors duration-300 ${i < passed ? toneClass[tone] : "bg-fg/15"}`}
          style={{ width: size, height: size, transitionDelay: `${i * 30}ms` }}
        />
      ))}
    </div>
  );
};

export default TestPips;
