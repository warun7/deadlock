import React from "react";
import { Link, LinkProps } from "react-router-dom";
import { CircleNotch } from "@phosphor-icons/react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] font-medium tracking-[-0.01em] transition-[background-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out-expo)] active:translate-y-px active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent-strong text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_24px_-8px_rgb(207_52_60/0.55)] hover:bg-accent-strong-hover",
  secondary:
    "bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-surface-3",
  ghost: "text-fg-2 hover:bg-white/[0.05] hover:text-fg",
  danger:
    "bg-transparent text-accent-text shadow-[inset_0_0_0_1px_rgb(229_72_77/0.4)] hover:bg-accent/10",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  className?: string;
  children: React.ReactNode;
}

type ButtonProps = CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading, className = "", children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <CircleNotch className="size-4 animate-spin" weight="bold" aria-hidden="true" />}
      {children}
    </button>
  )
);
Button.displayName = "Button";

type ButtonLinkProps = CommonProps & LinkProps;

export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ variant = "primary", size = "md", className = "", children, loading: _loading, ...rest }, ref) => (
    <Link ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {children}
    </Link>
  )
);
ButtonLink.displayName = "ButtonLink";

export const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <kbd
    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-white/10 px-1 font-mono text-[11px] font-medium text-current opacity-80 [@media(pointer:coarse)]:hidden ${className}`}
  >
    {children}
  </kbd>
);
