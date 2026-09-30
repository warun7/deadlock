import React from "react";

export type DotPattern = "scan" | "ripple" | "orbit" | "spiral";

interface DotLoaderProps {
  pattern?: DotPattern;
  /** Grid is size x size cells */
  size?: 3 | 5;
  /** Cell edge in px */
  cell?: number;
  gap?: number;
  className?: string;
  /** Accessible name. Omit when the loader sits next to visible text. */
  label?: string;
}

// Perimeter of an n x n grid, clockwise from the top-left
function perimeter(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 0; x < n; x++) out.push([x, 0]);
  for (let y = 1; y < n; y++) out.push([n - 1, y]);
  for (let x = n - 2; x >= 0; x--) out.push([x, n - 1]);
  for (let y = n - 2; y > 0; y--) out.push([0, y]);
  return out;
}

// Spiral order from the outside in
function spiral(n: number): [number, number][] {
  const out: [number, number][] = [];
  let [x0, y0, x1, y1] = [0, 0, n - 1, n - 1];
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) out.push([x, y0]);
    for (let y = y0 + 1; y <= y1; y++) out.push([x1, y]);
    if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) out.push([x, y1]);
    if (x1 > x0) for (let y = y1 - 1; y > y0; y--) out.push([x0, y]);
    x0++, y0++, x1--, y1--;
  }
  return out;
}

/** Order index for each cell; null means the cell stays dim. */
function orderFor(pattern: DotPattern, n: number): (number | null)[] {
  const c = (n - 1) / 2;
  const cells = Array.from({ length: n * n }, (_, i) => [i % n, Math.floor(i / n)] as [number, number]);
  const index = (list: [number, number][]) => {
    const map = new Map(list.map(([x, y], i) => [`${x},${y}`, i]));
    return cells.map(([x, y]) => map.get(`${x},${y}`) ?? null);
  };
  switch (pattern) {
    case "scan":
      return cells.map(([x, y]) => x + y);
    case "ripple":
      return cells.map(([x, y]) => Math.max(Math.abs(x - c), Math.abs(y - c)));
    case "orbit":
      return index(perimeter(n));
    case "spiral":
      return index(spiral(n));
  }
}

const STEP: Record<DotPattern, number> = { scan: 0.09, ripple: 0.16, orbit: 0.08, spiral: 0.05 };

/** Tiny LED-grid loader, in the spirit of dot-matrix displays. */
const DotLoader: React.FC<DotLoaderProps> = ({ pattern = "scan", size = 3, cell = 3, gap = 1, className = "", label }) => {
  const order = orderFor(pattern, size);
  const steps = Math.max(...order.map((o) => o ?? 0)) + 1;
  const duration = Math.max(0.7, steps * STEP[pattern] * 1.6);
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-grid shrink-0 ${className}`}
      style={{ gridTemplateColumns: `repeat(${size}, ${cell}px)`, gap }}
    >
      {order.map((o, i) => (
        <span
          key={i}
          className={`block bg-current ${
            o === null ? "opacity-15" : "animate-[dot-blink_var(--dur)_ease-in-out_infinite] opacity-15 motion-reduce:animate-none motion-reduce:opacity-60"
          }`}
          style={{ width: cell, height: cell, ["--dur" as string]: `${duration}s`, animationDelay: o === null ? undefined : `${o * STEP[pattern]}s` }}
        />
      ))}
    </span>
  );
};

export default DotLoader;
