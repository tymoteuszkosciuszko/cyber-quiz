import { cn } from './utils';

export function Switch({
  checked = false,
  onCheckedChange,
  disabled = false,
  id,
  className,
  ...props
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-secondary-background disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-main' : 'bg-background',
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full border-2 border-border bg-secondary-background transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
        )}
      />
    </button>
  );
}

