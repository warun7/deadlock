import React, { useId, useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Rendered at the right end of the label row (e.g. "Forgot password?") */
  labelAside?: React.ReactNode;
}

/** Mono label above input, hint and error below. Password inputs get a show/hide toggle. */
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
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={inputId} className="label text-fg">
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
            className={`h-11 w-full rounded-[3px] border bg-bg px-3 text-[15px] text-fg transition-[border-color,box-shadow] placeholder:text-fg-3 focus:border-fg focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] focus:outline-none disabled:opacity-60 ${
              isPassword ? "pr-11" : ""
            } ${error ? "border-accent-ink" : "border-line hover:border-fg-3"}`}
            {...rest}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? "Hide password" : "Show password"}
              aria-pressed={reveal}
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-[3px] text-fg-3 transition-colors hover:bg-bg-2 hover:text-fg"
            >
              {reveal ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
            </button>
          )}
        </div>
        {hint && !error && (
          <p id={hintId} className="text-[13px] text-fg-3">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-[13px] text-accent-ink">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Field.displayName = "Field";

export default Field;
