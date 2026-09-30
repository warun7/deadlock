import React from "react";
import { Link } from "react-router-dom";
import { SlidersHorizontal, TerminalWindow } from "@phosphor-icons/react";

/*
  House chrome: mono labels over hairline rules, registration crosses,
  figure frames, chips. Shared by the landing page and the app.
*/

/** "/ LABEL" over a rule. Put the heading level on `as` when it titles a section. */
export const Label: React.FC<{
  children: React.ReactNode;
  aside?: React.ReactNode;
  as?: "div" | "h2" | "h3";
  id?: string;
  className?: string;
  rule?: boolean;
}> = ({ children, aside, as: Tag = "div", id, className = "", rule = true }) => (
  <div className={`flex items-end justify-between gap-4 pb-2 text-fg ${rule ? "border-b border-rule" : ""} ${className}`}>
    <Tag id={id} className="label font-normal">
      <span aria-hidden="true">/ </span>
      {children}
    </Tag>
    {aside && <div className="label text-fg-2">{aside}</div>}
  </div>
);

/** Registration cross, the little "+" that marks grid intersections. */
export const Cross: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className = "", style }) => (
  <svg viewBox="0 0 11 11" style={style} className={`pointer-events-none absolute size-[11px] text-fg ${className}`} aria-hidden="true">
    <path d="M5.5 0v11M0 5.5h11" stroke="currentColor" strokeWidth="1" />
  </svg>
);

/** A row of crosses on the page grid. Positions are percentages of the row width. */
export const CrossRow: React.FC<{ at?: number[]; className?: string }> = ({ at = [0, 62, 86, 100], className = "" }) => (
  <div className={`relative h-px ${className}`} aria-hidden="true">
    {at.map((p) => (
      <Cross key={p} className="-top-[5px] -translate-x-1/2" style={{ left: `${p}%` }} />
    ))}
  </div>
);

/** Figure frame: title bar with "[ FIG. n ]", inset border, dotted drafting grid. */
export const Figure: React.FC<{
  n: number | string;
  caption?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  dots?: boolean;
}> = ({ n, caption, children, className = "", bodyClassName = "", dots = true }) => (
  <figure className={`m-0 flex flex-col border border-fg bg-bg ${className}`}>
    <div className="flex h-[22px] shrink-0 items-center justify-between px-1.5 text-fg" aria-hidden="true">
      <TerminalWindow className="size-3.5" />
      <span className="font-mono text-[9.5px] tracking-[0.08em]">[ FIG. {n} ]</span>
      <SlidersHorizontal className="size-3.5" />
    </div>
    <div className={`relative m-[5px] mt-0 min-h-0 flex-1 overflow-hidden border border-fg ${dots ? "dots" : ""} ${bodyClassName}`}>{children}</div>
    {caption && <figcaption className="sr-only">{caption}</figcaption>}
  </figure>
);

/** Mono chip, optionally with a keyboard shortcut hint: [K] LABEL. */
export const Chip: React.FC<{
  k?: string;
  children: React.ReactNode;
  active?: boolean;
  tone?: "default" | "accent" | "ink";
  className?: string;
}> = ({ k, children, active, tone = "default", className = "" }) => {
  const tones = {
    default: active ? "bg-fg text-bg" : "bg-bg-2 text-fg hover:bg-bg-3",
    accent: "bg-accent text-on-accent hover:bg-fg hover:text-bg",
    ink: "bg-fg text-bg hover:bg-accent hover:text-on-accent",
  };
  return (
    <span
      data-kbd={k?.toLowerCase()}
      className={`label inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[3px] px-2 transition-[background-color,color,transform] duration-150 ease-[var(--ease-out-expo)] active:scale-[0.95] data-pressed:scale-[0.92] data-pressed:bg-accent data-pressed:text-on-accent ${tones[tone]} ${className}`}
    >
      {k && <span className="opacity-70 [@media(pointer:coarse)]:hidden">[{k}]</span>}
      {children}
    </span>
  );
};

/** Chip that navigates. */
export const ChipLink: React.FC<{
  to: string;
  k?: string;
  children: React.ReactNode;
  active?: boolean;
  tone?: "default" | "accent" | "ink";
  className?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  "aria-current"?: "page";
}> = ({ to, k, children, active, tone, className = "", onClick, ...rest }) => (
  <Link to={to} onClick={onClick} className={`rounded-[3px] ${className}`} {...rest}>
    <Chip k={k} active={active} tone={tone}>
      {children}
    </Chip>
  </Link>
);

/** Small bordered tag, e.g. "PYTHON" or "WON". */
export const Tag: React.FC<{ children: React.ReactNode; tone?: "default" | "pass" | "fail" | "warn"; className?: string }> = ({
  children,
  tone = "default",
  className = "",
}) => {
  const tones = {
    default: "border-line text-fg-2",
    pass: "border-pass-ink/50 text-pass-ink",
    fail: "border-accent-ink/50 text-accent-ink",
    warn: "border-warn-ink/50 text-warn-ink",
  };
  return (
    <span className={`label inline-flex h-[22px] items-center rounded-[3px] border px-1.5 text-[10.5px] ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
};

/** Giant section title with a superscript count: "Featured (20)". */
export const BigTitle: React.FC<{
  children: React.ReactNode;
  count?: number | string;
  as?: "h1" | "h2";
  id?: string;
  className?: string;
}> = ({ children, count, as: Tag = "h2", id, className = "" }) => (
  <Tag
    id={id}
    className={`text-[clamp(3rem,9vw,8.25rem)] font-medium leading-[0.88] tracking-[-0.06em] text-fg ${className}`}
  >
    {children}
    {count !== undefined && (
      <sup className="tabular ml-[0.08em] align-top text-[max(0.2em,14px)] font-normal leading-none tracking-normal">
        ({count})
      </sup>
    )}
  </Tag>
);

/** "■ EXAMPLE: text" line over a dotted rule. */
export const Detail: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({
  label,
  children,
  className = "",
}) => (
  <p className={`rule-dotted flex items-baseline gap-2 pb-3 pt-1 ${className}`}>
    <span className="inline-block size-[7px] shrink-0 translate-y-[-1px] bg-fg" aria-hidden="true" />
    <span className="label text-fg">{label}:</span>
    <span className="label text-fg-2">{children}</span>
  </p>
);
