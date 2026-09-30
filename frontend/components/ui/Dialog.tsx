import React, { useEffect, useId, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface DialogProps {
  open: boolean;
  onClose?: () => void;
  /** When false, Esc and backdrop clicks do nothing. */
  dismissible?: boolean;
  title: React.ReactNode;
  children?: React.ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

/** Modal dialog: focus moves in on open and back to the trigger on close; Tab stays inside. */
const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  dismissible = true,
  title,
  children,
  initialFocusRef,
  className = "",
}) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      (initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>("button, [href], input"))?.focus();
    }, 20);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) {
        e.stopPropagation();
        onClose?.();
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      returnFocusRef.current?.focus?.();
    };
  }, [open, dismissible, onClose, initialFocusRef]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-ink/75 backdrop-blur-[6px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => dismissible && onClose?.()}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={`relative w-full max-w-sm rounded-[var(--radius-overlay)] bg-surface-1 p-6 shadow-[inset_0_0_0_1px_var(--color-line-strong),0_30px_80px_-20px_rgb(0_0_0/0.7)] ${className}`}
          >
            <h2 id={titleId} className="text-lg font-semibold tracking-[-0.01em] text-fg">
              {title}
            </h2>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default Dialog;
