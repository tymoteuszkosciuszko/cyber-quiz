import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from './utils';

const SheetContext = createContext(null);

const EXIT_DURATION_MS = 210;

const SIDE_CLASSES = {
  right: {
    base: 'inset-y-0 right-0 h-full w-full sm:max-w-md border-l-2 border-border shadow-[-4px_0px_0px_0px_var(--border)]',
    enter: 'animate-sheet-in-right',
    exit: 'animate-sheet-out-right',
  },
  left: {
    base: 'inset-y-0 left-0 h-full w-full sm:max-w-md border-r-2 border-border shadow-[4px_0px_0px_0px_var(--border)]',
    enter: 'animate-sheet-in-left',
    exit: 'animate-sheet-out-left',
  },
  top: {
    base: 'inset-x-0 top-0 w-full max-h-[85vh] border-b-2 border-border shadow-[0px_4px_0px_0px_var(--border)]',
    enter: 'animate-sheet-in-top',
    exit: 'animate-sheet-out-top',
  },
  bottom: {
    base: 'inset-x-0 bottom-0 w-full max-h-[85vh] border-t-2 border-border shadow-[0px_-4px_0px_0px_var(--border)]',
    enter: 'animate-sheet-in-bottom',
    exit: 'animate-sheet-out-bottom',
  },
};

function CloseIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function Sheet({ open = false, onOpenChange, children }) {
  const [rendered, setRendered] = useState(open);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (open) {
      setRendered(true);
      return undefined;
    }
    const timer = setTimeout(() => {
      setRendered(false);
    }, EXIT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <SheetContext.Provider
      value={{
        open,
        rendered,
        onOpenChange,
        titleId,
        descriptionId,
      }}
    >
      {children}
    </SheetContext.Provider>
  );
}

export function SheetOverlay({ className, ...props }) {
  const ctx = useContext(SheetContext);
  if (!ctx?.rendered) return null;

  return (
    <div
      data-slot="sheet-overlay"
      data-state={ctx.open ? 'open' : 'closed'}
      aria-hidden="true"
      onClick={() => ctx.onOpenChange?.(false)}
      className={cn(
        'fixed inset-0 z-50 bg-overlay',
        ctx.open ? 'animate-overlay-in' : 'animate-overlay-out pointer-events-none',
        className
      )}
      {...props}
    />
  );
}

export function SheetContent({
  side = 'right',
  showCloseButton = true,
  className,
  children,
  'aria-label': ariaLabel,
  ...props
}) {
  const ctx = useContext(SheetContext);
  const contentRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onOpenChangeRef = useRef(ctx?.onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = ctx?.onOpenChange;
  }, [ctx?.onOpenChange]);

  const isOpen = Boolean(ctx?.open);
  const isRendered = Boolean(ctx?.rendered);

  // Blokada przewijania tła + przywracanie fokusu + obsługa klawisza Escape
  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = requestAnimationFrame(() => {
      contentRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChangeRef.current?.(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isRendered || typeof document === 'undefined') return null;

  const sideConfig = SIDE_CLASSES[side] || SIDE_CLASSES.right;

  return createPortal(
    <div data-slot="sheet-portal">
      <SheetOverlay />
      <div
        ref={contentRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : ctx.titleId}
        aria-describedby={ctx.descriptionId}
        data-slot="sheet-content"
        data-side={side}
        data-state={isOpen ? 'open' : 'closed'}
        className={cn(
          'fixed z-50 flex flex-col bg-secondary-background text-foreground outline-none',
          sideConfig.base,
          isOpen ? sideConfig.enter : `${sideConfig.exit} pointer-events-none`,
          className
        )}
        {...props}
      >
        {showCloseButton && (
          <button
            type="button"
            onClick={() => ctx.onOpenChange?.(false)}
            aria-label="Zamknij panel"
            className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-base border-2 border-border bg-secondary-background text-foreground shadow-shadow transition-all cursor-pointer hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

export function SheetHeader({ className, children, ...props }) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        'flex flex-col gap-1.5 border-b-2 border-border bg-background p-6 pr-16',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SheetFooter({ className, children, ...props }) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'mt-auto flex flex-col-reverse gap-2 border-t-2 border-border bg-background px-6 py-4 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SheetTitle({ className, children, ...props }) {
  const ctx = useContext(SheetContext);
  return (
    <h2
      id={ctx?.titleId}
      data-slot="sheet-title"
      className={cn(
        'font-heading text-lg font-extrabold leading-tight tracking-tight text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </h2>
  );
}

export function SheetDescription({ className, children, ...props }) {
  const ctx = useContext(SheetContext);
  return (
    <p
      id={ctx?.descriptionId}
      data-slot="sheet-description"
      className={cn('text-sm font-base text-foreground/75', className)}
      {...props}
    >
      {children}
    </p>
  );
}

export function SheetClose({ onClick, children, ...props }) {
  const ctx = useContext(SheetContext);
  return (
    <button
      type="button"
      data-slot="sheet-close"
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) {
          ctx?.onOpenChange?.(false);
        }
      }}
      {...props}
    >
      {children}
    </button>
  );
}

