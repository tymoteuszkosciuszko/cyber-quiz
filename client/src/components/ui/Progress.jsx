import { cn } from './utils';

export function Progress({ value = 0, indicatorClassName, className, ...props }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn(
        'relative h-5 w-full overflow-hidden rounded-base border-2 border-border bg-secondary-background',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'h-full bg-main transition-all duration-100',
          clamped > 0 && clamped < 100 && 'border-r-2 border-border',
          indicatorClassName
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
