import React from "react";

interface TestPipsProps {
  passed: number;
  total: number;
  /** Colour of filled pips. "pass" when the run was accepted. */
  tone?: "you" | "opponent" | "pass";
  className?: string;
  /** Stagger fill transitions (used on the landing preview). */
  stagger?: boolean;
}

const toneClass = {
  you: "bg-fg",
  opponent: "bg-accent",
  pass: "bg-pass",
};

/** Segmented tests-passed meter, one pip per test. */
const TestPips: React.FC<TestPipsProps> = ({ passed, total, tone = "you", className = "", stagger }) => {
  const count = Math.max(total, 1);
  return (
    <div
      className={`flex items-center gap-[3px] ${className}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={passed}
      aria-label={`${passed} of ${total} tests passed`}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`h-2 flex-1 rounded-[2px] transition-[background-color,opacity,transform] duration-500 ease-[var(--ease-out-expo)] ${
            i < passed ? `${toneClass[tone]} opacity-100` : "bg-white/[0.07]"
          }`}
          style={stagger ? { transitionDelay: `${i * 45}ms` } : undefined}
        />
      ))}
    </div>
  );
};

export default TestPips;
