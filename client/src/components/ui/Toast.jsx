import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './utils';

const MAX_VISIBLE_TOASTS = 5;
const EXIT_DURATION_MS = 210;

const DEFAULT_DURATIONS = {
  success: 4000,
  default: 4000,
  info: 4500,
  neutral: 3500,
  warning: 5500,
  error: 6000,
  danger: 6000,
};

const VARIANT_CLASSES = {
  default: 'bg-main text-main-foreground',
  success: 'bg-main text-main-foreground',
  error: 'bg-danger text-foreground',
  danger: 'bg-danger text-foreground',
  warning: 'bg-warning text-foreground',
  info: 'bg-info text-foreground',
  neutral: 'bg-secondary-background text-foreground',
};

let toastSeq = 0;
let toastsState = [];
const listeners = new Set();

function notifyListeners() {
  for (const listener of listeners) {
    listener(toastsState);
  }
}

function removeToastImmediate(id) {
  toastsState = toastsState.filter((t) => t.id !== id);
  notifyListeners();
}

function dismissToast(id) {
  const target = toastsState.find((t) => t.id === id);
  if (!target || target.closing) return;

  toastsState = toastsState.map((t) =>
    t.id === id ? { ...t, closing: true } : t
  );
  notifyListeners();

  setTimeout(() => {
    removeToastImmediate(id);
  }, EXIT_DURATION_MS);
}

function dismissAllToasts() {
  if (toastsState.length === 0) return;
  const ids = toastsState.map((t) => t.id);
  toastsState = toastsState.map((t) => ({ ...t, closing: true }));
  notifyListeners();

  setTimeout(() => {
    toastsState = toastsState.filter((t) => !ids.includes(t.id));
    notifyListeners();
  }, EXIT_DURATION_MS);
}

function addToast(input) {
  const opts =
    typeof input === 'string'
      ? { title: input, variant: 'default' }
      : { variant: 'default', ...input };

  const id = `toast-${++toastSeq}-${Date.now()}`;
  const variant = opts.variant || 'default';
  const duration =
    typeof opts.duration === 'number'
      ? opts.duration
      : DEFAULT_DURATIONS[variant] ?? 4000;

  const entry = {
    id,
    title: opts.title || '',
    description: opts.description || '',
    variant,
    duration,
    action: opts.action || null,
    closing: false,
  };

  const active = toastsState.filter((t) => !t.closing);
  if (active.length >= MAX_VISIBLE_TOASTS) {
    const oldest = active[0];
    if (oldest) {
      dismissToast(oldest.id);
    }
  }

  toastsState = [...toastsState, entry];
  notifyListeners();
  return id;
}

function createVariantHelper(variant) {
  return (title, descriptionOrOptions) => {
    if (typeof descriptionOrOptions === 'string') {
      return addToast({
        title,
        description: descriptionOrOptions,
        variant,
      });
    }
    return addToast({
      ...(descriptionOrOptions || {}),
      title,
      variant,
    });
  };
}

export function toast(input) {
  return addToast(input);
}

toast.success = createVariantHelper('success');
toast.error = createVariantHelper('error');
toast.warning = createVariantHelper('warning');
toast.info = createVariantHelper('info');
toast.neutral = createVariantHelper('neutral');
toast.dismiss = dismissToast;
toast.dismissAll = dismissAllToasts;

function ToastIcon({ variant }) {
  const iconClass = 'h-4 w-4';
  if (variant === 'error' || variant === 'danger') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClass}
      >
        <circle cx="12" cy="12" r="9" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </svg>
    );
  }
  if (variant === 'warning') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClass}
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  if (variant === 'info') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClass}
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    );
  }
  if (variant === 'neutral') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClass}
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    );
  }
  // success / default
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={iconClass}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ToastItem({ item, onDismiss }) {
  const remainingRef = useRef(item.duration);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    if (item.closing || item.duration <= 0 || item.duration === Infinity) {
      return;
    }
    clearTimer();
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss(item.id);
    }, Math.max(0, remainingRef.current));
  }, [clearTimer, item.closing, item.duration, item.id, onDismiss]);

  const pauseTimer = useCallback(() => {
    if (!timerRef.current) return;
    clearTimer();
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(250, remainingRef.current - elapsed);
  }, [clearTimer]);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  const isAssertive =
    item.variant === 'error' ||
    item.variant === 'danger' ||
    item.variant === 'warning';

  return (
    <div
      role={isAssertive ? 'alert' : 'status'}
      aria-live={isAssertive ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-slot="toast"
      data-variant={item.variant}
      data-state={item.closing ? 'closed' : 'open'}
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
      onFocus={pauseTimer}
      onBlur={startTimer}
      className={cn(
        'pointer-events-auto relative flex w-full items-start gap-3 rounded-base border-2 border-border p-3.5 shadow-shadow',
        VARIANT_CLASSES[item.variant] || VARIANT_CLASSES.default,
        item.closing ? 'animate-toast-out pointer-events-none' : 'animate-toast-in'
      )}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-base border-2 border-border bg-secondary-background text-foreground"
      >
        <ToastIcon variant={item.variant} />
      </span>

      <div className="min-w-0 flex-1 space-y-0.5 pr-1">
        {item.title && (
          <div className="font-heading text-sm font-extrabold leading-snug break-words">
            {item.title}
          </div>
        )}
        {item.description && (
          <div className="text-xs font-base leading-relaxed text-foreground/85 break-words">
            {item.description}
          </div>
        )}
        {item.action?.label && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                item.action.onClick?.();
                onDismiss(item.id);
              }}
              className="inline-flex h-7 items-center justify-center rounded-base border-2 border-border bg-secondary-background px-2.5 font-heading text-xs font-bold text-foreground transition-colors cursor-pointer hover:bg-background"
            >
              {item.action.label}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Zamknij powiadomienie"
        className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-base border-2 border-border bg-secondary-background text-foreground transition-colors cursor-pointer hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}

export function Toaster({ className }) {
  const [toasts, setToasts] = useState(toastsState);

  useEffect(() => {
    listeners.add(setToasts);
    setToasts(toastsState);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  if (typeof document === 'undefined' || toasts.length === 0) return null;

  return createPortal(
    <div
      data-slot="toast-viewport"
      aria-label="Powiadomienia"
      className={cn(
        'pointer-events-none fixed bottom-4 right-4 z-[100] flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-sm flex-col gap-3',
        className
      )}
    >
      {toasts.map((item) => (
        <ToastItem key={item.id} item={item} onDismiss={dismissToast} />
      ))}
    </div>,
    document.body
  );
}

