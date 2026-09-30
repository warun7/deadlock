import React, { useId, useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Rendered at the right end of the label row (e.g. "Forgot password?") */
  labelAside?: React.ReactNode;
}

/** Label above input, hint and error below. Password inputs get a show/hide toggle. */
const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  ({ label, hint, error, labelAside, type = "text", className = "", id, ...rest }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;
    const [reveal, setReveal] = useState(false);
    const isPassword = type === "password";

    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <div className="flex items-baseline justify-between">
          <label htmlFor={inputId} className="text-[13px] font-medium text-fg-2">
            {label}
          </label>
          {labelAside}
        </div>
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={isPassword && reveal ? "text" : type}
            aria-invalid={error ? true : undefined}
            aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
            className={`h-11 w-full rounded-[var(--radius-control)] bg-surface-1 px-3.5 text-[15px] text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-shadow placeholder:text-fg-3/80 focus:shadow-[inset_0_0_0_1px_var(--color-accent-text),0_0_0_3px_rgb(229_72_77/0.18)] focus:outline-none disabled:opacity-60 ${
              isPassword ? "pr-11" : ""
            } ${error ? "shadow-[inset_0_0_0_1px_var(--color-accent-text)]" : ""}`}
            {...rest}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? "Hide password" : "Show password"}
              aria-pressed={reveal}
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-[8px] text-fg-3 transition-colors hover:bg-white/[0.06] hover:text-fg"
            >
              {reveal ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
            </button>
          )}
        </div>
        {hint && !error && (
          <p id={hintId} className="text-[12px] text-fg-3">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-[12px] text-accent-text">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Field.displayName = "Field";

export default Field;
