import { cn } from './utils';

export function Select({ className, children, ...props }) {
  return (
    <div className="relative w-full">
      <select
        className={cn(
          'flex h-11 w-full appearance-none rounded-base border-2 border-border bg-secondary-background px-3.5 py-2 pr-10 text-sm font-base text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
