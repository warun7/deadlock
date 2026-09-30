import React from "react";
import { Link, LinkProps } from "react-router-dom";
import { CircleNotch } from "@phosphor-icons/react";

type Variant = "primary" | "accent" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[background-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out-expo)] active:translate-y-px disabled:pointer-events-none disabled:opacity-45";

const variants: Record<Variant, string> = {
  primary: "bg-fg text-bg hover:bg-accent hover:text-on-accent",
  accent: "bg-accent text-on-accent hover:bg-fg hover:text-bg",
  outline: "shadow-[inset_0_0_0_1px_var(--fg)] text-fg hover:bg-fg hover:text-bg",
  ghost: "text-fg-2 hover:bg-bg-2 hover:text-fg",
  danger: "shadow-[inset_0_0_0_1px_var(--accent-ink)] text-accent-ink hover:bg-accent hover:text-on-accent hover:shadow-none",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-10 px-5 text-sm",
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

/** Keyboard hint in the house style: [K]. Hidden on touch screens. */
export const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <kbd className={`font-mono text-[11px] font-normal tracking-normal opacity-60 [@media(pointer:coarse)]:hidden ${className}`}>
    [{children}]
  </kbd>
);
